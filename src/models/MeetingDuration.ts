import mongoose, { Document, Schema } from 'mongoose';

export interface IMeetingDuration extends Document {
  _id: string;
  minutes: number;
  label: string;
  price: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const MeetingDurationSchema = new Schema<IMeetingDuration>({
  minutes: {
    type: Number,
    required: true,
    min: 30,
    validate: {
      validator: function(value: number) {
        // Ensure minutes is a multiple of 30
        return value % 30 === 0;
      },
      message: 'Duration must be a multiple of 30 minutes'
    }
  },
  label: {
    type: String,
    required: true,
    trim: true,
    uppercase: true,
    maxlength: 100
  },
  price: {
    type: Number,
    required: true,
    min: 0,
    default: 0,
    set: (value: number) => Math.round(value) // Round to integer on save
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true,
  toJSON: {
    transform: function(_doc, ret: Record<string, unknown>) {
      ret.id = ret._id;
      delete ret._id;
      delete ret.__v;
      // Round price to integer in JSON output
      if (typeof ret.price === 'number') {
        ret.price = Math.round(ret.price);
      }
      return ret;
    }
  }
});

// Index for active durations
MeetingDurationSchema.index({ isActive: 1 });

// Index for minutes lookup
MeetingDurationSchema.index({ minutes: 1 });

export default mongoose.models.MeetingDuration || mongoose.model<IMeetingDuration>('MeetingDuration', MeetingDurationSchema);




