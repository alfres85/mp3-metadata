import recursive from 'recursive-readdir';

export async function scanForMp3(target: string): Promise<string[]> {
  const files = await recursive(target);
  return files.filter(f => f.toLowerCase().endsWith('.mp3'));
}
