import { createHmac } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context } from "grammy";

interface AcrCloudResponse {
  status?: { code?: number; msg?: string };
  metadata?: {
    music?: Array<{
      title?: string;
      artists?: Array<{ name?: string }>;
    }>;
  };
}

export interface RecognizedTrack {
  artist: string;
  title: string;
}

export async function recognizeTelegramMedia(
  ctx: Context,
  fileId: string,
): Promise<RecognizedTrack | null> {
  const host = process.env.ACRCLOUD_HOST?.trim();
  const accessKey = process.env.ACRCLOUD_ACCESS_KEY?.trim();
  const accessSecret = process.env.ACRCLOUD_ACCESS_SECRET?.trim();
  if (!host || !accessKey || !accessSecret) {
    throw new Error(
      "ACRCLOUD_HOST, ACRCLOUD_ACCESS_KEY and ACRCLOUD_ACCESS_SECRET are required.",
    );
  }

  const directory = await mkdtemp(join(tmpdir(), "music-recognition-"));
  try {
    const file = await ctx.api.getFile(fileId);
    if (!file.file_path) {
      throw new Error("Telegram did not provide a media file path.");
    }
    const maxBytes = Number(process.env.MAX_RECOGNITION_BYTES || 25_000_000);
    if (file.file_size && file.file_size > maxBytes) {
      throw new Error(`Media file exceeds the ${maxBytes}-byte recognition limit.`);
    }

    const extension = file.file_path.includes(".")
      ? file.file_path.slice(file.file_path.lastIndexOf("."))
      : ".bin";
    const mediaPath = join(directory, `input${extension}`);
    const download = await fetch(
      `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`,
    );
    if (!download.ok) {
      throw new Error(`Telegram file download failed with status ${download.status}.`);
    }
    await writeFile(mediaPath, Buffer.from(await download.arrayBuffer()));

    const result = await identifyWithAcrCloud(
      host,
      accessKey,
      accessSecret,
      await readFile(mediaPath),
      `input${extension}`,
    );
    const music = result.metadata?.music?.[0];
    const title = music?.title?.trim();
    const artist = music?.artists
      ?.map((item) => item.name?.trim())
      .filter((name): name is string => Boolean(name))
      .join(", ");
    return title && artist ? { title, artist } : null;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function identifyWithAcrCloud(
  host: string,
  accessKey: string,
  accessSecret: string,
  contents: Buffer,
  filename: string,
): Promise<AcrCloudResponse> {
  const httpMethod = "POST";
  const uri = "/v1/identify";
  const dataType = "audio";
  const signatureVersion = "1";
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac("sha1", accessSecret)
    .update(
      [httpMethod, uri, accessKey, dataType, signatureVersion, timestamp].join("\n"),
    )
    .digest("base64");

  const form = new FormData();
  form.append("access_key", accessKey);
  form.append("sample_bytes", contents.byteLength.toString());
  form.append("timestamp", timestamp);
  form.append("signature", signature);
  form.append("data_type", dataType);
  form.append("signature_version", signatureVersion);
  form.append("sample", new Blob([new Uint8Array(contents)]), filename);

  const response = await fetch(`https://${host}${uri}`, {
    method: httpMethod,
    body: form,
  });
  const body = await response.text();
  let payload: AcrCloudResponse;
  try {
    payload = JSON.parse(body) as AcrCloudResponse;
  } catch {
    throw new Error(`ACRCloud returned invalid JSON: ${body.slice(0, 300)}`);
  }
  if (!response.ok) {
    throw new Error(`ACRCloud request failed with HTTP ${response.status}.`);
  }
  if (payload.status?.code !== 0) {
    throw new Error(
      `ACRCloud could not recognize the media: ${payload.status?.msg || "unknown error"}.`,
    );
  }
  return payload;
}
