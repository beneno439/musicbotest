import { GetListByKeyword, SearchResult } from "youtube-search-api";
import ytdl from "@distube/ytdl-core";
import { Readable } from "node:stream";
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

function youtubeOptions(): Parameters<typeof ytdl.getInfo>[1] {
  const options: Parameters<typeof ytdl.getInfo>[1] = {
    playerClients: ["WEB_EMBEDDED", "IOS", "ANDROID", "TV"],
    requestOptions: {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36",
      },
    },
  };

  const cookies = process.env.YOUTUBE_COOKIES_JSON;
  if (cookies) {
    try {
      options.agent = ytdl.createAgent(JSON.parse(cookies));
    } catch (error) {
      console.error("YOUTUBE_COOKIES_JSON is invalid:", error);
    }
  } else {
    // "Sign in to confirm you're not a bot" cannot be solved by retrying —
    // it requires a real logged-in session. Surface this once, loudly.
    console.warn(
      "YOUTUBE_COOKIES_JSON is not set. YouTube will likely block audio " +
        "downloads with 'Sign in to confirm you're not a bot', especially " +
        "from datacenter IPs. Export cookies from a logged-in browser " +
        "session (Netscape/JSON format compatible with @distube/ytdl-core's " +
        "createAgent) and set them in this env var to fix it.",
    );
  }

  const proxy = process.env.YOUTUBE_PROXY;
  if (proxy) {
    options.agent = ytdl.createProxyAgent({ uri: proxy });
  }
  return options;
}

function isUnrecoverable(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "UnrecoverableError" ||
      /sign in to confirm/i.test(error.message))
  );
}

async function getInfoWithRetry(videoId: string) {
  let lastError: unknown;
  for (const playerClients of [
    ["WEB_EMBEDDED", "IOS", "ANDROID", "TV"] as const,
    ["WEB", "ANDROID", "IOS"] as const,
  ]) {
    try {
      return await ytdl.getInfo(videoId, {
        ...youtubeOptions(),
        playerClients: [...playerClients],
      });
    } catch (error) {
      lastError = error;
      // Bot-check failures won't go away by trying another player client
      // without valid cookies/proxy — stop burning time and fail fast.
      if (isUnrecoverable(error)) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
  }
  throw lastError;
}

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
  try {
    const info = await getInfoWithRetry(videoId);
    title = info.videoDetails.title;
    artist = info.videoDetails.author.name || artist;
  } catch {
    // Metadata can be unavailable for age-restricted/deleted videos.
  }

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

export async function searchTracks(
  query: string,
  limit = 6,
): Promise<Track[]> {
  const key = `q:${normalizeQuery(query)}`;
  const cached = cache.get(key);
  if (cached) return [cached];

  // youtube-search-api expects a boolean, result limit, and an options array.
  const result = await GetListByKeyword(
    query,
    false,
    Math.max(limit, 1),
    [{ type: "video" }],
  );
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
  const info = await getInfoWithRetry(videoId);
  return ytdl.downloadFromInfo(info, {
    ...youtubeOptions(),
    quality: "highestaudio",
    filter: "audioonly",
  });
}

/**
 * Retries an async operation with exponential backoff.
 * Useful for transient 429 (Too Many Requests) errors.
 * Does NOT retry "Sign in to confirm you're not a bot" (UnrecoverableError) —
 * that needs valid cookies/proxy, not more attempts.
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
  if (isUnrecoverable(error)) return false;
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
