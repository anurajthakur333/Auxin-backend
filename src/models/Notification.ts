import mongoose, { Document, Schema } from 'mongoose';

export interface INotification extends Document {
  _id: string;
  userId: mongoose.Types.ObjectId; // Reference to User
  message: string;
  type: 'project' | 'meeting' | 'payment' | 'system' | 'task' | 'billing' | 'custom';
  read: boolean;
  relatedId?: mongoose.Types.ObjectId; // Optional: ID of related entity (project, invoice, task, etc.)
  relatedType?: string; // Optional: Type of related entity
  createdAt: Date;
  updatedAt: Date;
}

const NotificationSchema = new Schema<INotification>({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  message: {
    type: String,
    required: true,
    trim: true,
    maxlength: 500,
  },
  type: {
    type: String,
    enum: ['project', 'meeting', 'payment', 'system', 'task', 'billing', 'custom'],
    default: 'custom',
    index: true,
  },
  read: {
    type: Boolean,
    default: false,
    index: true,
  },
  relatedId: {
    type: Schema.Types.ObjectId,
    index: true,
  },
  relatedType: {
    type: String,
    trim: true,
  },
}, {
  timestamps: true,
  toJSON: {
    transform: function(_doc, ret: Record<string, unknown>) {
      ret.id = ret._id;
      delete ret._id;
      delete ret.__v;
      return ret;
    },
  },
});

// Compound index for efficient queries
NotificationSchema.index({ userId: 1, read: 1, createdAt: -1 });
NotificationSchema.index({ userId: 1, createdAt: -1 });

export default mongoose.models.Notification || mongoose.model<INotification>('Notification', NotificationSchema);
