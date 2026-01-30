import express from 'express';
import ProjectCategory from '../models/ProjectCategory.js';
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

// Get all categories (public - for dropdowns)
router.get('/', async (_req, res) => {
  try {
    const categories = await ProjectCategory.find({ isActive: true })
      .sort({ name: 1 })
      .lean();

    const transformedCategories = categories.map((cat: any) => ({
      id: cat._id,
      name: cat.name,
      slug: cat.slug,
      description: cat.description,
      color: cat.color,
      isActive: cat.isActive,
    }));

    res.json({ categories: transformedCategories });
  } catch (error) {
    console.error('❌ Error fetching categories:', error);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

// Get all categories including inactive (admin only)
router.get('/admin/all', verifyAdminToken, async (_req, res) => {
  try {
    const categories = await ProjectCategory.find()
      .sort({ name: 1 })
      .lean();

    const transformedCategories = categories.map((cat: any) => ({
      id: cat._id,
      name: cat.name,
      slug: cat.slug,
      description: cat.description,
      color: cat.color,
      isActive: cat.isActive,
      createdAt: cat.createdAt,
      updatedAt: cat.updatedAt,
    }));

    res.json({ categories: transformedCategories });
  } catch (error) {
    console.error('❌ Error fetching all categories:', error);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

// Create a new category (admin only)
router.post('/admin', verifyAdminToken, async (req, res) => {
  try {
    const { name, description, color, isActive = true } = req.body;

    if (!name || typeof name !== 'string' || name.trim() === '') {
      return res.status(400).json({ error: 'Category name is required' });
    }

    // Check if category with same name exists
    const existingCategory = await ProjectCategory.findOne({ 
      name: { $regex: new RegExp(`^${name.trim()}$`, 'i') } 
    });
    
    if (existingCategory) {
      return res.status(400).json({ error: 'A category with this name already exists' });
    }

    const category = new ProjectCategory({
      name: name.trim(),
      slug: name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
      description: description?.trim() || undefined,
      color: color || '#39FF14',
      isActive,
    });

    await category.save();

    res.status(201).json({ 
      category: category.toJSON(),
      message: 'Category created successfully' 
    });
  } catch (error: any) {
    console.error('❌ Error creating category:', error);
    if (error.code === 11000) {
      return res.status(400).json({ error: 'A category with this name already exists' });
    }
    res.status(500).json({ error: 'Failed to create category' });
  }
});

// Update a category (admin only)
router.patch('/admin/:id', verifyAdminToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, color, isActive } = req.body;

    const category = await ProjectCategory.findById(id);
    if (!category) {
      return res.status(404).json({ error: 'Category not found' });
    }

    // Check if new name conflicts with existing category
    if (name && name.trim() !== category.name) {
      const existingCategory = await ProjectCategory.findOne({ 
        name: { $regex: new RegExp(`^${name.trim()}$`, 'i') },
        _id: { $ne: id }
      });
      
      if (existingCategory) {
        return res.status(400).json({ error: 'A category with this name already exists' });
      }
      
      category.name = name.trim();
      category.slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    }

    if (description !== undefined) {
      category.description = description?.trim() || undefined;
    }

    if (color !== undefined) {
      category.color = color;
    }

    if (isActive !== undefined) {
      category.isActive = isActive;
    }

    await category.save();

    res.json({ 
      category: category.toJSON(),
      message: 'Category updated successfully' 
    });
  } catch (error: any) {
    console.error('❌ Error updating category:', error);
    if (error.code === 11000) {
      return res.status(400).json({ error: 'A category with this name already exists' });
    }
    res.status(500).json({ error: 'Failed to update category' });
  }
});

// Delete a category (admin only)
router.delete('/admin/:id', verifyAdminToken, async (req, res) => {
  try {
    const { id } = req.params;

    const category = await ProjectCategory.findByIdAndDelete(id);
    if (!category) {
      return res.status(404).json({ error: 'Category not found' });
    }

    res.json({ message: 'Category deleted successfully' });
  } catch (error) {
    console.error('❌ Error deleting category:', error);
    res.status(500).json({ error: 'Failed to delete category' });
  }
});

// Seed default categories (admin only) - can be called once to initialize
router.post('/admin/seed', verifyAdminToken, async (_req, res) => {
  try {
    const defaultCategories = [
      { name: 'Branding', color: '#FF6B6B' },
      { name: 'Web Design', color: '#4ECDC4' },
      { name: 'Marketing', color: '#FFE66D' },
      { name: 'SEO', color: '#95E1D3' },
      { name: 'Development', color: '#A8E6CF' },
    ];

    const created = [];
    const skipped = [];

    for (const cat of defaultCategories) {
      const existing = await ProjectCategory.findOne({ 
        name: { $regex: new RegExp(`^${cat.name}$`, 'i') } 
      });

      if (!existing) {
        const newCategory = new ProjectCategory({
          name: cat.name,
          slug: cat.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          color: cat.color,
          isActive: true,
        });
        await newCategory.save();
        created.push(cat.name);
      } else {
        skipped.push(cat.name);
      }
    }

    res.json({ 
      message: 'Default categories seeded',
      created,
      skipped 
    });
  } catch (error) {
    console.error('❌ Error seeding categories:', error);
    res.status(500).json({ error: 'Failed to seed categories' });
  }
});

export default router;
