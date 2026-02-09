import { requestWithRetry } from '../utils/http.js';
import { SOURCES } from '../../config/sources.js';

export async function searchiTunesMetadata(artist: string | null, title: string) {
  const query = artist ? `${artist} ${title}` : title;
  const url = `${SOURCES.itunes}?term=${encodeURIComponent(query)}&media=music&entity=song&limit=1`;

  try {
    const { data } = await requestWithRetry<any>({ url });
    const result = data?.results?.[0];

    if (!result) return null;

    return {
      title: result.trackName,
      artist: result.artistName,
      album: result.collectionName || null,
    };
  } catch {
    return null;
  }
}

export async function fetchiTunesCover(artist: string, album: string): Promise<Buffer | null> {
  const query = `${artist} ${album}`;
  const url = `${SOURCES.itunes}?term=${encodeURIComponent(
    query
  )}&media=music&entity=album&limit=1`;

  try {
    const { data } = await requestWithRetry<any>({ url });
    const result = data?.results?.[0];

    if (!result?.artworkUrl100) return null;

    // Get higher resolution artwork (600x600 instead of 100x100)
    const artworkUrl = result.artworkUrl100.replace('100x100bb', '600x600bb');
    const { data: imgData } = await requestWithRetry<Buffer>({
      url: artworkUrl,
      responseType: 'arraybuffer',
    });

    return Buffer.from(imgData);
  } catch {
    return null;
  }
}
