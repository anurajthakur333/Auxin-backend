import express from 'express';
import Article from '../models/Article.js';
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

// =====================
// PUBLIC ROUTES
// =====================

// Get all active articles (Public - no auth required)
router.get('/public', async (req, res) => {
  try {
    console.log('📰 Public request for active articles');
    
    const { category } = req.query;
    
    const query: any = { isActive: true };
    if (category && category !== 'ALL') {
      query.category = (category as string).toUpperCase();
    }
    
    const articles = await Article.find(query)
      .select('-content') // Exclude content for list view
      .sort({ createdAt: -1 });
    
    const formattedArticles = articles.map(a => ({
      _id: a._id.toString(),
      slug: a.slug,
      title: a.title,
      category: a.category,
      date: a.date,
      readTime: a.readTime,
      excerpt: a.excerpt,
      author: a.author,
      tags: a.tags,
      image: a.image,
      isActive: a.isActive
    }));
    
    console.log(`✅ Returning ${formattedArticles.length} active articles`);
    
    res.json({ 
      articles: formattedArticles,
      count: formattedArticles.length
    });
  } catch (error: any) {
    console.error('❌ Error fetching articles:', error);
    res.status(500).json({ error: 'Failed to fetch articles' });
  }
});

// Get single article by slug (Public - no auth required)
router.get('/public/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    console.log(`📰 Public request for article: ${slug}`);
    
    const article = await Article.findOne({ slug, isActive: true });
    
    if (!article) {
      return res.status(404).json({ error: 'Article not found' });
    }
    
    console.log(`✅ Returning article: ${article.title}`);
    
    res.json({ 
      article: {
        _id: article._id.toString(),
        slug: article.slug,
        title: article.title,
        category: article.category,
        date: article.date,
        readTime: article.readTime,
        excerpt: article.excerpt,
        author: article.author,
        tags: article.tags,
        content: article.content,
        image: article.image,
        isActive: article.isActive
      }
    });
  } catch (error: any) {
    console.error('❌ Error fetching article:', error);
    res.status(500).json({ error: 'Failed to fetch article' });
  }
});

// =====================
// ADMIN ROUTES
// =====================

// Get all articles (Admin only)
router.get('/', verifyAdminToken, async (req, res) => {
  try {
    console.log('📰 Admin fetching all articles');
    
    const articles = await Article.find({}).sort({ createdAt: -1 });
    
    console.log(`✅ Returning ${articles.length} articles to admin`);
    
    res.json({ 
      articles: articles.map(a => ({
        _id: a._id.toString(),
        slug: a.slug,
        title: a.title,
        category: a.category,
        date: a.date,
        readTime: a.readTime,
        excerpt: a.excerpt,
        author: a.author,
        tags: a.tags,
        content: a.content,
        image: a.image,
        isActive: a.isActive,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt
      }))
    });
  } catch (error: any) {
    console.error('Error fetching articles:', error);
    res.status(500).json({ error: 'Failed to fetch articles' });
  }
});

// Create a new article (Admin only)
router.post('/', verifyAdminToken, async (req, res) => {
  try {
    console.log('➕ Admin creating new article');
    
    const { slug, title, category, date, readTime, excerpt, author, tags, content, image, isActive } = req.body;
    
    // Validation
    if (!slug || typeof slug !== 'string' || slug.trim().length === 0) {
      return res.status(400).json({ error: 'Slug is required' });
    }
    
    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return res.status(400).json({ error: 'Title is required' });
    }
    
    if (!category || typeof category !== 'string' || category.trim().length === 0) {
      return res.status(400).json({ error: 'Category is required' });
    }
    
    if (!author || typeof author !== 'string' || author.trim().length === 0) {
      return res.status(400).json({ error: 'Author is required' });
    }
    
    if (!excerpt || typeof excerpt !== 'string' || excerpt.trim().length === 0) {
      return res.status(400).json({ error: 'Excerpt is required' });
    }
    
    if (!content || !Array.isArray(content) || content.length === 0) {
      return res.status(400).json({ error: 'Content is required and must be an array of paragraphs' });
    }
    
    // Check if article with same slug already exists
    const existing = await Article.findOne({ slug: slug.toLowerCase().trim() });
    if (existing) {
      return res.status(409).json({ 
        error: 'An article with this slug already exists',
        existingArticle: {
          _id: existing._id.toString(),
          slug: existing.slug,
          title: existing.title
        }
      });
    }
    
    const article = new Article({
      slug: slug.toLowerCase().trim(),
      title: title.toUpperCase().trim(),
      category: category.toUpperCase().trim(),
      date: date?.toUpperCase().trim() || new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase(),
      readTime: readTime?.toUpperCase().trim() || '5 MIN',
      excerpt: excerpt.toUpperCase().trim(),
      author: author.toUpperCase().trim(),
      tags: (tags || []).map((t: string) => t.toUpperCase().trim()),
      content: content.map((c: string) => c.toUpperCase().trim()),
      image: image?.trim() || '',
      isActive: isActive !== undefined ? isActive : true
    });
    
    await article.save();
    
    console.log(`✅ Created article: ${article.title}`);
    
    res.status(201).json({
      article: {
        _id: article._id.toString(),
        slug: article.slug,
        title: article.title,
        category: article.category,
        date: article.date,
        readTime: article.readTime,
        excerpt: article.excerpt,
        author: article.author,
        tags: article.tags,
        content: article.content,
        image: article.image,
        isActive: article.isActive
      }
    });
  } catch (error: any) {
    console.error('Error creating article:', error);
    
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    
    if (error.code === 11000) {
      return res.status(409).json({ error: 'An article with this slug already exists' });
    }
    
    res.status(500).json({ error: 'Failed to create article' });
  }
});

