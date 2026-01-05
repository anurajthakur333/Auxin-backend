import mongoose, { Document, Schema } from 'mongoose';

export interface ISubrole extends Document {
  _id: string;
  name: string;
  description?: string;
  role: string; // Connected role name (stored as string to match Employee.role)
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const SubroleSchema = new Schema<ISubrole>({
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
  role: {
    type: String,
    required: true,
    trim: true,
    uppercase: true,
    maxlength: 50
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

// Index for active subroles
SubroleSchema.index({ isActive: 1 });
SubroleSchema.index({ name: 1 });
SubroleSchema.index({ role: 1 });

export default mongoose.models.Subrole || mongoose.model<ISubrole>('Subrole', SubroleSchema);

