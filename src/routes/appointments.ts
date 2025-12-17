import express from 'express';
import Appointment from '../models/Appointment.js';
import { authenticateToken, optionalAuth } from '../middleware/auth.js';
import { generateNewMeetLink } from '../lib/googleCalendar.js';

const router = express.Router();

// Get available time slots for a specific date
router.get('/available', optionalAuth, async (req, res) => {
  try {
    const { date } = req.query;

    if (!date || typeof date !== 'string') {
      return res.status(400).json({
        error: 'Date parameter is required in YYYY-MM-DD format',
        code: 'INVALID_DATE'
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

    // Check if date is not in the past
    const requestedDate = new Date(date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (requestedDate < today) {
      return res.status(400).json({
        error: 'Cannot check availability for past dates',
        code: 'PAST_DATE'
      });
    }

    // Generate all possible time slots
    const allSlots = (Appointment as any).generateTimeSlots();

    // Find booked appointments for this date
    const bookedAppointments = await Appointment.find({
      date: requestedDate,
      status: { $in: ['confirmed', 'pending'] }
    }).select('time');

    const bookedTimes = new Set(bookedAppointments.map(apt => apt.time));

    // Mark slots as unavailable if they're booked
    const availableSlots = allSlots.map((slot: any) => ({
      ...slot,
      available: !bookedTimes.has(slot.time)
    }));

    console.log(`📅 Available slots for ${date}: ${availableSlots.filter((s: any) => s.available).length}/${availableSlots.length}`);

    res.json({
      slots: availableSlots,
      date: date,
      totalSlots: availableSlots.length,
      availableCount: availableSlots.filter((s: any) => s.available).length
    });

  } catch (error) {
    console.error('Error fetching available slots:', error);
    res.status(500).json({
      error: 'Failed to fetch available time slots',
      code: 'FETCH_SLOTS_ERROR'
    });
  }
});

// Book an appointment
router.post('/book', authenticateToken, async (req, res) => {
  try {
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

    // Check if time slot is available
    const existingAppointment = await Appointment.findOne({
      date: appointmentDate,
      time: time,
      status: { $in: ['confirmed', 'pending'] }
    });

    if (existingAppointment) {
      return res.status(409).json({
        error: 'Time slot not available',
        code: 'SLOT_UNAVAILABLE'
      });
    }

    // Check if user already has an appointment on this date
    const userExistingAppointment = await Appointment.findOne({
      userId: userId,
      date: appointmentDate,
      status: { $in: ['confirmed', 'pending'] }
    });

    if (userExistingAppointment) {
      return res.status(409).json({
        error: 'You already have an appointment on this date',
        code: 'DUPLICATE_DATE_BOOKING'
      });
    }

    // Create the appointment
    const appointment = new Appointment({
      userId,
      userEmail,
      userName,
      date: appointmentDate,
      time,
      timezone: timezone || 'UTC', // Store user's timezone
      status: 'confirmed'
    });

    await appointment.save();

    console.log(`✅ Appointment booked: ${userName} (${userEmail}) on ${date} at ${time}`);

    res.status(201).json({
      success: true,
      message: 'Appointment booked successfully',
      appointment: {
        id: appointment._id,
        date: appointment.date,
        time: appointment.time,
        status: appointment.status,
        createdAt: appointment.createdAt
      }
    });

  } catch (error) {
    console.error('Error booking appointment:', error);
    
    // Handle duplicate key error (race condition)
    if ((error as any).code === 11000) {
      return res.status(409).json({
        error: 'Time slot was just booked by another user',
        code: 'SLOT_UNAVAILABLE'
      });
    }

    res.status(500).json({
      error: 'Failed to book appointment',
      code: 'BOOKING_ERROR'
    });
  }
});

// Get user's appointments
router.get('/my-appointments', authenticateToken, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const { status, limit = 50, page = 1 } = req.query;

    // Build query
    const query: any = { userId };
    
    if (status && typeof status === 'string') {
      if (!['pending', 'confirmed', 'cancelled'].includes(status)) {
        return res.status(400).json({
          error: 'Invalid status. Must be: pending, confirmed, or cancelled',
          code: 'INVALID_STATUS'
        });
      }
      query.status = status;
    }

    // Pagination
    const pageNum = Math.max(1, parseInt(page as string) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string) || 50));
    const skip = (pageNum - 1) * limitNum;

    // Fetch appointments with pagination
    const appointments = await Appointment.find(query)
      .sort({ date: -1, time: -1 }) // Most recent first
      .skip(skip)
      .limit(limitNum);

    const totalCount = await Appointment.countDocuments(query);

    console.log(`📋 Fetched ${appointments.length} appointments for user ${req.user!.email}`);
    console.log(`📋 Appointments with Meet links: ${appointments.filter(apt => apt.googleMeetLink).length}`);

    // Ensure googleMeetLink is included in response (even if null)
    const appointmentsWithMeetLinks = appointments.map(apt => ({
      ...apt.toObject(),
      googleMeetLink: apt.googleMeetLink || null
    }));

    res.json({
      appointments: appointmentsWithMeetLinks,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: totalCount,
        pages: Math.ceil(totalCount / limitNum)
      }
    });

  } catch (error) {
    console.error('Error fetching user appointments:', error);
    res.status(500).json({
      error: 'Failed to fetch appointments',
      code: 'FETCH_APPOINTMENTS_ERROR'
    });
  }
});

