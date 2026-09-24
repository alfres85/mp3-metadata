import { searchReleases, findReleaseIdByTrack } from './musicbrainz.js';
import { fetchCover } from './coverArtArchive.js';
import { searchDuckDuckGoImage } from './duckduckgo.js';
import { fetchiTunesCover } from './itunes.js';
import { fetchLastFmCover, fetchLastFmCoverByTrack } from './lastfm.js';
import { saveImageToCache } from '../scanner/cacheManager.js';
import { log } from '../utils/logger.js';

export async function resolveCover(
  artist: string,
  album: string,
  options?: {
    title?: string;
    useOpenAICover?: boolean;
    openaiKey?: string;
  },
) {
  let resolvedAlbumName: string | null = null;

  if (options?.useOpenAICover) {
    const metaStr = [options.title, artist].filter(Boolean).join(' - ');
    log.info(`OpenAI Cover Mode: Resolving album name & cover art for "${metaStr}"...`);
    const { fetchAlbumAndCoverWithOpenAI } = await import('../metadata/openai.js');
    const result = await fetchAlbumAndCoverWithOpenAI(
      artist,
      options.title || '',
      options.openaiKey,
    );

    resolvedAlbumName = result.album;

    if (result.coverBuffer) {
      return { coverPath: saveImageToCache(result.coverBuffer), resolvedAlbum: resolvedAlbumName };
    }

    if (resolvedAlbumName) {
      log.warn(
        `OpenAI direct cover download failed. Retrying cover search via existing services using OpenAI album: "${resolvedAlbumName}"...`,
      );
    } else {
      log.warn(
        `OpenAI cover search returned no valid image. Falling back to standard cover pipeline...`,
      );
    }
  }

  const targetAlbum = resolvedAlbumName || album;
  const targetTitle = options?.title;

  // 1. iTunes – album first, then artist + title or title.
  if (targetTitle) {
    log.info(`Searching iTunes for: ${artist ? `${artist} - ` : ''}${targetAlbum || targetTitle}...`);
    const itunesCover = await fetchiTunesCover(artist || null, targetTitle, targetAlbum);
    if (itunesCover) {
      log.success('Found official album cover on iTunes!');
      return { coverPath: saveImageToCache(itunesCover), resolvedAlbum: resolvedAlbumName };
    }
  }

  // 2. Last.fm (optional – only active if LASTFM_API_KEY is set)
  if (process.env.LASTFM_API_KEY) {
    if (artist && targetTitle) {
      const { album: lfmAlbum, cover: lfmCover } = await fetchLastFmCoverByTrack(
        artist,
        targetTitle,
      );
      if (lfmCover) {
        if (lfmAlbum && !resolvedAlbumName) resolvedAlbumName = lfmAlbum;
        return { coverPath: saveImageToCache(lfmCover), resolvedAlbum: resolvedAlbumName };
      }
    }

    if (artist && (resolvedAlbumName || targetAlbum)) {
      const lfmCover = await fetchLastFmCover(artist, resolvedAlbumName || targetAlbum);
      if (lfmCover) {
        return { coverPath: saveImageToCache(lfmCover), resolvedAlbum: resolvedAlbumName };
      }
    }
  }

  // 4. MusicBrainz/CoverArtArchive – by album name
  if (targetAlbum || artist) {
    log.info(`Searching MusicBrainz for release cover: ${artist} - ${targetAlbum}...`);
    const releases = await searchReleases(artist, targetAlbum);
    for (const release of releases) {
      if (release?.id) {
        const mbCover = await fetchCover(release.id);
        if (mbCover && mbCover.length > 5000) {
          log.success('Found official cover on MusicBrainz / CoverArtArchive!');
          return { coverPath: saveImageToCache(mbCover), resolvedAlbum: resolvedAlbumName };
        }
      }
    }
  }

  // 5. MusicBrainz/CoverArtArchive – by track title (finds album MBID from recording)
  if (artist && targetTitle) {
    log.info(`Searching MusicBrainz for release via track: ${artist} - ${targetTitle}...`);
    const releaseId = await findReleaseIdByTrack(artist, targetTitle);
    if (releaseId) {
      const mbCover = await fetchCover(releaseId);
      if (mbCover && mbCover.length > 5000) {
        log.success('Found cover on CoverArtArchive via track-based release lookup!');
        return { coverPath: saveImageToCache(mbCover), resolvedAlbum: resolvedAlbumName };
      }
    }
  }

  // 6. DuckDuckGo Image search – last resort
  log.info(`Searching DuckDuckGo Images for: ${artist} ${targetAlbum || targetTitle}...`);
  const fallback = await searchDuckDuckGoImage(`${artist} ${targetAlbum || targetTitle}`);
  if (fallback) {
    log.success('Found album cover on DuckDuckGo Images!');
    return { coverPath: saveImageToCache(fallback), resolvedAlbum: resolvedAlbumName };
  }

  return { coverPath: null, resolvedAlbum: resolvedAlbumName };
}
