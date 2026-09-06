import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import decode from "audio-decode";
import { pipeline } from "@xenova/transformers";
import type { Context } from "grammy";

interface TranscriptionResult {
  text?: string;
}

type Transcriber = (
  audio: Float32Array,
  options: { chunk_length_s: number; stride_length_s: number },
) => Promise<TranscriptionResult>;

let transcriberPromise: Promise<Transcriber> | null = null;

export async function transcribeTelegramMedia(
  ctx: Context,
  fileId: string,
): Promise<string | null> {
  const directory = await mkdtemp(join(tmpdir(), "music-transcription-"));
  try {
    const file = await ctx.api.getFile(fileId);
    if (!file.file_path) {
      throw new Error("Telegram did not provide a media file path.");
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

    const decoded = await decode(await readFile(mediaPath));
    const audio = toMono16k(decoded);
    const transcriber = await getTranscriber();
    const result = await transcriber(audio, {
      chunk_length_s: 30,
      stride_length_s: 5,
    });
    return result.text?.trim() || null;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function getTranscriber(): Promise<Transcriber> {
  if (!transcriberPromise) {
    transcriberPromise = pipeline(
      "automatic-speech-recognition",
      process.env.WHISPER_MODEL || "Xenova/whisper-tiny",
    ) as Promise<Transcriber>;
  }
  return transcriberPromise;
}

function toMono16k(audio: {
  sampleRate: number;
  channelData: Float32Array[];
}): Float32Array {
  const mono = new Float32Array(audio.channelData[0]?.length ?? 0);
  for (const channel of audio.channelData) {
    for (let index = 0; index < mono.length; index += 1) {
      mono[index] += (channel[index] ?? 0) / audio.channelData.length;
    }
  }
  if (audio.sampleRate === 16000) return mono;

  const outputLength = Math.max(1, Math.round(mono.length * 16000 / audio.sampleRate));
  const output = new Float32Array(outputLength);
  const scale = audio.sampleRate / 16000;
  for (let index = 0; index < output.length; index += 1) {
    const sourceIndex = index * scale;
    const left = Math.floor(sourceIndex);
    const right = Math.min(left + 1, mono.length - 1);
    const weight = sourceIndex - left;
    output[index] = (mono[left] ?? 0) * (1 - weight) + (mono[right] ?? 0) * weight;
  }
  return output;
}
