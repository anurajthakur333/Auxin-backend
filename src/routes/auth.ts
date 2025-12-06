import express from 'express';
import User from '../models/User.js';
import PendingUser from '../models/PendingUser.js';
import PendingUser from '../models/PendingUser.js';
import { generateToken, verifyToken } from '../lib/jwt.js';
import { getGoogleAuthURL, getGoogleUserInfo } from '../lib/googleAuth.js';

const router = express.Router();

// Register
router.post('/register', async (req, res) => {
  try {
    console.log('Register request received:', { name: req.body.name, email: req.body.email, password: '***' });
    const { name, email, password } = req.body;

    // Validation
    if (!name || !email || !password) {
      console.log('Validation failed: missing fields');
      return res.status(400).json({ error: 'All fields are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    // Check if user already exists
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists with this email' });
    }

    // Upsert a pending user record instead of creating a real user
    const pending = await PendingUser.findOneAndUpdate(
      { email: normalizedEmail },
      {
        $set: {
          name,
          email: normalizedEmail,
          password
        },
        $unset: { emailVerificationCode: 1, emailVerificationExpires: 1 }
      },
      { upsert: true, new: true }
    );

    console.log('✅ Pending signup stored for', normalizedEmail, { id: pending._id });

    // Do not send OTP here; the client triggers /send-otp from verify page
    res.status(201).json({
      message: 'Signup started. Please verify your email.',
      email: normalizedEmail,
      requiresVerification: true
    });
  } catch (error) {
    console.error('Registration error:', error);
    if (error instanceof Error) {
      console.error('Error stack:', error.stack);
    }
    
    // Ensure we always return valid JSON
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    console.log('🔐 Login attempt for email:', email);

    if (!email || !password) {
      console.log('❌ Login failed: Missing email or password');
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    // Find user
    let user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      // If a pending signup exists and password matches, prompt verification
      const pending = await PendingUser.findOne({ email: normalizedEmail });
      if (pending && pending.password === password) {
        console.log('⚠️ Login blocked: pending user must verify email first:', normalizedEmail);
        return res.status(403).json({ error: 'Email not verified', requiresVerification: true, email: normalizedEmail });
      }
      console.log('❌ Login failed: User not found for email:', normalizedEmail);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    console.log('✅ User found:', { 
      id: user._id, 
      email: user.email, 
      hasPassword: !!user.password,
      hasGoogleId: !!user.googleId 
    });

    // Check if user has a password (users created via Google OAuth might not have one)
    if (!user.password) {
      console.log('❌ Login failed: User has no password (Google OAuth account)');
      return res.status(401).json({ 
        error: 'This account was created with Google. Please use "Continue with Google" to sign in.' 
      });
    }

    // Check password (plain text comparison)
    if (user.password !== password) {
      console.log('❌ Login failed: Invalid password for email:', email);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Block login if email not verified
    if (!user.isEmailVerified) {
      console.log('⚠️ Login blocked: email not verified for', normalizedEmail);
      return res.status(403).json({ error: 'Email not verified', requiresVerification: true, email: normalizedEmail });
    }

    console.log('✅ Login successful for email:', email);

    // Generate token
    const token = generateToken(user);

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        isEmailVerified: user.isEmailVerified
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    
    // Ensure we always return valid JSON
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// Google OAuth - Redirect to Google (NEW PATTERN)
router.get('/google', (_req, res) => {
  try {
    console.log('🔍 Google OAuth redirect request received');
    console.log('🔍 Environment variables check:');
    console.log('🔍 GOOGLE_CLIENT_ID:', process.env.GOOGLE_CLIENT_ID ? 'SET' : 'NOT SET');
    console.log('🔍 GOOGLE_CLIENT_SECRET:', process.env.GOOGLE_CLIENT_SECRET ? 'SET' : 'NOT SET');
    console.log('🔍 GOOGLE_REDIRECT_URI:', process.env.GOOGLE_REDIRECT_URI);
    
    const authURL = getGoogleAuthURL();
    console.log('✅ Redirecting to Google OAuth URL');
    
    // Redirect directly to Google instead of returning JSON
    res.redirect(authURL);
  } catch (error) {
    console.error('Google auth redirect error:', error);
    const frontendURL = process.env.FRONTEND_URL || 'https://auxin.media';
    res.redirect(`${frontendURL}/auth/google/callback?error=${encodeURIComponent('Failed to initiate Google authentication')}`);
  }
});

// Forgot Password
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    console.log('🔐 Forgot password request for email:', email);

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Validate email format
    const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
    if (!emailRegex.test(email.trim())) {
      return res.status(400).json({ error: 'Please enter a valid email address' });
    }

    // Check if user exists
    const user = await User.findOne({ email: email.trim().toLowerCase() });
    
    // Always return success for security (don't reveal if email exists)
    // In production, you would send an email here
    console.log(`📧 Password reset requested for: ${email} (User exists: ${!!user})`);
    
    // TODO: Implement email sending logic here
    // - Generate reset token
    // - Save token to database with expiration
    // - Send email with reset link
    
    res.json({
      message: 'If an account with that email exists, password reset instructions have been sent.'
    });

  } catch (error) {
    console.error('❌ Forgot password error:', error);
    res.status(500).json({ error: 'An error occurred. Please try again.' });
  }
});

// Google OAuth - Callback (GET route for Google's redirect)
router.get('/google/callback', async (req, res) => {
  try {
    const { code, error } = req.query;
    const frontendURL = process.env.FRONTEND_URL || 'https://auxin.media';

    if (error) {
      console.error('Google OAuth error:', error);
      return res.redirect(`${frontendURL}/auth/google/callback?error=${encodeURIComponent(error as string)}`);
    }

    if (!code) {
      console.error('No authorization code received from Google');
      return res.redirect(`${frontendURL}/auth/google/callback?error=${encodeURIComponent('No authorization code received')}`);
    }

    console.log('🔍 Processing Google OAuth callback with code');

    // Get user info from Google
    const googleUser = await getGoogleUserInfo(code as string);

    // Check if user exists
    let user = await User.findOne({ 
      $or: [
        { email: googleUser.email },
        { googleId: googleUser.googleId }
      ]
    });

    if (user) {
      // Update existing user with Google ID if not set
      if (!user.googleId) {
        user.googleId = googleUser.googleId;
        user.avatar = googleUser.avatar;
        await user.save();
      }
    } else {
      // Create new user
      user = new User({
        name: googleUser.name,
        email: googleUser.email,
        googleId: googleUser.googleId,
        avatar: googleUser.avatar,
        isEmailVerified: true
      });

      await user.save();
    }

    // Generate token
    const token = generateToken(user);

    console.log('✅ Google OAuth successful for user:', user.email);

    // Redirect back to frontend with user data and token
    const userData = encodeURIComponent(JSON.stringify({
      id: user._id,
      email: user.email,
      name: user.name,
      avatar: user.avatar,
      isEmailVerified: user.isEmailVerified
    }));
    
    res.redirect(`${frontendURL}/auth/google/callback?token=${token}&user=${userData}`);

  } catch (error) {
    console.error('Google callback error:', error);
    const frontendURL = process.env.FRONTEND_URL || 'https://auxin.media';
    res.redirect(`${frontendURL}/auth/google/callback?error=${encodeURIComponent('Authentication failed')}`);
  }
});

// Google OAuth - Callback (POST route for fallback/legacy support)
router.post('/google/callback', async (req, res) => {
  try {
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({ error: 'Authorization code is required' });
    }

    // Get user info from Google
    const googleUser = await getGoogleUserInfo(code);

    // Check if user exists
    let user = await User.findOne({ 
      $or: [
        { email: googleUser.email },
        { googleId: googleUser.googleId }
      ]
    });

    if (user) {
      // Update existing user with Google ID if not set
      if (!user.googleId) {
        user.googleId = googleUser.googleId;
        user.avatar = googleUser.avatar;
        await user.save();
      }
    } else {
      // Create new user
      user = new User({
        name: googleUser.name,
        email: googleUser.email,
        googleId: googleUser.googleId,
        avatar: googleUser.avatar,
        isEmailVerified: true
      });

      await user.save();
    }

    // Generate token
    const token = generateToken(user);

    res.json({
      message: 'Google authentication successful',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        isEmailVerified: user.isEmailVerified
      }
    });
  } catch (error) {
    console.error('Google callback error:', error);
    res.status(500).json({ error: 'Google authentication failed' });
  }
});

// Verify token
router.get('/verify', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.substring(7);
    const decoded = verifyToken(token);

    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    res.json({
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        isEmailVerified: user.isEmailVerified
      }
    });
  } catch (error) {
    console.error('Token verification error:', error);
    res.status(401).json({ error: 'Invalid token' });
  }
});

// Logout (client-side token removal)
router.post('/logout', (_req, res) => {
  res.json({ message: 'Logout successful' });
});

export default router;
