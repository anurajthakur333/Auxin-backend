import express from 'express';
import User from '../models/User.js';
import Appointment from '../models/Appointment.js';
import Project from '../models/Project.js';
import Task from '../models/Task.js';
import Invoice from '../models/Invoice.js';
import Notification from '../models/Notification.js';
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

// Get all clients (users with client codes) - Admin only
router.get('/', verifyAdminToken, async (req, res) => {
  try {
    console.log('👥 Admin fetching clients list');
    
    // Fetch all users with client codes
    const users = (await User.find({ clientCode: { $exists: true, $ne: null } })
      .select('-emailVerificationCode -emailVerificationExpires -passwordResetToken -passwordResetExpires')
      .sort({ createdAt: -1 })
      .lean()) as any[];

    console.log(`📊 Found ${users.length} clients in database`);

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
    const formattedClients = users.map((user: any) => {
      const userId = user._id?.toString() || user.id;
      const projects = appointmentMap.get(userId) || 0;
      
      const isEmailVerified = user.isEmailVerified === true || 
                             user.isEmailVerified === 'true' || 
                             user.isEmailVerified === 1 || 
                             String(user.isEmailVerified).toLowerCase() === 'true';
      
      const isBanned = !!user.isBanned;
      const status = isBanned ? 'banned' : (isEmailVerified ? 'active' : 'inactive');
      
      return {
        id: userId,
        name: user.name || 'N/A',
        email: user.email || '',
        clientCode: user.clientCode || '',
        status,
        isEmailVerified: Boolean(isEmailVerified),
        isBanned,
        joinDate: user.createdAt || new Date(),
        projects
      };
    });

    console.log(`✅ Returning ${formattedClients.length} clients to admin`);
    res.json({ clients: formattedClients });
  } catch (error: any) {
    console.error('❌ Error fetching clients:', error);
    console.error('❌ Error stack:', error.stack);
    res.status(500).json({ 
      error: 'Failed to fetch clients',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Check if a client code is available - Admin only
router.get('/check-code/:code', verifyAdminToken, async (req, res) => {
  try {
    const { code } = req.params;
    const trimmedCode = code.trim().toUpperCase();

    // Validate format
    const codeRegex = /^[A-Z]{5}$/;
    if (!codeRegex.test(trimmedCode)) {
      return res.status(400).json({ error: 'Invalid client code format' });
    }

    // Check if code exists
    const existingUser = await User.findOne({ clientCode: trimmedCode }).lean() as any;
    
    if (existingUser) {
      return res.json({ 
        exists: true,
        clientId: existingUser._id?.toString() || existingUser.id
      });
    }

    return res.json({ exists: false });
  } catch (error: any) {
    console.error('❌ Error checking client code:', error);
    res.status(500).json({ error: 'Failed to check client code' });
  }
});

// Get client by code - Admin only
router.get('/by-code/:code', verifyAdminToken, async (req, res) => {
  try {
    const { code } = req.params;
    const trimmedCode = code.trim().toUpperCase();

    // Validate format
    const codeRegex = /^[A-Z]{5}$/;
    if (!codeRegex.test(trimmedCode)) {
      return res.status(400).json({ error: 'Invalid client code format. Must be exactly 5 capital letters (A-Z)' });
    }

    // Find user by client code
    const user = await User.findOne({ clientCode: trimmedCode }).lean() as any;
    
    if (!user) {
      return res.status(404).json({ error: 'Client not found with this code' });
    }

    // Get appointment count
    const projects = await Appointment.countDocuments({ userId: user._id?.toString() || user.id });

    // Safely check isEmailVerified
    const isEmailVerified = user.isEmailVerified === true || 
                           user.isEmailVerified === 'true' || 
                           user.isEmailVerified === 1 || 
                           String(user.isEmailVerified).toLowerCase() === 'true';
    
    const isBanned = !!user.isBanned;
    
    const client = {
      id: user._id?.toString() || user.id,
      name: user.name || 'N/A',
      email: user.email || '',
      clientCode: user.clientCode || '',
      status: isBanned ? 'banned' : (isEmailVerified ? 'active' : 'inactive'),
      isEmailVerified: Boolean(isEmailVerified),
      isBanned,
      joinDate: user.createdAt || new Date(),
      projects,
      billingInfo: user.billingInfo || {}
    };

    res.json({ client });
  } catch (error: any) {
    console.error('❌ Error fetching client by code:', error);
    res.status(500).json({ error: 'Failed to fetch client' });
  }
});

// Update a client's code - Admin only
router.patch('/:id/code', verifyAdminToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { clientCode } = req.body as { clientCode?: string };

    if (!clientCode) {
      return res.status(400).json({ error: 'Client code is required' });
    }

    // Validate client code format: exactly 5 capital letters
    const codeRegex = /^[A-Z]{5}$/;
    const trimmedCode = clientCode.trim().toUpperCase();

    if (!codeRegex.test(trimmedCode)) {
      return res.status(400).json({ error: 'Client code must be exactly 5 capital letters (A-Z)' });
    }

    // Check if code is already in use by another client
    const existingClient = await User.findOne({ clientCode: trimmedCode });
    if (existingClient && existingClient._id.toString() !== id) {
      return res.status(400).json({ error: 'This client code is already in use' });
    }

    // Update client code
    const user = (await User.findByIdAndUpdate(
      id,
      { $set: { clientCode: trimmedCode } },
      { new: true }
    ).lean()) as any;

    if (!user) {
      return res.status(404).json({ error: 'Client not found' });
    }

    // Verify user has a client code (should be a client)
    if (!user.clientCode) {
      return res.status(400).json({ error: 'User is not a client' });
    }

    // Get appointment count
    const projects = await Appointment.countDocuments({ userId: id });

    // Safely check isEmailVerified
    const isEmailVerified = user.isEmailVerified === true || 
                           user.isEmailVerified === 'true' || 
                           user.isEmailVerified === 1 || 
                           String(user.isEmailVerified).toLowerCase() === 'true';
    
    const isBanned = !!user.isBanned;
    
    const responseClient = {
      id: user._id?.toString() || (user as any).id,
      name: user.name || 'N/A',
      email: user.email || '',
      clientCode: user.clientCode,
      status: isBanned ? 'banned' : (isEmailVerified ? 'active' : 'inactive'),
      isEmailVerified: Boolean(isEmailVerified),
      isBanned,
      joinDate: user.createdAt || new Date(),
      projects
    };

    console.log(`✅ Admin updated client code to ${trimmedCode} for client`, { id: responseClient.id, email: responseClient.email });
    res.json({ client: responseClient });
  } catch (error: any) {
    console.error('❌ Error updating client code:', error);
    
    // Handle duplicate key error (MongoDB unique constraint)
    if (error.code === 11000 || error.message?.includes('duplicate key')) {
      return res.status(400).json({ error: 'This client code is already in use' });
    }
    
    res.status(500).json({ error: 'Failed to update client code' });
  }
});

// Convert client to regular user (removes client code but keeps all data) - Admin only
router.patch('/:id/convert-to-user', verifyAdminToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Find the user
    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!user.clientCode) {
      return res.status(400).json({ error: 'User is not a client' });
    }

    const previousCode = user.clientCode;

    // Remove client code (convert to regular user)
    user.clientCode = undefined;
    await user.save();

    console.log(`✅ Converted client ${previousCode} to regular user`, { id, email: user.email });
    
    res.json({ 
      message: 'Client converted to regular user successfully. User can no longer access the dashboard.',
      user: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        previousClientCode: previousCode
      }
    });
  } catch (error: any) {
    console.error('❌ Error converting client to user:', error);
    res.status(500).json({ error: 'Failed to convert client to user' });
  }
});

