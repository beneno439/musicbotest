const YOUTUBE_ID = /^[\w-]{11}$/;

export function extractYouTubeId(text: string): string | null {
  try {
    const url = new URL(text.trim());
    if (url.hostname === "youtu.be" || url.hostname === "www.youtu.be") {
      const id = url.pathname.slice(1).split("/")[0];
      return YOUTUBE_ID.test(id) ? id : null;
    }
    if (url.hostname.endsWith("youtube.com")) {
      const id = url.searchParams.get("v");
      return id && YOUTUBE_ID.test(id) ? id : null;
    }
  } catch {
    // The message is a search query rather than a URL.
  }
  return null;
}

export function isYouTubeUrl(text: string): boolean {
  return /(?:youtube\.com|youtu\.be)/i.test(text);
}

export function normalizeQuery(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

export function isValidVideoId(id: string): boolean {
  return YOUTUBE_ID.test(id);
}

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ]!,
  );
}

export function youtubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export function getThumbnail(
  videoId: string,
  thumbnails?: Array<{ url: string }>,
): string {
  return (
    thumbnails?.[0]?.url ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
  );
}

export function canReadVideoInfo(videoId: string): boolean {
  return YOUTUBE_ID.test(videoId);
}

export function geniusSearchUrl(title: string, artist: string): string {
  return `https://genius.com/search?q=${encodeURIComponent(`${artist} ${title}`)}`;
}
