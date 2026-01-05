import express from 'express';
import MeetingDuration from '../models/MeetingDuration.js';
import { verifyToken } from '../lib/jwt.js';

const router = express.Router();

// Health check for meeting durations endpoint
router.get('/health', (_req, res) => {
  res.json({ 
    status: 'OK', 
    service: 'meeting-durations',
    timestamp: new Date().toISOString()
  });
});

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

// Get active meeting durations (Public - no auth required)
router.get('/public', async (req, res) => {
  try {
    const startTime = Date.now();
    console.log('📅 Public request for active meeting durations');
    console.log('🔍 Request origin:', req.headers.origin || 'unknown');
    
    const durations = await MeetingDuration.find({ isActive: true }).sort({ minutes: 1 });
    
    const formattedDurations = durations.map(d => ({
      _id: d._id.toString(),
      minutes: d.minutes,
      label: d.label,
      price: Math.round(d.price), // Ensure integer price
      isActive: d.isActive
    }));
    
    const duration = Date.now() - startTime;
    console.log(`✅ Returning ${formattedDurations.length} active meeting durations (${duration}ms)`);
    
    // Return empty array if no durations found (not an error)
    res.json({ 
      durations: formattedDurations,
      count: formattedDurations.length,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('❌ Error fetching meeting durations:', error);
    if (error.stack) {
      console.error('Error stack:', error.stack);
    }
    
    // Check if it's a MongoDB connection error
    if (error.name === 'MongoNetworkError' || error.name === 'MongoServerSelectionError') {
      return res.status(503).json({ 
        error: 'Database connection error',
        message: 'Unable to connect to database. Please try again later.'
      });
    }
    
    res.status(500).json({ 
      error: 'Failed to fetch meeting durations',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Get all meeting durations (Admin only)
router.get('/', verifyAdminToken, async (req, res) => {
  try {
    console.log('📅 Admin fetching meeting durations list');
    
    const durations = await MeetingDuration.find({}).sort({ minutes: 1 });
    
    console.log(`✅ Returning ${durations.length} meeting durations to admin`);
    
    res.json({ 
      durations: durations.map(d => ({
        _id: d._id.toString(),
        minutes: d.minutes,
        label: d.label,
        price: Math.round(d.price), // Ensure integer price
        isActive: d.isActive
      }))
    });
  } catch (error: any) {
    console.error('Error fetching meeting durations:', error);
    res.status(500).json({ error: 'Failed to fetch meeting durations' });
  }
});

// Create a new meeting duration (Admin only)
router.post('/', verifyAdminToken, async (req, res) => {
  try {
    console.log('➕ Admin creating new meeting duration');
    
    const { minutes, label, price, isActive } = req.body;
    
    // Validation
    if (minutes === undefined || minutes === null) {
      return res.status(400).json({ error: 'Minutes is required' });
    }
    
    if (!label || typeof label !== 'string' || label.trim().length === 0) {
      return res.status(400).json({ error: 'Label is required and must be a non-empty string' });
    }
    
    if (label.trim().length > 100) {
      return res.status(400).json({ error: 'Label must be 100 characters or less' });
    }
    
    if (typeof minutes !== 'number' || minutes < 30 || minutes % 30 !== 0) {
      return res.status(400).json({ error: 'Minutes must be a number >= 30 and a multiple of 30' });
    }
    
    if (typeof price !== 'number' || price < 0) {
      return res.status(400).json({ error: 'Price must be a non-negative number' });
    }
    
    // Round price to integer (no decimals)
    const roundedPrice = Math.round(price);
    
    // Check if duration with same minutes already exists (only if creating new)
    const existing = await MeetingDuration.findOne({ minutes });
    if (existing) {
      return res.status(409).json({ 
        error: 'A meeting duration with this number of minutes already exists',
        existingDuration: {
          _id: existing._id.toString(),
          minutes: existing.minutes,
          label: existing.label
        }
      });
    }
    
    const duration = new MeetingDuration({
      minutes,
      label: label.toUpperCase().trim(),
      price: roundedPrice || 0,
      isActive: isActive !== undefined ? isActive : true
    });
    
    await duration.save();
    
    console.log(`✅ Created meeting duration: ${duration.label} (${duration.minutes} minutes)`);
    
    res.status(201).json({
      duration: {
        _id: duration._id.toString(),
        minutes: duration.minutes,
        label: duration.label,
        price: Math.round(duration.price), // Ensure integer price
        isActive: duration.isActive
      }
    });
  } catch (error: any) {
    console.error('Error creating meeting duration:', error);
    
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    
    res.status(500).json({ error: 'Failed to create meeting duration' });
  }
});

// Update a meeting duration (Admin only)
router.put('/:id', verifyAdminToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { minutes, label, price, isActive } = req.body;
    
    console.log(`✏️ Admin updating meeting duration: ${id}`);
    
    const duration = await MeetingDuration.findById(id);
    
    if (!duration) {
      return res.status(404).json({ error: 'Meeting duration not found' });
    }
    
    // Update fields if provided
    if (minutes !== undefined) {
      if (typeof minutes !== 'number' || minutes < 30 || minutes % 30 !== 0) {
        return res.status(400).json({ error: 'Minutes must be a number >= 30 and a multiple of 30' });
      }
      // Check if another duration with same minutes exists (excluding current)
      const existing = await MeetingDuration.findOne({ minutes, _id: { $ne: id } });
      if (existing) {
        return res.status(409).json({ 
          error: 'A meeting duration with this number of minutes already exists',
          existingDuration: {
            _id: existing._id.toString(),
            minutes: existing.minutes,
            label: existing.label
          }
        });
      }
      duration.minutes = minutes;
    }
    
    if (label !== undefined) {
      if (typeof label !== 'string' || label.trim().length === 0) {
        return res.status(400).json({ error: 'Label must be a non-empty string' });
      }
      if (label.trim().length > 100) {
        return res.status(400).json({ error: 'Label must be 100 characters or less' });
      }
      duration.label = label.toUpperCase().trim();
    }
    
    if (price !== undefined) {
      if (typeof price !== 'number' || price < 0) {
        return res.status(400).json({ error: 'Price must be a non-negative number' });
      }
      // Round price to integer (no decimals)
      duration.price = Math.round(price);
    }
    
    if (isActive !== undefined) {
      duration.isActive = isActive;
    }
    
    await duration.save();
    
    console.log(`✅ Updated meeting duration: ${duration.label} (${duration.minutes} minutes)`);
    
    res.json({
      duration: {
        _id: duration._id.toString(),
        minutes: duration.minutes,
        label: duration.label,
        price: Math.round(duration.price), // Ensure integer price
        isActive: duration.isActive
      }
    });
  } catch (error: any) {
    console.error('Error updating meeting duration:', error);
    
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    
    res.status(500).json({ error: 'Failed to update meeting duration' });
  }
});

// Delete a meeting duration (Admin only)
router.delete('/:id', verifyAdminToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log(`🗑️ Admin attempting to delete meeting duration: ${id}`);
    
    const duration = await MeetingDuration.findByIdAndDelete(id);
    
    if (!duration) {
      return res.status(404).json({ error: 'Meeting duration not found' });
    }
    
    console.log(`✅ Deleted meeting duration: ${duration.label} (${duration.minutes} minutes)`);
    
    res.json({ message: 'Meeting duration deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting meeting duration:', error);
    res.status(500).json({ error: 'Failed to delete meeting duration' });
  }
});

export default router;





