import mongoose, { Document, Schema } from 'mongoose';

export interface IQuestion {
  label: string;
  type: 'text' | 'textarea' | 'email' | 'tel' | 'number';
  placeholder?: string;
  required: boolean;
  order: number;
}

export interface IMeetingCategory extends Document {
  _id: string;
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  questions: IQuestion[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const QuestionSchema = new Schema<IQuestion>({
  label: {
    type: String,
    required: true,
    trim: true
  },
  type: {
    type: String,
    enum: ['text', 'textarea', 'email', 'tel', 'number'],
    required: true,
    default: 'text'
  },
  placeholder: {
    type: String,
    trim: true
  },
  required: {
    type: Boolean,
    default: false
  },
  order: {
    type: Number,
    required: true,
    default: 0
  }
}, { _id: false });

const MeetingCategorySchema = new Schema<IMeetingCategory>({
  name: {
    type: String,
    required: true,
    trim: true,
    uppercase: true
  },
  description: {
    type: String,
    trim: true
  },
  icon: {
    type: String,
    trim: true
  },
  color: {
    type: String,
    trim: true,
    default: '#39FF14'
  },
  questions: {
    type: [QuestionSchema],
    default: []
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

// Index for active categories
MeetingCategorySchema.index({ isActive: 1 });

export default mongoose.models.MeetingCategory || mongoose.model<IMeetingCategory>('MeetingCategory', MeetingCategorySchema);


