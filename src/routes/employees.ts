import express from 'express';
import multer from 'multer';
import Employee from '../models/Employee.js';
import { verifyToken } from '../lib/jwt.js';
import { uploadToCloudinary, deleteFromCloudinary } from '../lib/cloudinary.js';

// Configure multer for file uploads (memory storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max
  },
  fileFilter: (req, file, cb) => {
    // Allow images and videos
    if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/') || file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only images, videos, and PDFs are allowed.'));
    }
  },
});

// Helper function to validate and check duplicate employee ID
const validateEmployeeId = async (employeeId: string, excludeId?: string): Promise<{ valid: boolean; error?: string }> => {
  // Check format
  if (!/^[A-Z]{4}$/.test(employeeId)) {
    return { valid: false, error: 'Employee ID must be exactly 4 capital letters' };
  }
  
  // Check for duplicates
  const query: any = { employeeId: employeeId.toUpperCase() };
  if (excludeId) {
    query._id = { $ne: excludeId };
  }
  
  const existing = await Employee.findOne(query);
  if (existing) {
    return { valid: false, error: 'Employee ID already exists' };
  }
  
  return { valid: true };
};

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
          employeeId: e.employeeId || '',
          name: e.name,
          email: e.email,
          personalEmail: e.personalEmail || '',
          password: decryptedPassword, // Include decrypted password for admin
          role: e.role,
          subrole: e.subrole || '',
          age: e.age,
          location: e.location,
          joinedDate: e.joinedDate,
          videoProof: e.videoProof,
          documentProof: e.documentProof,
          salary: e.salary,
          currency: e.currency || 'USD',
          salaryHistory: e.salaryHistory || [],
          isActive: e.isActive,
          isBanned: e.isBanned || false,
          isVerified: e.isVerified || false,
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
    const { 
      employeeId,
      name, 
      email,
      personalEmail,
      password: plainPassword, 
      role, 
      subrole, 
      age,
      location,
      joinedDate,
      salary,
      currency,
      isActive 
    } = req.body;
    
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
    
    // Validate employee ID
    if (!employeeId || typeof employeeId !== 'string') {
      return res.status(400).json({ error: 'Employee ID is required' });
    }
    
    const idValidation = await validateEmployeeId(employeeId);
    if (!idValidation.valid) {
      return res.status(400).json({ error: idValidation.error });
    }
    
    const employee = new Employee({
      employeeId: employeeId.toUpperCase().trim(),
      name: name.toUpperCase().trim(),
      email: email.toLowerCase().trim(),
      personalEmail: personalEmail ? personalEmail.toLowerCase().trim() : undefined,
      password: plainPassword || undefined, // Will be encrypted by pre-save hook
      role: (role || 'EMPLOYEE').toUpperCase().trim(),
      subrole: subrole ? subrole.toUpperCase().trim() : undefined,
      age: age ? parseInt(age) : undefined,
      location: location ? location.trim() : undefined,
      joinedDate: joinedDate ? new Date(joinedDate) : new Date(),
      salary: salary ? parseFloat(salary) : undefined,
      currency: currency ? currency.toUpperCase().trim() : 'USD',
      isActive: isActive !== undefined ? isActive : true,
      isBanned: false,
      isVerified: false
    });
    
    await employee.save();
    
    console.log(`✅ Created employee: ${employee.email} (ID: ${employeeId})`);
    
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
      return res.status(409).json({ error: 'An employee with this email or employee ID already exists' });
    }
    
    res.status(500).json({ error: 'Failed to create employee' });
  }
});

