import { OAuth2Client } from 'google-auth-library';

const getGoogleConfig = () => {
  const isProduction = process.env.NODE_ENV === 'production';
  
  // Get Google OAuth credentials
  const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID?.trim();
  const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET?.trim();
  
  // Determine redirect URI based on environment
  // For development: use localhost backend
  // For production: use production backend URL
  let GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI?.trim();
  
  // If not explicitly set, generate based on environment
  if (!GOOGLE_REDIRECT_URI) {
    if (isProduction) {
      // Production: use Railway/Render backend URL
      const backendUrl = process.env.RAILWAY_PUBLIC_DOMAIN || 
                        process.env.RENDER_EXTERNAL_URL || 
                        process.env.BACKEND_URL || 
                        'https://web-production-df81.up.railway.app';
      GOOGLE_REDIRECT_URI = `${backendUrl}/auth/google/callback`;
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

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    throw new Error('Missing Google OAuth environment variables: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required');
  }

  return { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI };
};

export const getOAuth2Client = () => {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = getGoogleConfig();
  return new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
};

export const getGoogleAuthURL = (): string => {
  try {
    const oauth2Client = getOAuth2Client();
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

export const getGoogleUserInfo = async (code: string) => {
  try {
    const oauth2Client = getOAuth2Client();
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
