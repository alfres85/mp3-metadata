import { requestWithRetry } from '../utils/http.js';
import { SOURCES } from '../../config/sources.js';
import { log } from '../utils/logger.js';
import type { BaseMetadata } from '../metadata/base.js';

interface MusicBrainzRelease {
  id?: string;
  title?: string;
}

interface MusicBrainzRecording {
  title?: string;
  'artist-credit'?: Array<{ name?: string }>;
  releases?: MusicBrainzRelease[];
}

interface MusicBrainzSearchResponse {
  releases?: MusicBrainzRelease[];
  recordings?: MusicBrainzRecording[];
}

export async function searchReleases(
  artist: string,
  album: string,
): Promise<MusicBrainzRelease[]> {
  const queryStr = artist ? `artist:"${artist}" AND release:"${album}"` : `release:"${album}"`;
  const url = `${SOURCES.musicBrainz}/release/?query=${encodeURIComponent(queryStr)}&fmt=json`;
  try {
    const { data } = await requestWithRetry<MusicBrainzSearchResponse>({ url });
    return data?.releases?.slice(0, 10) || [];
  } catch {
    return [];
  }
}

export async function searchRelease(artist: string, album: string) {
  const releases = await searchReleases(artist, album);
  return releases[0] || null;
}

export async function searchRecording(
  artist: string | null,
  title: string,
): Promise<BaseMetadata | null> {
  const queryStr = artist
    ? `artist:"${artist}" AND recording:"${title}"`
    : `recording:"${title}" OR "${title}"`;
  const query = encodeURIComponent(queryStr);
  const url = `${SOURCES.musicBrainz}/recording/?query=${query}&fmt=json`;
  try {
    const { data } = await requestWithRetry<MusicBrainzSearchResponse>({ url });
    const recording = data.recordings?.[0];

    if (!recording?.title) return null;

    return {
      title: recording.title,
      artist: recording['artist-credit']?.[0]?.name || artist || 'Unknown',
      album: recording.releases?.[0]?.title || null,
    };
  } catch {
    return null;
  }
}

/**
 * Find a MusicBrainz release ID by artist + track title.
 * Useful when you don't have an album name but know the song.
 */
export async function findReleaseIdByTrack(
  artist: string,
  title: string,
): Promise<string | null> {
  try {
    const queryStr = `artist:"${artist}" AND recording:"${title}"`;
    const url = `${SOURCES.musicBrainz}/recording/?query=${encodeURIComponent(queryStr)}&fmt=json`;
    const { data } = await requestWithRetry<MusicBrainzSearchResponse>({ url });
    const recording = data.recordings?.[0];
    const releaseId = recording?.releases?.[0]?.id;
    if (releaseId) {
      log.info(`MusicBrainz found release ID for "${artist} - ${title}": ${releaseId}`);
    }
    return releaseId || null;
  } catch {
    return null;
  }
}