// Update an employee (Admin only)
router.put('/:id', verifyAdminToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      employeeId,
      name, 
      email,
      personalEmail,
      password: plainPassword, 
      role, 
      subrole, 
      age,
      location,
      joinedDate,
      salary,
      currency,
      isActive 
    } = req.body;
    
    const employee = await Employee.findById(id);
    
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }
    
    // Validate and update employee ID if provided
    if (employeeId !== undefined) {
      const idValidation = await validateEmployeeId(employeeId, id);
      if (!idValidation.valid) {
        return res.status(400).json({ error: idValidation.error });
      }
      employee.employeeId = employeeId.toUpperCase().trim();
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
    
    if (personalEmail !== undefined) {
      if (personalEmail && typeof personalEmail === 'string' && personalEmail.trim().length > 0) {
        const emailRegex = /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/;
        if (!emailRegex.test(personalEmail)) {
          return res.status(400).json({ error: 'Invalid personal email format' });
        }
        employee.personalEmail = personalEmail.toLowerCase().trim();
      } else {
        employee.personalEmail = undefined;
      }
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
    
    if (age !== undefined) {
      employee.age = age ? parseInt(age) : undefined;
    }
    
    if (location !== undefined) {
      employee.location = location ? location.trim() : undefined;
    }
    
    if (joinedDate !== undefined) {
      employee.joinedDate = new Date(joinedDate);
    }
    
    if (salary !== undefined) {
      employee.salary = salary ? parseFloat(salary) : undefined;
    }
    
    if (currency !== undefined) {
      employee.currency = currency ? currency.toUpperCase().trim() : 'USD';
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

// Upload video proof (Admin only)
router.post('/:id/upload-video', verifyAdminToken, upload.single('video'), async (req, res) => {
  try {
    const { id } = req.params;
    const file = (req as any).file;
    
    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    const employee = await Employee.findById(id);
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }
    
    // Delete old video if exists
    if (employee.videoProof) {
      try {
        const publicId = employee.videoProof.split('/').pop()?.split('.')[0];
        if (publicId) {
          await deleteFromCloudinary(`auxin/employees/${publicId}`);
        }
      } catch (err) {
        console.error('Error deleting old video:', err);
      }
    }
    
    // Upload to Cloudinary
    const uploadResult = await uploadToCloudinary(file.buffer, 'employees', 'video');
    employee.videoProof = uploadResult.secure_url;
    await employee.save();
    
    res.json({ 
      message: 'Video uploaded successfully',
      videoProof: employee.videoProof
    });
  } catch (error: any) {
    console.error('Error uploading video:', error);
    res.status(500).json({ error: 'Failed to upload video' });
  }
});

// Upload document proof (Admin only)
router.post('/:id/upload-document', verifyAdminToken, upload.single('document'), async (req, res) => {
  try {
    const { id } = req.params;
    const file = (req as any).file;
    
    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    const employee = await Employee.findById(id);
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }
    
    // Delete old document if exists
    if (employee.documentProof) {
      try {
        const publicId = employee.documentProof.split('/').pop()?.split('.')[0];
        if (publicId) {
          await deleteFromCloudinary(`auxin/employees/${publicId}`);
        }
      } catch (err) {
        console.error('Error deleting old document:', err);
      }
    }
    
    // Upload to Cloudinary
    const uploadResult = await uploadToCloudinary(file.buffer, 'employees', 'raw');
    employee.documentProof = uploadResult.secure_url;
    await employee.save();
    
    res.json({ 
      message: 'Document uploaded successfully',
      documentProof: employee.documentProof
    });
  } catch (error: any) {
    console.error('Error uploading document:', error);
    res.status(500).json({ error: 'Failed to upload document' });
  }
});

// Add salary hike (Admin only)
router.post('/:id/salary-hike', verifyAdminToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, currency, reason } = req.body;
    
    if (!amount || isNaN(parseFloat(amount))) {
      return res.status(400).json({ error: 'Valid amount is required' });
    }
    
    const employee = await Employee.findById(id);
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }
    
    const previousAmount = employee.salary || 0;
    const newAmount = parseFloat(amount);
    const hikeCurrency = currency ? currency.toUpperCase().trim() : (employee.currency || 'USD');
    
    // Add to salary history
    if (!employee.salaryHistory) {
      employee.salaryHistory = [];
    }
    
    employee.salaryHistory.push({
      date: new Date(),
      amount: newAmount,
      currency: hikeCurrency,
      reason: reason || '',
      previousAmount
    });
    
    // Update current salary
    employee.salary = newAmount;
    employee.currency = hikeCurrency;
    
    await employee.save();
    
    console.log(`✅ Salary hike for ${employee.email}: ${previousAmount} -> ${newAmount} ${hikeCurrency}`);
    
    res.json({ 
      message: 'Salary hike recorded successfully',
      employee: employee.toObject()
    });
  } catch (error: any) {
    console.error('Error adding salary hike:', error);
    res.status(500).json({ error: 'Failed to add salary hike' });
  }
});

