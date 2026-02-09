import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import process from 'node:process';
import crypto from 'node:crypto';
import axios from 'axios';
import { log } from '../utils/logger.js';

export interface ACRCloudMetadata {
  artist: string;
  title: string;
  album: string;
}

export async function recognizeFromAudio(filePath: string): Promise<ACRCloudMetadata | null> {
  const host = process.env.ACRCLOUD_HOST || 'identify-us-west-2.acrcloud.com';
  const accessKey = process.env.ACRCLOUD_ACCESS_KEY;
  const accessSecret = process.env.ACRCLOUD_ACCESS_SECRET;

  if (!accessKey || !accessSecret) {
    log.error('Missing ACRCloud credentials (ACRCLOUD_ACCESS_KEY, ACRCLOUD_ACCESS_SECRET)');
    return null;
  }

  const tempDir = os.tmpdir();
  const snippetPath = path.join(tempDir, `snippet_${Date.now()}_${path.basename(filePath)}`);

  try {
    log.info(`Extracting snippet from: ${filePath}`);
    // ACRCloud prefers 12-15 seconds.
    execSync(`ffmpeg -y -ss 15 -t 12 -i "${filePath}" -map 0:a:0 -b:a 128k "${snippetPath}"`, {
      stdio: 'ignore',
    });

    if (!fs.existsSync(snippetPath)) {
      log.error('Failed to create audio snippet');
      return null;
    }

    log.info(`Recognizing via ACRCloud...`);
    const bitmap = fs.readFileSync(snippetPath);

    const timestamp = Math.floor(Date.now() / 1000);
    const stringToSign = ['POST', '/v1/identify', accessKey, 'audio', '1', timestamp].join('\n');

    const signature = crypto
      .createHmac('sha1', accessSecret)
      .update(Buffer.from(stringToSign, 'utf-8'))
      .digest()
      .toString('base64');

    const formData = new FormData();
    formData.append('sample', new Blob([bitmap]), 'snippet.mp3');
    formData.append('access_key', accessKey);
    formData.append('data_type', 'audio');
    formData.append('signature_version', '1');
    formData.append('signature', signature);
    formData.append('sample_bytes', bitmap.length.toString());
    formData.append('timestamp', timestamp.toString());

    const response = await axios.post(`https://${host}/v1/identify`, formData);

    if (response.data.status.code === 0 && response.data.metadata?.music?.[0]) {
      const music = response.data.metadata.music[0];
      return {
        artist: music.artists?.[0]?.name || 'Unknown Artist',
        title: music.title || 'Unknown Title',
        album: music.album?.name || '',
      };
    } else {
      const errorMsg = response.data.status?.msg || 'Unknown error';
      log.warn(`ACRCloud recognition failed: ${errorMsg}`);
      return null;
    }
  } catch (error) {
    log.error(`Error during recognition: ${String(error)}`);
    return null;
  } finally {
    if (fs.existsSync(snippetPath)) {
      try {
        fs.unlinkSync(snippetPath);
      } catch (err) {
        // ignore
      }
    }
  }
}
