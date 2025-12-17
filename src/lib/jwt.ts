import jwt from 'jsonwebtoken';
import { IUser } from '../models/User.js';

// Get JWT_SECRET with lazy evaluation
const getJWTSecret = (): string => {
  const JWT_SECRET = process.env.JWT_SECRET;
  if (!JWT_SECRET) {
    console.error('❌ JWT_SECRET environment variable is not set!');
    throw new Error('JWT_SECRET environment variable is required for security');
  }
  return JWT_SECRET;
};

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

export interface JWTPayload {
  userId: string;
  email: string;
  iat?: number;
  exp?: number;
}

export const generateToken = (user: IUser): string => {
  const payload: JWTPayload = {
    userId: user._id,
    email: user.email
  };

  const secretKey = getJWTSecret();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return jwt.sign(payload, secretKey, { expiresIn: JWT_EXPIRES_IN } as any);
};

export const verifyToken = (token: string): JWTPayload => {
  try {
    const secretKey = getJWTSecret();
    return jwt.verify(token, secretKey) as JWTPayload;
  } catch (error: any) {
    // Log the actual error for debugging
    console.error('JWT verification error:', {
      name: error?.name,
      message: error?.message,
      expiredAt: error?.expiredAt,
    });
    
    // Provide more specific error messages
    if (error?.name === 'TokenExpiredError') {
      throw new Error('Token has expired');
    } else if (error?.name === 'JsonWebTokenError') {
      throw new Error(`Invalid token: ${error?.message || 'Token malformed'}`);
    } else if (error?.name === 'NotBeforeError') {
      throw new Error('Token not yet active');
    }
    
    // Generic fallback
    throw new Error(`Invalid or expired token: ${error?.message || 'Unknown error'}`);
  }
};

export const generateRefreshToken = (user: IUser): string => {
  const payload = {
    userId: user._id,
    type: 'refresh'
  };

  const secretKey = getJWTSecret();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return jwt.sign(payload, secretKey, { expiresIn: '30d' } as any);
};

// Decode JWT token without verification (for debugging/inspection)
export const decodeToken = (token: string): JWTPayload | null => {
  try {
    return jwt.decode(token) as JWTPayload;
  } catch {
    return null;
  }
};

// Check if token is expired (without verification)
export const isTokenExpired = (token: string): boolean => {
  try {
    const decoded = jwt.decode(token) as JWTPayload;
    if (!decoded || !decoded.exp) return true;
    
    const currentTime = Math.floor(Date.now() / 1000);
    return decoded.exp < currentTime;
  } catch {
    return true;
  }
};

// Get token expiration date
export const getTokenExpiration = (token: string): Date | null => {
  try {
    const decoded = jwt.decode(token) as JWTPayload;
    if (!decoded || !decoded.exp) return null;
    
    return new Date(decoded.exp * 1000);
  } catch {
    return null;
  }
};
