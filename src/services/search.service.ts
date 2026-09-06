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

export interface Track {
  videoId: string;
  title: string;
  artist: string;
  thumbnail: string;
  watchUrl: string;
  downloadUrl?: string;
}

const cache = new Map<string, Track>();
const blockedVideoIds = new Set<string>();
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
    downloadUrl: youtubeWatchUrl(videoId),
  };
}

export async function getTrackByVideoId(
  videoId: string,
): Promise<Track | null> {
  const key = `id:${videoId}`;
  const cached = cache.get(key);
  if (cached) return cached;
  if (!canReadVideoInfo(videoId) || blockList(videoId)) return null;

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
  const track = cache.get(`id:${videoId}`);
  if ((!track && !canReadVideoInfo(videoId)) || blockList(videoId)) {
    throw new Error("The requested video cannot be downloaded.");
  }

  const directory = await mkdtemp(join(tmpdir(), "music-bot-"));
  const outputPath = join(directory, `${videoId}.mp3`);

  try {
    const apiKey =
      process.env.VIDEO_DOWNLOAD_API_KEY || process.env.AOU_KEY_VDA;
    if (!apiKey) {
      throw new Error("VIDEO_DOWNLOAD_API_KEY is not configured.");
    }
    const host = process.env.VIDEO_DOWNLOAD_API_HOST || "p.savenow.to";
    const createUrl = new URL(`https://${host}/ajax/download.php`);
    createUrl.searchParams.set(
      "url",
      track?.downloadUrl || `https://www.youtube.com/watch?v=${videoId}`,
    );
    createUrl.searchParams.set("format", "mp3");
    createUrl.searchParams.set("apikey", apiKey);
    createUrl.searchParams.set("add_info", "1");
    createUrl.searchParams.set("audio_quality", "192");

    const createResponse = await fetch(createUrl);
    const createPayload = (await createResponse.json()) as {
      success?: boolean;
      id?: string;
      error?: string;
    };
    if (!createResponse.ok || !createPayload.success || !createPayload.id) {
      throw new Error(
        `Video Download API rejected the job: ${
          createPayload.error || `HTTP ${createResponse.status}`
        }`,
      );
    }

    const downloadUrl = await waitForDownload(host, createPayload.id);
    const response = await fetch(downloadUrl);
    if (!response.ok) {
      throw new Error(
        `Video Download API file request returned HTTP ${response.status}.`,
      );
    }
    await writeFile(outputPath, Buffer.from(await response.arrayBuffer()));
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

async function waitForDownload(host: string, id: string): Promise<string> {
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    const progressUrl = new URL(`https://${host}/ajax/progress.php`);
    progressUrl.searchParams.set("id", id);
    const response = await fetch(progressUrl);
    const payload = (await response.json()) as {
      success?: number;
      progress?: number;
      download_url?: string;
      text?: string;
      message?: string;
    };
    if (!response.ok || payload.success === 0) {
      throw new Error(
        `Video Download API progress failed: ${
          payload.message || payload.text || `HTTP ${response.status}`
        }`,
      );
    }
    if (payload.progress === 1000 && payload.download_url) {
      return payload.download_url;
    }
    await sleep(2000);
  }
  throw new Error("Video Download API timed out while preparing the audio.");
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