// Delete client and all associated data - Admin only
router.delete('/:id', verifyAdminToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Find the user first
    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!user.clientCode) {
      return res.status(400).json({ error: 'User is not a client. Use the Users tab to manage regular users.' });
    }

    const clientInfo = {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      clientCode: user.clientCode
    };

    // Delete all associated data
    const deletedData = {
      projects: 0,
      tasks: 0,
      invoices: 0,
      notifications: 0,
      appointments: 0
    };

    // 1. Get all projects for this client
    const projects = await Project.find({ clientId: id });
    const projectIds = projects.map(p => p._id);

    // 2. Delete all tasks for these projects
    if (projectIds.length > 0) {
      const taskResult = await Task.deleteMany({ projectId: { $in: projectIds } });
      deletedData.tasks = taskResult.deletedCount;
    }

    // 3. Delete all projects
    const projectResult = await Project.deleteMany({ clientId: id });
    deletedData.projects = projectResult.deletedCount;

    // 4. Delete all invoices
    const invoiceResult = await Invoice.deleteMany({ clientId: id });
    deletedData.invoices = invoiceResult.deletedCount;

    // 5. Delete all notifications
    const notificationResult = await Notification.deleteMany({ userId: id });
    deletedData.notifications = notificationResult.deletedCount;

    // 6. Delete all appointments
    const appointmentResult = await Appointment.deleteMany({ userId: id });
    deletedData.appointments = appointmentResult.deletedCount;

    // 7. Finally delete the user
    await User.findByIdAndDelete(id);

    console.log(`✅ Deleted client and all associated data`, { 
      clientInfo, 
      deletedData 
    });

    res.json({ 
      message: 'Client and all associated data deleted successfully',
      deletedClient: clientInfo,
      deletedData
    });
  } catch (error: any) {
    console.error('❌ Error deleting client:', error);
    res.status(500).json({ error: 'Failed to delete client' });
  }
});

