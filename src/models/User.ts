import mongoose, { Document, Schema } from 'mongoose';

export interface IBillingInfo {
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  zip?: string;
  gstNumber?: string;
}

export interface IUser extends Document {
  _id: string;
  name: string;
  email: string;
  password?: string;
  googleId?: string;
  avatar?: string;
  isEmailVerified: boolean;
  // Admin moderation
  isBanned?: boolean;
  clientCode?: string; // 5-digit capital alphabetic code for clients
  // Billing information
  billingInfo?: IBillingInfo;
  emailVerificationCode?: string;
  emailVerificationExpires?: Date;
  passwordResetToken?: string;
  passwordResetExpires?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50
  },
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email']
  },
  password: {
    type: String,
    minlength: 6
  },
  googleId: {
    type: String
  },
  avatar: {
    type: String,
    default: ''
  },
  isEmailVerified: {
    type: Boolean,
    default: false
  },
  isBanned: {
    type: Boolean,
    default: false
  },
  clientCode: {
    type: String,
    uppercase: true,
    trim: true,
    match: [/^[A-Z]{5}$/, 'Client code must be exactly 5 capital letters'],
    sparse: true, // Allows multiple null values but enforces uniqueness for non-null values
    unique: true
  },
  billingInfo: {
    phone: { type: String, trim: true },
    address: { type: String, trim: true },
    city: { type: String, trim: true },
    state: { type: String, trim: true },
    country: { type: String, trim: true },
    zip: { type: String, trim: true },
    gstNumber: { type: String, trim: true }
  },
  emailVerificationCode: {
    type: String
  },
  emailVerificationExpires: {
    type: Date
  },
  passwordResetToken: {
    type: String
  },
  passwordResetExpires: {
    type: Date
  }
}, {
  timestamps: true,
  toJSON: {
    transform: function(_doc, ret: Record<string, unknown>) {
      ret.id = ret._id;
      delete ret._id;
      delete ret.__v;
      delete ret.password;
      return ret;
    }
  }
});

// Index for better query performance
UserSchema.index({ email: 1 });
UserSchema.index({ googleId: 1 }, { sparse: true }); // Sparse index allows multiple null values
UserSchema.index({ clientCode: 1 }, { sparse: true, unique: true }); // Unique index for client codes

export default mongoose.models.User || mongoose.model<IUser>('User', UserSchema);
