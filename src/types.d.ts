declare module "youtube-search-api" {
  export interface SearchResult {
    id?: string;
    type?: string;
    title?: string;
    channelTitle?: string;
    lengthSeconds?: number | string;
    length?: { simpleText?: string };
    thumbnail?: {
      thumbnails?: Array<{ url: string; width?: number; height?: number }>;
    };
  }

  export function GetListByKeyword(
    keyword: string,
    playlist?: boolean,
    limit?: number,
    options?: Array<{ type: "video" | "channel" | "playlist" | "movie" }>
  ): Promise<{ items?: SearchResult[]; nextPage?: string }>;
}
