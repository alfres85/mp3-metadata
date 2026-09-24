import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import axios from 'axios';
import { log } from '../utils/logger.js';
import type { ACRCloudMetadata } from './acrcloud.js';
import { isUsableMetadata } from './metadataValidation.js';
import { searchRecording } from '../cover/musicbrainz.js';
import { searchiTunesMetadata } from '../cover/itunes.js';
import { searchDuckDuckGoImage } from '../cover/duckduckgo.js';
import { requestWithRetry } from '../utils/http.js';

function createAudioSnippet(
  filePath: string,
  startOffsetSeconds = 60,
  durationSeconds = 40,
): string | null {
  const tempDir = os.tmpdir();
  const snippetPath = path.join(
    tempDir,
    `openai_whisper_${startOffsetSeconds}_${Date.now()}_${crypto.randomUUID()}.mp3`,
  );

  try {
    execFileSync(
      'ffmpeg',
      [
        '-y',
        '-ss',
        String(startOffsetSeconds),
        '-t',
        String(durationSeconds),
        '-i',
        filePath,
        '-map',
        '0:a:0',
        '-b:a',
        '128k',
        snippetPath,
      ],
      { stdio: 'ignore' },
    );

    if (fs.existsSync(snippetPath) && fs.statSync(snippetPath).size > 1024) {
      return snippetPath;
    }
  } catch (err) {
    log.warn(`Failed to create audio snippet at ${startOffsetSeconds}s: ${String(err)}`);
  }

  if (fs.existsSync(snippetPath)) {
    try {
      fs.unlinkSync(snippetPath);
    } catch {
      // ignore temp cleanup failures
    }
  }

  return null;
}

function parseArtistTitleFromSearchResult(
  rawTitle: string,
): { artist: string; title: string } | null {
  let clean = rawTitle
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();

  // Strip common website suffixes
  clean = clean
    .replace(
      /\s*[\-\|]\s*(Genius|AZLyrics|Musixmatch|Spotify|YouTube|Lyrics|Apple Music|Soundcharts|Songlyrics).*$/i,
      '',
    )
    .replace(/\s+lyrics$/i, '')
    .trim();

  // Pattern 1: "Title by Artist"
  const byMatch = clean.match(/^(.+?)\s+by\s+(.+?)(?:\s+lyrics)?$/i);
  if (byMatch && byMatch[1] && byMatch[2]) {
    return { title: byMatch[1].trim(), artist: byMatch[2].trim() };
  }

  // Pattern 2: "Artist - Title" or "Artist – Title" or "Artist: Title"
  const dashMatch = clean.match(/^(.+?)\s*[\-\–\:]\s*(.+?)$/);
  if (dashMatch && dashMatch[1] && dashMatch[2]) {
    const part1 = dashMatch[1].trim();
    const part2 = dashMatch[2].trim().replace(/\s+lyrics$/i, '');
    if (part1 && part2) {
      return { artist: part1, title: part2 };
    }
  }

  return null;
}

