import express from 'express';
import Appointment from '../models/Appointment.js';
import { authenticateToken } from '../middleware/auth.js';
import {
  getOrdersController,
  createOrderRequestBody,
  validatePayPalConfig,
  MEETING_PRICE,
  MEETING_CURRENCY
} from '../lib/paypal.js';

const router = express.Router();

// Get the frontend URL for redirects
const getFrontendUrl = (): string => {
  return process.env.FRONTEND_URL || 
    (process.env.NODE_ENV === 'production' ? 'https://auxin.media' : 'http://localhost:5173');
};

// Create a PayPal order for an appointment
router.post('/create-order', authenticateToken, async (req, res) => {
  try {
    // Validate PayPal configuration
    if (!validatePayPalConfig()) {
      return res.status(500).json({
        error: 'PayPal is not configured properly',
        code: 'PAYPAL_CONFIG_ERROR'
      });
    }

    const { date, time, userEmail, userName, timezone } = req.body;
    const userId = req.user!.userId;

    // Validation
    if (!date || !time || !userEmail || !userName) {
      return res.status(400).json({
        error: 'All fields are required: date, time, userEmail, userName',
        code: 'MISSING_FIELDS'
      });
    }

    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      return res.status(400).json({
        error: 'Invalid date format. Use YYYY-MM-DD',
        code: 'INVALID_DATE_FORMAT'
      });
    }

    // Validate time format and business hours
    const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
    if (!timeRegex.test(time)) {
      return res.status(400).json({
        error: 'Invalid time format. Use HH:MM',
        code: 'INVALID_TIME_FORMAT'
      });
    }

    const [hours, minutes] = time.split(':').map(Number);
    const timeInMinutes = hours * 60 + minutes;
    const startTime = 9 * 60; // 9:00 AM
    const endTime = 17 * 60 + 30; // 5:30 PM

    if (timeInMinutes < startTime || timeInMinutes > endTime || minutes % 30 !== 0) {
      return res.status(400).json({
        error: 'Time must be within business hours (09:00-17:30) in 30-minute intervals',
        code: 'INVALID_TIME_SLOT'
      });
    }

    // Check if date is not in the past
    const appointmentDate = new Date(date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (appointmentDate < today) {
      return res.status(400).json({
        error: 'Cannot book appointments for past dates',
        code: 'PAST_DATE'
      });
    }

    // Check if user email matches authenticated user
    if (userEmail !== req.user!.email) {
      return res.status(400).json({
        error: 'Email must match authenticated user',
        code: 'EMAIL_MISMATCH'
      });
    }

    // Check if time slot is available (exclude pending appointments older than 15 minutes)
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
    const existingAppointment = await Appointment.findOne({
      date: appointmentDate,
      time: time,
      $or: [
        { status: 'confirmed' },
        { 
          status: 'pending', 
          paymentStatus: 'pending',
          createdAt: { $gt: fifteenMinutesAgo }
        }
      ]
    });

    if (existingAppointment) {
      return res.status(409).json({
        error: 'Time slot not available',
        code: 'SLOT_UNAVAILABLE'
      });
    }

    // Check if user already has a confirmed appointment on this date
    const userExistingAppointment = await Appointment.findOne({
      userId: userId,
      date: appointmentDate,
      status: 'confirmed'
    });

    if (userExistingAppointment) {
      return res.status(409).json({
        error: 'You already have a confirmed appointment on this date',
        code: 'DUPLICATE_DATE_BOOKING'
      });
    }

    // Create a pending appointment
    const appointment = new Appointment({
      userId,
      userEmail,
      userName,
      date: appointmentDate,
      time,
      timezone: timezone || 'UTC',
      status: 'pending',
      paymentStatus: 'pending',
      paymentInfo: {
        amount: MEETING_PRICE,
        currency: MEETING_CURRENCY,
        status: 'pending'
      }
    });

    await appointment.save();

    console.log(`📝 Created pending appointment: ${appointment._id} for ${userName} on ${date} at ${time}`);

    // Create PayPal order
    const frontendUrl = getFrontendUrl();
    const returnUrl = `${frontendUrl}/payment/success?appointmentId=${appointment._id}`;
    const cancelUrl = `${frontendUrl}/payment/cancel?appointmentId=${appointment._id}`;

    const ordersController = getOrdersController();
    const orderRequest = createOrderRequestBody(
      appointment._id.toString(),
      { date, time, userName, userEmail },
      returnUrl,
      cancelUrl
    );

    const { result: order } = await ordersController.createOrder({ body: orderRequest });

    // Update appointment with PayPal order ID
    appointment.paymentInfo = {
      ...appointment.paymentInfo,
      paypalOrderId: order.id,
      amount: MEETING_PRICE,
      currency: MEETING_CURRENCY,
      status: 'pending'
    };
    await appointment.save();

    console.log(`💳 Created PayPal order: ${order.id} for appointment ${appointment._id}`);

    // Find the approval URL
    const approvalUrl = order.links?.find((link: any) => link.rel === 'payer-action')?.href ||
                       order.links?.find((link: any) => link.rel === 'approve')?.href;

    if (!approvalUrl) {
      console.error('❌ No approval URL in PayPal response:', order);
      return res.status(500).json({
        error: 'Failed to get PayPal approval URL',
        code: 'PAYPAL_APPROVAL_URL_ERROR'
      });
    }

    res.status(201).json({
      success: true,
      message: 'PayPal order created successfully',
      orderId: order.id,
      approvalUrl: approvalUrl,
      appointmentId: appointment._id,
      amount: MEETING_PRICE,
      currency: MEETING_CURRENCY
    });

  } catch (error) {
    console.error('❌ Error creating PayPal order:', error);
    
    // Handle duplicate key error (race condition)
    if ((error as any).code === 11000) {
      return res.status(409).json({
        error: 'Time slot was just booked by another user',
        code: 'SLOT_UNAVAILABLE'
      });
    }

    res.status(500).json({
      error: 'Failed to create PayPal order',
      code: 'PAYPAL_ORDER_ERROR',
      details: process.env.NODE_ENV === 'development' ? (error as any).message : undefined
    });
  }
});

