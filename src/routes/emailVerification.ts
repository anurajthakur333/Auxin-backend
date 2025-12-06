import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import nodemailer from 'nodemailer';
import User from '../models/User.js';
import PendingUser from '../models/PendingUser.js';
import { generateToken } from '../lib/jwt.js';

const router = Router();

// Get transporter with lazy evaluation (loads env vars at runtime)
const getTransporter = () => {
  const host = process.env.SMTP_HOST || 'smtp-relay.brevo.com';
  // Use port 465 (SSL) by default for better cloud compatibility
  const port = Number(process.env.SMTP_PORT || 465);
  const secure = port === 465; // true for 465, false for other ports
  
  console.log('🔍 SMTP Environment Variables Check:');
  console.log('   SMTP_HOST:', host);
  console.log('   SMTP_PORT:', port);
  console.log('   SMTP_SECURE:', secure);
  console.log('   SMTP_USER:', process.env.SMTP_USER ? 'SET (' + process.env.SMTP_USER.substring(0, 20) + '...)' : 'NOT SET');
  console.log('   SMTP_PASS:', process.env.SMTP_PASS ? 'SET' : 'NOT SET');
  
  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    connectionTimeout: 10000, // 10 second timeout
    greetingTimeout: 10000,
    socketTimeout: 10000,
  });
};

// POST /send-otp
router.post('/send-otp', async (req: Request, res: Response) => {
  try {
    const { email } = req.body as { email: string };
    console.log('📧 Send OTP request received for:', email);
    
    // Validate environment variables
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      console.error('❌ SMTP credentials not configured!');
      return res.status(500).json({ 
        success: false, 
        error: 'Email service not configured. Please set SMTP_USER and SMTP_PASS environment variables.'
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
    // 
    // The SMTP login email cannot be used as "from" address
    
    const smtpUser = process.env.SMTP_USER;
    
    // Use MAIL_FROM if set, otherwise try to use a verified email
    // For now, as a temporary solution, you can use your Gmail after verifying it in Brevo
    let from = process.env.MAIL_FROM;
    
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
    
    console.log('📤 Attempting to send email via SMTP...');
    console.log('📤 SMTP Config:', {
      host: process.env.SMTP_HOST || 'smtp-relay.brevo.com',
      port: process.env.SMTP_PORT || 587,
      user: smtpUser ? '***configured***' : 'NOT SET',
      from: from
    });

    // Get transporter instance
    const transporter = getTransporter();
    
    // Verify SMTP connection first
    try {
      await transporter.verify();
      console.log('✅ SMTP connection verified successfully');
    } catch (verifyError: any) {
      console.error('❌ SMTP verification failed:', verifyError);
      throw new Error(`SMTP connection failed: ${verifyError.message}`);
    }

    try {
      const mailResult = await transporter.sendMail({
        from: `Auxin <${from}>`,
        to: normalizedEmail,
        subject: 'Your Auxin Verification Code',
        html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#333;max-width:600px;margin:0 auto">
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
              </div>`,
      });
      console.log('✅ Email sent successfully!', mailResult.messageId);
    } catch (mailError: any) {
      console.error('❌ SMTP Error:', mailError);
      console.error('❌ SMTP Error Details:', {
        code: mailError.code,
        command: mailError.command,
        response: mailError.response,
        responseCode: mailError.responseCode
      });
      throw mailError; // Re-throw to be caught by outer catch
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


