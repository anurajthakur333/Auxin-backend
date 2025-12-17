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
    // Cast to any[] so we can safely access dynamic fields without TS errors
    const users = (await User.find({})
      .select('-emailVerificationCode -emailVerificationExpires -passwordResetToken -passwordResetExpires')
      .sort({ createdAt: -1 }) // Newest first
      .lean()) as any[];

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

// Export users to CSV (Admin only) - MUST be before /:id route
router.get('/export', verifyAdminToken, async (req, res) => {
  try {
    console.log('📊 Admin requesting CSV export');
    console.log('🔍 Query params:', req.query);

    // Build filter query
    const filter: any = {};
    
    if (req.query.nameEmailSearch) {
      const searchTerm = String(req.query.nameEmailSearch).trim();
      filter.$or = [
        { name: { $regex: searchTerm, $options: 'i' } },
        { email: { $regex: searchTerm, $options: 'i' } }
      ];
    }

    if (req.query.emailVerified && req.query.emailVerified !== 'all') {
      filter.isEmailVerified = req.query.emailVerified === 'true';
    }

    if (req.query.status && req.query.status !== 'all') {
      if (req.query.status === 'banned') {
        filter.isBanned = true;
      } else if (req.query.status === 'active') {
        filter.isBanned = false;
        filter.isEmailVerified = true;
      } else if (req.query.status === 'inactive') {
        filter.isBanned = false;
        filter.isEmailVerified = false;
      }
    }

    if (req.query.joinedDateStart || req.query.joinedDateEnd) {
      filter.createdAt = {};
      if (req.query.joinedDateStart) {
        filter.createdAt.$gte = new Date(String(req.query.joinedDateStart));
      }
      if (req.query.joinedDateEnd) {
        const endDate = new Date(String(req.query.joinedDateEnd));
        endDate.setHours(23, 59, 59, 999); // End of day
        filter.createdAt.$lte = endDate;
      }
    }

    // Fetch users with filters
    const users = (await User.find(filter)
      .select('-emailVerificationCode -emailVerificationExpires -passwordResetToken -passwordResetExpires')
      .sort({ createdAt: -1 })
      .lean()) as any[];

    console.log(`📊 Found ${users.length} users matching filters`);

    // Get appointment counts for all users
    const userIds = users.map((user: any) => user._id?.toString() || user.id);
    const appointmentCounts = await Appointment.aggregate([
      { $match: { userId: { $in: userIds } } },
      { $group: { _id: '$userId', count: { $sum: 1 } } }
    ]);

    const appointmentMap = new Map(
      appointmentCounts.map((item: any) => [item._id.toString(), item.count])
    );

    // Generate CSV content
    const csvHeaders = ['Name', 'Email', 'Status', 'Projects', 'Joined At', 'Email Verified', 'Password'];
    
    const csvRows = users.map((user: any) => {
      const userId = user._id?.toString() || user.id;
      const projects = appointmentMap.get(userId) || 0;
      
      const isEmailVerified = user.isEmailVerified === true || 
                             user.isEmailVerified === 'true' || 
                             user.isEmailVerified === 1 || 
                             String(user.isEmailVerified).toLowerCase() === 'true';
      const isBanned = !!user.isBanned;
      const status = isBanned ? 'BANNED' : (isEmailVerified ? 'ACTIVE' : 'INACTIVE');
      
      const joinDate = user.createdAt 
        ? new Date(user.createdAt).toLocaleString('en-US', {
            year: 'numeric',
            month: 'short',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
          })
        : 'N/A';

      return [
        user.name || 'N/A',
        user.email || '',
        status,
        projects.toString(),
        joinDate,
        isEmailVerified ? 'TRUE' : 'FALSE',
        user.password || 'NONE'
      ];
    });

    // Escape CSV values (handle commas, quotes, newlines)
    const escapeCsvValue = (value: string): string => {
      if (value.includes(',') || value.includes('"') || value.includes('\n')) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return value;
    };

    const csvContent = [
      csvHeaders.join(','),
      ...csvRows.map(row => row.map(cell => escapeCsvValue(String(cell))).join(','))
    ].join('\n');

    // Set response headers for CSV download
    const filename = `users_export_${new Date().toISOString().split('T')[0]}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    
    console.log(`✅ CSV export completed: ${users.length} users`);
    res.send(csvContent);
  } catch (error: any) {
    console.error('❌ Error exporting CSV:', error);
    console.error('❌ Error stack:', error.stack);
    res.status(500).json({ 
      error: 'Failed to export CSV',
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

    const user = (await User.findByIdAndUpdate(
      id,
      { $set: { isBanned: banned } },
      { new: true }
    ).lean()) as any;

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

// Delete a user (Admin only)
router.delete('/:id', verifyAdminToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`🗑️ Admin attempting to delete user: ${id}`);

    // Check if user exists
    const user = await User.findById(id);
    if (!user) {
      console.log(`❌ User not found: ${id}`);
      return res.status(404).json({ error: 'User not found' });
    }

    // Delete associated appointments first
    const deletedAppointments = await Appointment.deleteMany({ userId: id });
    console.log(`📅 Deleted ${deletedAppointments.deletedCount} appointments for user ${id}`);

    // Delete the user
    await User.findByIdAndDelete(id);
    console.log(`✅ Successfully deleted user: ${id} (${user.email})`);

    res.json({ message: 'User deleted successfully' });
  } catch (error: any) {
    console.error('❌ Error deleting user:', error);
    console.error('❌ Error stack:', error.stack);
    res.status(500).json({ 
      error: 'Failed to delete user',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

export default router;




