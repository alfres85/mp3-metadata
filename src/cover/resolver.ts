import { searchRelease } from './musicbrainz.js';
import { fetchCover } from './coverArtArchive.js';
import { searchDuckDuckGoImage } from './duckduckgo.js';
import { fetchiTunesCover } from './itunes.js';
import { saveImageToCache } from '../scanner/cacheManager.js';
import { log } from '../utils/logger.js';

export async function resolveCover(artist: string, album: string) {
  const release = await searchRelease(artist, album);

  if (release?.id) {
    const mbCover = await fetchCover(release.id);
    if (mbCover) return saveImageToCache(mbCover);
  }

  log.info(`MusicBrainz cover not found, trying iTunes fallback for ${artist} - ${album}...`);
  const itunesCover = await fetchiTunesCover(artist, album);
  if (itunesCover) {
    log.success('Found cover on iTunes');
    return saveImageToCache(itunesCover);
  }

  const fallback = await searchDuckDuckGoImage(`${artist} ${album}`);
  return fallback ? saveImageToCache(fallback) : null;
}
