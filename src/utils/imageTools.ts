import sharp from 'sharp';

export async function normalizeImage(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer).jpeg({ quality: 90 }).toBuffer();
}
