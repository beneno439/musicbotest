import "dotenv/config";
import { Bot, Context, InlineKeyboard, InputFile } from "grammy";
import { errorMiddleware } from "./middlewares/error.middleware.js";
import {
  getTrackByVideoId,
  getAudioStream,
  searchTracks,
  Track,
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
  const caption = `🎵 ${escapeHtml(track.title)} — ${escapeHtml(track.artist)}${albumLine}\n\n${track.watchUrl}`;

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
    .text("📨 Отправить текст", `lyrics:${track.videoId}`)
    .row()
    .url("🔗 Текст в Genius", geniusSearchUrl(track.title, track.artist));

  await ctx.replyWithPhoto(photo, {
    caption,
    parse_mode: "HTML",
    reply_markup: keyboard,
  });

  try {
    // YouTube throttles ytdl-core aggressively (429s), especially from
    // datacenter IPs. Retry with backoff before giving up.
    const audio = await withRetry(() => getAudioStream(track.videoId), {
      retries: 3,
      baseDelayMs: 1500,
    });
    await ctx.replyWithAudio(
      new InputFile(audio, `${track.artist} - ${track.title}.m4a`),
      {
        title: track.title,
        performer: track.artist,
        caption: `🎵 ${track.title} — ${track.artist}`,
      },
    );
  } catch (error) {
    console.error(`Audio upload failed for ${track.videoId}:`, error);
    await ctx.reply(
      "⚠️ Аудио временно недоступно, но ссылки на прослушивание работают.",
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
  const track = await getTrackByVideoId(ctx.match[1]);
  if (!track) {
    await ctx.reply("⚠️ Не удалось найти выбранную песню заново.");
    return;
  }
  await sendTrack(ctx, track);
});

bot.command("start", async (ctx) => {
  await ctx.reply(
    "👋 Привет!\nЯ помогу найти музыку 🎶, отправь мне что-то из этого:\n\n" +
      "🎵 Название песни или исполнителя\n🔤 Слова из песни\n🎙 Голосовое сообщение с музыкой\n" +
      "📹 Видео с музыкой\n🔊 Аудиозапись\n🎥 Видеосообщение с музыкой\n" +
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
      const tracks = await searchTracks(text);
      if (tracks.length === 0) {
        await ctx.reply("🔍 Ничего не найдено. Попробуйте уточнить название.");
        return;
      }
      const keyboard = new InlineKeyboard();
      for (const [index, result] of tracks.entries()) {
        const label = `${index + 1}. ${result.title}`.slice(0, 60);
        keyboard.text(label, `track:${result.videoId}`).row();
      }
      await ctx.reply("🎵 Выберите песню:", { reply_markup: keyboard });
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

bot.catch((error) => console.error("Fatal update error:", error));
bot.start({ onStart: (info) => console.log(`Bot @${info.username} started`) });
