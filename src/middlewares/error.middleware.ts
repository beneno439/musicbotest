import { BotError, Context, NextFunction } from "grammy";

export async function errorMiddleware(ctx: Context, next: NextFunction): Promise<void> {
  try {
    await next();
  } catch (error) {
    if (error instanceof BotError) {
      console.error("Telegram API error:", error.message);
    } else {
      console.error("Unhandled bot error:", error);
    }
    await ctx.reply("⚠️ Не удалось обработать запрос. Попробуйте ещё раз позже.").catch(
      (replyError) => console.error("Could not send error message:", replyError),
    );
  }
}
