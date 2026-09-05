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
  }

  const proxy = process.env.YOUTUBE_PROXY;
  if (proxy) {
    options.agent = ytdl.createProxyAgent({ uri: proxy });
  }
  return options;
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
  const key = `q:${normalizeQuery(query)}`;
  const cached = cache.get(key);
  if (cached) return cached;

  // youtube-search-api expects a boolean, result limit, and an options array.
  const result = await GetListByKeyword(query, false, 10, [{ type: "video" }]);
  for (const item of result.items ?? []) {
    const track = toTrack(item);
    if (track) {
      cache.set(key, track);
      cache.set(`id:${track.videoId}`, track);
      return track;
    }
  }
  return null;
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
