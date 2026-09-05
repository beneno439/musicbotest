declare module "youtube-search-api" {
  export interface SearchResult {
    id?: string;
    type?: string;
    title?: string;
    channelTitle?: string;
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

declare module "yt-dlp-exec" {
  type YtDlpFlags = Record<string, string | boolean | number>;
  type YtDlpOptions = {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
  };

  interface YtDlp {
    (url: string, flags?: YtDlpFlags, options?: YtDlpOptions): Promise<unknown>;
  }

  const ytdlp: YtDlp;
  export default ytdlp;
}
