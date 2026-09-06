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
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
  "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
  "Cache-Control": "max-age=0",
  "Sec-Ch-Ua":
    '"Not)A;Brand";v="99", "Google Chrome";v="127", "Chromium";v="127"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"Windows"',
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "same-origin",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
  Referer: "https://google.com/",
};

// Простой транслитератор для кириллицы в латиницу для формирования URL slug
function transliterate(text: string): string {
  const ruMap: Record<string, string> = {
    а: "a",
    б: "b",
    в: "v",
    г: "g",
    д: "d",
    е: "e",
    ё: "yo",
    ж: "zh",
    з: "z",
    и: "i",
    й: "y",
    к: "k",
    л: "l",
    м: "m",
    н: "n",
    о: "o",
    п: "p",
    р: "r",
    с: "s",
    т: "t",
    у: "u",
    ф: "f",
    х: "kh",
    ц: "ts",
    ч: "ch",
    ш: "sh",
    щ: "shch",
    ъ: "",
    ы: "y",
    ь: "",
    э: "e",
    ю: "yu",
    я: "ya",
  };
  return text
    .toLowerCase()
    .split("")
    .map((char) => ruMap[char] || char)
    .join("");
}

import _puppeteer from "puppeteer-extra";
const puppeteer = _puppeteer as any;
import StealthPlugin from "puppeteer-extra-plugin-stealth";

// Активируем плагин скрытности
puppeteer.use(StealthPlugin());

export async function searchZvuchTracks(
  query: string,
  limit = 6,
): Promise<ZvuchTrack[]> {
  const normalized = query.trim();
  if (!normalized) return [];

  const cyrillicSlug = encodeURIComponent(normalized.replace(/\s+/g, "-"));
  const latinSlug = buildTrackSlug(normalized);

  const searchUrls = [
    `${BASE_URL}/tracks/${cyrillicSlug}?search=1`,
    `${BASE_URL}/tracks/${latinSlug}?search=1`,
    `${BASE_URL}/search/${encodeURIComponent(normalized)}/`,
    `${BASE_URL}/?s=${encodeURIComponent(normalized)}`,
  ];

  // Запускаем браузер с флагами для экономии ресурсов
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--disable-gpu",
    ],
  });

  try {
    const page = await browser.newPage();

    // Блокируем тяжелые ресурсы (картинки, стили, шрифты), оставляем только HTML и JS
    await page.setRequestInterception(true);
    page.on("request", (req: any) => {
      if (
        ["image", "stylesheet", "font", "media"].includes(req.resourceType())
      ) {
        req.abort();
      } else {
        req.continue();
      }
    });

    const seen = new Set<string>();
    for (const url of searchUrls) {
      if (seen.has(url)) continue;
      seen.add(url);

      console.log(`[Zvuch Debug] Puppeteer открывает: ${url}`);

      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });

        // Ждем максимум 5 секунд, пока Cloudflare нас пропустит и появятся треки
        await page
          .waitForSelector(".track-item, .song-item, .track, audio", {
            timeout: 5000,
          })
          .catch(() => {});

        const html = await page.content();
        const $ = load(html);

        const tracks = parseTracksFromHtml($, url, limit);
        console.log(`[Zvuch Debug] Найдено треков: ${tracks.length}`);

        if (tracks.length > 0) {
          return tracks;
        }
      } catch (error) {
        console.error(
          `[Zvuch Debug] Ошибка Puppeteer на ${url}:`,
          (error as Error).message,
        );
      }
    }
  } finally {
    // Обязательно закрываем браузер, иначе сервер быстро останется без ОЗУ
    await browser.close();
  }

  return [];
}

