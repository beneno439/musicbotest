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

declare module "yt-dlp-wrap" {
  export default class YTDlpWrap {
    constructor(binaryPath?: string);
    execPromise(args: string[]): Promise<string>;
  }

  declare module "ffmpeg-static" {
    const ffmpegPath: string | null;
    export default ffmpegPath;
  }
}
