import express from 'express';
import Role from '../models/Role.js';
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
// PUBLIC ROUTES (For fetching active roles in employee form)
// =====================

// Get all active roles (Public - for employee management)
router.get('/public', async (req, res) => {
  try {
    const roles = await Role.find({ isActive: true })
      .sort({ name: 1 });
    
    res.json({ 
      roles: roles.map(r => ({
        _id: r._id.toString(),
        name: r.name,
        description: r.description
      })),
      count: roles.length
    });
  } catch (error: any) {
    console.error('❌ Error fetching roles:', error);
    res.status(500).json({ error: 'Failed to fetch roles' });
  }
});

// =====================
// ADMIN ROUTES
// =====================

// Get all roles (Admin only)
router.get('/', verifyAdminToken, async (req, res) => {
  try {
    const roles = await Role.find({}).sort({ createdAt: -1 });
    
    res.json({ 
      roles: roles.map(r => ({
        _id: r._id.toString(),
        name: r.name,
        description: r.description,
        isActive: r.isActive,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt
      }))
    });
  } catch (error: any) {
    console.error('Error fetching roles:', error);
    res.status(500).json({ error: 'Failed to fetch roles' });
  }
});

// Get single role (Admin only)
router.get('/:id', verifyAdminToken, async (req, res) => {
  try {
    const { id } = req.params;
    const role = await Role.findById(id);
    
    if (!role) {
      return res.status(404).json({ error: 'Role not found' });
    }
    
    res.json({ role });
  } catch (error: any) {
    console.error('Error fetching role:', error);
    res.status(500).json({ error: 'Failed to fetch role' });
  }
});

// Create a new role (Admin only)
router.post('/', verifyAdminToken, async (req, res) => {
  try {
    const { name, description, isActive } = req.body;
    
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Name is required' });
    }
    
    // Check if role with same name already exists
    const existing = await Role.findOne({ name: name.toUpperCase().trim() });
    if (existing) {
      return res.status(409).json({ 
        error: 'A role with this name already exists'
      });
    }
    
    const role = new Role({
      name: name.toUpperCase().trim(),
      description: description?.trim(),
      isActive: isActive !== undefined ? isActive : true
    });
    
    await role.save();
    
    console.log(`✅ Created role: ${role.name}`);
    
    res.status(201).json({ role });
  } catch (error: any) {
    console.error('Error creating role:', error);
    
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    
    if (error.code === 11000) {
      return res.status(409).json({ error: 'A role with this name already exists' });
    }
    
    res.status(500).json({ error: 'Failed to create role' });
  }
});

// Update a role (Admin only)
router.put('/:id', verifyAdminToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, isActive } = req.body;
    
    const role = await Role.findById(id);
    
    if (!role) {
      return res.status(404).json({ error: 'Role not found' });
    }
    
    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({ error: 'Name is required' });
      }
      
      // Check if another role with same name exists
      const existing = await Role.findOne({ 
        name: name.toUpperCase().trim(), 
        _id: { $ne: id } 
      });
      if (existing) {
        return res.status(409).json({ 
          error: 'A role with this name already exists'
        });
      }
      
      role.name = name.toUpperCase().trim();
    }
    
    if (description !== undefined) {
      role.description = description?.trim();
    }
    
    if (isActive !== undefined) {
      role.isActive = isActive;
    }
    
    await role.save();
    
    console.log(`✅ Updated role: ${role.name}`);
    
    res.json({ role });
  } catch (error: any) {
    console.error('Error updating role:', error);
    
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    
    if (error.code === 11000) {
      return res.status(409).json({ error: 'A role with this name already exists' });
    }
    
    res.status(500).json({ error: 'Failed to update role' });
  }
});

// Delete a role (Admin only)
router.delete('/:id', verifyAdminToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get the role to check its name
    const role = await Role.findById(id);
    if (!role) {
      return res.status(404).json({ error: 'Role not found' });
    }
    
    // Check if any employees are using this role (by role name, since employees store role as string)
    const Employee = (await import('../models/Employee.js')).default;
    const employeesWithRole = await Employee.countDocuments({ role: role.name });
    
    if (employeesWithRole > 0) {
      return res.status(409).json({ 
        error: `Cannot delete role. ${employeesWithRole} employee(s) are assigned to this role. Please reassign them first.`
      });
    }
    
    await Role.findByIdAndDelete(id);
    
    console.log(`✅ Deleted role: ${role.name}`);
    
    res.json({ message: 'Role deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting role:', error);
    res.status(500).json({ error: 'Failed to delete role' });
  }
});

export default router;

