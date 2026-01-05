import express from 'express';
import MeetingCategory from '../models/MeetingCategory.js';
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

// Get all active meeting categories (Public - no auth required)
router.get('/public', async (req, res) => {
  try {
    const categories = await MeetingCategory.find({ isActive: true })
      .sort({ createdAt: 1 });
    
    res.json({ 
      categories: categories.map(c => ({
        _id: c._id.toString(),
        name: c.name,
        description: c.description,
        icon: c.icon,
        color: c.color,
        questions: c.questions
      })),
      count: categories.length
    });
  } catch (error: any) {
    console.error('❌ Error fetching meeting categories:', error);
    res.status(500).json({ error: 'Failed to fetch meeting categories' });
  }
});

// =====================
// ADMIN ROUTES
// =====================

// Get all meeting categories (Admin only)
router.get('/', verifyAdminToken, async (req, res) => {
  try {
    const categories = await MeetingCategory.find({}).sort({ createdAt: -1 });
    
    res.json({ 
      categories: categories.map(c => ({
        _id: c._id.toString(),
        name: c.name,
        description: c.description,
        icon: c.icon,
        color: c.color,
        questions: c.questions,
        isActive: c.isActive,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt
      }))
    });
  } catch (error: any) {
    console.error('Error fetching meeting categories:', error);
    res.status(500).json({ error: 'Failed to fetch meeting categories' });
  }
});

// Get single meeting category (Admin only)
router.get('/:id', verifyAdminToken, async (req, res) => {
  try {
    const { id } = req.params;
    const category = await MeetingCategory.findById(id);
    
    if (!category) {
      return res.status(404).json({ error: 'Meeting category not found' });
    }
    
    res.json({ category });
  } catch (error: any) {
    console.error('Error fetching meeting category:', error);
    res.status(500).json({ error: 'Failed to fetch meeting category' });
  }
});

// Create a new meeting category (Admin only)
router.post('/', verifyAdminToken, async (req, res) => {
  try {
    const { name, description, icon, color, questions, isActive } = req.body;
    
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Name is required' });
    }
    
    if (!questions || !Array.isArray(questions)) {
      return res.status(400).json({ error: 'Questions must be an array' });
    }
    
    // Validate questions
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (!q.label || typeof q.label !== 'string' || q.label.trim().length === 0) {
        return res.status(400).json({ error: `Question ${i + 1}: Label is required` });
      }
      if (!['text', 'textarea', 'email', 'tel', 'number'].includes(q.type)) {
        return res.status(400).json({ error: `Question ${i + 1}: Invalid type` });
      }
    }
    
    // Sort questions by order
    const sortedQuestions = [...questions].sort((a, b) => (a.order || 0) - (b.order || 0));
    
    const category = new MeetingCategory({
      name: name.toUpperCase().trim(),
      description: description?.trim(),
      icon: icon?.trim(),
      color: color?.trim() || '#39FF14',
      questions: sortedQuestions,
      isActive: isActive !== undefined ? isActive : true
    });
    
    await category.save();
    
    console.log(`✅ Created meeting category: ${category.name}`);
    
    res.status(201).json({ category });
  } catch (error: any) {
    console.error('Error creating meeting category:', error);
    
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    
    res.status(500).json({ error: 'Failed to create meeting category' });
  }
});

// Update a meeting category (Admin only)
router.put('/:id', verifyAdminToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, icon, color, questions, isActive } = req.body;
    
    const category = await MeetingCategory.findById(id);
    
    if (!category) {
      return res.status(404).json({ error: 'Meeting category not found' });
    }
    
    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({ error: 'Name is required' });
      }
      category.name = name.toUpperCase().trim();
    }
    
    if (description !== undefined) {
      category.description = description?.trim();
    }
    
    if (icon !== undefined) {
      category.icon = icon?.trim();
    }
    
    if (color !== undefined) {
      category.color = color?.trim() || '#39FF14';
    }
    
    if (questions !== undefined) {
      if (!Array.isArray(questions)) {
        return res.status(400).json({ error: 'Questions must be an array' });
      }
      
      // Validate questions
      for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        if (!q.label || typeof q.label !== 'string' || q.label.trim().length === 0) {
          return res.status(400).json({ error: `Question ${i + 1}: Label is required` });
        }
        if (!['text', 'textarea', 'email', 'tel', 'number'].includes(q.type)) {
          return res.status(400).json({ error: `Question ${i + 1}: Invalid type` });
        }
      }
      
      // Sort questions by order
      category.questions = [...questions].sort((a, b) => (a.order || 0) - (b.order || 0));
    }
    
    if (isActive !== undefined) {
      category.isActive = isActive;
    }
    
    await category.save();
    
    console.log(`✅ Updated meeting category: ${category.name}`);
    
    res.json({ category });
  } catch (error: any) {
    console.error('Error updating meeting category:', error);
    
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    
    res.status(500).json({ error: 'Failed to update meeting category' });
  }
});

// Delete a meeting category (Admin only)
router.delete('/:id', verifyAdminToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    const category = await MeetingCategory.findByIdAndDelete(id);
    
    if (!category) {
      return res.status(404).json({ error: 'Meeting category not found' });
    }
    
    console.log(`✅ Deleted meeting category: ${category.name}`);
    
    res.json({ message: 'Meeting category deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting meeting category:', error);
    res.status(500).json({ error: 'Failed to delete meeting category' });
  }
});

export default router;


