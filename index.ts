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

async function run(
  processedFiles: Set<string>,
  target: string,
  useRecognition: boolean,
  force: boolean,
  rename: boolean,
) {
  log.info(`Scanning: ${target}`);
  const files = await scanForMp3(target);
  log.info(`Found ${files.length} MP3 files`);

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (processedFiles.has(file)) continue;

    let tag = readTag(file);

    if (!force && !useRecognition && tag.image && tag.artist && tag.album) {
      log.info(`(${i + 1}/${files.length}) Skipping: ${file} (Metadata and cover already exist)`);
      if (rename && tag.artist && tag.title) {
        applyRename(file, tag.artist, tag.title, processedFiles);
      }
      processedFiles.add(file);
      continue;
    }

    log.info(`(${i + 1}/${files.length}) Processing: ${file}`);

    if (!tag.artist || !tag.title || useRecognition) {
      let webMetadata = null;

      if (useRecognition) {
        log.info('Attempting audio recognition via ACRCloud...');
        webMetadata = await recognizeFromAudio(file);
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
      continue;
    }

    if (!force && tag.image) {
      log.info('Cover already exists, skipping cover search');
      if (rename && tag.artist && tag.title) {
        applyRename(file, tag.artist, tag.title, processedFiles);
      }
      processedFiles.add(file);
      continue;
    }

    const coverPath = await resolveCover(tag.artist, tag.album);
    if (!coverPath) {
      log.warn('No cover found');
      if (rename && tag.artist && tag.title) {
        applyRename(file, tag.artist, tag.title, processedFiles);
      }
      processedFiles.add(file);
      continue;
    }

    const img = fs.readFileSync(coverPath);
    writeCover(file, img);

    log.success('Cover embedded');
    if (rename && tag.artist && tag.title) {
      applyRename(file, tag.artist, tag.title, processedFiles);
    }
    processedFiles.add(file);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const useRecognition = args.includes('--recognize') || args.includes('-recognize');
  const force = args.includes('--force') || args.includes('-force');
  const rename = args.includes('--rename') || args.includes('-rename');
  const target = args.find((arg: string) => !arg.startsWith('-')) || './music';

  const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
  const processedFiles = new Set<string>();

  if (useRecognition) {
    log.info('Running in recognition mode using ACRCloud');
  }
  if (force) {
    log.info('Force mode enabled: re-processing all files');
  }
  if (rename) {
    log.info('Rename mode enabled: files will be renamed to "Title - Artist"');
  }

  while (true) {
    try {
      await run(processedFiles, target, useRecognition, force, rename);
      break; // Exit loop if run() completes successfully
    } catch (err) {
      log.error(`Fatal error: ${String(err)}`);
      log.info(`Restarting process in 5 minutes...`);
      await new Promise((resolve) => setTimeout(resolve, COOLDOWN_MS));
    }
  }
}

main().catch((err) => log.error(String(err)));
