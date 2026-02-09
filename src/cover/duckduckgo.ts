import { requestWithRetry } from '../utils/http.js';

export async function searchDuckDuckGoImage(query: string): Promise<Buffer | null> {
  try {
    const params = new URLSearchParams({ q: `${query} album cover`, iax: 'images', ia: 'images' });
    const { data: html } = await requestWithRetry<string>({
      url: `https://duckduckgo.com/?${params}`,
    });
    const token = html.match(/vqd='(\d+-\d+-\d+)'/)?.[1];
    if (!token) return null;

    const imageQuery = `https://duckduckgo.com/i.js?${new URLSearchParams({
      q: `${query} album cover`,
      vqd: token,
    })}`;
    const result = await requestWithRetry<any>({ url: imageQuery });

    const imgUrl = result.data?.results?.[0]?.image;
    if (!imgUrl) return null;

    const img = await requestWithRetry<Buffer>({ url: imgUrl, responseType: 'arraybuffer' });
    return Buffer.from(img.data);
  } catch {
    return null;
  }
}
