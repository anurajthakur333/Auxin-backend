import express from 'express';
import Employee from '../models/Employee.js';
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

// Get all employees (Admin only)
router.get('/', verifyAdminToken, async (req, res) => {
  try {
    const employees = await Employee.find({}).select('+password').sort({ createdAt: -1 });
    
    res.json({ 
      employees: employees.map(e => {
        const employeeObj = e.toObject();
        // Decrypt password for admin viewing
        let decryptedPassword = '';
        if (employeeObj.password) {
          try {
            // Use the decryptPassword method if available, otherwise decrypt directly
            if (typeof (e as any).decryptPassword === 'function') {
              decryptedPassword = (e as any).decryptPassword();
            }
          } catch (err) {
            console.error('Error decrypting password:', err);
          }
        }
        return {
          _id: e._id.toString(),
          name: e.name,
          email: e.email,
          password: decryptedPassword, // Include decrypted password for admin
          role: e.role,
          subrole: e.subrole || '',
          isActive: e.isActive,
          createdAt: e.createdAt,
          updatedAt: e.updatedAt
        };
      })
    });
  } catch (error: any) {
    console.error('Error fetching employees:', error);
    res.status(500).json({ error: 'Failed to fetch employees' });
  }
});

// Get single employee (Admin only)
router.get('/:id', verifyAdminToken, async (req, res) => {
  try {
    const { id } = req.params;
    const employee = await Employee.findById(id).select('+password');
    
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }
    
    // Decrypt password for admin viewing
    let decryptedPassword = '';
    if (employee.password) {
      try {
        if (typeof (employee as any).decryptPassword === 'function') {
          decryptedPassword = (employee as any).decryptPassword();
        }
      } catch (err) {
        console.error('Error decrypting password:', err);
      }
    }
    
    const employeeObj = employee.toObject();
    employeeObj.password = decryptedPassword;
    
    res.json({ employee: employeeObj });
  } catch (error: any) {
    console.error('Error fetching employee:', error);
    res.status(500).json({ error: 'Failed to fetch employee' });
  }
});

// Create a new employee (Admin only)
router.post('/', verifyAdminToken, async (req, res) => {
  try {
    const { name, email, password: plainPassword, role, subrole, isActive } = req.body;
    
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Name is required' });
    }
    
    if (!email || typeof email !== 'string' || email.trim().length === 0) {
      return res.status(400).json({ error: 'Email is required' });
    }
    
    // Validate email format
    const emailRegex = /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }
    
    // Check if employee with same email already exists
    const existing = await Employee.findOne({ email: email.toLowerCase().trim() });
    if (existing) {
      return res.status(409).json({ 
        error: 'An employee with this email already exists'
      });
    }
    
    // Validate password if provided
    if (plainPassword && (typeof plainPassword !== 'string' || plainPassword.length < 6)) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    
    const employee = new Employee({
      name: name.toUpperCase().trim(),
      email: email.toLowerCase().trim(),
      password: plainPassword || undefined, // Will be encrypted by pre-save hook
      role: (role || 'EMPLOYEE').toUpperCase().trim(),
      subrole: subrole ? subrole.toUpperCase().trim() : undefined,
      isActive: isActive !== undefined ? isActive : true
    });
    
    await employee.save();
    
    console.log(`✅ Created employee: ${employee.email}`);
    
    // Return employee with original password for admin viewing
    const employeeObj = employee.toObject();
    employeeObj.password = plainPassword || ''; // Return original password for admin
    
    res.status(201).json({ employee: employeeObj });
  } catch (error: any) {
    console.error('Error creating employee:', error);
    
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    
    if (error.code === 11000) {
      return res.status(409).json({ error: 'An employee with this email already exists' });
    }
    
    res.status(500).json({ error: 'Failed to create employee' });
  }
});

// Update an employee (Admin only)
router.put('/:id', verifyAdminToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, password: plainPassword, role, subrole, isActive } = req.body;
    
    const employee = await Employee.findById(id);
    
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }
    
    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({ error: 'Name is required' });
      }
      employee.name = name.toUpperCase().trim();
    }
    
    if (email !== undefined) {
      if (typeof email !== 'string' || email.trim().length === 0) {
        return res.status(400).json({ error: 'Email is required' });
      }
      
      const emailRegex = /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ error: 'Invalid email format' });
      }
      
      // Check if another employee with same email exists
      const existing = await Employee.findOne({ 
        email: email.toLowerCase().trim(), 
        _id: { $ne: id } 
      });
      if (existing) {
        return res.status(409).json({ 
          error: 'An employee with this email already exists'
        });
      }
      
      employee.email = email.toLowerCase().trim();
    }
    
    // Store original password before encryption for returning to admin
    let passwordToReturn = '';
    
    if (plainPassword !== undefined) {
      if (typeof plainPassword !== 'string' || plainPassword.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters' });
      }
      passwordToReturn = plainPassword; // Store original password to return
      employee.password = plainPassword; // Will be encrypted by pre-save hook
    } else {
      // If password not provided, get the current decrypted password
      const currentEmployee = await Employee.findById(id).select('+password');
      if (currentEmployee && currentEmployee.password) {
        try {
          if (typeof (currentEmployee as any).decryptPassword === 'function') {
            passwordToReturn = (currentEmployee as any).decryptPassword();
          }
        } catch (err) {
          console.error('Error decrypting current password:', err);
        }
      }
    }
    
    if (role !== undefined) {
      employee.role = role.toUpperCase().trim();
    }
    
    if (subrole !== undefined) {
      employee.subrole = subrole ? subrole.toUpperCase().trim() : '';
    }
    
    if (isActive !== undefined) {
      employee.isActive = isActive;
    }
    
    await employee.save();
    
    console.log(`✅ Updated employee: ${employee.email}`);
    
    // Return employee with password (original if updated, or decrypted current password)
    const employeeObj = employee.toObject();
    employeeObj.password = passwordToReturn;
    
    res.json({ employee: employeeObj });
  } catch (error: any) {
    console.error('Error updating employee:', error);
    
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    
    if (error.code === 11000) {
      return res.status(409).json({ error: 'An employee with this email already exists' });
    }
    
    res.status(500).json({ error: 'Failed to update employee' });
  }
});

// Delete an employee (Admin only)
router.delete('/:id', verifyAdminToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    const employee = await Employee.findByIdAndDelete(id);
    
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }
    
    console.log(`✅ Deleted employee: ${employee.email}`);
    
    res.json({ message: 'Employee deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting employee:', error);
    res.status(500).json({ error: 'Failed to delete employee' });
  }
});

export default router;


