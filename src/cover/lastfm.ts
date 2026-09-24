import { requestWithRetry } from '../utils/http.js';
import { log } from '../utils/logger.js';

const LASTFM_API_KEY = process.env.LASTFM_API_KEY;

/**
 * Download an image from a URL and return as Buffer.
 */
async function downloadImage(imgUrl: string): Promise<Buffer | null> {
  try {
    const imgRes = await requestWithRetry<Buffer>({
      url: imgUrl,
      responseType: 'arraybuffer',
      timeout: 10000,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });
    if (imgRes.data && imgRes.data.length > 5000) {
      return Buffer.from(imgRes.data);
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Fetch album cover from Last.fm API.
 * Only used when LASTFM_API_KEY environment variable is set.
 */
export async function fetchLastFmCover(
  artist: string,
  album: string,
): Promise<Buffer | null> {
  if (!artist || !album || !LASTFM_API_KEY) return null;

  try {
    log.info(`Searching Last.fm API for cover: "${artist} - ${album}"...`);
    const url = new URL('https://ws.audioscrobbler.com/2.0/');
    url.searchParams.set('method', 'album.getinfo');
    url.searchParams.set('api_key', LASTFM_API_KEY);
    url.searchParams.set('artist', artist);
    url.searchParams.set('album', album);
    url.searchParams.set('format', 'json');
    url.searchParams.set('autocorrect', '1');

    const { data } = await requestWithRetry<any>({ url: url.toString(), timeout: 8000 });
    const images: { '#text': string; size: string }[] = data?.album?.image || [];

    for (const size of ['extralarge', 'large', 'medium']) {
      const img = images.find((i) => i.size === size);
      const imgUrl = img?.['#text'];
      if (!imgUrl || imgUrl.trim() === '' || imgUrl.includes('/noimage/')) continue;

      const buf = await downloadImage(imgUrl);
      if (buf) {
        log.success(`Found album cover on Last.fm API (${size})!`);
        return buf;
      }
    }
  } catch (err: any) {
    log.warn(`Last.fm API cover search failed: ${err.message || String(err)}`);
  }

  return null;
}

/**
 * Search Last.fm for a track and get its album name + cover.
 * Only used when LASTFM_API_KEY environment variable is set.
 */
export async function fetchLastFmCoverByTrack(
  artist: string,
  title: string,
): Promise<{ album: string | null; cover: Buffer | null }> {
  if (!artist || !title || !LASTFM_API_KEY) return { album: null, cover: null };

  try {
    log.info(`Searching Last.fm track info for: "${artist} - ${title}"...`);
    const url = new URL('https://ws.audioscrobbler.com/2.0/');
    url.searchParams.set('method', 'track.getInfo');
    url.searchParams.set('api_key', LASTFM_API_KEY);
    url.searchParams.set('artist', artist);
    url.searchParams.set('track', title);
    url.searchParams.set('format', 'json');
    url.searchParams.set('autocorrect', '1');

    const { data } = await requestWithRetry<any>({ url: url.toString(), timeout: 8000 });

    const albumName: string | null = data?.track?.album?.title || null;
    const images: { '#text': string; size: string }[] = data?.track?.album?.image || [];

    let cover: Buffer | null = null;
    for (const size of ['extralarge', 'large', 'medium']) {
      const img = images.find((i) => i.size === size);
      const imgUrl = img?.['#text'];
      if (!imgUrl || imgUrl.trim() === '' || imgUrl.includes('/noimage/')) continue;

      cover = await downloadImage(imgUrl);
      if (cover) {
        log.success(`Found cover via Last.fm track info (${size})!`);
        break;
      }
    }

    // If we know the album name but didn't get a cover from track info, try album lookup
    if (!cover && albumName) {
      cover = await fetchLastFmCover(artist, albumName);
    }

    return { album: albumName, cover };
  } catch (err: any) {
    log.warn(`Last.fm track info search failed: ${err.message || String(err)}`);
  }

  return { album: null, cover: null };
}