// Cancel appointment
router.put('/:appointmentId/cancel', authenticateToken, async (req, res) => {
  try {
    const { appointmentId } = req.params;
    const userId = req.user!.userId;

    console.log(`🔄 Cancel request for appointment ${appointmentId} by user ${req.user!.email}`);
    console.log(`🔄 User ID: ${userId}`);
    console.log(`🔄 Request method: ${req.method}`);
    console.log(`🔄 Request URL: ${req.url}`);

    if (!appointmentId) {
      console.log(`❌ No appointment ID provided`);
      return res.status(400).json({
        error: 'Appointment ID is required',
        code: 'MISSING_APPOINTMENT_ID'
      });
    }

    // Validate MongoDB ObjectId format
    if (!/^[0-9a-fA-F]{24}$/.test(appointmentId)) {
      return res.status(400).json({
        error: 'Invalid appointment ID format',
        code: 'INVALID_APPOINTMENT_ID'
      });
    }

    // Find the appointment
    const appointment = await Appointment.findOne({
      _id: appointmentId,
      userId: userId
    });

    if (!appointment) {
      console.log(`❌ Appointment ${appointmentId} not found for user ${userId}`);
      return res.status(404).json({
        error: 'Appointment not found or you do not have permission to cancel it',
        code: 'APPOINTMENT_NOT_FOUND'
      });
    }

    console.log(`📋 Found appointment: ${appointment.userName} on ${appointment.date} at ${appointment.time} (status: ${appointment.status})`);
    console.log(`📋 Appointment ID: ${appointment._id}`);
    console.log(`📋 User ID: ${appointment.userId}`);

    // Check if appointment is already cancelled
    if (appointment.status === 'cancelled') {
      return res.status(400).json({
        error: 'Appointment is already cancelled',
        code: 'ALREADY_CANCELLED'
      });
    }

    // Check if appointment can be cancelled (not in the past + buffer time)
    const canCancel = (appointment as any).canBeCancelled();
    console.log(`⏰ Can cancel appointment: ${canCancel}`);
    
    if (!canCancel) {
      // Create proper date object with timezone handling
      const dateStr = appointment.date instanceof Date ? 
        appointment.date.toISOString().split('T')[0] : 
        appointment.date;
      const appointmentDateTime = new Date(`${dateStr}T${appointment.time}:00`);
      const now = new Date();
      const timeDiff = appointmentDateTime.getTime() - now.getTime();
      const hoursUntilAppointment = Math.floor(timeDiff / (1000 * 60 * 60));
      
      console.log(`⏰ Appointment date: ${appointment.date}`);
      console.log(`⏰ Appointment date type: ${typeof appointment.date}`);
      console.log(`⏰ Date string: ${dateStr}`);
      console.log(`⏰ Appointment time: ${appointment.time}`);
      console.log(`⏰ Appointment datetime: ${appointmentDateTime}`);
      console.log(`⏰ Current time: ${now}`);
      console.log(`⏰ Time difference: ${timeDiff}ms`);
      console.log(`⏰ Hours until appointment: ${hoursUntilAppointment}`);
      
      return res.status(400).json({
        error: `Cannot cancel appointment. Less than 1 hour remaining (${hoursUntilAppointment} hours left)`,
        code: 'CANCELLATION_TOO_LATE',
        hoursUntilAppointment: hoursUntilAppointment
      });
    }

    // Delete the appointment instead of marking as cancelled
    console.log(`🗑️ Deleting appointment ${appointmentId}...`);
    console.log(`🗑️ Appointment before deletion:`, appointment);
    
    try {
      // Double-check appointment exists before deletion
      const preDeleteCheck = await Appointment.findById(appointmentId);
      console.log(`🔍 Pre-deletion check - appointment exists:`, !!preDeleteCheck);
      if (!preDeleteCheck) {
        console.log(`❌ Appointment ${appointmentId} not found before deletion attempt`);
        return res.status(404).json({
          error: 'Appointment not found',
          code: 'APPOINTMENT_NOT_FOUND'
        });
      }
    } catch (preDeleteError) {
      console.error(`❌ Pre-deletion check failed:`, preDeleteError);
      return res.status(500).json({
        error: 'Failed to verify appointment before deletion',
        code: 'PRE_DELETE_CHECK_FAILED'
      });
    }
    
    // Try multiple deletion methods
    let deleteResult = null;
    
    try {
      // Method 1: Direct delete with user validation
      try {
        deleteResult = await Appointment.deleteOne({ _id: appointmentId, userId: userId });
        console.log(`🗑️ deleteOne result:`, deleteResult);
        console.log(`🗑️ deleteOne deletedCount:`, deleteResult.deletedCount);
      } catch (error) {
        console.error(`❌ deleteOne failed:`, error);
      }
      
      // Method 2: findByIdAndDelete if first method failed
      if (!deleteResult || deleteResult.deletedCount === 0) {
        try {
          deleteResult = await Appointment.findByIdAndDelete(appointmentId);
          console.log(`🗑️ findByIdAndDelete result:`, deleteResult);
        } catch (error) {
          console.error(`❌ findByIdAndDelete failed:`, error);
        }
      }
      
      // Method 3: findOneAndDelete if both methods failed
      if (!deleteResult || (deleteResult.deletedCount !== undefined && deleteResult.deletedCount === 0)) {
        try {
          deleteResult = await Appointment.findOneAndDelete({ _id: appointmentId, userId: userId });
          console.log(`🗑️ findOneAndDelete result:`, deleteResult);
        } catch (error) {
          console.error(`❌ findOneAndDelete failed:`, error);
        }
      }
    } catch (deletionError) {
      console.error(`❌ All deletion methods failed:`, deletionError);
      return res.status(500).json({
        error: 'All deletion methods failed',
        code: 'ALL_DELETION_METHODS_FAILED'
      });
    }

    if (!deleteResult) {
      console.log(`❌ Failed to delete appointment ${appointmentId}`);
      return res.status(500).json({
        error: 'Failed to delete appointment',
        code: 'DELETE_FAILED'
      });
    }

    // Check if deleteOne returned 0 deleted count
    if (deleteResult.deletedCount !== undefined && deleteResult.deletedCount === 0) {
      console.log(`❌ deleteOne returned 0 deleted count for appointment ${appointmentId}`);
      return res.status(500).json({
        error: 'Failed to delete appointment',
        code: 'DELETE_FAILED'
      });
    }

    // Verify deletion by trying to find the appointment again
    const verifyDeletion = await Appointment.findById(appointmentId);
    console.log(`🔍 Verification - appointment still exists:`, !!verifyDeletion);
    
    if (verifyDeletion) {
      console.log(`❌ Appointment still exists after deletion attempt!`);
      return res.status(500).json({
        error: 'Appointment deletion failed - appointment still exists',
        code: 'DELETION_VERIFICATION_FAILED'
      });
    }

    console.log(`✅ Appointment deleted successfully: ${appointment.userName} on ${appointment.date} at ${appointment.time}`);

    res.json({
      success: true,
      message: 'Appointment cancelled and removed successfully',
      appointment: {
        id: appointment._id,
        date: appointment.date,
        time: appointment.time,
        status: 'cancelled',
        cancelledAt: new Date()
      }
    });

  } catch (error) {
    console.error('❌ Error cancelling appointment:', error);
    
    // Handle specific MongoDB errors
    if ((error as any).name === 'CastError') {
      return res.status(400).json({
        error: 'Invalid appointment ID format',
        code: 'INVALID_APPOINTMENT_ID'
      });
    }
    
    res.status(500).json({
      error: 'Failed to cancel appointment',
      code: 'CANCELLATION_ERROR',
      details: process.env.NODE_ENV === 'development' ? (error as any).message : undefined
    });
  }
});

