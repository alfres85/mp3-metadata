import fpcalc from 'fpcalc';
import path from 'node:path';
import process from 'node:process';
import axios from 'axios';
import fs from 'node:fs';
import { log } from '../utils/logger.js';
import type { ACRCloudMetadata } from './acrcloud.js';



function getFingerprint(filePath: string): Promise<{ duration: number; fingerprint: string }> {
  return new Promise((resolve, reject) => {
    const fpcalcPath = path.join(process.cwd(), 'bin', 'fpcalc.exe');
    
    const options: any = {};
    if (fs.existsSync(fpcalcPath)) {
      options.command = fpcalcPath;
    }
    
    fpcalc(filePath, options, (err: any, result: any) => {
      if (err) return reject(err);
      resolve({
        duration: parseInt(result.duration, 10),
        fingerprint: result.fingerprint
      });
    });
  });
}

export async function recognizeFromAcoustID(filePath: string): Promise<ACRCloudMetadata | null> {
  const clientId = process.env.ACOUSTID_API_KEY;
  if (!clientId) {
    log.warn('Missing AcoustID credentials (ACOUSTID_API_KEY). Skipping AcoustID lookup.');
    return null;
  }

  try {
    log.info('Generating audio fingerprint via AcoustID...');
    const { duration, fingerprint } = await getFingerprint(filePath);
    
    log.info('Looking up fingerprint on AcoustID API...');
    
    const params = new URLSearchParams();
    params.append('client', clientId);
    params.append('meta', 'recordings releasegroups compress');
    params.append('duration', String(duration));
    params.append('fingerprint', fingerprint);

    const response = await axios.post('https://api.acoustid.org/v2/lookup', params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    const data = response.data;
    
    if (data.status === 'ok' && data.results && data.results.length > 0) {
      const bestResult = data.results[0];
      if (bestResult.recordings && bestResult.recordings.length > 0) {
        // Find a recording that has artists and a title
        const recording = bestResult.recordings.find((r: any) => r.artists && r.title) || bestResult.recordings[0];
        
        const artist = recording.artists?.[0]?.name || 'Unknown Artist';
        const title = recording.title || 'Unknown Title';
        
        let album = '';
        if (recording.releasegroups && recording.releasegroups.length > 0) {
          album = recording.releasegroups[0].title || '';
        }
        
        return { artist, title, album };
      }
    }
    
    log.warn('AcoustID returned no matching recordings.');
    return null;
  } catch (err: any) {
    if (err.message && err.message.includes('ENOENT')) {
      log.warn('fpcalc.exe not found in /bin. Could not generate AcoustID fingerprint.');
    } else {
      const responseData = err.response?.data ? JSON.stringify(err.response.data) : 'No response body';
      if (err.response?.data?.error?.message === 'invalid API key') {
        log.error('AcoustID rejected ACOUSTID_API_KEY. Create a valid application key at https://acoustid.org/new-application and update your environment.');
      }
      log.error(`AcoustID recognition failed: ${err.message} | Response: ${responseData}`);
    }
    return null;
  }
}
