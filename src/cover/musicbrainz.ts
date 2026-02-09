import { requestWithRetry } from '../utils/http.js';
import { SOURCES } from '../../config/sources.js';

export async function searchRelease(artist: string, album: string) {
  const url = `${SOURCES.musicBrainz}/release/?query=artist:${artist}%20AND%20release:${album}&fmt=json`;
  const { data } = await requestWithRetry<{ releases: any[] }>({ url });
  return data?.releases?.[0] || null;
}

export async function searchRecording(artist: string | null, title: string) {
  const queryStr = artist
    ? `artist:"${artist}" AND recording:"${title}"`
    : `recording:"${title}" OR "${title}"`;
  const query = encodeURIComponent(queryStr);
  const url = `${SOURCES.musicBrainz}/recording/?query=${query}&fmt=json`;
  const { data } = await requestWithRetry<any>({ url });
  const recording = data?.recordings?.[0];

  if (!recording) return null;

  return {
    title: recording.title,
    artist: recording['artist-credit']?.[0]?.name || artist || 'Unknown',
    album: recording.releases?.[0]?.title || null,
  };
}
