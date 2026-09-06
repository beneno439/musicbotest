import "dotenv/config";
import { Bot, Context, InlineKeyboard, InputFile } from "grammy";
import { errorMiddleware } from "./middlewares/error.middleware.js";
import {
  getTrackByVideoId,
  getAudioStream,
  searchTracks,
  Track,
  recordTrackSelection,
  withRetry,
} from "./services/search.service.js";
import { getAlternativeLinks } from "./services/links.service.js";
import {
  escapeHtml,
  extractYouTubeId,
  geniusSearchUrl,
  isYouTubeUrl,
} from "./utils/helpers.js";
import { getAlbumInfo } from "./services/itunes.service.js";
import { findLyrics } from "./services/lyrics.service.js";
import { recognizeTelegramAudio } from "./services/recognition.service.js";

const token = process.env.BOT_TOKEN;
if (!token || token === "YOUR_TELEGRAM_BOT_TOKEN") {
  throw new Error("BOT_TOKEN is missing. Put it in .env.");
}

const bot = new Bot(token);
bot.use(errorMiddleware);

const LEGAL_TEXT = `1`;

const ADS = ["12"];

function botUsername(): string {
  return (process.env.BOT_USERNAME || "YourMusicSearchBot").replace(/^@/, "");
}

async function sendAd(ctx: Context): Promise<void> {
  if (Math.random() < 0.3)
    await ctx.reply(ADS[Math.floor(Math.random() * ADS.length)]);
}

async function showSearchResults(ctx: Context, query: string): Promise<void> {
  const tracks = await searchTracks(query);
  if (tracks.length === 0) {
    await ctx.reply("🔍 Ничего не найдено. Попробуйте уточнить название.");
    return;
  }
  const keyboard = new InlineKeyboard();
  for (const [index, result] of tracks.entries()) {
    const title = result.title.slice(0, 48);
    const label = `${index + 1}. ${title} (${result.duration})`;
    keyboard.text(label, `track:${result.videoId}`).row();
  }
  await ctx.reply("🎵 Выберите песню:", { reply_markup: keyboard });
}

async function recognizeAndSearch(ctx: Context, fileId: string): Promise<void> {
  await ctx.replyWithChatAction("typing");
  try {
    const recognized = await recognizeTelegramAudio(ctx, fileId);
    if (!recognized) {
      await ctx.reply(
        "🔍 Не удалось распознать песню. Отправьте более длинный и чистый фрагмент.",
      );
      return;
    }
    await ctx.reply(`🎧 Похоже на: ${recognized.artist} — ${recognized.title}`);
    await showSearchResults(ctx, `${recognized.artist} ${recognized.title}`);
  } catch (error) {
    console.error(error);
  }
}

