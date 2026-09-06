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

declare module "youtube-downloader-cc-api" {
  export interface DownloadDetails {
    url?: string;
    download?: string;
    title?: string;
    response?: string;
    author?: string;
    error?: string;
  }

  export function getDownloadDetails(
    url: string,
    type: "mp3" | "mp4",
    responseType: "stream" | "direct",
  ): Promise<DownloadDetails>;
}
