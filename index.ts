import { scanForMp3 } from './src/scanner/fileScanner.js';
import { readTag } from './src/metadata/id3Reader.js';
import { writeCover, writeTags } from './src/metadata/id3Writer.js';
import { resolveCover } from './src/cover/resolver.js';
import { log } from './src/utils/logger.js';
import { parseFilename } from './src/utils/filenameParser.js';
import { searchRecording } from './src/cover/musicbrainz.js';
import { recognizeFromAudio } from './src/metadata/acrcloud.js';
import {
  hasUsefulMetadataValue,
  isUsableMetadata,
} from './src/metadata/metadataValidation.js';
import fs from 'fs';
import path from 'node:path';
import process from 'node:process';
import { createInterface, type Interface } from 'node:readline/promises';
import PQueue from 'p-queue';

type CliOptions = {
  target: string;
  useRecognition: boolean;
  useOpenAIRecognition: boolean;
  openaiKey?: string;
  force: boolean;
  rename: boolean;
  dedupStandaloneLog: boolean;
  dedupStandaloneDelete: boolean;
  dedupStandaloneMove: boolean;
  concurrency: number;
};

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

function cleanConsolePath(value: string): string {
  return value.trim().replace(/^["']|["']$/g, '');
}

function isDirectory(value: string): boolean {
  try {
    return fs.statSync(value).isDirectory();
  } catch {
    return false;
  }
}

function getSuggestedFolders(): string[] {
  const ignored = new Set(['.git', 'node_modules', 'dist']);
  const folders = fs
    .readdirSync(process.cwd(), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !ignored.has(entry.name))
    .map((entry) => `./${entry.name}`)
    .sort((a, b) => a.localeCompare(b));

  const preferred = ['./process', './music'].filter((folder) => isDirectory(folder));
  return [...preferred, ...folders.filter((folder) => !preferred.includes(folder))];
}

async function askYesNo(
  rl: Interface,
  question: string,
  defaultValue = false,
): Promise<boolean> {
  const suffix = defaultValue ? 'Y/n' : 'y/N';
  const answer = (await rl.question(`${question} (${suffix}): `)).trim().toLowerCase();
  if (!answer) return defaultValue;
  return answer === 'y' || answer === 'yes';
}

async function askNumber(
  rl: Interface,
  question: string,
  defaultValue: number,
  min: number,
): Promise<number> {
  while (true) {
    const answer = (await rl.question(`${question} [${defaultValue}]: `)).trim();
    if (!answer) return defaultValue;

    const parsed = Number.parseInt(answer, 10);
    if (Number.isInteger(parsed) && parsed >= min) {
      return parsed;
    }

    console.log(`Please enter a number greater than or equal to ${min}.`);
  }
}

async function askTargetFolder(rl: Interface): Promise<string> {
  const folders = getSuggestedFolders();
  const defaultTarget = folders[0] || '.';

  while (true) {
    console.log('\nTarget folder:');
    folders.forEach((folder, index) => console.log(`  ${index + 1}. ${folder}`));
    console.log('  0. Type a custom path');

    const answer = (await rl.question(`Choose folder [${defaultTarget}]: `)).trim();
    let target = defaultTarget;

    if (answer === '0') {
      target = cleanConsolePath(await rl.question('Folder path: '));
    } else if (answer) {
      const selectedIndex = Number.parseInt(answer, 10);
      target = Number.isInteger(selectedIndex) && folders[selectedIndex - 1]
        ? folders[selectedIndex - 1]
        : cleanConsolePath(answer);
    }

    if (isDirectory(target)) return target;
    console.log(`Folder not found: ${target}`);
  }
}

async function getInteractiveOptions(): Promise<CliOptions> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    console.log('MP3 Auto Tag interactive setup');
    const target = await askTargetFolder(rl);

    console.log('\nAction:');
    console.log('  1. Process metadata and covers');
    console.log('  2. Recognize audio, metadata, and covers (Shazam / ACRCloud / AcoustID)');
    console.log('  3. Recognize audio via OpenAI Whisper (Transcribe Lyrics -> Web Search)');
    console.log('  4. Deduplicate: log only');
    console.log('  5. Deduplicate: move duplicates');
    console.log('  6. Deduplicate: delete duplicates');

    let action = '';
    while (!['1', '2', '3', '4', '5', '6'].includes(action)) {
      action = (await rl.question('Choose action [1]: ')).trim() || '1';
    }

    const useRecognition = action === '2';
    const useOpenAIRecognition = action === '3';
    let openaiKey: string | undefined = undefined;

    if (useOpenAIRecognition && !process.env.OPENAI_API_KEY) {
      openaiKey = (await rl.question('Enter OpenAI API Key (or press Enter if set in OPENAI_API_KEY env): ')).trim() || undefined;
    }

    const dedupStandaloneLog = action === '4';
    const dedupStandaloneMove = action === '5';
    let dedupStandaloneDelete = action === '6';

    if (dedupStandaloneDelete) {
      const confirmation = await rl.question('Type DELETE to confirm permanent duplicate deletion: ');
      dedupStandaloneDelete = confirmation === 'DELETE';
      if (!dedupStandaloneDelete) {
        console.log('Delete confirmation was not entered. Switching to duplicate log mode.');
      }
    }

    const isDedupOnly = dedupStandaloneLog || dedupStandaloneMove || dedupStandaloneDelete || action === '6';
    const force = !isDedupOnly && await askYesNo(rl, 'Force re-process files with existing covers');
    const rename = !isDedupOnly && await askYesNo(rl, 'Rename files to "Title - Artist"');
    const concurrency = await askNumber(rl, 'Concurrency', 3, 1);

    return {
      target,
      useRecognition,
      useOpenAIRecognition,
      openaiKey,
      force,
      rename,
      dedupStandaloneLog: dedupStandaloneLog || (action === '6' && !dedupStandaloneDelete),
      dedupStandaloneDelete,
      dedupStandaloneMove,
      concurrency,
    };
  } finally {
    rl.close();
  }
}

