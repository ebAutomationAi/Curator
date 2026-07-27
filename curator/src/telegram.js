'use strict';

const TELEGRAM_API = `https://api.telegram.org/bot${process.env.BOT_TOKEN}`;
const TELEGRAM_RETRY_DELAY_MS = 3000;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function sendTelegram(chatId, text, options = {}, logger = console) {
  const targetChatId = chatId ?? process.env.TELEGRAM_CHAT_ID;
  if (!targetChatId) {
    logger.warn('sendTelegram: no hay chat ID disponible');
    return;
  }

  const payload = { chat_id: targetChatId, text };
  if (options.reply_markup) payload.reply_markup = options.reply_markup;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(`${TELEGRAM_API}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        logger.warn({ status: res.status }, 'sendTelegram: fallo al enviar notificación');
        if (res.status >= 500 && attempt === 1) {
          logger.warn({ status: res.status }, 'sendTelegram: reintentando tras error 5xx');
          await sleep(TELEGRAM_RETRY_DELAY_MS);
          continue;
        }
        if (attempt === 2) {
          logger.warn({ status: res.status }, 'sendTelegram: reintento agotado — notificación no enviada');
        }
        return;
      }
      return;
    } catch (err) {
      logger.warn({ error: err.message }, 'sendTelegram: error de red');
      if (attempt === 1) {
        logger.warn({ error: err.message }, 'sendTelegram: reintentando tras error de red');
        await sleep(TELEGRAM_RETRY_DELAY_MS);
        continue;
      }
      logger.warn({ error: err.message }, 'sendTelegram: reintento agotado — notificación no enviada');
      return;
    }
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
