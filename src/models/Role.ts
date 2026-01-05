import mongoose, { Document, Schema } from 'mongoose';

export interface IRole extends Document {
  _id: string;
  name: string;
  description?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const RoleSchema = new Schema<IRole>({
  name: {
    type: String,
    required: true,
    trim: true,
    unique: true,
    uppercase: true,
    maxlength: 50
  },
  description: {
    type: String,
    trim: true,
    maxlength: 200
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
      delete ret.__v;
      return ret;
    }
  }
});

// Index for active roles
RoleSchema.index({ isActive: 1 });
RoleSchema.index({ name: 1 });

export default mongoose.models.Role || mongoose.model<IRole>('Role', RoleSchema);

