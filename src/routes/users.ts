import express from 'express';
import User from '../models/User.js';
import Appointment from '../models/Appointment.js';
import { verifyToken } from '../lib/jwt.js';

const router = express.Router();

// Admin middleware to verify admin token
const verifyAdminToken = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    
    try {
      const decoded = verifyToken(token) as any;
      
      // Check if the email in the token matches the admin email from env
      const adminEmail = process.env.ADMIN_EMAIL?.trim();
      if (!adminEmail) {
        console.error('❌ ADMIN_EMAIL not configured');
        return res.status(500).json({ error: 'Admin configuration error' });
      }
      
      // Verify the token email matches admin email
      if (decoded.email?.trim() !== adminEmail) {
        return res.status(403).json({ error: 'Forbidden: Admin access required' });
      }
      
      // Attach admin info to request
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

// Debug route to check if route is registered (remove in production)
router.get('/debug', (req, res) => {
  res.json({ message: 'Users route is working', timestamp: new Date().toISOString() });
});

// Get all users (Admin only)
router.get('/', verifyAdminToken, async (req, res) => {
  try {
    console.log('👥 Admin fetching users list');
    console.log('🔍 Request headers:', { authorization: req.headers.authorization ? 'Bearer ***' : 'none' });
    
    // Fetch all users from database
    // We need password field to check if it exists, but we won't send it to frontend
    const users = await User.find({})
      .select('-emailVerificationCode -emailVerificationExpires -passwordResetToken -passwordResetExpires')
      .sort({ createdAt: -1 }) // Newest first
      .lean();

    console.log(`📊 Found ${users.length} users in database`);
    
    // Log first user's data for debugging
    if (users.length > 0) {
      const firstUser = users[0] as any;
      console.log('🔍 Sample user data from DB:', {
        id: firstUser._id,
        email: firstUser.email,
        isEmailVerified: firstUser.isEmailVerified,
        isEmailVerifiedType: typeof firstUser.isEmailVerified,
        hasPassword: !!firstUser.password,
        isBanned: !!firstUser.isBanned
      });
    }

    // Get appointment counts for all users in parallel
    const userIds = users.map((user: any) => user._id?.toString() || user.id);
    const appointmentCounts = await Appointment.aggregate([
      { $match: { userId: { $in: userIds } } },
      { $group: { _id: '$userId', count: { $sum: 1 } } }
    ]);

    // Create a map of userId -> appointment count
    const appointmentMap = new Map(
      appointmentCounts.map((item: any) => [item._id.toString(), item.count])
    );

    // Transform users to match frontend interface
    const formattedUsers = users.map((user: any) => {
      const userId = user._id?.toString() || user.id;
      // Get appointment count for this user (default to 0)
      const projects = appointmentMap.get(userId) || 0;
      
      // Safely check isEmailVerified - handle both boolean and string/truthy values
      // MongoDB might store it as boolean, string, or number
      const isEmailVerified = user.isEmailVerified === true || 
                             user.isEmailVerified === 'true' || 
                             user.isEmailVerified === 1 || 
                             String(user.isEmailVerified).toLowerCase() === 'true';
      
      // Check if password exists (we have it in the query but won't send it)
      const hasPassword = !!(user.password && String(user.password).trim().length > 0);
      const isBanned = !!user.isBanned;
      
      // Determine status based on email verification and ban
      const status = isBanned ? 'banned' : (isEmailVerified ? 'active' : 'inactive');
      
      // Return user data
      // Note: Including password for admin viewing (passwords are stored in plain text in this system)
      // In production, consider hashing passwords and removing this field
      return {
        id: userId,
        name: user.name || 'N/A',
        email: user.email || '',
        status,
        isEmailVerified: Boolean(isEmailVerified), // Ensure it's a boolean
        hasPassword,
        password: hasPassword ? String(user.password) : null, // Show password for admin (plain text storage)
        isBanned,
        joinDate: user.createdAt || new Date(),
        projects
      };
    });

    console.log(`✅ Returning ${formattedUsers.length} users to admin`);
    console.log(`📈 Total appointments across all users: ${appointmentCounts.reduce((sum, item) => sum + item.count, 0)}`);
    res.json({ users: formattedUsers });
  } catch (error: any) {
    console.error('❌ Error fetching users:', error);
    console.error('❌ Error stack:', error.stack);
    res.status(500).json({ 
      error: 'Failed to fetch users',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Toggle ban status for a user (Admin only)
router.patch('/:id/ban', verifyAdminToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { banned } = req.body as { banned?: boolean };

    if (typeof banned !== 'boolean') {
      return res.status(400).json({ error: 'Invalid banned value' });
    }

    const user = await User.findByIdAndUpdate(
      id,
      { $set: { isBanned: banned } },
      { new: true }
    ).lean();

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Safely check isEmailVerified (same logic as GET endpoint)
    const isEmailVerified = user.isEmailVerified === true || 
                           user.isEmailVerified === 'true' || 
                           user.isEmailVerified === 1 || 
                           String(user.isEmailVerified).toLowerCase() === 'true';
    
    const hasPassword = !!(user.password && String(user.password).trim().length > 0);
    const isBanned = !!user.isBanned;
    
    const responseUser = {
      id: user._id?.toString() || (user as any).id,
      name: user.name || 'N/A',
      email: user.email || '',
      status: isBanned ? 'banned' : (isEmailVerified ? 'active' : 'inactive'),
      isEmailVerified: Boolean(isEmailVerified),
      hasPassword,
      password: hasPassword ? String(user.password) : null,
      isBanned,
      joinDate: user.createdAt || new Date(),
      projects: 0 // Would need to calculate if needed
    };

    console.log(`🚨 Admin set ban=${banned} for user`, { id: responseUser.id, email: responseUser.email });
    res.json({ user: responseUser });
  } catch (error: any) {
    console.error('❌ Error updating user ban status:', error);
    res.status(500).json({ error: 'Failed to update user ban status' });
  }
});

export default router;