async function sendTrack(ctx: Context, track: Track): Promise<void> {
  await ctx.replyWithChatAction("upload_photo");

  const [album, links] = await Promise.all([
    getAlbumInfo(track.title, track.artist),
    getAlternativeLinks(track.watchUrl, `${track.artist} ${track.title}`),
  ]);
  const photo = album?.artworkUrl ?? track.thumbnail;
  const albumLine = album?.albumName
    ? `\n💿 ${escapeHtml(album.albumName)}`
    : "";
  const caption = `🎵 ${escapeHtml(track.title)} — ${escapeHtml(track.artist)}${albumLine}\n▶️ YouTube\n\n${track.watchUrl}`;

  const keyboard = new InlineKeyboard()
    .url("▶️ YouTube", links.youtube)
    .url("🎧 Song.link", links.songLink)
    .row();
  keyboard
    .url("🎶 YouTube Music", links.youtubeMusic)
    .url("🟢 Spotify", links.spotify)
    .row();
  keyboard
    .url("📝 Открыть текст", geniusSearchUrl(track.title, track.artist))
    .text("📨 Отправить текст", `lyrics:${track.videoId}`);

  await ctx.replyWithPhoto(photo, {
    caption,
    parse_mode: "HTML",
    reply_markup: keyboard,
  });

  try {
    await ctx.reply("⏳ Скачиваю аудио, это может занять некоторое время...");
    // Keep retries for transient yt-dlp/network failures.
    const audio = await withRetry(() => getAudioStream(track.videoId), {
      retries: 3,
      baseDelayMs: 1500,
    });
    await ctx.replyWithAudio(
      new InputFile(audio, `${track.artist} - ${track.title}.mp3`),
      {
        title: track.title,
        performer: track.artist,
        caption: `🎵 ${track.title} — ${track.artist}`,
      },
    );
  } catch (error) {
    console.error(`Audio upload failed for ${track.videoId}:`, error);
    await ctx.reply(
      "⚠️ Не удалось загрузить полное аудио. Попробуйте выбрать другую версию песни.",
    );
  }
}
bot.callbackQuery(/^lyrics:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const videoId = ctx.match[1];
  const track = await getTrackByVideoId(videoId);
  if (!track) {
    await ctx.reply("⚠️ Не удалось найти эту песню заново.");
    return;
  }

  const lyrics = await findLyrics(track.title, track.artist);
  if (!lyrics) {
    await ctx.reply(
      `Текст не найден. Попробуйте открыть Genius:\n${geniusSearchUrl(track.title, track.artist)}`,
    );
    return;
  }
  const text = `📝 ${track.title} — ${track.artist}\n\n${lyrics}`;
  for (let offset = 0; offset < text.length; offset += 3900) {
    await ctx.reply(text.slice(offset, offset + 3900));
  }
});

bot.callbackQuery(/^track:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery("Загружаю выбранную песню...");
  await ctx.reply("⏳ Вы выбрали трек. Начинаю загрузку аудио...");
  const track = await getTrackByVideoId(ctx.match[1]);
  if (!track) {
    await ctx.reply("⚠️ Не удалось найти выбранную песню заново.");
    return;
  }
  await recordTrackSelection(track.videoId);
  await sendTrack(ctx, track);
});

bot.command("start", async (ctx) => {
  await ctx.reply(
    "👋 Привет!\nЯ помогу найти музыку 🎶, отправь мне что-то из этого:\n\n" +
      "🎵 Название песни или исполнителя\n🔤 Слова из песни\n🎙 Голосовое сообщение с музыкой\n" +
      "📹 Видео с музыкой (не умеем)\n🔊 Аудиозапись\n🎥 Видеосообщение с музыкой(не умеем)\n" +
      "🔗 Ссылку на Instagram, TikTok, YouTube и другие сайты\n\n🕺 Наслаждайся!",
  );
});

bot.command("legal", (ctx) => ctx.reply(LEGAL_TEXT));

bot.on("message:text", async (ctx) => {
  const text = ctx.message.text.trim();
  if (!text || text.startsWith("/")) return;
  const videoId = isYouTubeUrl(text) ? extractYouTubeId(text) : null;
  let track: Track | null = null;
  try {
    if (videoId) {
      track = await getTrackByVideoId(videoId);
    } else {
      await showSearchResults(ctx, text);
      return;
    }
  } catch (error) {
    console.error("Music search failed:", error);
    await ctx.reply(
      "⚠️ Поиск временно недоступен. Попробуйте ещё раз через минуту.",
    );
    return;
  }
  if (!track) {
    await ctx.reply("🔍 Ничего не найдено. Попробуйте уточнить название.");
    return;
  }
  await sendTrack(ctx, track);
});

bot.on(["message:audio", "message:voice"], async (ctx) => {
  const fileId = ctx.message.audio?.file_id ?? ctx.message.voice?.file_id;
  if (!fileId) return;
  try {
    await recognizeAndSearch(ctx, fileId);
  } catch (error) {
    console.error("Audio recognition failed:", error);
    await ctx.reply(
      "⚠️ Не удалось распознать аудио. Проверьте настройку AUDD_API_TOKEN и отправьте фрагмент ещё раз.",
    );
  }
});

bot.catch((error) => console.error("Fatal update error:", error));
bot.start({ onStart: (info) => console.log(`Bot @${info.username} started`) });