// Cancel appointment (DELETE method - alternative endpoint)
router.delete('/:appointmentId', authenticateToken, async (req, res) => {
  try {
    const { appointmentId } = req.params;
    const userId = req.user!.userId;

    console.log(`🗑️ Delete request for appointment ${appointmentId} by user ${req.user!.email}`);

    if (!appointmentId) {
      return res.status(400).json({
        error: 'Appointment ID is required',
        code: 'MISSING_APPOINTMENT_ID'
      });
    }

    // Validate MongoDB ObjectId format
    if (!/^[0-9a-fA-F]{24}$/.test(appointmentId)) {
      return res.status(400).json({
        error: 'Invalid appointment ID format',
        code: 'INVALID_APPOINTMENT_ID'
      });
    }

    // Find the appointment
    const appointment = await Appointment.findOne({
      _id: appointmentId,
      userId: userId
    });

    if (!appointment) {
      console.log(`❌ Appointment ${appointmentId} not found for user ${userId}`);
      return res.status(404).json({
        error: 'Appointment not found or you do not have permission to cancel it',
        code: 'APPOINTMENT_NOT_FOUND'
      });
    }

    // Check if appointment is already cancelled
    if (appointment.status === 'cancelled') {
      return res.status(400).json({
        error: 'Appointment is already cancelled',
        code: 'ALREADY_CANCELLED'
      });
    }

    // Check if appointment can be cancelled (not in the past + buffer time)
    const canCancel = (appointment as any).canBeCancelled();
    
    if (!canCancel) {
      // Create proper date object with timezone handling
      const dateStr = appointment.date instanceof Date ? 
        appointment.date.toISOString().split('T')[0] : 
        appointment.date;
      const appointmentDateTime = new Date(`${dateStr}T${appointment.time}:00`);
      const now = new Date();
      const timeDiff = appointmentDateTime.getTime() - now.getTime();
      const hoursUntilAppointment = Math.floor(timeDiff / (1000 * 60 * 60));
      
      console.log(`⏰ DELETE - Appointment date: ${appointment.date}`);
      console.log(`⏰ DELETE - Appointment date type: ${typeof appointment.date}`);
      console.log(`⏰ DELETE - Date string: ${dateStr}`);
      console.log(`⏰ DELETE - Appointment time: ${appointment.time}`);
      console.log(`⏰ DELETE - Appointment datetime: ${appointmentDateTime}`);
      console.log(`⏰ DELETE - Current time: ${now}`);
      console.log(`⏰ DELETE - Time difference: ${timeDiff}ms`);
      console.log(`⏰ DELETE - Hours until appointment: ${hoursUntilAppointment}`);
      
      return res.status(400).json({
        error: `Cannot cancel appointment. Less than 1 hour remaining (${hoursUntilAppointment} hours left)`,
        code: 'CANCELLATION_TOO_LATE',
        hoursUntilAppointment: hoursUntilAppointment
      });
    }

    // Delete the appointment instead of marking as cancelled
    console.log(`🗑️ DELETE method - Deleting appointment ${appointmentId}...`);
    console.log(`🗑️ DELETE method - Appointment before deletion:`, appointment);
    
    // Try multiple deletion methods
    let deleteResult = null;
    
    // Method 1: Direct delete with user validation
    try {
      deleteResult = await Appointment.deleteOne({ _id: appointmentId, userId: userId });
      console.log(`🗑️ DELETE - deleteOne result:`, deleteResult);
      console.log(`🗑️ DELETE - deleteOne deletedCount:`, deleteResult.deletedCount);
    } catch (error) {
      console.error(`❌ DELETE - deleteOne failed:`, error);
    }
    
    // Method 2: findByIdAndDelete if first method failed
    if (!deleteResult || deleteResult.deletedCount === 0) {
      try {
        deleteResult = await Appointment.findByIdAndDelete(appointmentId);
        console.log(`🗑️ DELETE - findByIdAndDelete result:`, deleteResult);
      } catch (error) {
        console.error(`❌ DELETE - findByIdAndDelete failed:`, error);
      }
    }
    
    // Method 3: findOneAndDelete if both methods failed
    if (!deleteResult || (deleteResult.deletedCount !== undefined && deleteResult.deletedCount === 0)) {
      try {
        deleteResult = await Appointment.findOneAndDelete({ _id: appointmentId, userId: userId });
        console.log(`🗑️ DELETE - findOneAndDelete result:`, deleteResult);
      } catch (error) {
        console.error(`❌ DELETE - findOneAndDelete failed:`, error);
      }
    }

    if (!deleteResult) {
      console.log(`❌ DELETE - Failed to delete appointment ${appointmentId}`);
      return res.status(500).json({
        error: 'Failed to delete appointment',
        code: 'DELETE_FAILED'
      });
    }

    // Check if deleteOne returned 0 deleted count
    if (deleteResult.deletedCount !== undefined && deleteResult.deletedCount === 0) {
      console.log(`❌ DELETE - deleteOne returned 0 deleted count for appointment ${appointmentId}`);
      return res.status(500).json({
        error: 'Failed to delete appointment',
        code: 'DELETE_FAILED'
      });
    }

    // Verify deletion by trying to find the appointment again
    const verifyDeletion = await Appointment.findById(appointmentId);
    console.log(`🔍 DELETE - Verification - appointment still exists:`, !!verifyDeletion);
    
    if (verifyDeletion) {
      console.log(`❌ DELETE - Appointment still exists after deletion attempt!`);
      return res.status(500).json({
        error: 'Appointment deletion failed - appointment still exists',
        code: 'DELETION_VERIFICATION_FAILED'
      });
    }

    console.log(`✅ DELETE - Appointment deleted successfully: ${appointment.userName} on ${appointment.date} at ${appointment.time}`);

    res.json({
      success: true,
      message: 'Appointment cancelled and removed successfully',
      appointment: {
        id: appointment._id,
        date: appointment.date,
        time: appointment.time,
        status: 'cancelled',
        cancelledAt: new Date()
      }
    });

  } catch (error) {
    console.error('❌ Error cancelling appointment via DELETE:', error);
    
    // Handle specific MongoDB errors
    if ((error as any).name === 'CastError') {
      return res.status(400).json({
        error: 'Invalid appointment ID format',
        code: 'INVALID_APPOINTMENT_ID'
      });
    }
    
    res.status(500).json({
      error: 'Failed to cancel appointment',
      code: 'CANCELLATION_ERROR',
      details: process.env.NODE_ENV === 'development' ? (error as any).message : undefined
    });
  }
});

