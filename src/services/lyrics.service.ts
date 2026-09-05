interface LyricsResult {
  plainLyrics?: string;
  lyrics?: string;
}

function clean(value: string): string {
  return value
    .replace(/\[[^\]]+\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function findLyrics(
  title: string,
  artist: string,
): Promise<string | null> {
  const trackName = clean(title)
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s*\[[^\]]*\]\s*/g, " ")
    .trim();
  const artistName = clean(artist);

  try {
    const response = await fetch(
      `https://lrclib.net/api/search?track_name=${encodeURIComponent(trackName)}&artist_name=${encodeURIComponent(artistName)}`,
      { headers: { Accept: "application/json", "User-Agent": "TelegramMusicSearchBot/1.0" } },
    );
    if (response.ok) {
      const results = (await response.json()) as LyricsResult[];
      const lyrics = results.find((result) => result.plainLyrics)?.plainLyrics;
      if (lyrics) return lyrics.trim();
    }
  } catch (error) {
    console.error("LRCLIB lyrics lookup failed:", error);
  }

  try {
    const response = await fetch(
      `https://api.lyrics.ovh/v1/${encodeURIComponent(artistName)}/${encodeURIComponent(trackName)}`,
    );
    if (!response.ok) return null;
    const result = (await response.json()) as LyricsResult;
    return result.lyrics?.trim() || null;
  } catch (error) {
    console.error("lyrics.ovh lookup failed:", error);
    return null;
  }
}
