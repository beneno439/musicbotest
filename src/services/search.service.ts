import { GetListByKeyword, SearchResult } from "youtube-search-api";
import YTDlpWrap from "yt-dlp-wrap";
import { createReadStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import ffmpegPath from "ffmpeg-static";
import {
  canReadVideoInfo,
  getThumbnail,
  normalizeQuery,
  youtubeWatchUrl,
} from "../utils/helpers.js";

export interface Track {
  videoId: string;
  title: string;
  artist: string;
  thumbnail: string;
  watchUrl: string;
}

const cache = new Map<string, Track>();
const blockedVideoIds = new Set<string>();
const bundledYtDlp = join(
  process.cwd(),
  "bin",
  process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp_linux",
);
const ytdlp = new YTDlpWrap(process.env.YT_DLP_PATH || bundledYtDlp);

export function blockList(videoId: string): boolean {
  return blockedVideoIds.has(videoId);
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
  };
}

export async function getTrackByVideoId(
  videoId: string,
): Promise<Track | null> {
  if (!canReadVideoInfo(videoId) || blockList(videoId)) return null;
  const key = `id:${videoId}`;
  const cached = cache.get(key);
  if (cached) return cached;

  let title = videoId;
  let artist = "YouTube";
  const track: Track = {
    videoId,
    title,
    artist,
    thumbnail: `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
    watchUrl: youtubeWatchUrl(videoId),
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
  if (cached) return [cached];

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
  if (tracks.length > 0) cache.set(key, tracks[0]);
  return tracks;
}

export async function getAudioStream(videoId: string): Promise<Readable> {
  if (!canReadVideoInfo(videoId) || blockList(videoId)) {
    throw new Error("The requested video cannot be downloaded.");
  }

  const directory = await mkdtemp(join(tmpdir(), "music-bot-"));
  const outputPath = join(directory, `${videoId}.mp3`);
  const args = [
    `https://www.youtube.com/watch?v=${videoId}`,
    "--format", "bestaudio/best",
    "--extract-audio",
    "--audio-format", "mp3",
    "--audio-quality", "0",
    "--output", outputPath,
    "--no-playlist",
    "--no-part",
    "--quiet",
  ];
  const cookiesFile = process.env.YOUTUBE_COOKIES_FILE;
  const proxy = process.env.YOUTUBE_PROXY;
  if (cookiesFile) args.push("--cookies", cookiesFile);
  if (proxy) args.push("--proxy", proxy);
  if (ffmpegPath) args.push("--ffmpeg-location", ffmpegPath);

  try {
    await ytdlp.execPromise(args);
    const audio = createReadStream(outputPath);
    const cleanup = () => {
      void rm(directory, { recursive: true, force: true });
    };
    audio.once("close", cleanup);
    audio.once("error", cleanup);
    return audio;
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

/**
 * Retries an async operation with exponential backoff.
 * Useful for transient 429 (Too Many Requests) errors.
 * yt-dlp errors that are not transient are returned immediately.
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
