import { Bot, InlineKeyboard } from 'grammy';
import { z } from 'zod';

const config = z.object({ BOT_TOKEN: z.string().min(20), TMA_URL: z.string().url().default('https://maybe-flax-mu.vercel.app') });

export function createSubShareBot(env: NodeJS.ProcessEnv = process.env) {
  const c = config.parse({ ...env, TMA_URL: env.TMA_URL?.includes('example.com') ? undefined : env.TMA_URL });
  const bot = new Bot(c.BOT_TOKEN);
  bot.command('start', ctx => ctx.reply('Добро пожаловать в SubShare — безопасный шеринг семейных подписок.', {
    reply_markup: new InlineKeyboard().webApp('Открыть SubShare', c.TMA_URL),
  }));
  bot.command('help', ctx => ctx.reply('Откройте Mini App кнопкой /start.'));
  bot.catch(err => console.error('Telegram bot error', err.error));
  return bot;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const bot = createSubShareBot();
  await bot.start({ onStart: info => console.log(`Bot @${info.username} started`) });
}
