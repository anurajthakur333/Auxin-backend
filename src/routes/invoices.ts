import express from 'express';
import Invoice from '../models/Invoice.js';
import User from '../models/User.js';
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

// ADMIN: Create a new invoice
router.post('/admin/invoices', verifyAdminToken, async (req, res) => {
  try {
    console.log('📝 Creating invoice with data:', JSON.stringify(req.body, null, 2));
    
    const {
      clientId,
      date,
      dueDate,
      billTo,
      companyAddress,
      items,
      discount = 0,
      sgst = 0,
      cgst = 0,
      paymentTerms,
      paymentMethod,
    } = req.body;

    // Validate required fields
    if (!clientId || !date || !dueDate || !billTo || !companyAddress || !items || items.length === 0) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Validate billTo fields
    if (!billTo.name || !billTo.email || !billTo.address) {
      return res.status(400).json({ 
        error: 'Validation failed', 
        details: 'Bill To: name, email, and address are required' 
      });
    }

    // Validate companyAddress fields
    if (!companyAddress.companyName || !companyAddress.email || !companyAddress.street || 
        !companyAddress.city || !companyAddress.state || !companyAddress.zip || !companyAddress.country) {
      return res.status(400).json({ 
        error: 'Validation failed', 
        details: 'Company Address: all fields (companyName, email, street, city, state, zip, country) are required' 
      });
    }

    // Verify client exists
    const client = await User.findById(clientId);
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    // Calculate total from items
    const itemsTotal = items.reduce((sum: number, item: any) => {
      const subtotal = (item.price || 0) * (item.quantity || 0);
      return sum + subtotal;
    }, 0);

    const subtotalAfterDiscount = itemsTotal - (discount || 0);
    const taxTotal = (sgst || 0) + (cgst || 0);
    const total = subtotalAfterDiscount + taxTotal;

    // Validate and create invoice items with calculated subtotals
    const invoiceItems = [];
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      if (!item.title || typeof item.title !== 'string' || item.title.trim() === '') {
        return res.status(400).json({ 
          error: 'Validation failed', 
          details: `Item ${index + 1}: title is required` 
        });
      }
      if (typeof item.price !== 'number' || item.price < 0) {
        return res.status(400).json({ 
          error: 'Validation failed', 
          details: `Item ${index + 1}: price must be a non-negative number` 
        });
      }
      if (typeof item.quantity !== 'number' || item.quantity < 1) {
        return res.status(400).json({ 
          error: 'Validation failed', 
          details: `Item ${index + 1}: quantity must be at least 1` 
        });
      }
      invoiceItems.push({
        title: item.title.trim(),
        price: Number(item.price),
        quantity: Number(item.quantity),
        subtotal: Number(item.price) * Number(item.quantity),
      });
    }

    const invoice = new Invoice({
      clientId,
      date: new Date(date),
      dueDate: new Date(dueDate),
      billTo,
      companyAddress,
      items: invoiceItems,
      discount: discount || 0,
      sgst: sgst || 0,
      cgst: cgst || 0,
      total,
      paymentTerms,
      paymentMethod,
      status: 'pending',
    });

    await invoice.save();

    res.status(201).json({ invoice: invoice.toJSON() });
  } catch (error: any) {
    console.error('❌ Error creating invoice:', error);
    console.error('❌ Error stack:', error.stack);
    console.error('❌ Error name:', error.name);
    console.error('❌ Error code:', error.code);
    
    // Handle validation errors
    if (error.name === 'ValidationError') {
      const validationErrors = Object.values(error.errors || {}).map((err: any) => err.message);
      return res.status(400).json({ 
        error: 'Validation failed', 
        details: validationErrors.join(', ') 
      });
    }
    
    // Handle duplicate key errors
    if (error.code === 11000) {
      return res.status(409).json({ 
        error: 'Invoice number already exists', 
        details: error.message 
      });
    }
    
    res.status(500).json({ 
      error: 'Failed to create invoice', 
      details: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error' 
    });
  }
});

// ADMIN: Get all invoices
router.get('/admin/invoices', verifyAdminToken, async (req, res) => {
  try {
    const invoices = await Invoice.find()
      .populate('clientId', 'name email clientCode')
      .sort({ createdAt: -1 })
      .lean();

    // Normalize IDs: convert _id to id for frontend consistency
    const normalizedInvoices = invoices.map((invoice: any) => ({
      ...invoice,
      id: invoice._id?.toString() || invoice.id,
      _id: undefined,
      clientId: invoice.clientId?._id ? {
        ...invoice.clientId,
        id: invoice.clientId._id.toString(),
        _id: undefined,
      } : invoice.clientId,
    }));

    res.json({ invoices: normalizedInvoices });
  } catch (error: any) {
    console.error('❌ Error fetching invoices:', error);
    res.status(500).json({ error: 'Failed to fetch invoices' });
  }
});

// ADMIN: Get invoice by ID
router.get('/admin/invoices/:invoiceId', verifyAdminToken, async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.invoiceId)
      .populate('clientId', 'name email clientCode')
      .lean();

    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    // Normalize IDs
    const normalizedInvoice: any = {
      ...invoice,
      id: invoice._id?.toString() || (invoice as any).id,
      _id: undefined,
      clientId: (invoice as any).clientId?._id ? {
        ...(invoice as any).clientId,
        id: (invoice as any).clientId._id.toString(),
        _id: undefined,
      } : (invoice as any).clientId,
    };

    res.json({ invoice: normalizedInvoice });
  } catch (error: any) {
    console.error('❌ Error fetching invoice:', error);
    res.status(500).json({ error: 'Failed to fetch invoice' });
  }
});