// =====================================================
// CLIENT-SIDE BILLING INFO ROUTES (Authenticated Users)
// =====================================================

// Middleware to verify user token
const verifyUserToken = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }

    const token = authHeader.substring(7);
    
    try {
      const decoded = verifyToken(token) as any;
      (req as any).user = decoded;
      next();
    } catch (error) {
      console.error('User token verification error:', error);
      return res.status(401).json({ error: 'Unauthorized: Invalid or expired token' });
    }
  } catch (error) {
    return res.status(401).json({ error: 'Unauthorized: Invalid token format' });
  }
};

// Get current user's billing info
router.get('/user/billing-info', verifyUserToken, async (req, res) => {
  try {
    const userId = (req as any).user.id || (req as any).user.userId;
    
    const user = await User.findById(userId).lean() as any;
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      billingInfo: user.billingInfo || {},
      name: user.name,
      email: user.email
    });
  } catch (error: any) {
    console.error('❌ Error fetching user billing info:', error);
    res.status(500).json({ error: 'Failed to fetch billing info' });
  }
});

// Update current user's billing info
router.patch('/user/billing-info', verifyUserToken, async (req, res) => {
  try {
    const userId = (req as any).user.id || (req as any).user.userId;
    const { phone, address, city, state, country, zip, gstNumber } = req.body;

    const user = await User.findByIdAndUpdate(
      userId,
      {
        $set: {
          'billingInfo.phone': phone,
          'billingInfo.address': address,
          'billingInfo.city': city,
          'billingInfo.state': state,
          'billingInfo.country': country,
          'billingInfo.zip': zip,
          'billingInfo.gstNumber': gstNumber
        }
      },
      { new: true }
    ).lean() as any;

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    console.log(`✅ Updated billing info for user ${userId}`);
    res.json({
      message: 'Billing info updated successfully',
      billingInfo: user.billingInfo || {}
    });
  } catch (error: any) {
    console.error('❌ Error updating user billing info:', error);
    res.status(500).json({ error: 'Failed to update billing info' });
  }
});

export default router;
