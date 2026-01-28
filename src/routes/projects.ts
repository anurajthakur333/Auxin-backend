import express from 'express';
import Project from '../models/Project.js';
import User from '../models/User.js';
import Task from '../models/Task.js';
import { verifyToken } from '../lib/jwt.js';
import { createNotification } from './notifications.js';

const router = express.Router();

// Admin middleware
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

// Get all projects for a specific client - Admin only
router.get('/client/:clientId', verifyAdminToken, async (req, res) => {
  try {
    const { clientId } = req.params;
    
    const projects = await Project.find({ clientId })
      .sort({ createdAt: -1 })
      .lean();

    const projectIds = projects.map(p => p._id);

    const taskCounts = await Task.aggregate([
      { $match: { projectId: { $in: projectIds } } },
      {
        $group: {
          _id: '$projectId',
          total: { $sum: 1 },
          completed: {
            $sum: {
              $cond: [{ $eq: ['$status', 'done'] }, 1, 0],
            },
          },
        },
      },
    ]);

    const countsMap = new Map<string, { total: number; completed: number }>();
    taskCounts.forEach((c: any) => {
      countsMap.set(String(c._id), { total: c.total || 0, completed: c.completed || 0 });
    });

    const projectsWithCounts = projects.map((p: any) => {
      const counts = countsMap.get(String(p._id)) || { total: 0, completed: 0 };
      const totalTasks = counts.total;
      const completedTasks = counts.completed;

      // Derive progress from tasks: if no tasks exist, progress is 0%
      const derivedProgress =
        totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

      return {
        ...p,
        progress: derivedProgress,
        tasks: {
          total: totalTasks,
          completed: completedTasks,
        },
      };
    });

    res.json({ projects: projectsWithCounts });
  } catch (error: any) {
    console.error('❌ Error fetching client projects:', error);
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

// Create a new project for a client - Admin only
router.post('/client/:clientId', verifyAdminToken, async (req, res) => {
  try {
    const { clientId } = req.params;
    const {
      name,
      description,
      category,
      status,
      progress,
      deadline,
      startDate,
      budget,
      team,
      tasks,
      projectCode,
    } = req.body;

    // Validate required fields
    if (!name || !category || !deadline || !startDate) {
      return res.status(400).json({ error: 'Name, category, deadline, and startDate are required' });
    }

    // Verify client exists and has a clientCode
    const client = await User.findById(clientId);
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }
    if (!(client as any).clientCode) {
      return res.status(400).json({ error: 'User is not a client' });
    }

    // Validate / normalize project code (optional but recommended)
    let normalizedCode: string | undefined;
    if (projectCode) {
      normalizedCode = String(projectCode).trim().toUpperCase();
      if (!/^[A-Z]{6}$/.test(normalizedCode)) {
        return res.status(400).json({ error: 'Project code must be exactly 6 capital letters (A-Z)' });
      }

      // Ensure global uniqueness
      const existing = await Project.findOne({ projectCode: normalizedCode }).lean();
      if (existing) {
        return res.status(409).json({ error: 'Project code already exists' });
      }
    }

    // Create project
    const project = new Project({
      name,
      description,
      clientId,
      category,
      status: status || 'pending',
      progress: progress || 0,
      deadline: new Date(deadline),
      startDate: new Date(startDate),
      budget,
      team: team || [],
      tasks: tasks || { completed: 0, total: 0 },
      projectCode: normalizedCode,
    });

    await project.save();

    // Create notification for client about new project
    const projectCodeDisplay = normalizedCode ? `PROJECT - ${normalizedCode}` : 'NEW PROJECT';
    await createNotification(
      String(clientId),
      `${projectCodeDisplay}: ${project.name}`,
      'project',
      String(project._id),
      'project'
    );

    const projectObj = project.toObject();
    res.status(201).json({ project: projectObj });
  } catch (error: any) {
    console.error('❌ Error creating project:', error);
    res.status(500).json({ error: 'Failed to create project' });
  }
});

// Update a project - Admin only
router.patch('/:projectId', verifyAdminToken, async (req, res) => {
  try {
    const { projectId } = req.params;
    const updateData = req.body as any;

    // Convert date strings to Date objects if present
    if (updateData.deadline) {
      updateData.deadline = new Date(updateData.deadline);
    }
    if (updateData.startDate) {
      updateData.startDate = new Date(updateData.startDate);
    }

    // If updating projectCode, validate and enforce global uniqueness
    if (updateData.projectCode) {
      const code = String(updateData.projectCode).trim().toUpperCase();
      if (!/^[A-Z]{6}$/.test(code)) {
        return res.status(400).json({ error: 'Project code must be exactly 6 capital letters (A-Z)' });
      }

      const duplicate = await Project.findOne({
        _id: { $ne: projectId },
        projectCode: code,
      }).lean();

      if (duplicate) {
        return res.status(409).json({ error: 'Project code already exists' });
      }

      updateData.projectCode = code;
    }

    const project = await Project.findByIdAndUpdate(
      projectId,
      { $set: updateData },
      { new: true, runValidators: true }
    ).lean();

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    res.json({ project });
  } catch (error: any) {
    console.error('❌ Error updating project:', error);
    res.status(500).json({ error: 'Failed to update project' });
  }
});

// Delete a project - Admin only
router.delete('/:projectId', verifyAdminToken, async (req, res) => {
  try {
    const { projectId } = req.params;

    const project = await Project.findByIdAndDelete(projectId);

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    res.json({ message: 'Project deleted successfully' });
  } catch (error: any) {
    console.error('❌ Error deleting project:', error);
    res.status(500).json({ error: 'Failed to delete project' });
  }
});

// Get projects for authenticated user (client dashboard)
router.get('/my-projects', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.substring(7);
    const decoded = verifyToken(token);

    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    // Get projects for this user
    const projects = await Project.find({ clientId: user._id })
      .sort({ createdAt: -1 })
      .lean();
    
    const projectIds = projects.map(p => p._id);

    const taskCounts = await Task.aggregate([
      { $match: { projectId: { $in: projectIds } } },
      {
        $group: {
          _id: '$projectId',
          total: { $sum: 1 },
          completed: {
            $sum: {
              $cond: [{ $eq: ['$status', 'done'] }, 1, 0],
            },
          },
        },
      },
    ]);

    const countsMap = new Map<string, { total: number; completed: number }>();
    taskCounts.forEach((c: any) => {
      countsMap.set(String(c._id), { total: c.total || 0, completed: c.completed || 0 });
    });

    const projectsWithCounts = projects.map((p: any) => {
      const counts = countsMap.get(String(p._id)) || { total: 0, completed: 0 };
      const totalTasks = counts.total;
      const completedTasks = counts.completed;

      // Derive progress from tasks: if no tasks exist, progress is 0%
      const derivedProgress =
        totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

      return {
        ...p,
        progress: derivedProgress,
        tasks: {
          total: totalTasks,
          completed: completedTasks,
        },
      };
    });

    res.json({ projects: projectsWithCounts });
  } catch (error: any) {
    console.error('❌ Error fetching user projects:', error);
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

export default router;
