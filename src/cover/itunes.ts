import { requestWithRetry } from '../utils/http.js';
import { SOURCES } from '../../config/sources.js';
import { log } from '../utils/logger.js';
import type { iTunesMetadata } from '../metadata/itunes.js';

type SearchEntity = 'song' | 'album';

interface iTunesResult {
  trackName?: string;
  artistName?: string;
  collectionName?: string;
  artworkUrl100?: string;
  artworkUrl60?: string;
}

interface iTunesSearchResponse {
  results?: iTunesResult[];
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function matches(value: string | undefined, searchTerm: string): boolean {
  return Boolean(value && normalize(value).includes(normalize(searchTerm)));
}

function hasArtwork(result: iTunesResult): boolean {
  return Boolean(result.artworkUrl100 || result.artworkUrl60);
}

function isCleanTrack(result: iTunesResult): boolean {
  return !result.trackName?.match(/\b(live|remix|remaster|acoustic|version)\b/i);
}

async function searchiTunes(
  query: string,
  entity: SearchEntity,
  limit = 10,
  country?: string,
): Promise<iTunesResult[]> {
  const selectedCountry = (country || process.env.ITUNES_COUNTRY || 'US').trim().toUpperCase();
  const params = new URLSearchParams({
    term: query,
    country: selectedCountry,
    media: 'music',
    entity,
    limit: String(limit),
  });

  try {
    const { data } = await requestWithRetry<iTunesSearchResponse>({
      url: `${SOURCES.itunes}?${params.toString()}`,
    });
    return data.results || [];
  } catch {
    return [];
  }
}

function findMetadataResult(
  results: iTunesResult[],
  title: string,
  artist: string | null,
): iTunesResult | undefined {
  return results.find(
    (result) =>
      result.trackName &&
      result.artistName &&
      isCleanTrack(result) &&
      matches(result.trackName, title) &&
      (!artist || matches(result.artistName, artist)),
  );
}

function toMetadata(result: iTunesResult): iTunesMetadata {
  return {
    title: result.trackName!,
    artist: result.artistName!,
    album: result.collectionName || null,
    artwork: result.artworkUrl100 || result.artworkUrl60,
  };
}

export async function searchiTunesMetadata(
  artist: string | null,
  title: string,
  country?: string,
): Promise<iTunesMetadata | null> {
  const queries = artist ? [`${artist} ${title}`, title] : [title];

  for (const query of queries) {
    const results = await searchiTunes(query, 'song', 10, country);
    const result = findMetadataResult(results, title, artist);
    if (result) return toMetadata(result);
  }

  return null;
}

/**
 * Download artwork from an iTunes artwork URL, upgrading to 600x600.
 */
async function downloadItunesArtwork(artworkUrl: string): Promise<Buffer | null> {
  const url600 = artworkUrl
    .replace('100x100bb', '600x600bb')
    .replace(/\/\d+x\d+bb\./, '/600x600bb.');
  const urls = url600 === artworkUrl ? [artworkUrl] : [url600, artworkUrl];

  for (const url of urls) {
    try {
      const response = await requestWithRetry<Buffer>({
        url,
        responseType: 'arraybuffer',
        timeout: 10000,
      });
      if (response.data && response.data.length > 5000) {
        return Buffer.from(response.data);
      }
    } catch {
      // ignore and try the next artwork URL
    }
  }

  return null;
}

function findAlbumCoverResult(results: iTunesResult[], album: string): iTunesResult | undefined {
  return results.find(
    (result) =>
      result.collectionName && hasArtwork(result) && matches(result.collectionName, album),
  );
}

function findTrackCoverResult(
  results: iTunesResult[],
  title: string,
  artist: string | null,
): iTunesResult | undefined {
  return results.find(
    (result) =>
      hasArtwork(result) &&
      result.trackName &&
      matches(result.trackName, title) &&
      (!artist || matches(result.artistName, artist)) &&
      isCleanTrack(result),
  );
}

async function downloadCover(result: iTunesResult | undefined): Promise<Buffer | null> {
  const artworkUrl = result?.artworkUrl100 || result?.artworkUrl60;
  return artworkUrl ? downloadItunesArtwork(artworkUrl) : null;
}

export async function fetchiTunesCover(
  artist: string | null,
  title: string,
  album: string | null,
  country?: string,
): Promise<Buffer | null> {
  const selectedCountry = (country || process.env.ITUNES_COUNTRY || 'US').trim().toUpperCase();
  const query = artist ? `${artist} ${title}` : title;
  log.info(`Trying iTunes song search (${selectedCountry}): "${query}"...`);
  const results = await searchiTunes(query, 'song', 25, selectedCountry);

  if (album) {
    const cover = await downloadCover(findAlbumCoverResult(results, album));
    if (cover) return cover;
  }

  return downloadCover(findTrackCoverResult(results, title, artist));
}
