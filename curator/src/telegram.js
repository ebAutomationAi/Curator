'use strict';

const TELEGRAM_API = `https://api.telegram.org/bot${process.env.BOT_TOKEN}`;

async function sendTelegram(chatId, text, options = {}, logger = console) {
  const targetChatId = chatId ?? process.env.TELEGRAM_CHAT_ID;
  if (!targetChatId) {
    logger.warn('sendTelegram: no hay chat ID disponible');
    return;
  }
  try {
    const payload = { chat_id: targetChatId, text };
    if (options.reply_markup) payload.reply_markup = options.reply_markup;
    const res = await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) logger.warn({ status: res.status }, 'sendTelegram: fallo al enviar notificación');
  } catch (err) {
    logger.warn({ error: err.message }, 'sendTelegram: error de red');
  }
}

function buildKarakeepButton(bookmarkId) {
  const publicUrl = process.env.NEXTAUTH_URL;
  if (!publicUrl || !bookmarkId) return {};
  return {
    reply_markup: {
      inline_keyboard: [[
        { text: '📖 Ver en Karakeep', url: `${publicUrl}/dashboard/preview/${bookmarkId}` },
      ]],
    },
  };
}

module.exports = { sendTelegram, buildKarakeepButton };
