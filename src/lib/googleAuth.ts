import { OAuth2Client } from 'google-auth-library';

const getGoogleConfig = (req?: any) => {
  const isProduction = process.env.NODE_ENV === 'production';
  
  // Get Google OAuth credentials
  const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID?.trim();
  const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET?.trim();
  
  // Determine redirect URI based on environment
  // IMPORTANT: This must point to the BACKEND, not the frontend!
  // Google will redirect here with the OAuth code, then backend processes it
  let GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI?.trim();
  
  // Validate that redirect URI points to backend, not frontend
  if (GOOGLE_REDIRECT_URI) {
    // Check if it's pointing to frontend (auxin.world) - this is wrong!
    if (GOOGLE_REDIRECT_URI.includes('auxin.world') && !GOOGLE_REDIRECT_URI.includes('backend')) {
      console.error('❌ ERROR: GOOGLE_REDIRECT_URI is pointing to frontend! It must point to backend.');
      console.error('❌ Current value:', GOOGLE_REDIRECT_URI);
      GOOGLE_REDIRECT_URI = undefined; // Force auto-detection
    }
  }
  
  // If not explicitly set or invalid, generate based on environment
  if (!GOOGLE_REDIRECT_URI) {
    if (isProduction) {
      // Production: detect backend URL from request or environment variables
      let backendUrl = '';
      
      // Try to get from request headers (most reliable)
      if (req) {
        const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
        const host = req.headers['host'] || req.get('host');
        if (host) {
          backendUrl = `${protocol}://${host}`;
          console.log('🔍 Detected backend URL from request:', backendUrl);
        }
      }
      
      // Fallback to environment variables
      if (!backendUrl) {
        backendUrl = process.env.RENDER_EXTERNAL_URL || 
                    process.env.RAILWAY_PUBLIC_DOMAIN || 
                    process.env.BACKEND_URL || 
                    process.env.PUBLIC_URL ||
                    '';
        
        // If still empty, try to construct from known patterns
        if (!backendUrl) {
          // Render pattern: service-name.onrender.com
          const renderService = process.env.RENDER_SERVICE_NAME;
          if (renderService) {
            backendUrl = `https://${renderService}.onrender.com`;
          }
        }
      }
      
      if (!backendUrl) {
        throw new Error('Cannot determine backend URL in production. Please set GOOGLE_REDIRECT_URI or RENDER_EXTERNAL_URL environment variable.');
      }
      
      // Ensure no trailing slash
      backendUrl = backendUrl.replace(/\/+$/, '');
      GOOGLE_REDIRECT_URI = `${backendUrl}/auth/google/callback`;
      console.log('🔍 Auto-generated redirect URI:', GOOGLE_REDIRECT_URI);
    } else {
      // Development: use localhost
      const port = process.env.PORT || '3001';
      GOOGLE_REDIRECT_URI = `http://localhost:${port}/auth/google/callback`;
    }
  }

  console.log('🔍 Google Config Debug:');
  console.log('🔍 Environment:', isProduction ? 'PRODUCTION' : 'DEVELOPMENT');
  console.log('🔍 GOOGLE_CLIENT_ID:', GOOGLE_CLIENT_ID ? `${GOOGLE_CLIENT_ID.substring(0, 20)}...` : 'NOT SET');
  console.log('🔍 GOOGLE_CLIENT_SECRET:', GOOGLE_CLIENT_SECRET ? 'SET' : 'NOT SET');
  console.log('🔍 GOOGLE_REDIRECT_URI:', GOOGLE_REDIRECT_URI);
  console.log('🔍 Redirect URI points to:', GOOGLE_REDIRECT_URI.includes('auxin.world') ? '❌ FRONTEND (WRONG!)' : '✅ BACKEND (CORRECT)');

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    throw new Error('Missing Google OAuth environment variables: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required');
  }

  return { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI };
};

export const getOAuth2Client = (req?: any) => {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = getGoogleConfig(req);
  return new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
};

export const getGoogleAuthURL = (req?: any): string => {
  try {
    const oauth2Client = getOAuth2Client(req);
    const scopes = [
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile'
    ];

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent'
    });

    console.log('✅ Generated Google auth URL successfully');
    console.log('🔍 Auth URL preview:', authUrl.substring(0, 100) + '...');
    
    return authUrl;
  } catch (error) {
    console.error('❌ Failed to generate Google auth URL:', error);
    throw error;
  }
};

export const getGoogleUserInfo = async (code: string, req?: any) => {
  try {
    const oauth2Client = getOAuth2Client(req);
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`
      }
    });

    if (!response.ok) {
      throw new Error('Failed to fetch user info from Google');
    }

    const userInfo = await response.json() as {
      id: string;
      email: string;
      name: string;
      picture: string;
    };
    
    return {
      googleId: userInfo.id,
      email: userInfo.email,
      name: userInfo.name,
      avatar: userInfo.picture
    };
  } catch (error) {
    console.error('Google OAuth error:', error);
    throw new Error('Failed to authenticate with Google');
  }
};
