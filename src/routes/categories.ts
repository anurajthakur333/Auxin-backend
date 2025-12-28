import express from 'express';
import Category from '../models/Category.js';
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
// PUBLIC ROUTES
// =====================

// Get all active categories (Public - no auth required)
router.get('/public', async (_req, res) => {
  try {
    console.log('📂 Public request for active categories');
    
    const categories = await Category.find({ isActive: true }).sort({ name: 1 });
    
    const formattedCategories = categories.map(c => ({
      _id: c._id.toString(),
      name: c.name,
      description: c.description,
      isActive: c.isActive
    }));
    
    console.log(`✅ Returning ${formattedCategories.length} active categories`);
    
    res.json({ 
      categories: formattedCategories,
      count: formattedCategories.length
    });
  } catch (error: any) {
    console.error('❌ Error fetching categories:', error);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

// =====================
// ADMIN ROUTES
// =====================

// Get all categories (Admin only)
router.get('/', verifyAdminToken, async (_req, res) => {
  try {
    console.log('📂 Admin fetching all categories');
    
    const categories = await Category.find({}).sort({ name: 1 });
    
    console.log(`✅ Returning ${categories.length} categories to admin`);
    
    res.json({ 
      categories: categories.map(c => ({
        _id: c._id.toString(),
        name: c.name,
        description: c.description,
        isActive: c.isActive,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt
      }))
    });
  } catch (error: any) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

// Create a new category (Admin only)
router.post('/', verifyAdminToken, async (req, res) => {
  try {
    console.log('➕ Admin creating new category');
    
    const { name, description, isActive } = req.body;
    
    // Validation
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Category name is required' });
    }
    
    // Check if category with same name already exists
    const existing = await Category.findOne({ name: name.toUpperCase().trim() });
    
    if (existing) {
      return res.status(409).json({ 
        error: 'A category with this name already exists',
        existingCategory: {
          _id: existing._id.toString(),
          name: existing.name
        }
      });
    }
    
    const category = new Category({
      name: name.toUpperCase().trim(),
      description: description?.toUpperCase().trim() || '',
      isActive: isActive !== undefined ? isActive : true
    });
    
    await category.save();
    
    console.log(`✅ Created category: ${category.name}`);
    
    res.status(201).json({
      category: {
        _id: category._id.toString(),
        name: category.name,
        description: category.description,
        isActive: category.isActive
      }
    });
  } catch (error: any) {
    console.error('Error creating category:', error);
    
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    
    if (error.code === 11000) {
      return res.status(409).json({ error: 'A category with this name already exists' });
    }
    
    res.status(500).json({ error: 'Failed to create category' });
  }
});

// Update a category (Admin only)
router.put('/:id', verifyAdminToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, isActive } = req.body;
    
    console.log(`✏️ Admin updating category: ${id}`);
    
    const category = await Category.findById(id);
    
    if (!category) {
      return res.status(404).json({ error: 'Category not found' });
    }
    
    if (name !== undefined) {
      // Check if another category with same name exists
      const existing = await Category.findOne({ 
        name: name.toUpperCase().trim(),
        _id: { $ne: id }
      });
      
      if (existing) {
        return res.status(409).json({ 
          error: 'A category with this name already exists'
        });
      }
      
      category.name = name.toUpperCase().trim();
    }
    
    if (description !== undefined) {
      category.description = description.toUpperCase().trim();
    }
    
    if (isActive !== undefined) {
      category.isActive = isActive;
    }
    
    await category.save();
    
    console.log(`✅ Updated category: ${category.name}`);
    
    res.json({
      category: {
        _id: category._id.toString(),
        name: category.name,
        description: category.description,
        isActive: category.isActive
      }
    });
  } catch (error: any) {
    console.error('Error updating category:', error);
    
    if (error.code === 11000) {
      return res.status(409).json({ error: 'A category with this name already exists' });
    }
    
    res.status(500).json({ error: 'Failed to update category' });
  }
});

// Delete a category (Admin only)
router.delete('/:id', verifyAdminToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log(`🗑️ Admin attempting to delete category: ${id}`);
    
    const category = await Category.findByIdAndDelete(id);
    
    if (!category) {
      return res.status(404).json({ error: 'Category not found' });
    }
    
    console.log(`✅ Deleted category: ${category.name}`);
    
    res.json({ message: 'Category deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting category:', error);
    res.status(500).json({ error: 'Failed to delete category' });
  }
});

export default router;
