import express from 'express';
import Subrole from '../models/Subrole.js';
import { verifyToken } from '../lib/jwt.js';

const router = express.Router();

// Admin middleware to verify admin token
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

// =====================
// ADMIN ROUTES
// =====================

// Get all subroles (Admin only)
router.get('/', verifyAdminToken, async (req, res) => {
  try {
    const subroles = await Subrole.find({}).sort({ createdAt: -1 });
    res.json({ subroles });
  } catch (error: any) {
    console.error('Error fetching subroles:', error);
    res.status(500).json({ error: 'Failed to fetch subroles' });
  }
});

// Get public subroles (for employee form dropdown)
// Optional query param: ?role=ROLE_NAME to filter by role
router.get('/public', async (req, res) => {
  try {
    const { role } = req.query;
    const query: any = { isActive: true };
    
    // Filter by role if provided
    if (role && typeof role === 'string') {
      query.role = role.toUpperCase().trim();
    }
    
    const subroles = await Subrole.find(query).sort({ name: 1 });
    res.json({ subroles });
  } catch (error: any) {
    console.error('Error fetching public subroles:', error);
    res.status(500).json({ error: 'Failed to fetch subroles' });
  }
});

// Get single subrole (Admin only)
router.get('/:id', verifyAdminToken, async (req, res) => {
  try {
    const { id } = req.params;
    const subrole = await Subrole.findById(id);
    
    if (!subrole) {
      return res.status(404).json({ error: 'Subrole not found' });
    }
    
    res.json({ subrole });
  } catch (error: any) {
    console.error('Error fetching subrole:', error);
    res.status(500).json({ error: 'Failed to fetch subrole' });
  }
});

// Create a new subrole (Admin only)
router.post('/', verifyAdminToken, async (req, res) => {
  try {
    const { name, description, role, isActive } = req.body;
    
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Name is required' });
    }
    
    if (!role || typeof role !== 'string' || role.trim().length === 0) {
      return res.status(400).json({ error: 'Role is required' });
    }
    
    // Check if subrole with same name already exists
    const existing = await Subrole.findOne({ name: name.toUpperCase().trim() });
    if (existing) {
      return res.status(409).json({ 
        error: 'A subrole with this name already exists'
      });
    }
    
    const subrole = new Subrole({
      name: name.toUpperCase().trim(),
      description: description || undefined,
      role: role.toUpperCase().trim(),
      isActive: isActive !== undefined ? isActive : true
    });
    
    await subrole.save();
    
    console.log(`✅ Created subrole: ${subrole.name}`);
    
    res.status(201).json({ subrole });
  } catch (error: any) {
    console.error('Error creating subrole:', error);
    
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    
    if (error.code === 11000) {
      return res.status(409).json({ error: 'A subrole with this name already exists' });
    }
    
    res.status(500).json({ error: 'Failed to create subrole' });
  }
});

// Update a subrole (Admin only)
router.put('/:id', verifyAdminToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, role, isActive } = req.body;
    
    const subrole = await Subrole.findById(id);
    
    if (!subrole) {
      return res.status(404).json({ error: 'Subrole not found' });
    }
    
    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({ error: 'Name is required' });
      }
      
      // Check if another subrole with same name exists
      const existing = await Subrole.findOne({ 
        name: name.toUpperCase().trim(), 
        _id: { $ne: id } 
      });
      if (existing) {
        return res.status(409).json({ 
          error: 'A subrole with this name already exists'
        });
      }
      
      subrole.name = name.toUpperCase().trim();
    }
    
    if (role !== undefined) {
      if (typeof role !== 'string' || role.trim().length === 0) {
        return res.status(400).json({ error: 'Role is required' });
      }
      subrole.role = role.toUpperCase().trim();
    }
    
    if (description !== undefined) {
      subrole.description = description || undefined;
    }
    
    if (isActive !== undefined) {
      subrole.isActive = isActive;
    }
    
    await subrole.save();
    
    console.log(`✅ Updated subrole: ${subrole.name}`);
    
    res.json({ subrole });
  } catch (error: any) {
    console.error('Error updating subrole:', error);
    
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    
    if (error.code === 11000) {
      return res.status(409).json({ error: 'A subrole with this name already exists' });
    }
    
    res.status(500).json({ error: 'Failed to update subrole' });
  }
});

// Delete a subrole (Admin only)
router.delete('/:id', verifyAdminToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    const subrole = await Subrole.findByIdAndDelete(id);
    
    if (!subrole) {
      return res.status(404).json({ error: 'Subrole not found' });
    }
    
    console.log(`✅ Deleted subrole: ${subrole.name}`);
    
    res.json({ message: 'Subrole deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting subrole:', error);
    res.status(500).json({ error: 'Failed to delete subrole' });
  }
});

export default router;