export async function searchWebForLyrics(
  lyrics: string,
): Promise<{ artist: string; title: string } | null> {
  try {
    const cleanQuery = lyrics
      .slice(0, 100)
      .replace(/[^\w\s\u00C0-\u024F]/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!cleanQuery) return null;

    log.info(`Searching web for song & artist matching lyrics: "${cleanQuery.slice(0, 50)}..."`);
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(`${cleanQuery} lyrics song`)}`;

    const { data: html } = await requestWithRetry<string>({
      url: searchUrl,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    const matches = Array.from(html.matchAll(/<a[^>]*class="result__a"[^>]*>(.*?)<\/a>/gi));
    for (const match of matches) {
      const parsed = parseArtistTitleFromSearchResult(match[1]);
      if (parsed && parsed.artist && parsed.title) {
        return parsed;
      }
    }
  } catch (err) {
    log.warn(`Web lyric search failed: ${String(err)}`);
  }
  return null;
}

export async function transcribeAudioSnippet(
  filePath: string,
  apiKey?: string,
): Promise<string | null> {
  const token = apiKey || process.env.OPENAI_API_KEY;
  if (!token) {
    log.warn('Missing OpenAI API Key (OPENAI_API_KEY). Skipping OpenAI transcription.');
    return null;
  }

  // Try offsets 60s, 90s, 30s, 0s
  for (const offset of [60, 90, 30, 0]) {
    const snippetPath = createAudioSnippet(filePath, offset, 40);
    if (!snippetPath) continue;

    try {
      log.info(`Transcribing audio snippet (offset ${offset}s) via OpenAI Whisper...`);
      const fileBuffer = fs.readFileSync(snippetPath);
      const blob = new Blob([fileBuffer], { type: 'audio/mp3' });

      const formData = new FormData();
      formData.append('file', blob, 'audio.mp3');
      formData.append('model', 'whisper-1');
      formData.append('prompt', 'Transcribe the music lyrics or singing in this song:');
      formData.append('temperature', '0');

      const response = await axios.post(
        'https://api.openai.com/v1/audio/transcriptions',
        formData,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'multipart/form-data',
          },
          timeout: 60000,
        },
      );

      const transcript = response.data?.text?.trim();
      if (transcript && transcript.length > 5) {
        log.info(`Transcribed lyrics/text: "${transcript}"`);
        return transcript;
      }
    } catch (err: any) {
      const errorMsg = err.response?.data?.error?.message || err.message;
      log.warn(`OpenAI Whisper transcription failed at ${offset}s: ${errorMsg}`);
    } finally {
      if (fs.existsSync(snippetPath)) {
        try {
          fs.unlinkSync(snippetPath);
        } catch {
          // ignore
        }
      }
    }
  }

  return null;
}

export async function identifySongWithOpenAI(
  transcript: string,
  apiKey?: string,
): Promise<{ artist: string; title: string } | null> {
  const token = apiKey || process.env.OPENAI_API_KEY;
  if (!token) return null;

  try {
    log.info(`Asking OpenAI Chat API to identify artist and title from lyrics...`);
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content:
              'You are a music identification expert. Given a transcribed snippet of song lyrics, identify the exact song title and artist name. Respond ONLY with JSON containing "artist" and "title" string properties. If you cannot identify the song, return {"artist": null, "title": null}.',
          },
          {
            role: 'user',
            content: `Song lyrics snippet: "${transcript}"`,
          },
        ],
        temperature: 0.1,
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      },
    );

    const content = response.data?.choices?.[0]?.message?.content?.trim();
    if (!content) return null;

    const cleaned = content
      .replace(/^```json\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();
    const parsed = JSON.parse(cleaned);

    if (parsed.artist && parsed.title) {
      return { artist: String(parsed.artist).trim(), title: String(parsed.title).trim() };
    }
  } catch (err: any) {
    const msg = err.response?.data?.error?.message || err.message;
    log.warn(`OpenAI Chat song identification failed: ${msg}`);
  }

  return null;
}

export async function searchAudDByLyrics(
  lyrics: string,
  apiKey?: string,
): Promise<{ artist: string; title: string } | null> {
  const token = apiKey || process.env.AUDD_API_KEY || 'test';
  try {
    const cleanQuery = lyrics.slice(0, 250).replace(/\s+/g, ' ').trim();
    if (!cleanQuery) return null;

    log.info(`Searching AudD for lyrics: "${cleanQuery.slice(0, 50)}..."`);
    const response = await axios.get('https://api.audd.io/findLyrics/', {
      params: {
        q: cleanQuery,
        api_token: token,
      },
      timeout: 10000,
    });

    if (
      response.data?.status === 'success' &&
      Array.isArray(response.data.result) &&
      response.data.result.length > 0
    ) {
      const match = response.data.result[0];
      if (match.artist && match.title) {
        log.info(`AudD match found: "${match.artist} - ${match.title}"`);
        return { artist: String(match.artist).trim(), title: String(match.title).trim() };
      }
    }
  } catch (err: any) {
    const errorMsg = err.response?.data?.error?.error_message || err.message;
    log.warn(`AudD lyrics search failed: ${errorMsg}`);
  }
  return null;
}

