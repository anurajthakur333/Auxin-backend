import mongoose, { Document, Schema } from 'mongoose';

export interface IPaymentInfo {
  paypalOrderId?: string;
  paypalPayerId?: string;
  paypalTransactionId?: string;
  amount: string;
  currency: string;
  status: 'pending' | 'completed' | 'failed' | 'refunded';
  paidAt?: Date;
}

export interface IAppointment extends Document {
  _id: string;
  userId: string;
  userEmail: string;
  userName: string;
  date: Date;
  time: string;
  timezone?: string;
  status: 'pending' | 'confirmed' | 'cancelled';
  // Payment fields
  paymentStatus: 'pending' | 'completed' | 'failed' | 'refunded';
  paymentInfo?: IPaymentInfo;
  // Google Meet fields
  googleMeetLink?: string;
  googleCalendarEventId?: string;
  // Duration and slot booking fields
  duration?: number;
  endTime?: string;
  bookedSlots?: string[];
  createdAt: Date;
  updatedAt: Date;
}

// Payment info sub-schema
const PaymentInfoSchema = new Schema({
  paypalOrderId: { type: String },
  paypalPayerId: { type: String },
  paypalTransactionId: { type: String },
  amount: { type: String, required: true },
  currency: { type: String, required: true, default: 'USD' },
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'refunded'],
    default: 'pending'
  },
  paidAt: { type: Date }
}, { _id: false });

const AppointmentSchema = new Schema<IAppointment>({
  userId: {
    type: String,
    required: true,
    ref: 'User'
  },
  userEmail: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email']
  },
  userName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  date: {
    type: Date,
    required: true,
    validate: {
      validator: function(value: Date) {
        // Ensure date is not in the past (allow today)
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return value >= today;
      },
      message: 'Appointment date cannot be in the past'
    }
  },
  time: {
    type: String,
    required: true,
    validate: {
      validator: function(value: string) {
        // Validate time format (HH:MM) and business hours (09:00-17:30)
        const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
        if (!timeRegex.test(value)) return false;
        
        const [hours, minutes] = value.split(':').map(Number);
        const timeInMinutes = hours * 60 + minutes;
        const startTime = 9 * 60; // 9:00 AM
        const endTime = 17 * 60 + 30; // 5:30 PM
        
        return timeInMinutes >= startTime && timeInMinutes <= endTime && minutes % 30 === 0;
      },
      message: 'Time must be in HH:MM format and within business hours (09:00-17:30) in 30-minute intervals'
    }
  },
  timezone: {
    type: String,
    default: 'UTC',
    trim: true
  },
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'cancelled'],
    default: 'pending' // Default to pending until payment is completed
  },
  // Payment fields
  paymentStatus: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'refunded'],
    default: 'pending'
  },
  paymentInfo: PaymentInfoSchema,
  // Google Meet fields
  googleMeetLink: {
    type: String,
    trim: true
  },
  googleCalendarEventId: {
    type: String,
    trim: true
  },
  // Duration and slot booking fields
  duration: {
    type: Number,
    min: 30
  },
  endTime: {
    type: String,
    trim: true
  },
  bookedSlots: {
    type: [String],
    default: []
  }
}, {
  timestamps: true,
  toJSON: {
    transform: function(_doc, ret: Record<string, unknown>) {
      ret.id = ret._id;
      delete ret._id;
      delete ret.__v;
      
      // Format date as YYYY-MM-DD for frontend
      if (ret.date) {
        ret.date = (ret.date as Date).toISOString().split('T')[0];
      }
      
      // Include payment status for frontend
      ret.paymentStatus = ret.paymentStatus || 'pending';
      
      return ret;
    }
  }
});

// Compound index to prevent double booking
AppointmentSchema.index({ date: 1, time: 1 }, { unique: true });

// Index for user queries
AppointmentSchema.index({ userId: 1, date: 1 });
AppointmentSchema.index({ userEmail: 1 });

// Index for status queries
AppointmentSchema.index({ status: 1 });

// Index for PayPal order lookup
AppointmentSchema.index({ 'paymentInfo.paypalOrderId': 1 });

// Index for payment status queries
AppointmentSchema.index({ paymentStatus: 1 });

// Static method to generate available time slots
AppointmentSchema.statics.generateTimeSlots = function() {
  const slots = [];
  for (let hour = 9; hour < 18; hour++) {
    for (let minute = 0; minute < 60; minute += 30) {
      const time = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
      slots.push({
        id: time,
        time: time,
        available: true
      });
    }
  }
  return slots;
};

// Instance method to check if appointment can be cancelled
AppointmentSchema.methods.canBeCancelled = function() {
  if (this.status === 'cancelled') return false;
  
  // Create proper date object with timezone handling
  const dateStr = this.date instanceof Date ? 
    this.date.toISOString().split('T')[0] : 
    this.date;
  const appointmentDateTime = new Date(`${dateStr}T${this.time}:00`);
  const now = new Date();
  
  console.log(`🔍 canBeCancelled - Appointment date: ${this.date}`);
  console.log(`🔍 canBeCancelled - Appointment date type: ${typeof this.date}`);
  console.log(`🔍 canBeCancelled - Date string: ${dateStr}`);
  console.log(`🔍 canBeCancelled - Appointment time: ${this.time}`);
  console.log(`🔍 canBeCancelled - Appointment datetime: ${appointmentDateTime}`);
  console.log(`🔍 canBeCancelled - Current time: ${now}`);
  
  // Allow cancellation up to 1 hour before appointment
  const oneHourBefore = new Date(appointmentDateTime.getTime() - 60 * 60 * 1000);
  
  console.log(`🔍 canBeCancelled - One hour before: ${oneHourBefore}`);
  console.log(`🔍 canBeCancelled - Can cancel: ${now < oneHourBefore}`);
  
  return now < oneHourBefore;
};

export default mongoose.models.Appointment || mongoose.model<IAppointment>('Appointment', AppointmentSchema);
