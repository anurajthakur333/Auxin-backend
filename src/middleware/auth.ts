import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../lib/jwt.js';
import User from '../models/User.js';

// Extend Request interface to include user
declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        email: string;
        name: string;
        avatar?: string;
        isEmailVerified: boolean;
      };
    }
  }
}

export const authenticateToken = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    
    // Debug logging in development
    if (process.env.NODE_ENV === 'development') {
      console.log(`🔐 Auth check for ${req.method} ${req.path}`);
      console.log(`   Authorization header present: ${!!authHeader}`);
      if (authHeader) {
        console.log(`   Header preview: ${authHeader.substring(0, 30)}...`);
      }
    }
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      if (process.env.NODE_ENV === 'development') {
        console.error(`❌ Missing or invalid Authorization header for ${req.path}`);
        console.error(`   Header value: ${authHeader || 'undefined'}`);
      }
      return res.status(401).json({ 
        error: 'Access token required',
        code: 'UNAUTHORIZED'
      });
    }

    const token = authHeader.substring(7).trim();
    
    // Validate token format before verification
    if (!token || token.length === 0) {
      console.error('❌ Empty token received');
      return res.status(401).json({ 
        error: 'Token is empty',
        code: 'INVALID_TOKEN'
      });
    }

    // Check for invalid token values (null, undefined, etc.)
    const invalidTokens = ['null', 'undefined', 'Bearer', 'bearer'];
    if (invalidTokens.includes(token.toLowerCase())) {
      console.error('❌ Invalid token value received:', token);
      console.error('   This usually means the frontend is not properly storing/retrieving the token');
      console.error('   Check localStorage/sessionStorage for the auth token');
      return res.status(401).json({ 
        error: 'Invalid token value. Please log in again.',
        code: 'INVALID_TOKEN',
        hint: 'Token appears to be null or undefined. Please check your authentication state.'
      });
    }

    // Basic JWT format validation (should have 3 parts separated by dots)
    const tokenParts = token.split('.');
    if (tokenParts.length !== 3) {
      console.error('❌ Malformed token format. Expected 3 parts, got:', tokenParts.length);
      console.error('Token value:', token.length > 50 ? token.substring(0, 50) + '...' : token);
      console.error('Token length:', token.length);
      console.error('Authorization header preview:', authHeader.substring(0, 50) + '...');
      return res.status(401).json({ 
        error: 'Invalid token format. Token must be a valid JWT with 3 parts separated by dots.',
        code: 'INVALID_TOKEN',
        hint: 'Please ensure you are sending a valid JWT token in the Authorization header.'
      });
    }
    
    try {
      const decoded = verifyToken(token);
      
      // Fetch user from database to ensure they still exist
      const user = await User.findById(decoded.userId);
      if (!user) {
        return res.status(401).json({ 
          error: 'User not found',
          code: 'USER_NOT_FOUND'
        });
      }

      // Add user info to request object
      req.user = {
        userId: user._id.toString(),
        email: user.email,
        name: user.name,
        avatar: user.avatar,
        isEmailVerified: user.isEmailVerified
      };

      next();
    } catch (tokenError: any) {
      console.error('Token verification failed:', tokenError);
      
      // Provide more specific error messages
      const errorMessage = tokenError?.message || 'Invalid or expired token';
      const errorCode = tokenError?.message?.includes('expired') ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN';
      
      return res.status(401).json({ 
        error: errorMessage,
        code: errorCode
      });
    }
  } catch (error) {
    console.error('Authentication middleware error:', error);
    return res.status(500).json({ 
      error: 'Authentication failed',
      code: 'AUTH_ERROR'
    });
  }
};

// Optional authentication - doesn't fail if no token provided
export const optionalAuth = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7).trim();
      
      // Validate token format before attempting verification
      // This prevents unnecessary error logging for malformed tokens
      if (token && token.length > 0) {
        // Check for invalid token values (null, undefined, etc.)
        const invalidTokens = ['null', 'undefined', 'Bearer', 'bearer'];
        const isInvalidValue = invalidTokens.includes(token.toLowerCase());
        
        // Basic JWT format validation (should have 3 parts separated by dots)
        const tokenParts = token.split('.');
        const isValidFormat = tokenParts.length === 3;
        
        // Only attempt verification if token looks valid
        if (!isInvalidValue && isValidFormat) {
          try {
            const decoded = verifyToken(token);
            const user = await User.findById(decoded.userId);
            
            if (user) {
              req.user = {
                userId: user._id.toString(),
                email: user.email,
                name: user.name,
                avatar: user.avatar,
                isEmailVerified: user.isEmailVerified
              };
            }
          } catch (tokenError) {
            // Silently ignore token errors for optional auth
            // Token format was valid but verification failed (expired, invalid signature, etc.)
            // No need to log as this is expected behavior for optional auth
          }
        }
        // If token is invalid format or invalid value, silently continue without auth
      }
    }
    
    next();
  } catch (error) {
    console.error('Optional auth middleware error:', error);
    next(); // Continue without authentication
  }
};
