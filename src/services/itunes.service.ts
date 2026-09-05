export interface AlbumInfo {
  albumName: string;
  artworkUrl: string; // высокое разрешение
  artistName: string;
  trackName: string;
}

const cache = new Map<string, AlbumInfo | null>();

export async function getAlbumInfo(
  title: string,
  artist: string,
): Promise<AlbumInfo | null> {
  const key = `${artist}::${title}`.toLowerCase();
  if (cache.has(key)) return cache.get(key)!;

  try {
    const term = encodeURIComponent(`${artist} ${title}`);
    const res = await fetch(
      `https://itunes.apple.com/search?term=${term}&media=music&entity=song&limit=1`,
    );
    if (!res.ok) throw new Error(`iTunes API ${res.status}`);
    const data = (await res.json()) as {
      results: Array<{
        collectionName?: string;
        artworkUrl100?: string;
        artistName?: string;
        trackName?: string;
      }>;
    };
    const hit = data.results?.[0];
    if (!hit?.artworkUrl100) {
      cache.set(key, null);
      return null;
    }
    const info: AlbumInfo = {
      albumName: hit.collectionName ?? title,
      // iTunes отдаёт 100x100, но можно попросить крупнее подменой в URL
      artworkUrl: hit.artworkUrl100.replace("100x100", "600x600"),
      artistName: hit.artistName ?? artist,
      trackName: hit.trackName ?? title,
    };
    cache.set(key, info);
    return info;
  } catch (error) {
    console.error("iTunes lookup failed:", error);
    cache.set(key, null);
    return null;
  }
}
