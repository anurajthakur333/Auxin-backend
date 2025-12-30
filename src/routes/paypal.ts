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
import { createGoogleMeetEvent } from '../lib/googleCalendar.js';

const router = express.Router();

// Get the frontend URL for redirects
const getFrontendUrl = (): string => {
  return process.env.FRONTEND_URL || 
    (process.env.NODE_ENV === 'production' ? 'https://auxin.world' : 'http://localhost:5173');
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

    const { date, time, userEmail, userName, timezone, duration, price, slots } = req.body;
    const userId = req.user!.userId;
    
    // Use provided price or fallback to default
    const meetingPrice = price ? String(price) : MEETING_PRICE;
    
    // Calculate slots to check if not provided
    const slotsToCheck = slots && Array.isArray(slots) && slots.length > 0 
      ? slots 
      : [time]; // Fallback to just the start time if slots not provided

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

    // Parse date as local date (not UTC) to avoid timezone shifts
    // When date is "YYYY-MM-DD", parse it as local midnight, not UTC
    const [year, month, day] = date.split('-').map(Number);
    const appointmentDate = new Date(year, month - 1, day);
    appointmentDate.setHours(0, 0, 0, 0);
    
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

    // Check if all required time slots are available (exclude pending appointments older than 15 minutes)
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
    
    // Query appointments for the entire day (handle timezone correctly)
    // Create date range: start of day to end of day
    // Since appointmentDate is already at local midnight, we need to find all dates
    // that fall within this calendar day when converted back to local time
    const startOfDay = new Date(appointmentDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(appointmentDate);
    endOfDay.setHours(23, 59, 59, 999);

    // Check each slot that needs to be booked
    for (const slotTime of slotsToCheck) {
      const existingAppointment = await Appointment.findOne({
        date: {
          $gte: startOfDay,
          $lte: endOfDay
        },
        time: slotTime,
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
          error: `Time slot ${slotTime} is not available`,
          code: 'SLOT_UNAVAILABLE',
          conflictingSlot: slotTime
        });
      }
    }

    // Check if user already has a confirmed appointment on this date
    const userExistingAppointment = await Appointment.findOne({
      userId: userId,
      date: {
        $gte: startOfDay,
        $lte: endOfDay
      },
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
        amount: meetingPrice,
        currency: MEETING_CURRENCY,
        status: 'pending'
      }
    });
    
    // Store duration, end time, and booked slots
    if (duration) {
      appointment.duration = duration;
    }
    
    if (req.body.endTime) {
      appointment.endTime = req.body.endTime;
    }
    
    // Store all booked slots for reference
    appointment.bookedSlots = slotsToCheck;

    await appointment.save();

    console.log(`📝 Created pending appointment: ${appointment._id} for ${userName}`);
    console.log(`   📅 Requested date: ${date} (parsed as: ${appointmentDate.toISOString()})`);
    console.log(`   ⏰ Time: ${time}, Duration: ${duration} minutes`);
    console.log(`   🎫 Booked slots: ${slotsToCheck.join(', ')}`);
    console.log(`   💾 Stored date in DB: ${appointment.date.toISOString()}`);

    // Create PayPal order
    const frontendUrl = getFrontendUrl();
    const returnUrl = `${frontendUrl}/payment/success?appointmentId=${appointment._id}`;
    const cancelUrl = `${frontendUrl}/payment/cancel?appointmentId=${appointment._id}`;

    const ordersController = getOrdersController();
    const orderRequest = createOrderRequestBody(
      appointment._id.toString(),
      { 
        date, 
        time, 
        userName, 
        userEmail,
        duration: duration || undefined,
        label: duration ? `${duration} minutes` : undefined
      },
      returnUrl,
      cancelUrl,
      meetingPrice
    );

    const { result: order } = await ordersController.createOrder({ body: orderRequest });

    // Update appointment with PayPal order ID
    appointment.paymentInfo = {
      ...appointment.paymentInfo,
      paypalOrderId: order.id,
      amount: meetingPrice,
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
    const { orderId, appointmentId, categoryId, categoryName, formAnswers } = req.body;
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
      // Refresh to get latest Meet link
      const refreshedAppointment = await Appointment.findById(appointmentId);
      
      return res.json({
        success: true,
        message: 'Payment already completed',
        appointment: {
          id: refreshedAppointment!._id,
          date: refreshedAppointment!.date,
          time: refreshedAppointment!.time,
          status: refreshedAppointment!.status,
          paymentStatus: refreshedAppointment!.paymentStatus,
          googleMeetLink: refreshedAppointment!.googleMeetLink || null, // Explicitly include
          createdAt: refreshedAppointment!.createdAt
        }
      });
    }

    const ordersController = getOrdersController();

    // Helper function to update appointment from PayPal order
    const updateAppointmentFromOrder = async (order: any, appointmentToUpdate: any) => {
      if (order.status === 'COMPLETED') {
        // Get capture details
        const captureDetails = order.purchaseUnits?.[0]?.payments?.captures?.[0];

        // Update appointment status
        appointmentToUpdate.status = 'confirmed';
        appointmentToUpdate.paymentStatus = 'completed';
        appointmentToUpdate.paymentInfo = {
          ...appointmentToUpdate.paymentInfo,
          paypalOrderId: orderId,
          paypalPayerId: order.payer?.payerId || '',
          paypalTransactionId: captureDetails?.id || '',
          amount: MEETING_PRICE,
          currency: MEETING_CURRENCY,
          status: 'completed',
          paidAt: new Date()
        };

        // Add category and form data if provided (from req.body via closure)
        if (categoryId) {
          appointmentToUpdate.categoryId = categoryId;
        }
        if (categoryName) {
          appointmentToUpdate.categoryName = categoryName.toUpperCase().trim();
        }
        if (formAnswers && typeof formAnswers === 'object') {
          appointmentToUpdate.formAnswers = formAnswers;
        }

        // Generate Google Meet link if not already generated
        if (!appointmentToUpdate.googleMeetLink) {
          try {
            console.log('📹 Generating Google Meet link for appointment...');
            const meetData = await createGoogleMeetEvent(appointmentToUpdate);
            appointmentToUpdate.googleMeetLink = meetData.googleMeetLink;
            appointmentToUpdate.googleCalendarEventId = meetData.googleCalendarEventId;
            console.log('✅ Google Meet link generated:', meetData.googleMeetLink.substring(0, 50) + '...');
          } catch (meetError: any) {
            console.error('❌ Google Meet creation failed:', meetError);
            console.error('❌ Error details:', meetError.message);
            // Continue with payment confirmation even if Meet link fails
            // Admin can manually generate link later
          }
        }

        await appointmentToUpdate.save();

        console.log(`✅ Appointment ${appointmentId} confirmed after payment`);
        return true;
      }
      return false;
    };

    try {
      // Attempt to capture the order
      const { result: capturedOrder } = await ordersController.captureOrder({ id: orderId });

      console.log(`💰 PayPal order captured: ${orderId}`, capturedOrder.status);

      if (capturedOrder.status === 'COMPLETED') {
        // Pass category data to update function via closure
        await updateAppointmentFromOrder(capturedOrder, appointment);

        // Refresh appointment to get latest data including Google Meet link
        const updatedAppointment = await Appointment.findById(appointmentId);

        console.log('📋 Returning appointment data:', {
          id: updatedAppointment!._id,
          hasMeetLink: !!updatedAppointment!.googleMeetLink,
          meetLink: updatedAppointment!.googleMeetLink?.substring(0, 50) + '...'
        });

        res.json({
          success: true,
          message: 'Payment completed successfully',
          appointment: {
            id: updatedAppointment!._id,
            date: updatedAppointment!.date,
            time: updatedAppointment!.time,
            status: updatedAppointment!.status,
            paymentStatus: updatedAppointment!.paymentStatus,
            googleMeetLink: updatedAppointment!.googleMeetLink || null, // Explicitly include, even if null
            createdAt: updatedAppointment!.createdAt
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
    } catch (error: any) {
      // Handle ORDER_ALREADY_CAPTURED error
      // Check error structure - PayPal SDK errors have result.details array
      let errorResult = error?.result;
      if (!errorResult && error?.body) {
        try {
          errorResult = typeof error.body === 'string' ? JSON.parse(error.body) : error.body;
        } catch (e) {
          // If body is not JSON, ignore and use result only
        }
      }
      const errorDetails = errorResult?.details?.[0];
      const isOrderAlreadyCaptured = error?.statusCode === 422 && 
        (errorDetails?.issue === 'ORDER_ALREADY_CAPTURED' || 
         (typeof error?.body === 'string' && error.body.includes('ORDER_ALREADY_CAPTURED')) ||
         error?.message?.includes('ORDER_ALREADY_CAPTURED'));
      
      if (isOrderAlreadyCaptured) {
        console.log(`ℹ️ Order ${orderId} already captured, fetching order details...`);
        
        try {
          // Fetch the order details to get the current status
          const { result: orderDetails } = await ordersController.getOrder({ id: orderId });
          
          // Re-fetch appointment from database in case it was updated by another request
          const refreshedAppointment = await Appointment.findById(appointmentId);
          
          // Use the refreshed appointment if available, otherwise use the original
          const appointmentToUpdate = refreshedAppointment || appointment;
          
          // Check again if already completed (race condition check)
          if (appointmentToUpdate.paymentStatus === 'completed') {
            console.log(`✅ Order ${orderId} was already captured, appointment already completed`);
            // Refresh to get latest Meet link
            const refreshedForResponse = await Appointment.findById(appointmentId);
            
            return res.json({
              success: true,
              message: 'Payment already completed',
              appointment: {
                id: refreshedForResponse!._id,
                date: refreshedForResponse!.date,
                time: refreshedForResponse!.time,
                status: refreshedForResponse!.status,
                paymentStatus: refreshedForResponse!.paymentStatus,
                googleMeetLink: refreshedForResponse!.googleMeetLink || null, // Explicitly include
                createdAt: refreshedForResponse!.createdAt
              }
            });
          }

          // Update appointment from order details if not already updated
          const updated = await updateAppointmentFromOrder(orderDetails, appointmentToUpdate);
          
          if (updated) {
            console.log(`✅ Appointment ${appointmentId} confirmed after payment (order was already captured)`);
            
            // Refresh appointment to get latest data including Google Meet link
            const refreshedAppointment = await Appointment.findById(appointmentId);
            
            console.log('📋 Returning appointment data (already captured):', {
              id: refreshedAppointment!._id,
              hasMeetLink: !!refreshedAppointment!.googleMeetLink,
              meetLink: refreshedAppointment!.googleMeetLink?.substring(0, 50) + '...'
            });
            
            return res.json({
              success: true,
              message: 'Payment was already completed',
              appointment: {
                id: refreshedAppointment!._id,
                date: refreshedAppointment!.date,
                time: refreshedAppointment!.time,
                status: refreshedAppointment!.status,
                paymentStatus: refreshedAppointment!.paymentStatus,
                googleMeetLink: refreshedAppointment!.googleMeetLink || null, // Explicitly include
                createdAt: refreshedAppointment!.createdAt
              }
            });
          } else {
            // Order exists but not completed
            console.warn(`⚠️ Order ${orderId} exists but status is not COMPLETED: ${orderDetails?.status}`);
            return res.status(400).json({
              error: 'Order exists but payment was not completed',
              code: 'PAYMENT_NOT_COMPLETED',
              orderStatus: orderDetails?.status
            });
          }
        } catch (fetchError: any) {
          console.error('❌ Error fetching order details:', fetchError);
          // If we can't fetch order details, check if appointment is already completed
          const fallbackAppointment = await Appointment.findById(appointmentId);
          if (fallbackAppointment && fallbackAppointment.paymentStatus === 'completed') {
            console.log(`✅ Appointment ${appointmentId} is already completed (fallback check)`);
            return res.json({
              success: true,
              message: 'Payment already completed',
              appointment: {
                id: fallbackAppointment._id,
                date: fallbackAppointment.date,
                time: fallbackAppointment.time,
                status: fallbackAppointment.status,
                paymentStatus: fallbackAppointment.paymentStatus,
                googleMeetLink: fallbackAppointment.googleMeetLink || null, // Explicitly include
                createdAt: fallbackAppointment.createdAt
              }
            });
          }
          // Fall through to general error handling if we can't verify
        }
      }

      // General error handling
      console.error('❌ Error capturing PayPal order:', error);
      const errorMessage = error?.result?.message || error?.message || 'Failed to capture payment';
      res.status(error?.statusCode || 500).json({
        error: errorMessage,
        code: 'CAPTURE_ERROR',
        details: process.env.NODE_ENV === 'development' ? errorMessage : undefined
      });
    }
  } catch (error) {
    console.error('❌ Error in capture-order endpoint:', error);
    res.status(500).json({
      error: 'Failed to process payment capture',
      code: 'CAPTURE_ERROR'
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


