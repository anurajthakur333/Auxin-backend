import { v2 as cloudinary } from 'cloudinary';
import { Readable } from 'stream';

// Validate Cloudinary configuration
const validateCloudinaryConfig = () => {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    const missing = [];
    if (!cloudName) missing.push('CLOUDINARY_CLOUD_NAME');
    if (!apiKey) missing.push('CLOUDINARY_API_KEY');
    if (!apiSecret) missing.push('CLOUDINARY_API_SECRET');
    
    throw new Error(
      `Cloudinary configuration is incomplete. Missing environment variables: ${missing.join(', ')}. ` +
      `Please add these to your .env file.`
    );
  }

  return { cloudName, apiKey, apiSecret };
};

// Configure Cloudinary (lazy initialization)
let isConfigured = false;
const configureCloudinary = () => {
  if (!isConfigured) {
    const { cloudName, apiKey, apiSecret } = validateCloudinaryConfig();
    cloudinary.config({
      cloud_name: cloudName,
      api_key: apiKey,
      api_secret: apiSecret,
    });
    isConfigured = true;
    console.log('✅ Cloudinary configured successfully');
  }
};

export interface UploadResult {
  url: string;
  public_id: string;
  secure_url: string;
}

/**
 * Upload a file buffer to Cloudinary
 */
export const uploadToCloudinary = async (
  buffer: Buffer,
  folder: string = 'employees',
  resourceType: 'image' | 'video' | 'raw' | 'auto' = 'auto'
): Promise<UploadResult> => {
  // Ensure Cloudinary is configured before upload
  try {
    configureCloudinary();
  } catch (error: any) {
    return Promise.reject(error);
  }

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: `auxin/${folder}`,
        resource_type: resourceType,
        use_filename: true,
        unique_filename: true,
      },
      (error, result) => {
        if (error) {
          reject(error);
        } else if (result) {
          resolve({
            url: result.url,
            public_id: result.public_id,
            secure_url: result.secure_url,
          });
        } else {
          reject(new Error('Upload failed: No result returned'));
        }
      }
    );

    // Convert buffer to stream
    const stream = Readable.from(buffer);
    stream.pipe(uploadStream);
  });
};

/**
 * Delete a file from Cloudinary
 */
export const deleteFromCloudinary = async (publicId: string): Promise<void> => {
  try {
    // Ensure Cloudinary is configured before deletion
    configureCloudinary();
    await cloudinary.uploader.destroy(publicId);
  } catch (error) {
    console.error('Error deleting from Cloudinary:', error);
    // Don't throw - deletion is not critical
  }
};

export default cloudinary;

