import { GetListByKeyword, SearchResult } from "youtube-search-api";
import { createReadStream } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import {
  canReadVideoInfo,
  getThumbnail,
  normalizeQuery,
  youtubeWatchUrl,
} from "../utils/helpers.js";
import { Buffer } from "node:buffer";
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

export interface Track {
  videoId: string;
  title: string;
  artist: string;
  thumbnail: string;
  watchUrl: string;
  downloadUrl?: string;
  duration: string;
}

const cache = new Map<string, Track | Track[]>();
const apifyAudioCache = new Map<string, string>();
const blockedVideoIds = new Set<string>();
const b2Client = createB2Client();
const popularity = new Map<string, number>();
let popularityLoaded: Promise<void> | null = null;
let popularityWrite: Promise<void> = Promise.resolve();
export function blockList(videoId: string): boolean {
  return blockedVideoIds.has(videoId);
}

export async function recordTrackSelection(videoId: string): Promise<void> {
  await loadPopularity();
  popularity.set(videoId, (popularity.get(videoId) ?? 0) + 1);
  popularityWrite = popularityWrite.then(() => savePopularity());
  await popularityWrite;
}

function toTrack(item: SearchResult): Track | null {
  const videoId = item.id;
  if (!videoId || item.type !== "video" || blockList(videoId)) return null;
  const title = item.title?.trim();
  if (!title) return null;
  // отсекаем явно нерелевантные типы контента
  const lower = title.toLowerCase();
  if (/\b(live stream|трансляция)\b/i.test(lower)) return null;

  const artist = item.channelTitle?.trim() || "YouTube";
  return {
    videoId,
    title,
    artist,
    thumbnail: getThumbnail(videoId, item.thumbnail?.thumbnails),
    watchUrl: youtubeWatchUrl(videoId),
    downloadUrl: youtubeWatchUrl(videoId),
    duration: formatDuration(item.lengthSeconds ?? item.length?.simpleText),
  };
}

function formatDuration(value: number | string | undefined): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  const seconds = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return "?:??";
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, "0")}`;
}

export async function getTrackByVideoId(
  videoId: string,
): Promise<Track | null> {
  const key = `id:${videoId}`;
  const cached = cache.get(key);
  if (cached && !Array.isArray(cached)) return cached;
  if (!canReadVideoInfo(videoId) || blockList(videoId)) return null;

  let title = videoId;
  let artist = "YouTube";
  const track: Track = {
    videoId,
    title,
    artist,
    thumbnail: `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
    watchUrl: youtubeWatchUrl(videoId),
    duration: "?:??",
  };
  cache.set(key, track);
  return track;
}

export async function searchTrack(query: string): Promise<Track | null> {
  const tracks = await searchTracks(query, 1);
  return tracks[0] ?? null;
}

export async function searchTracks(query: string, limit = 6): Promise<Track[]> {
  const key = `q:${normalizeQuery(query)}`;
  const cached = cache.get(key);
  if (cached && Array.isArray(cached)) {
    return await sortSearchResults(cached);
  }

  // youtube-search-api expects a boolean, result limit, and an options array.
  const result = await GetListByKeyword(query, false, Math.max(limit, 1), [
    { type: "video" },
  ]);
  const tracks: Track[] = [];
  for (const item of result.items ?? []) {
    const track = toTrack(item);
    if (track) {
      cache.set(`id:${track.videoId}`, track);
      tracks.push(track);
      if (tracks.length >= limit) break;
    }
  }
  if (tracks.length > 0) cache.set(key, tracks);
  return await sortSearchResults(tracks);
}

async function sortSearchResults(tracks: Track[]): Promise<Track[]> {
  await loadPopularity();
  const cachedIds = await getCachedAudioIds(tracks);
  return tracks
    .map((track, index) => ({ track, index }))
    .sort((a, b) => {
      const aCached = cachedIds.has(a.track.videoId) ? 1 : 0;
      const bCached = cachedIds.has(b.track.videoId) ? 1 : 0;
      if (aCached !== bCached) return bCached - aCached;
      const popularityDifference =
        (popularity.get(b.track.videoId) ?? 0) -
        (popularity.get(a.track.videoId) ?? 0);
      return popularityDifference || a.index - b.index;
    })
    .map(({ track }) => track);
}

