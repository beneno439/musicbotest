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

  const cookies = [
    {
      domain: ".youtube.com",
      expirationDate: 1802432872.451148,
      hostOnly: false,
      httpOnly: true,
      name: "VISITOR_PRIVACY_METADATA",
      path: "/",
      sameSite: "no_restriction",
      secure: true,
      session: false,
      storeId: null,
      value: "CgJSVRIEGgAgSQ%3D%3D",
    },
    {
      domain: ".youtube.com",
      expirationDate: 1822754910.363338,
      hostOnly: false,
      httpOnly: true,
      name: "__Secure-3PSID",
      path: "/",
      sameSite: "no_restriction",
      secure: true,
      session: false,
      storeId: null,
      value:
        "g.a000CAmOuLOJ6_YDpLqigknBTEGDc1sdH33kDhYyPfaXxzi0IkKT30MyBdGvwXJ4c7iVYtSdWgACgYKAfASARISFQHGX2MilOumYUG5XuT5z6dwSkR0kRoVAUF8yKouf4XbqU_AGvrOS7QF-dIa0076",
    },
    {
      domain: ".youtube.com",
      hostOnly: false,
      httpOnly: true,
      name: "YSC",
      path: "/",
      sameSite: "no_restriction",
      secure: true,
      session: true,
      storeId: null,
      value: "K0l9q-JN5A8",
    },
    {
      domain: ".youtube.com",
      expirationDate: 1820182594.35715,
      hostOnly: false,
      httpOnly: true,
      name: "__Secure-1PSIDTS",
      path: "/",
      sameSite: null,
      secure: true,
      session: false,
      storeId: null,
      value:
        "sidts-CjQBXMw41QzpgnoJCHr7GjlX3g7KwhLxY6XNdmDE9IPqFeFj-oysvc7YYKz8vvVJA9cakZ27EAA",
    },
    {
      domain: ".youtube.com",
      expirationDate: 1822754910.363685,
      hostOnly: false,
      httpOnly: false,
      name: "SAPISID",
      path: "/",
      sameSite: null,
      secure: true,
      session: false,
      storeId: null,
      value: "d69VDo1szcFU_RuV/Aj3hYNIabOXm4bVUX",
    },
    {
      domain: ".youtube.com",
      expirationDate: 1820182613.401931,
      hostOnly: false,
      httpOnly: true,
      name: "__Secure-1PSIDCC",
      path: "/",
      sameSite: null,
      secure: true,
      session: false,
      storeId: null,
      value:
        "AKEyXzWmHczFvcP8HRqKXPJdeUxUFudV_LkKHrwtB_eU510jYGvGZsxAIRsFi8ULddVbYbV1a2M",
    },
    {
      domain: ".youtube.com",
      expirationDate: 1822754910.363531,
      hostOnly: false,
      httpOnly: true,
      name: "SSID",
      path: "/",
      sameSite: null,
      secure: true,
      session: false,
      storeId: null,
      value: "AAPiJIWl1V09jcwvv",
    },
    {
      domain: ".youtube.com",
      expirationDate: 1822754910.363761,
      hostOnly: false,
      httpOnly: false,
      name: "__Secure-1PAPISID",
      path: "/",
      sameSite: null,
      secure: true,
      session: false,
      storeId: null,
      value: "d69VDo1szcFU_RuV/Aj3hYNIabOXm4bVUX",
    },
    {
      domain: ".youtube.com",
      expirationDate: 1822754910.363235,
      hostOnly: false,
      httpOnly: true,
      name: "__Secure-1PSID",
      path: "/",
      sameSite: null,
      secure: true,
      session: false,
      storeId: null,
      value:
        "g.a000CAmOuLOJ6_YDpLqigknBTEGDc1sdH33kDhYyPfaXxzi0IkKTc3kIy9XkWD-tMUQsP6GkWAACgYKASQSARISFQHGX2MiNcPsyRGnrydYFxupgxh7shoVAUF8yKpK-4MUna4H0cBnW2VPNTPQ0076",
    },
    {
      domain: ".youtube.com",
      expirationDate: 1822754910.363833,
      hostOnly: false,
      httpOnly: false,
      name: "__Secure-3PAPISID",
      path: "/",
      sameSite: "no_restriction",
      secure: true,
      session: false,
      storeId: null,
      value: "d69VDo1szcFU_RuV/Aj3hYNIabOXm4bVUX",
    },
    {
      domain: ".youtube.com",
      expirationDate: 1820182613.402176,
      hostOnly: false,
      httpOnly: true,
      name: "__Secure-3PSIDCC",
      path: "/",
      sameSite: "no_restriction",
      secure: true,
      session: false,
      storeId: null,
      value:
        "AKEyXzWnpxS635D96I41XYcrr4fpLNalSku_y5fd7Ch7PuK6jJ0CraoNREf7EClkD9hnMvyxrUs",
    },
    {
      domain: ".youtube.com",
      expirationDate: 1820182594.357409,
      hostOnly: false,
      httpOnly: true,
      name: "__Secure-3PSIDTS",
      path: "/",
      sameSite: "no_restriction",
      secure: true,
      session: false,
      storeId: null,
      value:
        "sidts-CjQBXMw41QzpgnoJCHr7GjlX3g7KwhLxY6XNdmDE9IPqFeFj-oysvc7YYKz8vvVJA9cakZ27EAA",
    },
    {
      domain: ".youtube.com",
      expirationDate: 1791138584.61499,
      hostOnly: false,
      httpOnly: true,
      name: "__Secure-BUCKET",
      path: "/",
      sameSite: "lax",
      secure: true,
      session: false,
      storeId: null,
      value: "CNIE",
    },
    {
      domain: ".youtube.com",
      expirationDate: 1822771660.131449,
      hostOnly: false,
      httpOnly: true,
      name: "__Secure-YENID",
      path: "/",
      sameSite: "lax",
      secure: true,
      session: false,
      storeId: null,
      value:
        "17.YTE=o-KEVN5mhHiy_ufjEB0g4bnMn5hD3EOmROrq0f4fXPI82XsgYAWsm_e-TwINqdsQt1eFz1y5gScNyp2SQDtQ6eJKkyjEEd0VURmUp7a-qIqgOn6TbMiz14megFne3IltCbaSP3E8ui4Nrdjqm3_envluzeZ2Et4oqjVR7B1-W1kYAM5Qckyj0Y6dEEZmQtwFIsfs9vpImmZVS0vTvoRcqEyXQ7Yzc4U68EPLVp8eIeioObcpf2bpQV3zNAfZ9GPu69Ysu_H74EN_07Q6SHBSqszhSiHQwgUOLSqNCVrTV2zv6Mv1x5ZoLt20XjJrWW_WOz8m9zvPVoVZEVVb_2rJlw",
    },
    {
      domain: ".youtube.com",
      expirationDate: 1802432872.625451,
      hostOnly: false,
      httpOnly: true,
      name: "__Secure-YNID",
      path: "/",
      sameSite: "no_restriction",
      secure: true,
      session: false,
      storeId: null,
      value:
        "21.YT=SEfBttfr599nqn8rwwi-Ln7kmVxTDjwg66r2CHeFybE-OR4W2UG-xPNJbpxPk3tQ8IFll91QuQrILggObuPomp6lgRrGDuWkX90pzBphYMJ5z9aK-ez7CN5FRxhckbRAW0gY4hEV_Di_P_3lMc8g8tQtYImg6PJglD1o0i6cOaUgxnufbU52H2i6ieTECL_mjHObgKp1PdWusw74Jg867S83OKnTuJs2QN5ectGhS1Euu4LC6RfQg4fWDk7sVsFAdjB-d3Z5hcLEYkqChFGbGYZC2d9vpCiEnZYKF4JnhxawYPcTqOgLCWbcf-Ce4EhMksBPhkhzr74OxYcA88OhFA",
    },
    {
      domain: ".youtube.com",
      expirationDate: 1823206603.770068,
      hostOnly: false,
      httpOnly: true,
      name: "LOGIN_INFO",
      path: "/",
      sameSite: "no_restriction",
      secure: true,
      session: false,
      storeId: null,
      value:
        "AFmmF2swRQIhALi0QTU2-0ape1oBZAJ44-VpwtjMJswLPoLZIRTWpPSxAiB1jqRBqDKXF0iOkyedw0FZ0S8dCyVnMmzBTkfuLPmLlA:QUQ3MjNmeHhCakRBSmtnZWVzdG55eVpwNFlCMjBVVHJXZzVaMW0yWjZCMmQ5S3NJNjI1TU9POEVBVnVvdm1XckVGdW9RV3dKcWFOREdsdWhvWjlLTGQzRy1jSE9pcWYtQ3JpU0I1WnNLaWZMNGhNanltSXZWclRSOFF1SXp1Z2VBdVNhOGRwbjl3X3ZtQjRGd3gwOGJ2MFFpRUpkX2I4RHl3",
    },
    {
      domain: ".youtube.com",
      expirationDate: 1823206609.287218,
      hostOnly: false,
      httpOnly: false,
      name: "PREF",
      path: "/",
      sameSite: null,
      secure: true,
      session: false,
      storeId: null,
      value: "tz=Europe.Moscow&f5=30000&f7=100&hl=ja&gl=RU&f6=40000000",
    },
  ];

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
