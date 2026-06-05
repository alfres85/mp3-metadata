import { scanForMp3 } from './src/scanner/fileScanner.js';
import { readTag } from './src/metadata/id3Reader.js';
import { writeCover, writeTags } from './src/metadata/id3Writer.js';
import { resolveCover } from './src/cover/resolver.js';
import { log } from './src/utils/logger.js';
import { parseFilename } from './src/utils/filenameParser.js';
import { searchRecording } from './src/cover/musicbrainz.js';
import { recognizeFromAudio } from './src/metadata/acrcloud.js';
import fs from 'fs';
import path from 'node:path';
import process from 'node:process';
import PQueue from 'p-queue';

function applyRename(
  file: string,
  artist: string,
  title: string,
  processedFiles: Set<string>,
): string {
  const dir = path.dirname(file);
  const ext = path.extname(file);
  // Clean filename from illegal characters
  const cleanArtist = artist.replace(/[\\/<>:"|?*]/g, '');
  const cleanTitle = title.replace(/[\\/<>:"|?*]/g, '');
  const baseName = `${cleanTitle} - ${cleanArtist}`;

  let newName = `${baseName}${ext}`;
  let newPath = path.join(dir, newName);
  let counter = 1;

  // Handle collision by adding (1), (2), etc.
  while (fs.existsSync(newPath) && file !== newPath) {
    newName = `${baseName} (${counter})${ext}`;
    newPath = path.join(dir, newName);
    counter++;
  }

  if (file !== newPath) {
    try {
      fs.renameSync(file, newPath);
      log.info(`Renamed: ${path.basename(file)} -> ${newName}`);
      processedFiles.add(newPath);
      return newPath;
    } catch (err) {
      log.error(`Failed to rename ${file}: ${String(err)}`);
    }
  }
  return file;
}

function hasNumberedDuplicateSuffix(file: string): boolean {
  const baseName = path.basename(file, path.extname(file));
  return /\s\(\d+\)$/.test(baseName);
}

function moveDuplicateToFolder(file: string, target: string): string | null {
  const dupDir = path.join(target, 'duplicates');
  if (!fs.existsSync(dupDir)) {
    fs.mkdirSync(dupDir, { recursive: true });
  }

  const baseName = path.basename(file, path.extname(file));
  const ext = path.extname(file);
  let targetPath = path.join(dupDir, `${baseName}${ext}`);
  let counter = 1;

  while (fs.existsSync(targetPath)) {
    targetPath = path.join(dupDir, `${baseName} (${counter})${ext}`);
    counter++;
  }

  try {
    fs.renameSync(file, targetPath);
    return targetPath;
  } catch (err) {
    log.error(`Failed to move duplicate: ${file}`);
    return null;
  }
}

async function run(
  processedFiles: Set<string>,
  seenTracks: Map<string, string>,
  target: string,
  useRecognition: boolean,
  force: boolean,
  rename: boolean,
  dedupStandaloneLog: boolean,
  dedupStandaloneDelete: boolean,
  dedupStandaloneMove: boolean,
  concurrency: number,
) {
  log.info(`Scanning: ${target}`);
  const files = await scanForMp3(target);
  log.info(`Found ${files.length} MP3 files`);

  const queue = new PQueue({ concurrency });

  const tasks = files.map((file, i) => async () => {
    if (processedFiles.has(file)) return;

    const checkDuplicate = (artist: string, title: string) => {
      if (!(dedupStandaloneLog || dedupStandaloneDelete || dedupStandaloneMove)) return false;
      const trackKey = `${artist.toLowerCase()} - ${title.toLowerCase()}`;
      const keptFile = seenTracks.get(trackKey);
      if (keptFile) {
        if (dedupStandaloneDelete) {
          log.warn(`Duplicate detected and deleted: ${file} (${artist} - ${title})`);
          fs.appendFileSync('duplicates.txt', `DELETED: ${file} (${artist} - ${title})\n`);
          try {
            fs.unlinkSync(file);
          } catch (err) {
            log.error(`Failed to delete duplicate: ${file}`);
          }
        } else if (dedupStandaloneMove) {
          if (hasNumberedDuplicateSuffix(keptFile) && !hasNumberedDuplicateSuffix(file)) {
            log.warn(`Duplicate detected; keeping clean filename in main folder: ${file} (${artist} - ${title})`);
            const targetPath = moveDuplicateToFolder(keptFile, target);
            if (targetPath) {
              fs.appendFileSync('duplicates.txt', `MOVED: ${keptFile} -> ${targetPath} (kept ${file})\n`);
              processedFiles.add(keptFile);
              seenTracks.set(trackKey, file);
            }
            return false;
          }

          log.warn(`Duplicate detected and moved: ${file} (${artist} - ${title})`);
          const targetPath = moveDuplicateToFolder(file, target);
          if (targetPath) {
            fs.appendFileSync('duplicates.txt', `MOVED: ${file} -> ${targetPath}\n`);
          }
        } else {
          log.warn(`Duplicate detected: ${file} (${artist} - ${title})`);
          fs.appendFileSync('duplicates.txt', `LOGGED: ${file} (${artist} - ${title})\n`);
        }
        processedFiles.add(file);
        return true;
      }
      seenTracks.set(trackKey, file);
      return false;
    };

    let tag = readTag(file);

    if (tag.artist && tag.title) {
      if (checkDuplicate(tag.artist, tag.title)) return;
    }

    if (dedupStandaloneLog || dedupStandaloneDelete || dedupStandaloneMove) {
      processedFiles.add(file);
      return;
    }

    if (!force && !useRecognition && tag.image && tag.artist && tag.album) {
      log.info(`(${i + 1}/${files.length}) Skipping: ${file} (Metadata and cover already exist)`);
      if (rename && tag.artist && tag.title) {
        applyRename(file, tag.artist, tag.title, processedFiles);
      }
      processedFiles.add(file);
      return;
    }

    log.info(`(${i + 1}/${files.length}) Processing: ${file}`);

    if (!tag.artist || !tag.title || useRecognition) {
      let webMetadata = null;

      if (useRecognition) {
        log.info('Attempting audio recognition via ACRCloud...');
        webMetadata = await recognizeFromAudio(file);
        
        if (!webMetadata) {
          log.warn('ACRCloud failed or reached limit. Falling back to AcoustID...');
          const { recognizeFromAcoustID } = await import('./src/metadata/acoustid.js');
          webMetadata = await recognizeFromAcoustID(file);
        }
      }

      if (!webMetadata && !tag.artist) {
        log.info('Missing metadata, attempting to fetch from filename');
        const parsed = parseFilename(file);
        if (parsed.title) {
          log.info(
            `Searching MusicBrainz for: ${parsed.artist ? parsed.artist + ' - ' : ''}${parsed.title}`,
          );
          webMetadata = await searchRecording(parsed.artist, parsed.title);

          if (!webMetadata) {
            log.info('MusicBrainz search failed, trying iTunes fallback...');
            const { searchiTunesMetadata } = await import('./src/cover/itunes.js');
            webMetadata = await searchiTunesMetadata(parsed.artist, parsed.title);
          }
        }
      }

      if (webMetadata) {
        log.success(
          `Found metadata: ${webMetadata.artist} - ${webMetadata.title} (${webMetadata.album})`,
        );
        writeTags(file, {
          artist: webMetadata.artist,
          album: webMetadata.album || undefined,
          title: webMetadata.title,
        });
        // Re-read tags after writing
        tag = readTag(file);
        if (tag.artist && tag.title) {
          if (checkDuplicate(tag.artist, tag.title)) return;
        }
      } else if (useRecognition) {
        log.warn('Audio recognition failed');
      }
    }

    if (!tag.artist || !tag.album) {
      log.warn('Still missing metadata, skipping cover search');
      if (rename && tag.artist && tag.title) {
        applyRename(file, tag.artist, tag.title, processedFiles);
      }
      processedFiles.add(file);
      return;
    }

    if (!force && tag.image) {
      log.info('Cover already exists, skipping cover search');
      if (rename && tag.artist && tag.title) {
        applyRename(file, tag.artist, tag.title, processedFiles);
      }
      processedFiles.add(file);
      return;
    }

    const coverPath = await resolveCover(tag.artist, tag.album);
    if (!coverPath) {
      log.warn('No cover found');
      if (rename && tag.artist && tag.title) {
        applyRename(file, tag.artist, tag.title, processedFiles);
      }
      processedFiles.add(file);
      return;
    }

    const img = fs.readFileSync(coverPath);
    writeCover(file, img);

    log.success('Cover embedded');
    if (rename && tag.artist && tag.title) {
      applyRename(file, tag.artist, tag.title, processedFiles);
    }
    processedFiles.add(file);
  });

  await queue.addAll(tasks);
}

async function main() {
  const args = process.argv.slice(2);
  const useRecognition = args.includes('--recognize') || args.includes('-recognize');
  const force = args.includes('--force') || args.includes('-force');
  const rename = args.includes('--rename') || args.includes('-rename');
  const dedupStandaloneLog = args.includes('--dedup-standalone-log') || args.includes('-dedup-standalone-log');
  const dedupStandaloneDelete = args.includes('--dedup-standalone-delete') || args.includes('-dedup-standalone-delete');
  const dedupStandaloneMove = args.includes('--dedup-standalone-move') || args.includes('-dedup-standalone-move');

  let concurrency = 3;
  const concurrencyIndex = args.indexOf('--concurrency');
  if (concurrencyIndex !== -1 && args[concurrencyIndex + 1]) {
    concurrency = parseInt(args[concurrencyIndex + 1], 10);
  }

  const target = args.find((arg: string) => !arg.startsWith('-') && arg !== args[concurrencyIndex + 1]) || './music';

  const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
  const processedFiles = new Set<string>();
  const seenTracks = new Map<string, string>();

  if (dedupStandaloneLog || dedupStandaloneDelete || dedupStandaloneMove) {
    fs.appendFileSync('duplicates.txt', `\n--- Duplicate Scan Started at ${new Date().toISOString()} ---\n`);
  }

  if (useRecognition) {
    log.info('Running in recognition mode using ACRCloud');
  }
  if (force) {
    log.info('Force mode enabled: re-processing all files');
  }
  if (rename) {
    log.info('Rename mode enabled: files will be renamed to "Title - Artist"');
  }
  if (dedupStandaloneDelete) {
    log.info('Standalone dedup enabled: duplicates will be logged to duplicates.txt and DELETED');
  } else if (dedupStandaloneMove) {
    log.info('Standalone dedup enabled: duplicates will be moved to duplicates/ folder');
  } else if (dedupStandaloneLog) {
    log.info('Standalone dedup enabled: duplicates will be logged to duplicates.txt and skipped');
  }

  while (true) {
    try {
      await run(
        processedFiles,
        seenTracks,
        target,
        useRecognition,
        force,
        rename,
        dedupStandaloneLog,
        dedupStandaloneDelete,
        dedupStandaloneMove,
        concurrency,
      );
      break; // Exit loop if run() completes successfully
    } catch (err) {
      log.error(`Fatal error: ${String(err)}`);
      log.info(`Restarting process in 5 minutes...`);
      await new Promise((resolve) => setTimeout(resolve, COOLDOWN_MS));
    }
  }
}

main().catch((err) => log.error(String(err)));
