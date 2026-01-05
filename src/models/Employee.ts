import mongoose, { Document, Schema } from 'mongoose';
import crypto from 'crypto';

export interface ISalaryHistory {
  date: Date;
  amount: number;
  currency: string;
  reason?: string;
  previousAmount: number;
}

export interface IEmployee extends Document {
  _id: string;
  employeeId: string; // 4 capital letters, unique
  name: string;
  email: string; // Login email (admin email)
  personalEmail?: string; // Personal email
  password?: string;
  role: string;
  subrole?: string;
  age?: number;
  location?: string;
  joinedDate?: Date;
  videoProof?: string; // Cloudinary URL
  documentProof?: string; // Cloudinary URL
  salary?: number;
  currency?: string; // USD, EUR, INR, etc.
  salaryHistory?: ISalaryHistory[];
  isActive: boolean;
  isBanned: boolean;
  isVerified?: boolean; // Employee verification status
  createdAt: Date;
  updatedAt: Date;
  comparePassword(candidatePassword: string): Promise<boolean>;
  decryptPassword(): string;
}

// Encryption key (should be in env, but using a default for now)
// IMPORTANT: Use a consistent key - don't generate random keys
const getEncryptionKey = (): Buffer => {
  const key = process.env.ENCRYPTION_KEY;
  if (key) {
    // If key is hex string (64 chars = 32 bytes), convert it
    if (key.length === 64 && /^[0-9a-fA-F]+$/.test(key)) {
      return Buffer.from(key, 'hex');
    }
    // Otherwise pad or truncate to 32 bytes from UTF-8
    const keyBuffer = Buffer.alloc(32);
    Buffer.from(key, 'utf8').copy(keyBuffer, 0, 0, 32);
    return keyBuffer;
  }
  // Default key - 64 hex chars = 32 bytes for AES-256
  // This is a fixed key - in production, set ENCRYPTION_KEY in environment variables
  return Buffer.from('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'hex');
};
const ALGORITHM = 'aes-256-cbc';

// Helper functions for encryption/decryption
const encrypt = (text: string): string => {
  const keyBuffer = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, keyBuffer, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
};

const decrypt = (encryptedText: string): string => {
  const keyBuffer = getEncryptionKey();
  const parts = encryptedText.split(':');
  if (parts.length !== 2) {
    throw new Error('Invalid encrypted text format');
  }
  const iv = Buffer.from(parts[0], 'hex');
  const encrypted = parts[1];
  const decipher = crypto.createDecipheriv(ALGORITHM, keyBuffer, iv);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
};

const EmployeeSchema = new Schema<IEmployee>({
  employeeId: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    trim: true,
    match: [/^[A-Z]{4}$/, 'Employee ID must be exactly 4 capital letters'],
    index: true
  },
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100,
    uppercase: true
  },
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    unique: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email']
  },
  personalEmail: {
    type: String,
    lowercase: true,
    trim: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email']
  },
  password: {
    type: String,
    minlength: 6,
    select: false // Don't include password in queries by default
  },
  role: {
    type: String,
    required: true,
    trim: true,
    uppercase: true,
    default: 'EMPLOYEE'
  },
  subrole: {
    type: String,
    trim: true,
    uppercase: true,
    default: ''
  },
  age: {
    type: Number,
    min: 18,
    max: 100
  },
  location: {
    type: String,
    trim: true,
    maxlength: 200
  },
  joinedDate: {
    type: Date,
    default: Date.now
  },
  videoProof: {
    type: String,
    trim: true
  },
  documentProof: {
    type: String,
    trim: true
  },
  salary: {
    type: Number,
    min: 0
  },
  currency: {
    type: String,
    uppercase: true,
    trim: true,
    default: 'USD',
    enum: ['USD', 'EUR', 'GBP', 'INR', 'CAD', 'AUD', 'JPY', 'CNY', 'SGD', 'AED', 'SAR', 'PKR', 'BDT', 'LKR', 'NPR', 'MYR', 'THB', 'PHP', 'IDR', 'VND', 'KRW', 'HKD', 'NZD', 'ZAR', 'BRL', 'MXN', 'ARS', 'CLP', 'COP', 'PEN', 'EGP', 'NGN', 'KES', 'GHS', 'ETB', 'UGX', 'TZS', 'RWF', 'MAD', 'TND', 'DZD', 'XOF', 'XAF', 'ZMW', 'BWP', 'MWK', 'MZN', 'AOA', 'CDF', 'RUB', 'TRY', 'PLN', 'CZK', 'HUF', 'RON', 'BGN', 'HRK', 'SEK', 'NOK', 'DKK', 'ISK', 'CHF', 'ILS', 'JOD', 'KWD', 'BHD', 'OMR', 'QAR', 'BND', 'FJD', 'PGK', 'SBD', 'VUV', 'WST', 'TOP', 'TVD', 'XPF', 'NIO', 'GTQ', 'BZD', 'BBD', 'BSD', 'JMD', 'KYD', 'TTD', 'AWG', 'ANG', 'SRD', 'GYD', 'BMD', 'FKP', 'SHP', 'GIP', 'MOP', 'BTN', 'AFN', 'IRR', 'IQD', 'SYP', 'YER', 'LBP', 'AMD', 'AZN', 'GEL', 'KZT', 'KGS', 'TJS', 'TMT', 'UZS', 'MNT', 'KPW', 'MMK', 'LAK', 'KHR', 'TWD', 'HNL', 'SVC', 'PAB', 'CRC', 'PYG', 'UYU', 'BOB', 'VES']
  },
  salaryHistory: [{
    date: {
      type: Date,
      default: Date.now
    },
    amount: {
      type: Number,
      required: true,
      min: 0
    },
    currency: {
      type: String,
      required: true,
      uppercase: true
    },
    reason: {
      type: String,
      trim: true
    },
    previousAmount: {
      type: Number,
      required: true,
      min: 0
    }
  }],
  isActive: {
    type: Boolean,
    default: true
  },
  isBanned: {
    type: Boolean,
    default: false
  },
  isVerified: {
    type: Boolean,
    default: false
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

// Encrypt password before saving
EmployeeSchema.pre('save', async function(next) {
  if (!this.isModified('password') || !this.password) return next();
  
  try {
    // Only encrypt if it's not already encrypted (check if it contains ':')
    if (!this.password.includes(':')) {
      this.password = encrypt(this.password);
    }
    next();
  } catch (error: any) {
    next(error);
  }
});

// Compare password method
EmployeeSchema.methods.comparePassword = async function(candidatePassword: string): Promise<boolean> {
  if (!this.password) return false;
  try {
    const decrypted = decrypt(this.password);
    return decrypted === candidatePassword;
  } catch (error) {
    return false;
  }
};

// Decrypt password method (for admin viewing)
EmployeeSchema.methods.decryptPassword = function(): string {
  if (!this.password) return '';
  try {
    return decrypt(this.password);
  } catch (error) {
    return '';
  }
};

// Indexes
EmployeeSchema.index({ email: 1 });
EmployeeSchema.index({ employeeId: 1 });
EmployeeSchema.index({ role: 1 });
EmployeeSchema.index({ subrole: 1 });
EmployeeSchema.index({ isActive: 1 });
EmployeeSchema.index({ isBanned: 1 });
EmployeeSchema.index({ joinedDate: 1 });

export default mongoose.models.Employee || mongoose.model<IEmployee>('Employee', EmployeeSchema);


