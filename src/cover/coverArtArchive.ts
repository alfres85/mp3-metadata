import { requestWithRetry } from '../utils/http.js';
import { SOURCES } from '../../config/sources.js';

export async function fetchCover(mbid: string): Promise<Buffer | null> {
  try {
    const url = `${SOURCES.coverArtArchive}/release/${mbid}/front`;
    const { data } = await requestWithRetry<Buffer>({ url, responseType: 'arraybuffer' });
    return Buffer.from(data);
  } catch {
    return null;
  }
}
