import { requestWithRetry } from '../utils/http.js';

export async function searchDuckDuckGoImage(query: string): Promise<Buffer | null> {
  try {
    const params = new URLSearchParams({ q: `${query} album cover`, iax: 'images', ia: 'images' });
    const { data: html } = await requestWithRetry<string>({
      url: `https://duckduckgo.com/?${params}`,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });
    const token = html.match(/vqd='(\d+-\d+-\d+)'/)?.[1] || html.match(/vqd="(\d+-\d+-\d+)"/)?.[1];
    if (!token) return null;

    const imageQuery = `https://duckduckgo.com/i.js?${new URLSearchParams({
      q: `${query} album cover`,
      vqd: token,
    })}`;
    const result = await requestWithRetry<any>({
      url: imageQuery,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    const results = result.data?.results || [];

    // Try top 5 candidates
    for (const item of results.slice(0, 5)) {
      const imgUrl = item?.image || item?.thumbnail;
      if (!imgUrl) continue;

      try {
        const img = await requestWithRetry<Buffer>({
          url: imgUrl,
          responseType: 'arraybuffer',
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          },
          timeout: 8000,
        });
        if (img.data && img.data.length > 5000) {
          return Buffer.from(img.data);
        }
      } catch {
        // try next candidate
      }
    }
  } catch {
    return null;
  }
  return null;
}