export async function searchLyricsOvh(
  lyrics: string,
): Promise<{ artist: string; title: string } | null> {
  try {
    const cleanQuery = lyrics
      .slice(0, 200)
      .replace(/[^\w\s\u00C0-\u024F]/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!cleanQuery) return null;

    log.info(`Searching lyrics.ovh suggest endpoint for: "${cleanQuery.slice(0, 200)}..."`);
    const response = await axios.get(
      `https://api.lyrics.ovh/suggest/${encodeURIComponent(cleanQuery)}`,
      {
        timeout: 8000,
      },
    );

    if (response.data?.data && Array.isArray(response.data.data) && response.data.data.length > 0) {
      const match = response.data.data[0];
      const artist = match.artist?.name;
      const title = match.title;
      if (artist && title) {
        log.info(`lyrics.ovh suggest match found: "${artist} - ${title}"`);
        return { artist: String(artist).trim(), title: String(title).trim() };
      }
    }
  } catch (err: any) {
    log.warn(`lyrics.ovh search failed: ${err.message}`);
  }
  return null;
}

export async function recognizeFromOpenAI(
  filePath: string,
  apiKey?: string,
  auddKey?: string,
): Promise<ACRCloudMetadata | null> {
  const transcript = await transcribeAudioSnippet(filePath, apiKey);
  if (!transcript) {
    return null;
  }

  // 1. lyrics.ovh Search
  let songCandidate = await searchLyricsOvh(transcript);

  // 2. OpenAI Chat & Web Search Fallbacks
  if (!songCandidate) {
    log.info('lyrics.ovh returned no match. Falling back to OpenAI Chat identification...');
    songCandidate = await identifySongWithOpenAI(transcript, apiKey);
  }

  if (!songCandidate) {
    log.info('OpenAI Chat could not identify track directly. Trying web lyric search...');
    songCandidate = await searchWebForLyrics(transcript);
  }

  // Fetch full metadata from MusicBrainz and iTunes using candidate song & artist
  if (songCandidate) {
    log.info(`Song candidate identified: "${songCandidate.artist} - ${songCandidate.title}"`);

    log.info(
      `Fetching metadata from MusicBrainz for candidate: ${songCandidate.artist} - ${songCandidate.title}`,
    );
    let mbMetadata = await searchRecording(songCandidate.artist, songCandidate.title);
    if (mbMetadata && isUsableMetadata(mbMetadata)) {
      return mbMetadata;
    }

    log.info(
      `Fetching metadata from iTunes for candidate: ${songCandidate.artist} - ${songCandidate.title}`,
    );
    let iTunesMetadata = await searchiTunesMetadata(songCandidate.artist, songCandidate.title);
    if (iTunesMetadata && isUsableMetadata(iTunesMetadata)) {
      return iTunesMetadata;
    }

    return {
      artist: songCandidate.artist,
      title: songCandidate.title,
      album: songCandidate.title,
    };
  }

  // Fallback: Direct search using lyrics string across metadata sources
  const cleanQuery = transcript
    .replace(/[^\w\s\u00C0-\u024F]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleanQuery) return null;

  log.info(`Fallback: Searching metadata sources directly using transcribed lyrics snippet...`);

  let metadata = await searchiTunesMetadata(null, cleanQuery);

  if (!metadata) {
    const shortQuery = cleanQuery.split(' ').slice(0, 6).join(' ');
    if (shortQuery && shortQuery !== cleanQuery) {
      log.info(`Retrying iTunes search with key lyrics words: "${shortQuery}"`);
      metadata = await searchiTunesMetadata(null, shortQuery);
    }
  }

  if (!metadata) {
    log.info('Searching MusicBrainz with lyric snippet...');
    const shortQuery = cleanQuery.split(' ').slice(0, 6).join(' ');
    metadata = await searchRecording(null, shortQuery);
  }

  if (metadata && isUsableMetadata(metadata)) {
    return metadata;
  }

  log.warn('Could not identify song metadata from transcribed audio lyrics.');
  return null;
}