function parseTracksFromHtml(
  $: ReturnType<typeof load>,
  pageUrl: string,
  limit: number,
): ZvuchTrack[] {
  const tracks: ZvuchTrack[] = [];

  const directTrack = extractDirectTrackFromPage($, pageUrl);
  if (directTrack) {
    tracks.push(directTrack);
    if (tracks.length >= limit) return tracks;
  }

  $(
    ".track-item, .song-item, .track, [data-mp3], [data-url], [data-id], .track-item__body, .track-card, a[href*='/tracks/']",
  ).each((_, element) => {
    if (tracks.length >= limit) return false;

    const $element = $(element);
    const downloadUrl = pickDownloadUrl(element, $);
    const href = $element.attr("href");
    const pageHref = href || $element.find("a").first().attr("href") || pageUrl;

    const candidatePageUrl =
      pageHref && /\/tracks\//i.test(pageHref)
        ? normalizeUrl(pageHref)
        : pageUrl;
    const titleText =
      $element
        .find(".track-title, .song-name, .title, .name, h1, h2, h3, a")
        .first()
        .text()
        .trim() ||
      $("meta[property='og:title']").attr("content")?.trim() ||
      $("title").text().trim() ||
      "Без названия";
    const artistText =
      $element
        .find(".track-artist, .artist-name, .artist, .author, .artist-title")
        .first()
        .text()
        .trim() ||
      inferArtistFromTitle(titleText) ||
      "Неизвестный исполнитель";
    const durationText =
      $element.find(".track-time, .duration, time").first().text().trim() ||
      "?:??";

    const finalDownloadUrl =
      downloadUrl || pickDownloadUrlFromAnchor($element, $);
    if (!finalDownloadUrl) return;

    const title = cleanTrackTitle(titleText);
    const artist = cleanArtistName(artistText);

    tracks.push({
      id: makeTrackId(finalDownloadUrl),
      title: title || "Без названия",
      artist,
      thumbnail: getTrackThumbnail($, candidatePageUrl),
      pageUrl: candidatePageUrl,
      downloadUrl: normalizeUrl(finalDownloadUrl),
      duration: durationText,
    });
  });

  return tracks;
}

function extractDirectTrackFromPage(
  $: ReturnType<typeof load>,
  pageUrl: string,
): ZvuchTrack | null {
  const rawTitle =
    $("meta[property='og:title']").attr("content") || $("title").text();
  const title = cleanTrackTitle(rawTitle || "");
  if (!title) return null;

  const author = inferArtistFromTitle(title) || "Неизвестный исполнитель";
  const downloadUrl =
    pickDownloadUrlFromDom($) || pickDownloadUrlFromAnchor($("body"), $);
  if (!downloadUrl) return null;

  return {
    id: makeTrackId(downloadUrl),
    title,
    artist: cleanArtistName(author),
    thumbnail: getTrackThumbnail($, pageUrl),
    pageUrl: normalizeUrl(pageUrl),
    downloadUrl: normalizeUrl(downloadUrl),
    duration: $(".track-time, .duration, time").first().text().trim() || "?:??",
  };
}

function getTrackThumbnail(
  $: ReturnType<typeof load>,
  pageUrl: string,
): string {
  const image =
    $("meta[property='og:image']").attr("content") ||
    $("img").first().attr("src") ||
    "https://images.unsplash.com/photo-1516280440614-37939bbacd81?auto=format&fit=crop&w=1200&q=80";

  return normalizeUrl(image, pageUrl);
}

