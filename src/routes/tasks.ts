import express from 'express';
import Task from '../models/Task.js';
import Project from '../models/Project.js';
import { verifyToken } from '../lib/jwt.js';
import { createNotification } from './notifications.js';

const router = express.Router();

// Admin middleware (same logic as in clients/users routes)
const verifyAdminToken = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }

    const token = authHeader.substring(7);

    try {
      const decoded = verifyToken(token) as any;

      const adminEmail = process.env.ADMIN_EMAIL?.trim();
      if (!adminEmail) {
        console.error('❌ ADMIN_EMAIL not configured');
        return res.status(500).json({ error: 'Admin configuration error' });
      }

      if (decoded.email?.trim() !== adminEmail) {
        return res.status(403).json({ error: 'Forbidden: Admin access required' });
      }

      (req as any).admin = decoded;
      next();
    } catch (error) {
      console.error('Admin token verification error:', error);
      return res.status(401).json({ error: 'Unauthorized: Invalid or expired token' });
    }
  } catch (error) {
    return res.status(401).json({ error: 'Unauthorized: Invalid token format' });
  }
};

// ADMIN: Get tasks for a project
router.get('/admin/projects/:projectId/tasks', verifyAdminToken, async (req, res) => {
  try {
    const { projectId } = req.params;
    const tasks = await Task.find({ projectId }).sort({ order: 1, createdAt: 1 }).lean();
    res.json({ tasks });
  } catch (error: any) {
    console.error('❌ Error fetching tasks:', error);
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

// ADMIN: Create task for a project
router.post('/admin/projects/:projectId/tasks', verifyAdminToken, async (req, res) => {
  try {
    const { projectId } = req.params;
    const { title, description, status, dueDate } = req.body as {
      title?: string;
      description?: string;
      status?: 'todo' | 'in-progress' | 'done';
      dueDate?: string;
    };

    if (!title) {
      return res.status(400).json({ error: 'Title is required' });
    }

    const project = await Project.findById(projectId).lean();
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const maxOrder = await Task.find({ projectId }).sort({ order: -1 }).limit(1).lean();
    const order = maxOrder[0]?.order + 1 || 0;

    const task = await Task.create({
      projectId,
      title,
      description,
      status: status || 'todo',
      dueDate: dueDate ? new Date(dueDate) : undefined,
      order,
    });

    res.status(201).json({ task: task.toJSON() });
  } catch (error: any) {
    console.error('❌ Error creating task:', error);
    res.status(500).json({ error: 'Failed to create task' });
  }
});

// ADMIN: Update task
router.patch('/admin/tasks/:taskId', verifyAdminToken, async (req, res) => {
  try {
    const { taskId } = req.params;
    const updateData: any = { ...req.body };

    if (updateData.dueDate) {
      updateData.dueDate = new Date(updateData.dueDate);
    }

    // Get the task before update to check status change
    const oldTask = await Task.findById(taskId).lean();
    const wasDone = oldTask?.status === 'done';
    const willBeDone = updateData.status === 'done';

    const task = await Task.findByIdAndUpdate(
      taskId,
      { $set: updateData },
      { new: true, runValidators: true }
    ).lean();

    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Create notification if task was just completed
    if (!wasDone && willBeDone) {
      const project = await Project.findById(task.projectId).lean();
      if (project && project.clientId) {
        await createNotification(
          String(project.clientId),
          `TASK COMPLETED: ${task.title}`,
          'task',
          String(task._id),
          'task'
        );
      }
    }

    res.json({ task });
  } catch (error: any) {
    console.error('❌ Error updating task:', error);
    res.status(500).json({ error: 'Failed to update task' });
  }
});

// ADMIN: Delete task
router.delete('/admin/tasks/:taskId', verifyAdminToken, async (req, res) => {
  try {
    const { taskId } = req.params;
    const task = await Task.findByIdAndDelete(taskId);

    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error('❌ Error deleting task:', error);
    res.status(500).json({ error: 'Failed to delete task' });
  }
});

// CLIENT: Get tasks for a project owned by current user
router.get('/projects/:projectId/tasks', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.substring(7);
    const decoded = verifyToken(token) as any;

    const project = await Project.findById(req.params.projectId).lean() as any;
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    if (String(project.clientId) !== decoded.userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const tasks = await Task.find({ projectId: project._id }).sort({ order: 1, createdAt: 1 }).lean();
    res.json({ tasks });
  } catch (error: any) {
    console.error('❌ Error fetching client tasks:', error);
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

export default router;