async function getCachedAudioIds(tracks: Track[]): Promise<Set<string>> {
  if (!b2Client || !process.env.B2_BUCKET_NAME) return new Set();
  const results = await Promise.all(
    tracks.map(async (track) => ({
      videoId: track.videoId,
      cached: await hasB2Object(`audio/${track.videoId}.mp3`),
    })),
  );
  return new Set(results.filter((item) => item.cached).map((item) => item.videoId));
}

async function hasB2Object(key: string): Promise<boolean> {
  if (!b2Client || !process.env.B2_BUCKET_NAME) return false;
  try {
    await b2Client.send(
      new HeadObjectCommand({ Bucket: process.env.B2_BUCKET_NAME, Key: key }),
    );
    return true;
  } catch (error) {
    const statusCode =
      error && typeof error === "object" && "$metadata" in error
        ? (error as { $metadata?: { httpStatusCode?: number } }).$metadata
            ?.httpStatusCode
        : undefined;
    if (statusCode === 404) return false;
    throw error;
  }
}

async function loadPopularity(): Promise<void> {
  if (!popularityLoaded) {
    popularityLoaded = readPopularity();
  }
  await popularityLoaded;
}

async function readPopularity(): Promise<void> {
  if (!b2Client || !process.env.B2_BUCKET_NAME) return;
  try {
    const result = await b2Client.send(
      new GetObjectCommand({
        Bucket: process.env.B2_BUCKET_NAME,
        Key: "metadata/track-popularity.json",
      }),
    );
    if (!result.Body) return;
    const data: unknown = JSON.parse(
      Buffer.from(await result.Body.transformToByteArray()).toString("utf8"),
    );
    if (data && typeof data === "object") {
      for (const [videoId, count] of Object.entries(data)) {
        if (typeof count === "number" && Number.isFinite(count) && count > 0) {
          popularity.set(videoId, count);
        }
      }
    }
  } catch (error) {
    const statusCode =
      error && typeof error === "object" && "$metadata" in error
        ? (error as { $metadata?: { httpStatusCode?: number } }).$metadata
            ?.httpStatusCode
        : undefined;
    if (statusCode !== 404) throw error;
  }
}

async function savePopularity(): Promise<void> {
  if (!b2Client || !process.env.B2_BUCKET_NAME) return;
  await b2Client.send(
    new PutObjectCommand({
      Bucket: process.env.B2_BUCKET_NAME,
      Key: "metadata/track-popularity.json",
      Body: JSON.stringify(Object.fromEntries(popularity)),
      ContentType: "application/json",
    }),
  );
}

export async function getAudioStream(videoId: string): Promise<Readable> {
  const cachedTrack = cache.get(`id:${videoId}`);
  const track =
    cachedTrack && !Array.isArray(cachedTrack) ? cachedTrack : undefined;
  if ((!track && !canReadVideoInfo(videoId)) || blockList(videoId)) {
    throw new Error("The requested video cannot be downloaded.");
  }

  const directory = await mkdtemp(join(tmpdir(), "music-bot-"));
  const outputPath = join(directory, `${videoId}.mp3`);

  try {
    const cacheKey = `audio/${videoId}.mp3`;
    if (b2Client) {
      const cached = await readFromB2(cacheKey, outputPath);
      if (cached) {
        return createAudioStream(outputPath, directory);
      }
    }

    let downloadUrl = apifyAudioCache.get(videoId);
    if (!downloadUrl) {
      const fallbackQuery = track ? `${track.artist} ${track.title}` : `youtube ${videoId}`;
      const zvuchUrl = await findZvuchAudioUrl(fallbackQuery);
      if (!zvuchUrl) {
        throw new Error("No direct audio source is available for this track.");
      }
      downloadUrl = zvuchUrl;
      apifyAudioCache.set(videoId, downloadUrl);
    }
    const response = await fetch(downloadUrl);
    if (!response.ok) {
      apifyAudioCache.delete(videoId);
      throw new Error(
        `Audio file request returned HTTP ${response.status}.`,
      );
    }
    const contents = Buffer.from(await response.arrayBuffer());
    await writeFile(outputPath, contents);
    if (b2Client) {
      await b2Client.send(
        new PutObjectCommand({
          Bucket: process.env.B2_BUCKET_NAME,
          Key: cacheKey,
          Body: contents,
          ContentType: "audio/mpeg",
        }),
      );
    }
    return createAudioStream(outputPath, directory);
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }

}

