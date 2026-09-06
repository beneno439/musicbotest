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

  async function fetchLinks(withKey: boolean): Promise<SongLinkResponse> {
    const url = new URL("https://api.song.link/v1-alpha.1/links");
    url.searchParams.set("url", youtubeUrl);
    if (withKey && apiKey) url.searchParams.set("key", apiKey);

    const response = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      const err = new Error(`song.link API ${response.status}`) as Error & {
        statusCode: number;
      };
      err.statusCode = response.status;
      throw err;
    }
    return (await response.json()) as SongLinkResponse;
  }

  try {
    let data: SongLinkResponse;
    try {
      data = await fetchLinks(true);
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      // An invalid/expired key causes a 401 even though the public endpoint
      // works fine unauthenticated. Fall back to the keyless call once.
      if (statusCode === 401 && apiKey) {
        console.warn(
          "song.link API 401 with key set — SONGLINK_API_KEY looks invalid/expired. Retrying without it.",
        );
        data = await fetchLinks(false);
      } else {
        throw error;
      }
    }
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
    cache.set(youtubeUrl, fallback);
    return fallback;
  }
}
