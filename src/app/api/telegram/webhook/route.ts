import { NextResponse } from 'next/server';
import { createSubShareBot } from '../../../../bot/runtime';

export async function POST(request: Request) {
  try {
    const token = request.headers.get('x-telegram-bot-api-secret-token');
    if (!token || token !== process.env.TELEGRAM_WEBHOOK_SECRET) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    await createSubShareBot().handleUpdate(await request.json());
    return NextResponse.json({ ok: true });
  } catch { return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 }); }
}