function parseCliOptionValue(
  args: string[],
  flags: string[],
  consumedIndices: Set<number>,
): string | undefined {
  for (const flag of flags) {
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg.startsWith(`${flag}=`)) {
        consumedIndices.add(i);
        return arg.slice(flag.length + 1);
      }
      if (arg === flag) {
        consumedIndices.add(i);
        if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
          consumedIndices.add(i + 1);
          return args[i + 1];
        }
      }
    }
  }
  return undefined;
}

async function getCliOptions(args: string[]): Promise<CliOptions> {
  const interactive = args.length === 0 || args.includes('--interactive') || args.includes('-interactive');
  const filteredArgs = args.filter((arg) => arg !== '--interactive' && arg !== '-interactive');

  if (interactive) {
    return getInteractiveOptions();
  }

  const consumedIndices = new Set<number>();

  const useRecognition = filteredArgs.some((arg, idx) => {
    if (arg === '--recognize' || arg === '-recognize') {
      consumedIndices.add(idx);
      return true;
    }
    return false;
  });

  const useOpenAIRecognition = filteredArgs.some((arg, idx) => {
    if (arg === '--openai-recon' || arg === '-openai-recon' || arg === '--use-openai') {
      consumedIndices.add(idx);
      return true;
    }
    return false;
  });

  const openaiKey = parseCliOptionValue(
    filteredArgs,
    ['--openai-key', '-openai-key', '--openaiKey', '--key', '-key', '-k'],
    consumedIndices,
  );

  const force = filteredArgs.some((arg, idx) => {
    if (arg === '--force' || arg === '-force') {
      consumedIndices.add(idx);
      return true;
    }
    return false;
  });

  const rename = filteredArgs.some((arg, idx) => {
    if (arg === '--rename' || arg === '-rename') {
      consumedIndices.add(idx);
      return true;
    }
    return false;
  });

  const dedupStandaloneLog = filteredArgs.some((arg, idx) => {
    if (arg === '--dedup-standalone-log' || arg === '-dedup-standalone-log') {
      consumedIndices.add(idx);
      return true;
    }
    return false;
  });

  const dedupStandaloneDelete = filteredArgs.some((arg, idx) => {
    if (arg === '--dedup-standalone-delete' || arg === '-dedup-standalone-delete') {
      consumedIndices.add(idx);
      return true;
    }
    return false;
  });

  const dedupStandaloneMove = filteredArgs.some((arg, idx) => {
    if (arg === '--dedup-standalone-move' || arg === '-dedup-standalone-move') {
      consumedIndices.add(idx);
      return true;
    }
    return false;
  });

  const rawConcurrency = parseCliOptionValue(
    filteredArgs,
    ['--concurrency', '-concurrency'],
    consumedIndices,
  );
  const concurrency = rawConcurrency ? parseInt(rawConcurrency, 10) : 3;

  const target =
    filteredArgs.find(
      (arg: string, index: number) => !arg.startsWith('-') && !consumedIndices.has(index),
    ) || './music';

  return {
    target,
    useRecognition,
    useOpenAIRecognition,
    openaiKey,
    force,
    rename,
    dedupStandaloneLog,
    dedupStandaloneDelete,
    dedupStandaloneMove,
    concurrency,
  };
}

