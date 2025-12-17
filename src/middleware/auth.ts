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
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
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

    // Basic JWT format validation (should have 3 parts separated by dots)
    const tokenParts = token.split('.');
    if (tokenParts.length !== 3) {
      console.error('❌ Malformed token format. Expected 3 parts, got:', tokenParts.length);
      console.error('Token preview:', token.substring(0, 20) + '...');
      return res.status(401).json({ 
        error: 'Invalid token format',
        code: 'INVALID_TOKEN'
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
      const token = authHeader.substring(7);
      
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
        // Ignore token errors for optional auth
        console.log('Optional auth token invalid, continuing without user');
      }
    }
    
    next();
  } catch (error) {
    console.error('Optional auth middleware error:', error);
    next(); // Continue without authentication
  }
};
