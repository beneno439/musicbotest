import { load } from "cheerio";
import { Readable } from "node:stream";

export interface ZvuchTrack {
  id: string;
  title: string;
  artist: string;
  thumbnail: string;
  pageUrl: string;
  downloadUrl: string;
  duration: string;
}

const DEFAULT_BASE_URL = "https://wwv.zvuch.com";
const BASE_URL = process.env.ZVUCH_BASE_URL?.trim() || DEFAULT_BASE_URL;

const REQUEST_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
  Referer: BASE_URL,
};

export async function searchZvuchTracks(
  query: string,
  limit = 6,
): Promise<ZvuchTrack[]> {
  const normalized = query.trim();
  if (!normalized) return [];

  const searchUrls = [
    `${BASE_URL}/?s=${encodeURIComponent(normalized)}`,
    `${BASE_URL}/search/${encodeURIComponent(normalized)}/`,
    `${BASE_URL}/tracks?q=${encodeURIComponent(normalized)}`,
  ];

  for (const url of searchUrls) {
    try {
      const response = await fetch(url, { headers: REQUEST_HEADERS });
      if (!response.ok) continue;
      const html = await response.text();
      const $ = load(html);
      const tracks: ZvuchTrack[] = [];

      $(".track-item, .song-item, .track, [data-mp3], [data-url]").each((_, element) => {
        if (tracks.length >= limit) return false;
        const $element = $(element);
        const downloadUrl = pickDownloadUrl(element, $);
        if (!downloadUrl) return;

        const title =
          $element.find(".track-title, .song-name, .title, h3, a").first().text().trim() ||
          $element.text().trim().split(/\s{2,}/)[0] ||
          "Без названия";
        const artist =
          $element.find(".track-artist, .artist-name, .artist, .author").first().text().trim() ||
          "Неизвестный исполнитель";
        const duration =
          $element.find(".track-time, .duration, time").first().text().trim() || "?:??";
        const pageUrl =
          $element.find("a").first().attr("href") ||
          `${BASE_URL}/`;

        tracks.push({
          id: makeTrackId(downloadUrl),
          title: title || "Без названия",
          artist,
          thumbnail: `https://images.unsplash.com/photo-1516280440614-37939bbacd81?auto=format&fit=crop&w=1200&q=80`,
          pageUrl: normalizeUrl(pageUrl),
          downloadUrl: normalizeUrl(downloadUrl),
          duration,
        });
      });

      if (tracks.length > 0) return tracks;
    } catch {
      // Keep trying fallback search URLs if the site blocks or changes markup.
    }
  }

  return [];
}

export async function getZvuchAudioStream(downloadUrl: string): Promise<Readable> {
  const response = await fetch(normalizeUrl(downloadUrl), {
    headers: {
      ...REQUEST_HEADERS,
      Referer: BASE_URL,
    },
  });

  if (!response.ok || !response.body) {
    throw new Error(`Failed to fetch Zvuch audio stream: HTTP ${response.status}`);
  }

  return Readable.fromWeb(response.body as any);
}

function pickDownloadUrl(element: unknown, $: ReturnType<typeof load>): string | null {
  const $element = $(element as any);
  const candidates = [
    $element.attr("data-mp3"),
    $element.attr("data-url"),
    $element.find("[data-mp3]").first().attr("data-mp3"),
    $element.find("[data-url]").first().attr("data-url"),
    $element
      .find("a.download, a[href*='download'], a[href*='.mp3'], a[href*='.m4a'], a[href*='.aac'], a[href*='.wav'], a[href*='.ogg']")
      .first()
      .attr("href"),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    const normalized = normalizeUrl(candidate);
    if (normalized && /\.(mp3|m4a|aac|wav|ogg)(?:$|[?#])/i.test(normalized)) {
      return normalized;
    }
  }

  return null;
}

function normalizeUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  if (trimmed.startsWith("/")) return `${BASE_URL}${trimmed}`;
  return `${BASE_URL}/${trimmed}`;
}

function makeTrackId(value: string): string {
  return Buffer.from(value).toString("base64url").replace(/=+$/g, "");
}