// ADMIN: Update invoice
router.patch('/admin/invoices/:invoiceId', verifyAdminToken, async (req, res) => {
  try {
    const updateData: any = { ...req.body };

    // Recalculate total if items are updated
    if (updateData.items) {
      const itemsTotal = updateData.items.reduce((sum: number, item: any) => {
        const subtotal = (item.price || 0) * (item.quantity || 0);
        return sum + subtotal;
      }, 0);

      const discount = updateData.discount || 0;
      const sgst = updateData.sgst || 0;
      const cgst = updateData.cgst || 0;
      const subtotalAfterDiscount = itemsTotal - discount;
      const taxTotal = sgst + cgst;
      updateData.total = subtotalAfterDiscount + taxTotal;

      // Recalculate subtotals for items
      updateData.items = updateData.items.map((item: any) => ({
        ...item,
        subtotal: item.price * item.quantity,
      }));
    } else if (updateData.discount !== undefined || updateData.sgst !== undefined || updateData.cgst !== undefined) {
      // Recalculate total if tax/discount changed
      const invoice = await Invoice.findById(req.params.invoiceId).lean();
      if (invoice) {
        const itemsTotal = invoice.items.reduce((sum, item) => sum + item.subtotal, 0);
        const discount = updateData.discount !== undefined ? updateData.discount : invoice.discount;
        const sgst = updateData.sgst !== undefined ? updateData.sgst : invoice.sgst;
        const cgst = updateData.cgst !== undefined ? updateData.cgst : invoice.cgst;
        const subtotalAfterDiscount = itemsTotal - discount;
        const taxTotal = sgst + cgst;
        updateData.total = subtotalAfterDiscount + taxTotal;
      }
    }

    // Convert date strings to Date objects
    if (updateData.date) updateData.date = new Date(updateData.date);
    if (updateData.dueDate) updateData.dueDate = new Date(updateData.dueDate);

    const invoice = await Invoice.findByIdAndUpdate(
      req.params.invoiceId,
      { $set: updateData },
      { new: true, runValidators: true }
    )
      .populate('clientId', 'name email clientCode')
      .lean();

    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    // Normalize IDs
    const normalizedInvoice: any = {
      ...invoice,
      id: invoice._id?.toString() || (invoice as any).id,
      _id: undefined,
      clientId: (invoice as any).clientId?._id ? {
        ...(invoice as any).clientId,
        id: (invoice as any).clientId._id.toString(),
        _id: undefined,
      } : (invoice as any).clientId,
    };

    res.json({ invoice: normalizedInvoice });
  } catch (error: any) {
    console.error('❌ Error updating invoice:', error);
    res.status(500).json({ error: 'Failed to update invoice', details: error.message });
  }
});

// ADMIN: Delete invoice
router.delete('/admin/invoices/:invoiceId', verifyAdminToken, async (req, res) => {
  try {
    const invoice = await Invoice.findByIdAndDelete(req.params.invoiceId);

    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    res.json({ message: 'Invoice deleted successfully' });
  } catch (error: any) {
    console.error('❌ Error deleting invoice:', error);
    res.status(500).json({ error: 'Failed to delete invoice' });
  }
});

// CLIENT: Get invoices for authenticated user
router.get('/invoices/my-invoices', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.substring(7);
    const decoded = verifyToken(token) as any;

    const invoices = await Invoice.find({ clientId: decoded.userId })
      .sort({ createdAt: -1 })
      .lean();

    // Update status to 'overdue' if due date has passed and status is still 'pending'
    const now = new Date();
    const updatePromises = invoices.map(async (invoice: any) => {
      if (invoice.status === 'pending' && new Date(invoice.dueDate) < now) {
        // Update in database
        await Invoice.findByIdAndUpdate(invoice._id, { status: 'overdue' });
        invoice.status = 'overdue';
      }
      return invoice;
    });

    const updatedInvoices = await Promise.all(updatePromises);

    // Normalize IDs: convert _id to id for frontend consistency
    const normalizedInvoices = updatedInvoices.map((invoice: any) => ({
      ...invoice,
      id: invoice._id?.toString() || invoice.id,
      _id: undefined,
    }));

    res.json({ invoices: normalizedInvoices });
  } catch (error: any) {
    console.error('❌ Error fetching user invoices:', error);
    res.status(500).json({ error: 'Failed to fetch invoices' });
  }
});

// CLIENT: Get invoice by ID (for authenticated user)
router.get('/invoices/:invoiceId', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.substring(7);
    const decoded = verifyToken(token) as any;

    const invoice = await Invoice.findById(req.params.invoiceId).lean();

    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    // Verify invoice belongs to user
    if (String(invoice.clientId) !== decoded.userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Update status to 'overdue' if due date has passed and status is still 'pending'
    if (invoice.status === 'pending' && new Date(invoice.dueDate) < new Date()) {
      invoice.status = 'overdue';
    }

    res.json({ invoice });
  } catch (error: any) {
    console.error('❌ Error fetching invoice:', error);
    res.status(500).json({ error: 'Failed to fetch invoice' });
  }
});

// CLIENT: Update invoice status (mark as paid after PayPal payment)
router.patch('/invoices/:invoiceId/pay', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.substring(7);
    const decoded = verifyToken(token) as any;

    const { paypalOrderId } = req.body;

    const invoice = await Invoice.findById(req.params.invoiceId).lean();

    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    // Verify invoice belongs to user
    if (String(invoice.clientId) !== decoded.userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const updatedInvoice = await Invoice.findByIdAndUpdate(
      req.params.invoiceId,
      {
        $set: {
          status: 'paid',
          paypalOrderId,
        },
      },
      { new: true }
    ).lean();

    res.json({ invoice: updatedInvoice });
  } catch (error: any) {
    console.error('❌ Error updating invoice payment:', error);
    res.status(500).json({ error: 'Failed to update invoice payment' });
  }
});

export default router;
