import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { Shazam } from 'node-shazam';
import { log } from '../utils/logger.js';
import type { ACRCloudMetadata } from './acrcloud.js';
import { isUsableMetadata } from './metadataValidation.js';

type ShazamMinimalResult = {
  artist?: string;
  title?: string;
  album?: string;
};

function createSnippetAtOffset(filePath: string, offsetSeconds: number): string | null {
  const tempDir = os.tmpdir();
  const extension = path.extname(filePath) || '.mp3';
  const snippetPath = path.join(
    tempDir,
    `shazam_${offsetSeconds}_${Date.now()}_${crypto.randomUUID()}${extension}`,
  );

  try {
    execFileSync('ffmpeg', [
      '-y',
      '-ss',
      String(offsetSeconds),
      '-t',
      '12',
      '-i',
      filePath,
      '-map',
      '0:a:0',
      '-b:a',
      '128k',
      snippetPath,
    ], { stdio: 'ignore' });

    if (fs.existsSync(snippetPath) && fs.statSync(snippetPath).size > 1024) {
      return snippetPath;
    }
  } catch (err) {
    log.warn(`Failed to create Shazam audio snippet at ${offsetSeconds}s: ${String(err)}`);
  }

  if (fs.existsSync(snippetPath)) {
    try {
      fs.unlinkSync(snippetPath);
    } catch {
      // ignore temp cleanup failures
    }
  }

  return null;
}

function createSnippet(filePath: string): string | null {
  for (const offsetSeconds of [60, 15, 0]) {
    const snippetPath = createSnippetAtOffset(filePath, offsetSeconds);
    if (snippetPath) {
      log.info(`Created Shazam audio snippet starting at ${offsetSeconds}s`);
      return snippetPath;
    }
  }

  log.warn('Failed to create any Shazam audio snippet.');
  return null;
}

export async function recognizeFromShazam(filePath: string): Promise<ACRCloudMetadata | null> {
  const language = process.env.SHAZAM_LANGUAGE || 'es-US';
  const snippetPath = createSnippet(filePath);

  if (!snippetPath) {
    return null;
  }

  try {
    log.info('Recognizing via Shazam API...');
    const shazam = new Shazam();
    const result = await shazam.recognise(snippetPath, language, true) as ShazamMinimalResult | null;

    if (!result?.artist || !result?.title) {
      log.warn('Shazam returned no matching track.');
      return null;
    }

    const metadata = {
      artist: result.artist,
      title: result.title,
      album: result.album || '',
    };
    if (!isUsableMetadata(metadata)) {
      log.warn('Shazam returned incomplete placeholder metadata; continuing fallback chain.');
      return null;
    }

    return metadata;
  } catch (err) {
    log.warn(`Shazam recognition failed: ${String(err)}`);
    return null;
  } finally {
    if (fs.existsSync(snippetPath)) {
      try {
        fs.unlinkSync(snippetPath);
      } catch {
        // ignore temp cleanup failures
      }
    }
  }
}