/**
 * Domains that require auth/tokens and cannot be fetched directly.
 * Spotify CDN links (i.scdn.co) always return 404 without a valid Spotify access token.
 */
const BLOCKED_IMAGE_DOMAINS = ['i.scdn.co', 'scdn.co', 'open.spotify.com'];

function isBlockedImageUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return BLOCKED_IMAGE_DOMAINS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

async function downloadImageBuffer(url: string): Promise<Buffer | null> {
  if (isBlockedImageUrl(url)) {
    log.info(`Skipping blocked image domain (requires auth): ${url}`);
    return null;
  }

  try {
    const res = await axios.get(url, {
      responseType: 'arraybuffer',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      timeout: 8000,
    });
    if (res.status === 200 && res.data) {
      return Buffer.from(res.data);
    }
  } catch (err: any) {
    const status = err.response?.status ? `HTTP ${err.response.status}` : String(err.message || err);
    log.warn(`Failed to download cover image from ${url}: ${String(err.message || err)}`);
    log.info(`Direct cover URL download unavailable (${status}). Will use iTunes/CoverArtArchive/DuckDuckGo services.`);
  }
  return null;
}

export interface OpenAIAlbumAndCoverResult {
  album: string | null;
  coverBuffer: Buffer | null;
}

export async function fetchAlbumAndCoverWithOpenAI(
  artist: string,
  title: string,
  apiKey?: string,
): Promise<OpenAIAlbumAndCoverResult> {
  const token = apiKey || process.env.OPENAI_API_KEY;
  if (!token) {
    log.warn('Missing OpenAI API Key (OPENAI_API_KEY). Skipping OpenAI album search.');
    return { album: null, coverBuffer: null };
  }

  const querySubject = [title, artist].filter(Boolean).join(' - ') || 'Music Track';

  log.info(`Searching OpenAI for official album name of: "${querySubject}"`);
  let album: string | null = null;
  let coverBuffer: Buffer | null = null;

  try {
    const prompt = `You are a music metadata expert. For the song "${title || ''}" by "${artist || ''}", identify:
1. The exact official album name (or single release name if not on an LP/EP).
2. Optionally, if you know a PUBLICLY ACCESSIBLE direct static cover image URL (e.g. from coverartarchive.org, archive.org, wikimedia.org, or mzstatic.com), include it in "imageUrl".
   IMPORTANT: Do NOT return Spotify URLs (i.scdn.co or open.spotify.com) — they require authentication and will fail.
   Do NOT generate fictional/hallucinated hash links. Only include a URL if you are confident it is real and publicly accessible.

Respond ONLY with a JSON object:
{"album": "Official Album Name", "imageUrl": "https://..."} or {"album": "Official Album Name", "imageUrl": null}.`;

    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You output valid JSON only.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.1,
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      },
    );

    const content = response.data?.choices?.[0]?.message?.content?.trim();
    let imageUrl: string | null = null;

    if (content) {
      const cleaned = content.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
      try {
        const parsed = JSON.parse(cleaned);
        if (parsed.album && typeof parsed.album === 'string' && parsed.album.trim()) {
          album = parsed.album.trim();
          log.success(`OpenAI resolved album name: "${album}"`);
        }
        if (parsed.imageUrl && typeof parsed.imageUrl === 'string' && parsed.imageUrl.startsWith('http')) {
          imageUrl = parsed.imageUrl.trim();
        }
      } catch {
        // ignore parse error
      }
    }

    if (imageUrl) {
      coverBuffer = await downloadImageBuffer(imageUrl);
      if (coverBuffer && coverBuffer.length > 5000) {
        log.success('Successfully downloaded album cover from OpenAI suggested URL!');
      } else {
        coverBuffer = null;
      }
    }
  } catch (err: any) {
    const errorMsg = err.response?.data?.error?.message || err.message;
    log.warn(`OpenAI album search failed: ${errorMsg}`);
  }

  return { album, coverBuffer };
}
