import { NextResponse } from 'next/server';
export async function POST(request: Request) {
  try {
    const token = request.headers.get('x-telegram-bot-api-secret-token');
    if (!token || token !== process.env.TELEGRAM_WEBHOOK_SECRET) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const update = await request.json();
    const message = update?.message;
    if (message?.chat?.id && typeof message.text === 'string' && message.text.startsWith('/start')) {
      const botToken = process.env.BOT_TOKEN;
      const appUrl = process.env.TMA_URL ?? 'https://maybe-flax-mu.vercel.app';
      const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: message.chat.id, text: 'Добро пожаловать в SubShare — безопасный шеринг семейных подписок.', reply_markup: { inline_keyboard: [[{ text: 'Открыть SubShare', web_app: { url: appUrl } }]] } }) });
      if (!response.ok) console.error('Telegram sendMessage failed', response.status);
    }
    return NextResponse.json({ ok: true });
  } catch { return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 }); }
}
