import path from 'path';

export interface ParsedFilename {
  artist: string | null;
  title: string | null;
}

export function parseFilename(filePath: string): ParsedFilename {
  const fileName = path.basename(filePath, path.extname(filePath));

  // Clean up common suffixes and noise
  let cleanName = fileName
    .replace(/\(video oficial\)/gi, '')
    .replace(/\(LETRA\)/gi, '')
    .replace(/\[HD\]/gi, '')
    .replace(/\(128kbit_AAC\)/gi, '')
    .replace(/\(Official Video\)/gi, '')
    .replace(/\(LETRA\)/gi, '')
    .replace(/\[LETRA\]/gi, '')
    .replace(/\(Lyrics\)/gi, '')
    .replace(/\[Lyrics\]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Try to split by common artist-title splitters
  const splitters = [' - ', ' – ', ' — '];
  for (const splitter of splitters) {
    if (cleanName.includes(splitter)) {
      const parts = cleanName.split(splitter);
      if (parts.length >= 2) {
        return {
          artist: parts[0].trim(),
          title: parts[1].trim(),
        };
      }
    }
  }

  // Fallback: title is the entire cleaned filename
  return {
    artist: null,
    title: cleanName,
  };
}
