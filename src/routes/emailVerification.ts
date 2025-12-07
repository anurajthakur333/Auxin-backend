import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import * as brevoSdk from '@getbrevo/brevo';
import User from '../models/User.js';
import PendingUser from '../models/PendingUser.js';
import { generateToken } from '../lib/jwt.js';

const router = Router();

// Setup Brevo API client (HTTP-based, no SMTP)
const getBrevoClient = () => {
  const apiInstance = new brevoSdk.TransactionalEmailsApi();
  apiInstance.setApiKey(
    brevoSdk.TransactionalEmailsApiApiKeys.apiKey,
    process.env.BREVO_API_KEY || ''
  );
  return apiInstance;
};

// Helper function to send OTP email via Brevo HTTP API
async function sendOtpEmail(to: string, code: string, from: string): Promise<void> {
  const apiInstance = getBrevoClient();
  
  const sendSmtpEmail = new brevoSdk.SendSmtpEmail();
  sendSmtpEmail.sender = { email: from, name: 'Auxin' };
  sendSmtpEmail.to = [{ email: to }];
  sendSmtpEmail.subject = 'Your Auxin Verification Code';
  sendSmtpEmail.htmlContent = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#333;max-width:600px;margin:0 auto">
      <div style="background:#000;padding:20px;text-align:center">
        <h1 style="color:#39FF14;margin:0">AUXIN</h1>
      </div>
      <div style="background:#fff;padding:30px">
        <h2 style="color:#333;margin-top:0">Verify Your Email</h2>
        <p style="color:#666;font-size:16px">Thank you for signing up! Please enter the following verification code to complete your registration:</p>
        <div style="background:#f5f5f5;border:2px solid #39FF14;padding:20px;text-align:center;margin:30px 0;border-radius:8px">
          <div style="font-size:32px;letter-spacing:12px;font-weight:bold;color:#39FF14;font-family:'Courier New',monospace">${code}</div>
        </div>
        <p style="color:#666;font-size:14px">This code will expire in 2 minutes.</p>
        <p style="color:#999;font-size:12px;margin-top:30px;padding-top:20px;border-top:1px solid #eee">If you didn't create an account with Auxin, please ignore this email.</p>
      </div>
    </div>`;

  await apiInstance.sendTransacEmail(sendSmtpEmail);
}

// POST /send-otp
router.post('/send-otp', async (req: Request, res: Response) => {
  try {
    const { email } = req.body as { email: string };
    console.log('📧 Send OTP request received for:', email);
    
    // Validate Brevo API key
    if (!process.env.BREVO_API_KEY) {
      console.error('❌ BREVO_API_KEY not configured!');
      return res.status(500).json({ 
        success: false, 
        error: 'Email service not configured. Please set BREVO_API_KEY environment variable.'
      });
    }
    
    if (!email) {
      console.log('❌ Email is required');
      return res.status(400).json({ success: false, error: 'Email is required' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    // We now support both registered users and pending users
    let user = await User.findOne({ email: normalizedEmail });
    let pending = null as any;
    if (!user) {
      pending = await PendingUser.findOne({ email: normalizedEmail });
      if (!pending) {
        console.log('❌ No pending signup found for email:', normalizedEmail);
        return res.status(404).json({ success: false, error: 'No signup found for this email' });
      }
    }

    console.log('✅ User found, generating OTP code...');
    const code = crypto.randomInt(100000, 999999).toString();
    const expires = new Date(Date.now() + 2 * 60 * 1000); // 2 minutes

    if (user) {
      user.emailVerificationCode = code;
      user.emailVerificationExpires = expires;
      await user.save();
    } else if (pending) {
      pending.emailVerificationCode = code;
      pending.emailVerificationExpires = expires;
      await pending.save();
    }
    console.log('✅ OTP code saved to database:', code);

    // IMPORTANT: Brevo requires the "from" email to be a verified sender in your Brevo account
    // 
    // To fix the "sender is not valid" error:
    // 1. Go to Brevo Dashboard → Settings → Senders & IP → Add a sender
    // 2. Add and verify your email
    // 3. Set MAIL_FROM environment variable to that verified email
    
    const from = process.env.MAIL_FROM;
    
    // If MAIL_FROM not set, provide helpful error
    if (!from) {
      console.error('❌ MAIL_FROM environment variable not set!');
      console.error('📝 Instructions:');
      console.error('   1. Go to Brevo Dashboard → Settings → Senders & IP');
      console.error('   2. Click "Add a sender" and verify your email');
      console.error('   3. Set MAIL_FROM environment variable to that verified email');
      console.error('   4. Example: MAIL_FROM=your-verified-email@example.com');
      
      return res.status(500).json({ 
        success: false, 
        error: 'Email sender not configured. Please verify a sender email in Brevo and set MAIL_FROM environment variable.'
      });
    }
    
    // Validate it's not the SMTP login format (common mistake)
    if (from.includes('@smtp-brevo.com')) {
      console.error('❌ MAIL_FROM cannot be the SMTP login email format.');
      console.error('❌ Use a verified sender email instead (e.g., your Gmail address)');
      return res.status(500).json({ 
        success: false, 
        error: 'Invalid sender email. Please use a verified sender email from your Brevo account.'
      });
    }
    
    console.log('📤 Attempting to send email via Brevo HTTP API...');
    console.log('📤 Brevo Config:', {
      apiKey: process.env.BREVO_API_KEY ? '***configured***' : 'NOT SET',
      from: from,
      to: normalizedEmail
    });

    try {
      await sendOtpEmail(normalizedEmail, code, from);
      console.log('✅ Email sent successfully via Brevo API!');
    } catch (mailError: any) {
      console.error('❌ Brevo API Error:', mailError);
      console.error('❌ Brevo Error Details:', mailError.body || mailError.message);
      throw mailError;
    }

    return res.json({ success: true, message: 'Verification code sent successfully' });
  } catch (err: any) {
    console.error('❌ send-otp error:', err);
    console.error('❌ Error stack:', err.stack);
    return res.status(500).json({ 
      success: false, 
      error: err.message || 'Failed to send verification code',
      details: process.env.NODE_ENV === 'development' ? err.toString() : undefined
    });
  }
});

// POST /verify-otp
router.post('/verify-otp', async (req: Request, res: Response) => {
  try {
    const { email, code } = req.body as { email: string; code: string };
    console.log('🔐 Verify OTP request received:', { email, code: code ? '***' : 'missing' });
    
    if (!email || !code) {
      console.log('❌ Email and code are required');
      return res.status(400).json({ success: false, error: 'Email and code are required' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    let user = await User.findOne({ email: normalizedEmail });
    let pending = null as any;
    if (!user) {
      pending = await PendingUser.findOne({ email: normalizedEmail });
      if (!pending) {
        console.log('❌ No user or pending signup found for email:', normalizedEmail);
        return res.status(404).json({ success: false, error: 'No active verification code. Please request a new code.' });
      }
    }

    if (user) {
      console.log('✅ User found:', {
        isEmailVerified: user.isEmailVerified,
        hasVerificationCode: !!user.emailVerificationCode,
        verificationCode: user.emailVerificationCode ? '***' : 'none',
        expires: user.emailVerificationExpires
      });
    } else if (pending) {
      console.log('✅ Pending user found:', {
        hasVerificationCode: !!pending.emailVerificationCode,
        verificationCode: pending.emailVerificationCode ? '***' : 'none',
        expires: pending.emailVerificationExpires
      });
    }

    if (user && user.isEmailVerified) {
      console.log('✅ User already verified, generating token...');
      // Already verified - return token anyway
      const token = generateToken(user);
      return res.json({ 
        success: true,
        token,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          avatar: user.avatar,
          isEmailVerified: user.isEmailVerified
        }
      });
    }

    const storedCode = user ? user.emailVerificationCode : pending?.emailVerificationCode;
    const storedExpires = user ? user.emailVerificationExpires : pending?.emailVerificationExpires;
    if (!storedCode || !storedExpires) {
      console.log('❌ No active verification code found');
      return res.status(400).json({ 
        success: false, 
        error: 'No active verification code. Please request a new code.' 
      });
    }

    const isExpired = new Date(storedExpires).getTime() < Date.now();
    const codeMatches = String(storedCode) === String(code);
    
    console.log('🔍 Code verification:', {
      isExpired,
      codeMatches,
      storedCode: storedCode ? '***' : 'none',
      providedCode: code,
      expiresAt: storedExpires,
      now: new Date()
    });

    if (isExpired || !codeMatches) {
      const errorMsg = isExpired ? 'Verification code has expired' : 'Invalid verification code';
      console.log('❌ Verification failed:', errorMsg);
      return res.status(400).json({ success: false, error: errorMsg });
    }

    if (user) {
      user.isEmailVerified = true;
      user.emailVerificationCode = undefined;
      user.emailVerificationExpires = undefined;
      await user.save();
    } else if (pending) {
      // Create real user from pending record
      const created = new User({
        name: pending.name,
        email: pending.email,
        password: pending.password,
        isEmailVerified: true
      });
      await created.save();
      await pending.deleteOne();
      user = created;
    }

    // Generate token and return user data
    const token = generateToken(user);

    return res.json({ 
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        isEmailVerified: user.isEmailVerified
      }
    });
  } catch (err) {
    console.error('❌ verify-otp error:', err);
    if (err instanceof Error) {
      console.error('❌ Error stack:', err.stack);
    }
    return res.status(500).json({ 
      success: false, 
      error: 'Internal error',
      message: process.env.NODE_ENV === 'development' ? (err instanceof Error ? err.message : String(err)) : undefined
    });
  }
});

export default router;
