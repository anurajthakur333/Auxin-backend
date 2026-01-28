import mongoose, { Document, Schema } from 'mongoose';

export interface ITask extends Document {
  _id: string;
  projectId: mongoose.Types.ObjectId;
  title: string;
  description?: string;
  status: 'todo' | 'in-progress' | 'done';
  dueDate?: Date;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

const TaskSchema = new Schema<ITask>({
  projectId: {
    type: Schema.Types.ObjectId,
    ref: 'Project',
    required: true,
    index: true,
  },
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200,
  },
  description: {
    type: String,
    trim: true,
    maxlength: 1000,
  },
  status: {
    type: String,
    enum: ['todo', 'in-progress', 'done'],
    default: 'todo',
  },
  dueDate: {
    type: Date,
  },
  order: {
    type: Number,
    default: 0,
  },
}, {
  timestamps: true,
  toJSON: {
    transform(_doc, ret: any) {
      ret.id = ret._id;
      delete ret._id;
      delete ret.__v;
    },
  },
});

TaskSchema.index({ projectId: 1, order: 1 });

export default mongoose.models.Task || mongoose.model<ITask>('Task', TaskSchema);