async function run(
  processedFiles: Set<string>,
  seenTracks: Map<string, string>,
  unknownArtistFiles: Set<string>,
  target: string,
  useRecognition: boolean,
  useOpenAIRecognition: boolean,
  openaiKey: string | undefined,
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
            log.warn(
              `Duplicate detected; keeping clean filename in main folder: ${file} (${artist} - ${title})`,
            );
            const targetPath = moveDuplicateToFolder(keptFile, target);
            if (targetPath) {
              fs.appendFileSync(
                'duplicates.txt',
                `MOVED: ${keptFile} -> ${targetPath} (kept ${file})\n`,
              );
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
    if (!hasUsefulMetadataValue(tag.artist)) {
      tag.artist = '';
    }
    if (!hasUsefulMetadataValue(tag.title)) {
      tag.title = '';
    }

    if (tag.artist && tag.title) {
      if (checkDuplicate(tag.artist, tag.title)) return;
    }

    if (dedupStandaloneLog || dedupStandaloneDelete || dedupStandaloneMove) {
      processedFiles.add(file);
      return;
    }

    if (
      !force &&
      !useRecognition &&
      !useOpenAIRecognition &&
      tag.image &&
      tag.artist &&
      tag.album
    ) {
      log.info(`(${i + 1}/${files.length}) Skipping: ${file} (Metadata and cover already exist)`);
      if (rename && tag.artist && tag.title) {
        applyRename(file, tag.artist, tag.title, processedFiles);
      }
      processedFiles.add(file);
      return;
    }

    log.info(`(${i + 1}/${files.length}) Processing: ${file}`);

    if (!tag.artist || !tag.title || useRecognition || useOpenAIRecognition) {
      let webMetadata = null;

      if (useOpenAIRecognition) {
        log.info('Attempting audio recognition via OpenAI Whisper lyrics transcription...');
        const { recognizeFromOpenAI } = await import('./src/metadata/openai.js');
        webMetadata = await recognizeFromOpenAI(file, openaiKey);
      }

      if (!webMetadata && useRecognition) {
        log.info('Attempting audio recognition via Shazam...');
        const { recognizeFromShazam } = await import('./src/metadata/shazam.js');
        webMetadata = await recognizeFromShazam(file);

        if (!webMetadata) {
          log.warn('Shazam failed or returned no match. Falling back to ACRCloud...');
          const { recognizeFromAudio } = await import('./src/metadata/acrcloud.js');
          webMetadata = await recognizeFromAudio(file);
        }

        if (!webMetadata) {
          log.warn('ACRCloud failed or reached limit. Falling back to AcoustID...');
          const { recognizeFromAcoustID } = await import('./src/metadata/acoustid.js');
          webMetadata = await recognizeFromAcoustID(file);
        }
      }

      if (!webMetadata && !tag.artist) {
        log.info('Missing metadata, attempting to fetch from filename');
        const parsed = parseFilename(file);
        const parsedArtist = hasUsefulMetadataValue(parsed.artist || undefined)
          ? parsed.artist
          : null;
        const parsedTitle = hasUsefulMetadataValue(parsed.title || undefined) ? parsed.title : null;

        if (parsedTitle) {
          log.info(
            `Searching MusicBrainz for: ${parsedArtist ? parsedArtist + ' - ' : ''}${parsedTitle}`,
          );
          webMetadata = await searchRecording(parsedArtist, parsedTitle);

          if (!webMetadata) {
            log.info('MusicBrainz search failed, trying iTunes fallback...');
            const { searchiTunesMetadata } = await import('./src/cover/itunes.js');
            webMetadata = await searchiTunesMetadata(parsedArtist, parsedTitle);
          }
        } else {
          log.warn('Filename metadata is not usable, skipping filename lookup');
          unknownArtistFiles.add(file);
        }
      }

      if (webMetadata && !isUsableMetadata(webMetadata)) {
        log.warn('Resolved metadata is incomplete placeholder data, skipping tag write');
        webMetadata = null;
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
      unknownArtistFiles.add(file);
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
  const {
    target,
    useRecognition,
    useOpenAIRecognition,
    openaiKey,
    force,
    rename,
    dedupStandaloneLog,
    dedupStandaloneDelete,
    dedupStandaloneMove,
    concurrency,
  } = await getCliOptions(args);

  const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
  const processedFiles = new Set<string>();
  const seenTracks = new Map<string, string>();
  const unknownArtistFiles = new Set<string>();

  if (dedupStandaloneLog || dedupStandaloneDelete || dedupStandaloneMove) {
    fs.appendFileSync(
      'duplicates.txt',
      `\n--- Duplicate Scan Started at ${new Date().toISOString()} ---\n`,
    );
  }

  if (useOpenAIRecognition) {
    log.info(
      'Running in OpenAI recognition mode (Whisper audio transcription -> Web lyric search)',
    );
  }
  if (useRecognition) {
    log.info('Running in recognition mode using Shazam -> ACRCloud -> AcoustID');
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
      unknownArtistFiles.clear();
      await run(
        processedFiles,
        seenTracks,
        unknownArtistFiles,
        target,
        useRecognition,
        useOpenAIRecognition,
        openaiKey,
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

  // Log unknown artist/name files after processing completes
  if (unknownArtistFiles.size > 0) {
    console.log(`\n⚠️  ALERT: Found ${unknownArtistFiles.size} file(s) with unknown artist/name`);

    // Log to file
    fs.appendFileSync(
      'unknown_artist.txt',
      `\n--- Unknown Artist Files Scan at ${new Date().toISOString()} ---\n`,
    );
    unknownArtistFiles.forEach((file) => {
      fs.appendFileSync('unknown_artist.txt', `${file}\n`);
    });

    console.log(`Details logged to unknown_artist.txt`);
  } else {
    console.log(`\n✓ All files have artist/name metadata`);
  }
}

main().catch((err) => log.error(String(err)));
