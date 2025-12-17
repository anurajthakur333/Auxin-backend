import mongoose from 'mongoose';

const getMongoURI = () => {
  const isProduction = process.env.NODE_ENV === 'production';
  
  // Debug: Log all available environment variables (MOVED INSIDE FUNCTION)
  console.log('🔍 Environment Check:');
  console.log('   NODE_ENV:', process.env.NODE_ENV);
  console.log('   MONGODB_URI exists:', !!process.env.MONGODB_URI);
  console.log('   MONGODB_URI_PROD exists:', !!process.env.MONGODB_URI_PROD);
  console.log('   DATABASE_URL exists:', !!process.env.DATABASE_URL);
  console.log('   MONGO_URI exists:', !!process.env.MONGO_URI);
  
  // Try multiple environment variable names for flexibility
  const MONGODB_URI = process.env.MONGODB_URI || 
                     process.env.MONGODB_URI_PROD || 
                     process.env.DATABASE_URL ||
                     process.env.MONGO_URI;
  
  if (!MONGODB_URI) {
    console.error('❌ Available environment variables:', Object.keys(process.env).filter(k => 
      k.includes('MONGO') || k.includes('DATABASE')
    ));
    
    throw new Error(
      `❌ Missing MongoDB connection string!\n` +
      `Please define one of these environment variables:\n` +
      `- MONGODB_URI (recommended)\n` +
      `- MONGODB_URI_PROD\n` +
      `- DATABASE_URL\n` +
      `- MONGO_URI\n` +
      `Example: MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/database?retryWrites=true&w=majority`
    );
  }
  
  // Mask the password in logs for security
  const maskedURI = MONGODB_URI.replace(/:([^:@]{1,}@)/, ':****@');
  console.log(`🔗 Using MongoDB URI: ${maskedURI}`);
  console.log(`🔗 URI length: ${MONGODB_URI.length} characters`);
  
  return MONGODB_URI;
};

interface MongooseCache {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
}

declare global {
  var mongoose: MongooseCache | undefined;
}

let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

async function connectDB() {
  if (cached!.conn) {
    console.log('♻️  Using existing MongoDB connection');
    return cached!.conn;
  }

  if (!cached!.promise) {
    const opts = {
      bufferCommands: false,
      serverSelectionTimeoutMS: 10000, // 10 seconds
      socketTimeoutMS: 45000, // 45 seconds
      maxPoolSize: 10,
      minPoolSize: 5,
    };

    const MONGODB_URI = getMongoURI(); // This now logs debug info
    console.log('🔄 Connecting to MongoDB...');
    
    cached!.promise = mongoose.connect(MONGODB_URI, opts).then((mongoose) => {
      console.log('✅ Successfully connected to MongoDB');
      console.log(`📊 Database: ${mongoose.connection.name}`);
      console.log(`🌐 Host: ${mongoose.connection.host}`);
      return mongoose;
    }).catch((error) => {
      console.error('❌ MongoDB connection failed:', error.message);
      
      // Provide helpful error messages for common issues
      if (error.message.includes('ENOTFOUND')) {
        console.error('💡 This usually means:');
        console.error('   1. Check your MongoDB connection string');
        console.error('   2. Ensure your IP is whitelisted in MongoDB Atlas');
        console.error('   3. Verify your internet connection');
      } else if (error.message.includes('ECONNREFUSED') || error.message.includes('connect ECONNREFUSED')) {
        console.error('💡 Connection refused. This usually means:');
        console.error('   1. MongoDB is not running locally');
        console.error('   2. Start MongoDB: brew services start mongodb-community (macOS)');
        console.error('   3. Or use MongoDB Atlas cloud database');
        console.error('   4. Verify MONGODB_URI points to a running MongoDB instance');
      } else if (error.message.includes('authentication failed')) {
        console.error('💡 Authentication failed - check your username/password');
      } else if (error.message.includes('timeout')) {
        console.error('💡 Connection timeout - check your network or MongoDB Atlas status');
      }
      
      throw error;
    });
  }

  try {
    cached!.conn = await cached!.promise;
  } catch (e) {
    cached!.promise = null;
    throw e;
  }

  return cached!.conn;
}

export default connectDB;