// Update an article (Admin only)
router.put('/:id', verifyAdminToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { slug, title, category, date, readTime, excerpt, author, tags, content, image, isActive } = req.body;
    
    console.log(`✏️ Admin updating article: ${id}`);
    
    const article = await Article.findById(id);
    
    if (!article) {
      return res.status(404).json({ error: 'Article not found' });
    }
    
    // Update fields if provided
    if (slug !== undefined) {
      // Check if another article with same slug exists
      const existing = await Article.findOne({ slug: slug.toLowerCase().trim(), _id: { $ne: id } });
      if (existing) {
        return res.status(409).json({ 
          error: 'An article with this slug already exists',
          existingArticle: {
            _id: existing._id.toString(),
            slug: existing.slug,
            title: existing.title
          }
        });
      }
      article.slug = slug.toLowerCase().trim();
    }
    
    if (title !== undefined) {
      article.title = title.toUpperCase().trim();
    }
    
    if (category !== undefined) {
      if (typeof category !== 'string' || category.trim().length === 0) {
        return res.status(400).json({ error: 'Category is required' });
      }
      article.category = category.toUpperCase().trim();
    }
    
    if (date !== undefined) {
      article.date = date.toUpperCase().trim();
    }
    
    if (readTime !== undefined) {
      article.readTime = readTime.toUpperCase().trim();
    }
    
    if (excerpt !== undefined) {
      article.excerpt = excerpt.toUpperCase().trim();
    }
    
    if (author !== undefined) {
      article.author = author.toUpperCase().trim();
    }
    
    if (tags !== undefined) {
      article.tags = tags.map((t: string) => t.toUpperCase().trim());
    }
    
    if (content !== undefined) {
      article.content = content.map((c: string) => c.toUpperCase().trim());
    }
    
    if (image !== undefined) {
      article.image = image.trim();
    }
    
    if (isActive !== undefined) {
      article.isActive = isActive;
    }
    
    await article.save();
    
    console.log(`✅ Updated article: ${article.title}`);
    
    res.json({
      article: {
        _id: article._id.toString(),
        slug: article.slug,
        title: article.title,
        category: article.category,
        date: article.date,
        readTime: article.readTime,
        excerpt: article.excerpt,
        author: article.author,
        tags: article.tags,
        content: article.content,
        image: article.image,
        isActive: article.isActive
      }
    });
  } catch (error: any) {
    console.error('Error updating article:', error);
    
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    
    if (error.code === 11000) {
      return res.status(409).json({ error: 'An article with this slug already exists' });
    }
    
    res.status(500).json({ error: 'Failed to update article' });
  }
});

// Delete an article (Admin only)
router.delete('/:id', verifyAdminToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log(`🗑️ Admin attempting to delete article: ${id}`);
    
    const article = await Article.findByIdAndDelete(id);
    
    if (!article) {
      return res.status(404).json({ error: 'Article not found' });
    }
    
    console.log(`✅ Deleted article: ${article.title}`);
    
    res.json({ message: 'Article deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting article:', error);
    res.status(500).json({ error: 'Failed to delete article' });
  }
});

export default router;

