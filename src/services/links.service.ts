export interface AlternativeLinks {
  songLink: string;
  youtube: string;
  youtubeMusic: string;
  spotify: string;
}

interface SongLinkResponse {
  pageUrl?: string;
  linksByPlatform?: Record<string, { url?: string }>;
}

const cache = new Map<string, AlternativeLinks | null>();

export async function getAlternativeLinks(
  youtubeUrl: string,
  searchQuery: string,
): Promise<AlternativeLinks> {
  const cached = cache.get(youtubeUrl);
  if (cached) return cached;

  const fallback: AlternativeLinks = {
    songLink: `https://song.link/y/${youtubeUrl.split("v=")[1] ?? ""}`,
    youtube: youtubeUrl,
    youtubeMusic: `https://music.youtube.com/search?q=${encodeURIComponent(searchQuery)}`,
    spotify: `https://open.spotify.com/search/${encodeURIComponent(searchQuery)}`,
  };

  // Odesli/song.link's public API does NOT use Bearer auth.
  // The free endpoint works with no key at all (rate limited).
  // A paid/whitelisted key, if you have one, goes in the query string as `key=`.
  const apiKey = process.env.SONGLINK_API_KEY;
  const url = new URL("https://api.song.link/v1-alpha.1/links");
  url.searchParams.set("url", youtubeUrl);
  if (apiKey) url.searchParams.set("key", apiKey);

  try {
    const response = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`song.link API ${response.status}`);
    const data = (await response.json()) as SongLinkResponse;
    const links: AlternativeLinks = {
      songLink: data.pageUrl ?? fallback.songLink,
      youtube: data.linksByPlatform?.youtube?.url ?? youtubeUrl,
      youtubeMusic:
        data.linksByPlatform?.youtubeMusic?.url ?? fallback.youtubeMusic,
      spotify: data.linksByPlatform?.spotify?.url ?? fallback.spotify,
    };
    cache.set(youtubeUrl, links);
    return links;
  } catch (error) {
    console.warn(
      "Alternative links lookup failed; using fallback links.",
      error,
    );
    cache.set(youtubeUrl, fallback);
    return fallback;
  }
}
