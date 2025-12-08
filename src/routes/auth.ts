import express from 'express';
import crypto from 'crypto';
import * as brevoSdk from '@getbrevo/brevo';
import User from '../models/User.js';
import PendingUser from '../models/PendingUser.js';
import { generateToken, verifyToken } from '../lib/jwt.js';
import { getGoogleAuthURL, getGoogleUserInfo } from '../lib/googleAuth.js';

// Setup Brevo API client for password reset emails
const getBrevoClient = () => {
  const apiInstance = new brevoSdk.TransactionalEmailsApi();
  apiInstance.setApiKey(
    brevoSdk.TransactionalEmailsApiApiKeys.apiKey,
    process.env.BREVO_API_KEY || ''
  );
  return apiInstance;
};

// Helper function to send password reset email via Brevo
async function sendPasswordResetEmail(to: string, resetLink: string, from: string): Promise<void> {
  const apiInstance = getBrevoClient();
  
  const sendSmtpEmail = new brevoSdk.SendSmtpEmail();
  sendSmtpEmail.sender = { email: from, name: 'Auxin' };
  sendSmtpEmail.to = [{ email: to }];
  sendSmtpEmail.subject = 'Reset Your Auxin Password';
  sendSmtpEmail.htmlContent = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#333;max-width:600px;margin:0 auto">
      <div style="background:#000;padding:20px;text-align:center">
        <h1 style="color:#39FF14;margin:0">AUXIN</h1>
      </div>
      <div style="background:#fff;padding:30px">
        <h2 style="color:#333;margin-top:0">Reset Your Password</h2>
        <p style="color:#666;font-size:16px">We received a request to reset your password. Click the button below to create a new password:</p>
        <div style="text-align:center;margin:30px 0">
          <a href="${resetLink}" style="background:#39FF14;color:#000;padding:15px 30px;text-decoration:none;font-weight:bold;display:inline-block;border-radius:4px">Reset Password</a>
        </div>
        <p style="color:#666;font-size:14px">Or copy and paste this link into your browser:</p>
        <p style="color:#39FF14;font-size:14px;word-break:break-all">${resetLink}</p>
        <p style="color:#666;font-size:14px">This link will expire in 1 hour.</p>
        <p style="color:#999;font-size:12px;margin-top:30px;padding-top:20px;border-top:1px solid #eee">If you didn't request a password reset, please ignore this email. Your password will remain unchanged.</p>
      </div>
    </div>`;

  await apiInstance.sendTransacEmail(sendSmtpEmail);
}

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

    const normalizedEmail = email.trim().toLowerCase();

    // Check if user exists
    const user = await User.findOne({ email: normalizedEmail });
    
    // Always return success for security (don't reveal if email exists)
    if (!user) {
      console.log(`📧 Password reset requested for non-existent email: ${email}`);
      return res.json({
        message: 'If an account with that email exists, password reset instructions have been sent.'
      });
    }

    // Check if user has a password (Google OAuth users can't reset password)
    if (!user.password && user.googleId) {
      console.log(`📧 Password reset requested for Google OAuth user: ${email}`);
      return res.json({
        message: 'If an account with that email exists, password reset instructions have been sent.'
      });
    }

    // Check if there's already a valid (non-expired) reset token
    // If so, don't send another email to prevent spam and confusion
    if (user.passwordResetToken && user.passwordResetExpires && user.passwordResetExpires > new Date()) {
      const remainingMinutes = Math.ceil((user.passwordResetExpires.getTime() - Date.now()) / (1000 * 60));
      console.log(`⏳ Valid reset token already exists for ${email}, expires in ${remainingMinutes} minutes`);
      return res.json({
        message: 'If an account with that email exists, password reset instructions have been sent.'
      });
    }

    // Generate new reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
    const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // Save token to database
    user.passwordResetToken = resetTokenHash;
    user.passwordResetExpires = resetExpires;
    await user.save();

    console.log(`✅ Password reset token generated for: ${email}`);

    // Create reset link
    const frontendURL = process.env.FRONTEND_URL || 'https://auxin.media';
    const resetLink = `${frontendURL}/reset-password/${resetToken}`;

    // Send email
    const from = process.env.MAIL_FROM;
    
    if (!from) {
      console.error('❌ MAIL_FROM environment variable not set!');
      return res.status(500).json({ 
        error: 'Email service not configured. Please contact support.'
      });
    }

    try {
      await sendPasswordResetEmail(normalizedEmail, resetLink, from);
      console.log(`✅ Password reset email sent to: ${email}`);
    } catch (mailError: any) {
      console.error('❌ Failed to send password reset email:', mailError);
      // Clear the token since email failed
      user.passwordResetToken = undefined;
      user.passwordResetExpires = undefined;
      await user.save();
      return res.status(500).json({ 
        error: 'Failed to send password reset email. Please try again.'
      });
    }

    res.json({
      message: 'If an account with that email exists, password reset instructions have been sent.'
    });

  } catch (error) {
    console.error('❌ Forgot password error:', error);
    res.status(500).json({ error: 'An error occurred. Please try again.' });
  }
});

// Reset Password - Verify token and update password
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    console.log('🔐 Reset password request received');

    if (!token || !password) {
      return res.status(400).json({ error: 'Token and password are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // Hash the token to compare with stored hash
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // Find user with valid token
    const user = await User.findOne({
      passwordResetToken: tokenHash,
      passwordResetExpires: { $gt: new Date() }
    });

    if (!user) {
      console.log('❌ Invalid or expired reset token');
      return res.status(400).json({ 
        error: 'Invalid or expired reset link. Please request a new password reset.'
      });
    }

    console.log(`✅ Valid reset token for user: ${user.email}`);

    // Update password
    user.password = password;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save();

    console.log(`✅ Password reset successful for: ${user.email}`);

    res.json({
      message: 'Password reset successful. You can now login with your new password.'
    });

  } catch (error) {
    console.error('❌ Reset password error:', error);
    res.status(500).json({ error: 'An error occurred. Please try again.' });
  }
});

// Verify Reset Token - Check if token is valid (for frontend validation)
router.get('/reset-password/:token', async (req, res) => {
  try {
    const { token } = req.params;
    console.log('🔐 Verifying reset token');

    if (!token) {
      return res.status(400).json({ valid: false, error: 'Token is required' });
    }

    // Hash the token to compare with stored hash
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // Find user with valid token
    const user = await User.findOne({
      passwordResetToken: tokenHash,
      passwordResetExpires: { $gt: new Date() }
    });

    if (!user) {
      console.log('❌ Invalid or expired reset token');
      return res.status(400).json({ 
        valid: false, 
        error: 'Invalid or expired reset link. Please request a new password reset.'
      });
    }

    console.log(`✅ Valid reset token for user: ${user.email}`);
    res.json({ valid: true, email: user.email });

  } catch (error) {
    console.error('❌ Verify reset token error:', error);
    res.status(500).json({ valid: false, error: 'An error occurred. Please try again.' });
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