async function findZvuchAudioUrl(query: string): Promise<string | null> {
  const searchUrls = [
    `https://wwv.zvuch.com/?s=${encodeURIComponent(query)}`,
    `https://wwv.zvuch.com/search/${encodeURIComponent(query)}/`,
  ];

  for (const url of searchUrls) {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
        },
      });
      if (!response.ok) continue;
      const html = await response.text();
      const matches = [
        ...html.matchAll(/https?:\/\/[^\s"'<>]+\.(?:mp3|m4a|aac|wav|ogg)(?:\?[^\s"'<>]*)?/gi),
        ...html.matchAll(/(?:file|src|href|data-src|data-url)\s*[:=]\s*["']?(https?:\/\/[^"'\s<>]+)(?:["']|\s|>)/gi),
      ];
      const candidate = matches
        .map((match) => match[0].replace(/^['"]+|['"]+$/g, ""))
        .find((value) => /zvuch\.com|mp3|m4a|aac|wav|ogg/i.test(value));
      if (candidate) return candidate;
    } catch {
      // If the site blocks requests from the server, fall through to the next source.
    }
  }

  return null;
}

function createB2Client(): S3Client | null {
  if (process.env.B2_CACHE_ENABLED !== "true") return null;
  const endpoint = process.env.B2_ENDPOINT;
  const region = process.env.B2_REGION;
  const accessKeyId = process.env.B2_KEY_ID;
  const secretAccessKey = process.env.B2_APPLICATION_KEY;
  if (
    !endpoint ||
    !region ||
    !accessKeyId ||
    !secretAccessKey ||
    !process.env.B2_BUCKET_NAME
  ) {
    console.warn("B2 cache disabled: incomplete B2 configuration.");
    return null;
  }
  return new S3Client({
    endpoint,
    region,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });
}

async function readFromB2(key: string, outputPath: string): Promise<boolean> {
  if (!b2Client) return false;
  try {
    await b2Client.send(
      new HeadObjectCommand({ Bucket: process.env.B2_BUCKET_NAME, Key: key }),
    );
    const result = await b2Client.send(
      new GetObjectCommand({ Bucket: process.env.B2_BUCKET_NAME, Key: key }),
    );
    if (!result.Body) return false;
    await writeFile(
      outputPath,
      Buffer.from(await result.Body.transformToByteArray()),
    );
    return true;
  } catch (error) {
    const statusCode =
      error && typeof error === "object" && "$metadata" in error
        ? (error as { $metadata?: { httpStatusCode?: number } }).$metadata
            ?.httpStatusCode
        : undefined;
    if (statusCode === 404) return false;
    throw error;
  }
}

function createAudioStream(outputPath: string, directory: string): Readable {
  const audio = createReadStream(outputPath);
  const cleanup = () => {
    void rm(directory, { recursive: true, force: true });
  };
  audio.once("close", cleanup);
  audio.once("error", cleanup);
  return audio;
}

/**
 * Retries an async operation with exponential backoff.
 * Useful for transient downloader API/network errors.
 * Non-transient errors are returned immediately.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    retries?: number;
    baseDelayMs?: number;
    isRetryable?: (error: unknown) => boolean;
  } = {},
): Promise<T> {
  const {
    retries = 3,
    baseDelayMs = 1000,
    isRetryable = defaultIsRetryable,
  } = options;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === retries || !isRetryable(error)) {
        throw error;
      }
      const delay = baseDelayMs * 2 ** attempt + Math.random() * 300;
      console.warn(
        `Retryable error on attempt ${attempt + 1}/${retries + 1}, retrying in ${Math.round(delay)}ms:`,
        error,
      );
      await sleep(delay);
    }
  }
  throw lastError;
}

function defaultIsRetryable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const statusCode =
    error instanceof Error && "statusCode" in error
      ? (error as { statusCode?: number }).statusCode
      : undefined;
  return (
    statusCode === 429 ||
    message.includes("429") ||
    message.includes("Status code: 429")
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
