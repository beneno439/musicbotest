import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context } from "grammy";

interface AuddResponse {
  status?: string;
  result?: {
    artist?: string;
    title?: string;
  } | null;
  error?: {
    error_code?: string;
    error_message?: string;
  };
}

export async function recognizeTelegramAudio(
  ctx: Context,
  fileId: string,
): Promise<{ artist: string; title: string } | null> {
  const token = process.env.AUDD_API_TOKEN?.trim();
  if (!token) {
    throw new Error("AUDD_API_TOKEN is not configured.");
  }

  const directory = await mkdtemp(join(tmpdir(), "music-recognition-"));
  const audioPath = join(directory, "input");

  try {
    const file = await ctx.api.getFile(fileId);
    if (!file.file_path) {
      throw new Error("Telegram did not provide an audio file path.");
    }
    const download = await fetch(
      `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`,
    );
    if (!download.ok) {
      throw new Error(`Telegram file download failed with status ${download.status}.`);
    }
    await writeFile(audioPath, Buffer.from(await download.arrayBuffer()));

    const form = new FormData();
    form.append("api_token", token);
    form.append("return", "apple_music,spotify");
    const audio = await BunlessBlob.fromFile(audioPath);
    form.append("file", audio, "input");

    const response = await fetch("https://api.audd.io/", {
      method: "POST",
      body: form,
    });
    if (!response.ok) {
      throw new Error(`AudD request failed with status ${response.status}.`);
    }

    const payload = (await response.json()) as AuddResponse;
    if (payload.status !== "success") {
      throw new Error(payload.error?.error_message || "AudD could not recognize the audio.");
    }

    const artist = payload.result?.artist?.trim();
    const title = payload.result?.title?.trim();
    return artist && title ? { artist, title } : null;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

class BunlessBlob {
  static async fromFile(path: string): Promise<Blob> {
    const { readFile } = await import("node:fs/promises");
    return new Blob([await readFile(path)], { type: "application/octet-stream" });
  }
}
