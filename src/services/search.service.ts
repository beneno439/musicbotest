import { GetListByKeyword, SearchResult } from "youtube-search-api";
import ytdl from "ytdl-core";
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
    const info = await ytdl.getInfo(videoId);
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

export function getAudioStream(videoId: string): Readable {
  if (!canReadVideoInfo(videoId) || blockList(videoId)) {
    throw new Error("The requested video cannot be downloaded.");
  }
  return ytdl(videoId, {
    quality: "highestaudio",
    filter: "audioonly",
  });
}
