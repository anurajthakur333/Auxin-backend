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

// Helper function to send verification email via Brevo HTTP API
async function sendVerificationEmail(to: string, verificationLink: string, from: string): Promise<any> {
  const apiInstance = getBrevoClient();
  
  const sendSmtpEmail = new brevoSdk.SendSmtpEmail();
  sendSmtpEmail.sender = { email: from, name: 'Auxin' };
  sendSmtpEmail.to = [{ email: to }];
  sendSmtpEmail.subject = 'Verify Your Auxin Account';
  
  sendSmtpEmail.htmlContent = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;margin:0;padding:0;background:#000;">
      <div style="max-width:600px;margin:0 auto;background:#000;background-image:repeating-linear-gradient(135deg,transparent,transparent 35px,rgba(50,50,50,0.3) 35px,rgba(50,50,50,0.3) 70px);padding:40px 30px;">
        
        <!-- Header -->
        <h1 style="color:#39FF14;margin:0 0 20px 0;font-size:48px;font-weight:bold;font-style:italic;line-height:1.1;">
          VERIFY<br>YOUR EMAIL
        </h1>
        
        <!-- Subheading -->
        <p style="color:#39FF14;font-size:16px;margin:0 0 30px 0;line-height:1.5;">
          Thank You For Signing Up! Please Click<br>
          The Button Below To Complete Your Registration:
        </p>
        
        <!-- Verify Button -->
        <div style="margin:30px 0;text-align:center;">
          <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#39FF14;">
            <tr>
              <td style="padding:20px 30px;text-align:center;">
                <a href="${verificationLink}" style="display:inline-block;background:#39FF14;color:#000;font-size:24px;font-weight:bold;text-decoration:none;padding:18px 60px;font-family:'Arial Black',Arial,sans-serif;letter-spacing:2px;border:none;">
                  VERIFY EMAIL
                </a>
              </td>
            </tr>
          </table>
        </div>
        
        <!-- Validity Notice -->
        <p style="color:#39FF14;font-size:16px;margin:25px 0;text-align:center;font-weight:bold;">
          This Link Is Valid For 24 Hours. Please Do Not Share This Link With Anyone.
        </p>
        
        <!-- Disclaimer -->
        <p style="color:#39FF14;font-size:14px;margin:30px 0;text-align:center;line-height:1.6;">
          If You Didn't Request This Email, Please Ignore It.<br>
          Thank You For Using Our Service!
        </p>
        
        <!-- Divider -->
        <hr style="border:none;border-top:2px solid #39FF14;margin:30px 0;">
        
        <!-- Footer -->
        <p style="color:#fff;font-size:12px;margin:0;text-align:center;font-weight:bold;letter-spacing:1px;">
          COPYRIGHT 2024 <span style="color:#39FF14;">AUXIN MEDIA.</span> ALL RIGHTS RESERVED.
        </p>
        
      </div>
    </div>`;

  const response = await apiInstance.sendTransacEmail(sendSmtpEmail);
  console.log('📬 Brevo Response:', JSON.stringify(response.body || response, null, 2));
  return response;
}

// POST /send-verification - Send verification email with link
router.post(['/send-otp', '/send-verification'], async (req: Request, res: Response) => {
  try {
    const { email } = req.body as { email: string };
    console.log('📧 Send verification email request for:', email);
    
    // Validate Brevo API key
    if (!process.env.BREVO_API_KEY) {
      console.error('❌ BREVO_API_KEY not configured!');
      return res.status(500).json({ 
        success: false, 
        error: 'Email service not configured.'
      });
    }
    
    if (!email) {
      return res.status(400).json({ success: false, error: 'Email is required' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    // Check for user or pending user
    let user = await User.findOne({ email: normalizedEmail });
    let pending = null as any;
    if (!user) {
      pending = await PendingUser.findOne({ email: normalizedEmail });
      if (!pending) {
        console.log('❌ No signup found for:', normalizedEmail);
        return res.status(404).json({ success: false, error: 'No signup found for this email' });
      }
    }

    // Generate a secure random token
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    if (user) {
      user.emailVerificationCode = token;
      user.emailVerificationExpires = expires;
      await user.save();
    } else if (pending) {
      pending.emailVerificationCode = token;
      pending.emailVerificationExpires = expires;
      await pending.save();
    }
    console.log('✅ Verification token generated');

    const from = process.env.MAIL_FROM;
    if (!from) {
      console.error('❌ MAIL_FROM not set');
      return res.status(500).json({ 
        success: false, 
        error: 'Email sender not configured.'
      });
    }
    
    // Build verification link - points to BACKEND which then redirects to frontend
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:3001';
    const verificationLink = `${backendUrl}/auth/verify-email?token=${token}&email=${encodeURIComponent(normalizedEmail)}`;
    
    console.log('🔗 Verification link:', verificationLink);
    console.log('📤 Sending email to:', normalizedEmail);

    try {
      await sendVerificationEmail(normalizedEmail, verificationLink, from);
      console.log('✅ Verification email sent successfully!');
    } catch (mailError: any) {
      console.error('❌ Email send error:', mailError.body || mailError.message);
      throw mailError;
    }

    return res.json({ success: true, message: 'Verification email sent! Please check your inbox.' });
  } catch (err: any) {
    console.error('❌ send-verification error:', err);
    return res.status(500).json({ 
      success: false, 
      error: err.message || 'Failed to send verification email'
    });
  }
});

// GET /verify-email - Handle when user clicks the verification link
router.get('/verify-email', async (req: Request, res: Response) => {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  
  try {
    const { token, email } = req.query as { token: string; email: string };
    console.log('🔐 Verification link clicked for:', email);
    
    if (!email || !token) {
      return res.redirect(`${frontendUrl}/login?verified=failed&error=Invalid link`);
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    let user = await User.findOne({ email: normalizedEmail });
    let pending = null as any;
    
    if (!user) {
      pending = await PendingUser.findOne({ email: normalizedEmail });
      if (!pending) {
        return res.redirect(`${frontendUrl}/login?verified=failed&error=User not found`);
      }
    }

    // Already verified
    if (user && user.isEmailVerified) {
      console.log('✅ User already verified');
      return res.redirect(`${frontendUrl}/login?verified=already`);
    }

    const storedToken = user ? user.emailVerificationCode : pending?.emailVerificationCode;
    const storedExpires = user ? user.emailVerificationExpires : pending?.emailVerificationExpires;
    
    if (!storedToken || !storedExpires) {
      return res.redirect(`${frontendUrl}/login?verified=failed&error=No verification pending`);
    }

    const isExpired = new Date(storedExpires).getTime() < Date.now();
    const tokenMatches = String(storedToken) === String(token);

    if (isExpired) {
      console.log('❌ Token expired');
      return res.redirect(`${frontendUrl}/login?verified=failed&error=Link expired`);
    }
    
    if (!tokenMatches) {
      console.log('❌ Token mismatch');
      return res.redirect(`${frontendUrl}/login?verified=failed&error=Invalid link`);
    }

    // Verify the user
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

    console.log('✅ Email verified successfully for:', normalizedEmail);
    
    // Redirect to login page with success message
    return res.redirect(`${frontendUrl}/login?verified=success`);
  } catch (err) {
    console.error('❌ verify-email error:', err);
    return res.redirect(`${frontendUrl}/login?verified=failed&error=Server error`);
  }
});

export default router;
