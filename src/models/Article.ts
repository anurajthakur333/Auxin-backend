import mongoose, { Document, Schema } from 'mongoose';

export interface IArticle extends Document {
  _id: string;
  slug: string;
  title: string;
  category: string;
  date: string;
  readTime: string;
  excerpt: string;
  author: string;
  tags: string[];
  content: string[];
  image?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ArticleSchema = new Schema<IArticle>({
  slug: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
    maxlength: 200
  },
  title: {
    type: String,
    required: true,
    trim: true,
    uppercase: true,
    maxlength: 500
  },
  category: {
    type: String,
    required: true,
    trim: true,
    uppercase: true
  },
  date: {
    type: String,
    required: true,
    trim: true,
    uppercase: true
  },
  readTime: {
    type: String,
    required: true,
    trim: true,
    uppercase: true
  },
  excerpt: {
    type: String,
    required: true,
    trim: true,
    uppercase: true,
    maxlength: 1000
  },
  author: {
    type: String,
    required: true,
    trim: true,
    uppercase: true,
    maxlength: 200
  },
  tags: [{
    type: String,
    trim: true,
    uppercase: true
  }],
  content: [{
    type: String,
    trim: true,
    uppercase: true
  }],
  image: {
    type: String,
    trim: true,
    default: ''
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

// Index for active articles
ArticleSchema.index({ isActive: 1 });

// Index for slug lookup
ArticleSchema.index({ slug: 1 });

// Index for category filtering
ArticleSchema.index({ category: 1 });

// Compound index for active articles by category
ArticleSchema.index({ isActive: 1, category: 1 });

export default mongoose.models.Article || mongoose.model<IArticle>('Article', ArticleSchema);