// Admin: Get all appointments (optional - for future admin panel)
router.get('/admin/all', authenticateToken, async (req, res) => {
  try {
    // TODO: Add admin role check when you implement user roles
    const { date, status, limit = 100, page = 1 } = req.query;

    const query: any = {};
    
    if (date && typeof date === 'string') {
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (dateRegex.test(date)) {
        query.date = new Date(date);
      }
    }
    
    if (status && typeof status === 'string') {
      if (['pending', 'confirmed', 'cancelled'].includes(status)) {
        query.status = status;
      }
    }

    const pageNum = Math.max(1, parseInt(page as string) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string) || 100));
    const skip = (pageNum - 1) * limitNum;

    const appointments = await Appointment.find(query)
      .sort({ date: 1, time: 1 })
      .skip(skip)
      .limit(limitNum);

    const totalCount = await Appointment.countDocuments(query);

    res.json({
      appointments,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: totalCount,
        pages: Math.ceil(totalCount / limitNum)
      }
    });

  } catch (error) {
    console.error('Error fetching all appointments:', error);
    res.status(500).json({
      error: 'Failed to fetch appointments',
      code: 'FETCH_ALL_APPOINTMENTS_ERROR'
    });
  }
});

// Request new Google Meet link for an appointment
router.post('/:appointmentId/request-meet-link', authenticateToken, async (req, res) => {
  try {
    const { appointmentId } = req.params;
    const userId = req.user!.userId;

    if (!appointmentId) {
      return res.status(400).json({
        error: 'Appointment ID is required',
        code: 'MISSING_APPOINTMENT_ID'
      });
    }

    // Validate MongoDB ObjectId format
    if (!/^[0-9a-fA-F]{24}$/.test(appointmentId)) {
      return res.status(400).json({
        error: 'Invalid appointment ID format',
        code: 'INVALID_APPOINTMENT_ID'
      });
    }

    // Find the appointment
    const appointment = await Appointment.findOne({
      _id: appointmentId,
      userId: userId
    });

    if (!appointment) {
      return res.status(404).json({
        error: 'Appointment not found or you do not have permission to access it',
        code: 'APPOINTMENT_NOT_FOUND'
      });
    }

    // Verify appointment is confirmed and paid
    if (appointment.status !== 'confirmed' || appointment.paymentStatus !== 'completed') {
      return res.status(400).json({
        error: 'Appointment must be confirmed and paid before requesting a meeting link',
        code: 'APPOINTMENT_NOT_CONFIRMED'
      });
    }

    // Generate new Meet link
    try {
      console.log(`📹 Generating new Google Meet link for appointment ${appointmentId}`);
      console.log(`📹 Appointment details:`, {
        date: appointment.date,
        time: appointment.time,
        hasCalendarEventId: !!appointment.googleCalendarEventId,
        calendarEventId: appointment.googleCalendarEventId
      });
      
      const googleMeetLink = await generateNewMeetLink(appointment);

      // Refresh appointment to get updated calendar event ID if it was created
      const updatedAppointment = await Appointment.findById(appointmentId);

      // Update appointment with new link
      if (updatedAppointment) {
        updatedAppointment.googleMeetLink = googleMeetLink;
        if (updatedAppointment.googleCalendarEventId) {
          // Preserve calendar event ID if it was updated
          appointment.googleCalendarEventId = updatedAppointment.googleCalendarEventId;
        }
        await updatedAppointment.save();
      } else {
        appointment.googleMeetLink = googleMeetLink;
        await appointment.save();
      }

      console.log(`✅ New Google Meet link generated for appointment ${appointmentId}`);

      res.json({
        success: true,
        message: 'New meeting link generated successfully',
        googleMeetLink: googleMeetLink,
        appointment: {
          id: appointment._id,
          date: appointment.date,
          time: appointment.time,
          status: appointment.status,
          paymentStatus: appointment.paymentStatus,
          googleMeetLink: googleMeetLink
        }
      });
    } catch (meetError: any) {
      console.error('❌ Error generating new Meet link:', meetError);
      console.error('❌ Error message:', meetError.message);
      console.error('❌ Error code:', meetError.code);
      console.error('❌ Error response:', meetError.response?.data);
      
      // Provide more helpful error message
      let errorMessage = 'Failed to generate meeting link';
      let errorDetails = meetError.message;
      
      if (meetError.message?.includes('Domain-Wide Delegation') || 
          meetError.message?.includes('attendees')) {
        errorMessage = 'Google Calendar configuration issue. Creating new event...';
        // Try to create a completely new event as fallback
        try {
          console.log('🔄 Attempting fallback: creating new event...');
          const { createGoogleMeetEvent } = await import('../lib/googleCalendar.js');
          const meetData = await createGoogleMeetEvent(appointment);
          
          appointment.googleMeetLink = meetData.googleMeetLink;
          appointment.googleCalendarEventId = meetData.googleCalendarEventId;
          await appointment.save();
          
          return res.json({
            success: true,
            message: 'New meeting link generated successfully (fallback method)',
            googleMeetLink: meetData.googleMeetLink,
            appointment: {
              id: appointment._id,
              date: appointment.date,
              time: appointment.time,
              status: appointment.status,
              paymentStatus: appointment.paymentStatus,
              googleMeetLink: meetData.googleMeetLink
            }
          });
        } catch (fallbackError: any) {
          console.error('❌ Fallback also failed:', fallbackError);
          errorMessage = 'Failed to generate meeting link. Please contact support.';
          errorDetails = fallbackError.message;
        }
      } else if (meetError.message) {
        errorMessage = meetError.message;
      }
      
      res.status(500).json({
        error: errorMessage,
        code: 'MEET_LINK_GENERATION_ERROR',
        details: process.env.NODE_ENV === 'development' ? errorDetails : undefined
      });
    }

  } catch (error: any) {
    console.error('❌ Error requesting new Meet link:', error);
    
    // Handle specific MongoDB errors
    if (error.name === 'CastError') {
      return res.status(400).json({
        error: 'Invalid appointment ID format',
        code: 'INVALID_APPOINTMENT_ID'
      });
    }
    
    res.status(500).json({
      error: 'Failed to request new meeting link',
      code: 'REQUEST_MEET_LINK_ERROR',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

export default router;