// Capture a PayPal order after user approves
router.post('/capture-order', authenticateToken, async (req, res) => {
  try {
    const { orderId, appointmentId } = req.body;
    const userId = req.user!.userId;

    if (!orderId || !appointmentId) {
      return res.status(400).json({
        error: 'Order ID and Appointment ID are required',
        code: 'MISSING_FIELDS'
      });
    }

    // Find the appointment
    const appointment = await Appointment.findOne({
      _id: appointmentId,
      userId: userId,
      'paymentInfo.paypalOrderId': orderId
    });

    if (!appointment) {
      return res.status(404).json({
        error: 'Appointment not found or order ID mismatch',
        code: 'APPOINTMENT_NOT_FOUND'
      });
    }

    // Check if already captured
    if (appointment.paymentStatus === 'completed') {
      return res.json({
        success: true,
        message: 'Payment already completed',
        appointment: {
          id: appointment._id,
          date: appointment.date,
          time: appointment.time,
          status: appointment.status,
          paymentStatus: appointment.paymentStatus
        }
      });
    }

    // Capture the order
    const ordersController = getOrdersController();
    const { result: capturedOrder } = await ordersController.captureOrder({ id: orderId });

    console.log(`💰 PayPal order captured: ${orderId}`, capturedOrder.status);

    if (capturedOrder.status === 'COMPLETED') {
      // Get capture details
      const captureDetails = capturedOrder.purchaseUnits?.[0]?.payments?.captures?.[0];

      // Update appointment status
      appointment.status = 'confirmed';
      appointment.paymentStatus = 'completed';
      appointment.paymentInfo = {
        ...appointment.paymentInfo,
        paypalOrderId: orderId,
        paypalPayerId: capturedOrder.payer?.payerId || '',
        paypalTransactionId: captureDetails?.id || '',
        amount: MEETING_PRICE,
        currency: MEETING_CURRENCY,
        status: 'completed',
        paidAt: new Date()
      };
      await appointment.save();

      console.log(`✅ Appointment ${appointmentId} confirmed after payment`);

      res.json({
        success: true,
        message: 'Payment completed successfully',
        appointment: {
          id: appointment._id,
          date: appointment.date,
          time: appointment.time,
          status: appointment.status,
          paymentStatus: appointment.paymentStatus,
          createdAt: appointment.createdAt
        }
      });
    } else {
      // Payment not completed
      appointment.paymentStatus = 'failed';
      appointment.paymentInfo = {
        ...appointment.paymentInfo!,
        status: 'failed'
      };
      await appointment.save();

      res.status(400).json({
        error: 'Payment was not completed',
        code: 'PAYMENT_NOT_COMPLETED',
        status: capturedOrder.status
      });
    }

  } catch (error) {
    console.error('❌ Error capturing PayPal order:', error);
    res.status(500).json({
      error: 'Failed to capture payment',
      code: 'CAPTURE_ERROR',
      details: process.env.NODE_ENV === 'development' ? (error as any).message : undefined
    });
  }
});

