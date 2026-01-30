import mongoose, { Document, Schema } from 'mongoose';

export interface IProject extends Document {
  _id: string;
  name: string;
  projectCode?: string;
  description?: string;
  clientId: mongoose.Types.ObjectId; // Reference to User with clientCode
  category: string; // Dynamic - managed through ProjectCategory
  status: 'active' | 'pending' | 'completed' | 'on-hold';
  progress: number; // 0-100
  deadline: Date;
  startDate: Date;
  budget?: string;
  team?: string[];
  tasks?: {
    completed: number;
    total: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

const ProjectSchema = new Schema<IProject>({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  projectCode: {
    type: String,
    uppercase: true,
    trim: true,
    match: [/^[A-Z]{6}$/, 'Project code must be exactly 6 capital letters'],
  },
  description: {
    type: String,
    trim: true,
    maxlength: 1000
  },
  clientId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  category: {
    type: String,
    required: true,
    trim: true,
    lowercase: true
  },
  status: {
    type: String,
    enum: ['active', 'pending', 'completed', 'on-hold'],
    default: 'pending',
    required: true
  },
  progress: {
    type: Number,
    min: 0,
    max: 100,
    default: 0,
    required: true
  },
  deadline: {
    type: Date,
    required: true
  },
  startDate: {
    type: Date,
    required: true
  },
  budget: {
    type: String,
    trim: true
  },
  team: {
    type: [String],
    default: []
  },
  tasks: {
    completed: {
      type: Number,
      default: 0,
      min: 0
    },
    total: {
      type: Number,
      default: 0,
      min: 0
    }
  }
}, {
  timestamps: true,
  toJSON: {
    transform: function(_doc, ret: Record<string, unknown>) {
      ret.id = ret._id;
      delete ret._id;
      delete ret.__v;
      return ret;
    }
  }
});

// Indexes for better query performance
ProjectSchema.index({ clientId: 1 });
// Globally unique project code (optional field)
ProjectSchema.index({ projectCode: 1 }, { unique: true, sparse: true });
ProjectSchema.index({ status: 1 });
ProjectSchema.index({ category: 1 });
ProjectSchema.index({ deadline: 1 });

export default mongoose.models.Project || mongoose.model<IProject>('Project', ProjectSchema);
