import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { DEFAULT_CONFIG } from '../../config/defaults.js';

export function ensureCacheDir(): void {
  if (!fs.existsSync(DEFAULT_CONFIG.cacheDir)) {
    fs.mkdirSync(DEFAULT_CONFIG.cacheDir, { recursive: true });
  }
}

export function getImageHash(buffer: Buffer): string {
  return crypto.createHash('md5').update(buffer).digest('hex');
}

export function saveImageToCache(buffer: Buffer): string {
  ensureCacheDir();
  const hash = getImageHash(buffer);
  const filePath = path.join(DEFAULT_CONFIG.cacheDir, `${hash}.jpg`);
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, buffer);
  return filePath;
}

export function loadFromCache(hash: string): Buffer | null {
  const file = path.join(DEFAULT_CONFIG.cacheDir, `${hash}.jpg`);
  return fs.existsSync(file) ? fs.readFileSync(file) : null;
}