function pickDownloadUrlFromDom($: ReturnType<typeof load>): string | null {
  const candidates = [
    $("audio").first().attr("src"),
    $("source").first().attr("src"),
    $('meta[property="og:audio"]').attr("content"),
    $('a[href*=".mp3"]').first().attr("href"),
    $('a[href*="download"]').first().attr("href"),
    $('a[href*="download_file"]').first().attr("href"),
    $('a[href*="audio"]').first().attr("href"),
    $("script")
      .toArray()
      .map((node) => $(node).html() || "")
      .find((text) =>
        /https?:\/\/[^\s"']+\.(mp3|m4a|aac|wav|ogg)/i.test(text),
      ) ?? null,
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    const normalized = normalizeUrl(candidate);
    if (
      normalized &&
      (/\.(mp3|m4a|aac|wav|ogg)(?:$|[?#])/i.test(normalized) ||
        /\/download\//i.test(normalized))
    ) {
      return normalized;
    }
  }

  return null;
}

function pickDownloadUrlFromAnchor(
  $element: ReturnType<typeof load> | any,
  $: ReturnType<typeof load>,
): string | null {
  const candidates = [
    $element.attr("data-mp3"),
    $element.attr("data-url"),
    $element.attr("data-file"),
    $element.find("[data-mp3]").first().attr("data-mp3"),
    $element.find("[data-url]").first().attr("data-url"),
    $element.find("[data-file]").first().attr("data-file"),
    $element
      .find(
        "a.download, a[href*='download'], a[href*='.mp3'], a[href*='.m4a'], a[href*='.aac'], a[href*='.wav'], a[href*='.ogg']",
      )
      .first()
      .attr("href"),
    $("a[href*='.mp3']").first().attr("href"),
    $("a[href*='download']").first().attr("href"),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    const normalized = normalizeUrl(candidate);
    if (
      normalized &&
      (/\.(mp3|m4a|aac|wav|ogg)(?:$|[?#])/i.test(normalized) ||
        /\/download\//i.test(normalized))
    ) {
      return normalized;
    }
  }

  return null;
}

function buildTrackSlug(query: string): string {
  const transliterated = transliterate(query);
  return transliterated
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function cleanTrackTitle(value: string): string {
  return value
    .replace(/\s*[-–—]\s*.*?Zvuch\.?\s*$/i, "")
    .replace(/\s*музыка\s+в\s+mp3.*$/i, "")
    .replace(/\s*скачать\s+бесплатно.*$/i, "")
    .replace(/\s*слушать\s+музыку.*$/i, "")
    .replace(/\s*на\s+Zvuch\.com.*$/i, "")
    .replace(/\s*\|\s*.*$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function cleanArtistName(value: string): string {
  return (
    value
      .replace(/\s*[-–—]\s*.*$/, "")
      .replace(/^\s*by\s+/i, "")
      .replace(/\s{2,}/g, " ")
      .trim() || "Неизвестный исполнитель"
  );
}

function inferArtistFromTitle(title: string): string {
  const cleaned = title.replace(/\s+[-–—]\s+/g, " - ");
  const match = cleaned.match(/^(.*?)(?:\s+-\s+.*)$/);
  if (!match) return "";
  const candidate = match[1].trim();
  return candidate && candidate.length < title.length ? candidate : "";
}

export async function getZvuchAudioStream(
  downloadUrl: string,
): Promise<Readable> {
  const response = await fetch(normalizeUrl(downloadUrl), {
    headers: {
      ...REQUEST_HEADERS,
      Referer: BASE_URL,
    },
  });

  if (!response.ok || !response.body) {
    throw new Error(
      `Failed to fetch Zvuch audio stream: HTTP ${response.status}`,
    );
  }

  return Readable.fromWeb(response.body as any);
}

function pickDownloadUrl(
  element: unknown,
  $: ReturnType<typeof load>,
): string | null {
  const $element = $(element as any);
  const candidates = [
    $element.attr("data-mp3"),
    $element.attr("data-url"),
    $element.attr("data-file"),
    $element.find("[data-mp3]").first().attr("data-mp3"),
    $element.find("[data-url]").first().attr("data-url"),
    $element.find("[data-file]").first().attr("data-file"),
    $element
      .find(
        "a.download, a[href*='download'], a[href*='.mp3'], a[href*='.m4a'], a[href*='.aac'], a[href*='.wav'], a[href*='.ogg']",
      )
      .first()
      .attr("href"),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    const normalized = normalizeUrl(candidate);
    if (
      normalized &&
      (/\.(mp3|m4a|aac|wav|ogg)(?:$|[?#])/i.test(normalized) ||
        /\/download\//i.test(normalized))
    ) {
      return normalized;
    }
  }

  return null;
}

function normalizeUrl(value: string, baseUrl = BASE_URL): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  if (trimmed.startsWith("/")) return `${baseUrl}${trimmed}`;
  return `${baseUrl}/${trimmed}`;
}

function makeTrackId(value: string): string {
  return Buffer.from(value).toString("base64url").replace(/=+$/g, "");
}