// Ban employee (Admin only)
router.put('/:id/ban', verifyAdminToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    const employee = await Employee.findById(id);
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }
    
    employee.isBanned = true;
    employee.isActive = false; // Also deactivate when banned
    await employee.save();
    
    console.log(`⛔ Banned employee: ${employee.email}`);
    
    res.json({ 
      message: 'Employee banned successfully',
      employee: employee.toObject()
    });
  } catch (error: any) {
    console.error('Error banning employee:', error);
    res.status(500).json({ error: 'Failed to ban employee' });
  }
});

// Unban employee (Admin only)
router.put('/:id/unban', verifyAdminToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    const employee = await Employee.findById(id);
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }
    
    employee.isBanned = false;
    await employee.save();
    
    console.log(`✅ Unbanned employee: ${employee.email}`);
    
    res.json({ 
      message: 'Employee unbanned successfully',
      employee: employee.toObject()
    });
  } catch (error: any) {
    console.error('Error unbanning employee:', error);
    res.status(500).json({ error: 'Failed to unban employee' });
  }
});

// Verify employee (Admin only)
router.put('/:id/verify', verifyAdminToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    const employee = await Employee.findById(id);
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }
    
    employee.isVerified = true;
    await employee.save();
    
    console.log(`✅ Verified employee: ${employee.email}`);
    
    res.json({ 
      message: 'Employee verified successfully',
      employee: employee.toObject()
    });
  } catch (error: any) {
    console.error('Error verifying employee:', error);
    res.status(500).json({ error: 'Failed to verify employee' });
  }
});

// Unverify employee (Admin only)
router.put('/:id/unverify', verifyAdminToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    const employee = await Employee.findById(id);
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }
    
    employee.isVerified = false;
    await employee.save();
    
    console.log(`⛔ Unverified employee: ${employee.email}`);
    
    res.json({ 
      message: 'Employee unverified successfully',
      employee: employee.toObject()
    });
  } catch (error: any) {
    console.error('Error unverifying employee:', error);
    res.status(500).json({ error: 'Failed to unverify employee' });
  }
});

// Delete an employee (Admin only)
router.delete('/:id', verifyAdminToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    const employee = await Employee.findById(id);
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }
    
    // Delete files from Cloudinary
    if (employee.videoProof) {
      try {
        const publicId = employee.videoProof.split('/').pop()?.split('.')[0];
        if (publicId) {
          await deleteFromCloudinary(`auxin/employees/${publicId}`);
        }
      } catch (err) {
        console.error('Error deleting video:', err);
      }
    }
    
    if (employee.documentProof) {
      try {
        const publicId = employee.documentProof.split('/').pop()?.split('.')[0];
        if (publicId) {
          await deleteFromCloudinary(`auxin/employees/${publicId}`);
        }
      } catch (err) {
        console.error('Error deleting document:', err);
      }
    }
    
    await Employee.findByIdAndDelete(id);
    
    console.log(`✅ Deleted employee: ${employee.email}`);
    
    res.json({ message: 'Employee deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting employee:', error);
    res.status(500).json({ error: 'Failed to delete employee' });
  }
});

export default router;


