import express from 'express';
import Notification from '../models/Notification.js';
import User from '../models/User.js';
import { verifyToken } from '../lib/jwt.js';

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

// Helper function to create notification
export const createNotification = async (
  userId: string,
  message: string,
  type: 'project' | 'meeting' | 'payment' | 'system' | 'task' | 'billing' | 'custom',
  relatedId?: string,
  relatedType?: string
) => {
  try {
    const notification = await Notification.create({
      userId,
      message,
      type,
      read: false,
      relatedId: relatedId ? relatedId : undefined,
      relatedType: relatedType || undefined,
    });
    return notification;
  } catch (error) {
    console.error('Error creating notification:', error);
    return null;
  }
};

// ADMIN: Send notification to a user
router.post('/admin/notifications', verifyAdminToken, async (req, res) => {
  try {
    const { userId, message, type = 'custom' } = req.body;

    if (!userId || !message) {
      return res.status(400).json({ error: 'User ID and message are required' });
    }

    // Verify user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Validate message length
    if (message.length > 500) {
      return res.status(400).json({ error: 'Message must be 500 characters or less' });
    }

    const notification = await Notification.create({
      userId,
      message: message.trim(),
      type: type || 'custom',
      read: false,
    });

    res.status(201).json({ notification: notification.toJSON() });
  } catch (error: any) {
    console.error('❌ Error creating notification:', error);
    res.status(500).json({ error: 'Failed to create notification' });
  }
});

// ADMIN: Send notification to multiple users
router.post('/admin/notifications/bulk', verifyAdminToken, async (req, res) => {
  try {
    const { userIds, message, type = 'custom' } = req.body;

    if (!userIds || !Array.isArray(userIds) || userIds.length === 0 || !message) {
      return res.status(400).json({ error: 'User IDs array and message are required' });
    }

    // Validate message length
    if (message.length > 500) {
      return res.status(400).json({ error: 'Message must be 500 characters or less' });
    }

    // Verify all users exist
    const users = await User.find({ _id: { $in: userIds } });
    if (users.length !== userIds.length) {
      return res.status(400).json({ error: 'One or more users not found' });
    }

    // Create notifications for all users
    const notifications = await Promise.all(
      userIds.map((userId: string) =>
        Notification.create({
          userId,
          message: message.trim(),
          type: type || 'custom',
          read: false,
        })
      )
    );

    res.status(201).json({ 
      notifications: notifications.map(n => n.toJSON()),
      count: notifications.length 
    });
  } catch (error: any) {
    console.error('❌ Error creating bulk notifications:', error);
    res.status(500).json({ error: 'Failed to create notifications' });
  }
});

// ADMIN: Get all notifications (for admin dashboard)
router.get('/admin/notifications', verifyAdminToken, async (req, res) => {
  try {
    const { userId, read, type, limit = 100 } = req.query;

    const query: any = {};
    if (userId) query.userId = userId;
    if (read !== undefined) query.read = read === 'true';
    if (type) query.type = type;

    const notifications = await Notification.find(query)
      .populate('userId', 'name email')
      .sort({ createdAt: -1 })
      .limit(Number(limit))
      .lean();

    // Normalize IDs
    const normalizedNotifications = notifications.map((notification: any) => ({
      ...notification,
      id: notification._id?.toString() || notification.id,
      _id: undefined,
      userId: notification.userId?._id ? {
        ...notification.userId,
        id: notification.userId._id.toString(),
        _id: undefined,
      } : notification.userId,
    }));

    res.json({ notifications: normalizedNotifications });
  } catch (error: any) {
    console.error('❌ Error fetching notifications:', error);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

// CLIENT: Get notifications for authenticated user
router.get('/notifications', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.substring(7);
    const decoded = verifyToken(token) as any;

    const { read, type, limit = 100 } = req.query;

    const query: any = { userId: decoded.userId };
    if (read !== undefined) query.read = read === 'true';
    if (type) query.type = type;

    const notifications = await Notification.find(query)
      .sort({ createdAt: -1 })
      .limit(Number(limit))
      .lean();

    // Format time ago
    const formattedNotifications = notifications.map((notification: any) => {
      const timeAgo = getTimeAgo(new Date(notification.createdAt));
      return {
        ...notification,
        id: notification._id?.toString() || notification.id,
        _id: undefined,
        time: timeAgo,
      };
    });

    res.json({ notifications: formattedNotifications });
  } catch (error: any) {
    console.error('❌ Error fetching user notifications:', error);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

// CLIENT: Mark notification as read
router.patch('/notifications/:notificationId/read', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.substring(7);
    const decoded = verifyToken(token) as any;

    const notification = await Notification.findOne({
      _id: req.params.notificationId,
      userId: decoded.userId,
    });

    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    notification.read = true;
    await notification.save();

    res.json({ notification: notification.toJSON() });
  } catch (error: any) {
    console.error('❌ Error marking notification as read:', error);
    res.status(500).json({ error: 'Failed to update notification' });
  }
});

// CLIENT: Mark all notifications as read
router.patch('/notifications/read-all', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.substring(7);
    const decoded = verifyToken(token) as any;

    const result = await Notification.updateMany(
      { userId: decoded.userId, read: false },
      { $set: { read: true } }
    );

    res.json({ 
      success: true,
      updatedCount: result.modifiedCount 
    });
  } catch (error: any) {
    console.error('❌ Error marking all notifications as read:', error);
    res.status(500).json({ error: 'Failed to update notifications' });
  }
});

// Helper function to format time ago
function getTimeAgo(date: Date): string {
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffInSeconds < 60) {
    return 'JUST NOW';
  }

  const diffInMinutes = Math.floor(diffInSeconds / 60);
  if (diffInMinutes < 60) {
    return `${diffInMinutes} ${diffInMinutes === 1 ? 'MINUTE' : 'MINUTES'} AGO`;
  }

  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) {
    return `${diffInHours} ${diffInHours === 1 ? 'HOUR' : 'HOURS'} AGO`;
  }

  const diffInDays = Math.floor(diffInHours / 24);
  if (diffInDays < 7) {
    return `${diffInDays} ${diffInDays === 1 ? 'DAY' : 'DAYS'} AGO`;
  }

  const diffInWeeks = Math.floor(diffInDays / 7);
  if (diffInWeeks < 4) {
    return `${diffInWeeks} ${diffInWeeks === 1 ? 'WEEK' : 'WEEKS'} AGO`;
  }

  const diffInMonths = Math.floor(diffInDays / 30);
  return `${diffInMonths} ${diffInMonths === 1 ? 'MONTH' : 'MONTHS'} AGO`;
}

export default router;