// Cancel a pending payment/appointment
router.post('/cancel-order', authenticateToken, async (req, res) => {
  try {
    const { appointmentId } = req.body;
    const userId = req.user!.userId;

    if (!appointmentId) {
      return res.status(400).json({
        error: 'Appointment ID is required',
        code: 'MISSING_APPOINTMENT_ID'
      });
    }

    // Find and delete the pending appointment
    const appointment = await Appointment.findOneAndDelete({
      _id: appointmentId,
      userId: userId,
      status: 'pending',
      paymentStatus: 'pending'
    });

    if (!appointment) {
      return res.status(404).json({
        error: 'Pending appointment not found',
        code: 'APPOINTMENT_NOT_FOUND'
      });
    }

    console.log(`🚫 Cancelled pending appointment: ${appointmentId}`);

    res.json({
      success: true,
      message: 'Appointment cancelled successfully'
    });

  } catch (error) {
    console.error('❌ Error cancelling appointment:', error);
    res.status(500).json({
      error: 'Failed to cancel appointment',
      code: 'CANCEL_ERROR'
    });
  }
});

// Get payment status for an appointment
router.get('/status/:appointmentId', authenticateToken, async (req, res) => {
  try {
    const { appointmentId } = req.params;
    const userId = req.user!.userId;

    const appointment = await Appointment.findOne({
      _id: appointmentId,
      userId: userId
    });

    if (!appointment) {
      return res.status(404).json({
        error: 'Appointment not found',
        code: 'APPOINTMENT_NOT_FOUND'
      });
    }

    res.json({
      appointmentId: appointment._id,
      status: appointment.status,
      paymentStatus: appointment.paymentStatus,
      date: appointment.date,
      time: appointment.time
    });

  } catch (error) {
    console.error('❌ Error getting payment status:', error);
    res.status(500).json({
      error: 'Failed to get payment status',
      code: 'STATUS_ERROR'
    });
  }
});

// Cleanup old pending appointments (can be called by a cron job)
router.post('/cleanup-pending', async (req, res) => {
  try {
    // Delete pending appointments older than 15 minutes
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
    
    const result = await Appointment.deleteMany({
      status: 'pending',
      paymentStatus: 'pending',
      createdAt: { $lt: fifteenMinutesAgo }
    });

    console.log(`🧹 Cleaned up ${result.deletedCount} expired pending appointments`);

    res.json({
      success: true,
      deletedCount: result.deletedCount
    });

  } catch (error) {
    console.error('❌ Error cleaning up pending appointments:', error);
    res.status(500).json({
      error: 'Failed to cleanup pending appointments',
      code: 'CLEANUP_ERROR'
    });
  }
});

export default router;


