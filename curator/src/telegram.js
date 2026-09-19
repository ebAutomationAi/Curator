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
          await sleep(TELEGRAM_RETRY_DELAY_MS);
          continue;
        }
        return;
      }
      return;
    } catch (err) {
      logger.warn({ error: err.message }, 'sendTelegram: error de red');
      if (attempt === 1) {
        await sleep(TELEGRAM_RETRY_DELAY_MS);
        continue;
      }
      return;
    }
  }
}

// Solución 1 + 2: notifica al operador (ADMIN_CHAT_ID) con clase de error y proveedor
async function notifyAdmin(message, logger = console) {
  const adminChatId = process.env.ADMIN_CHAT_ID;
  if (!adminChatId) {
    logger.warn('notifyAdmin: ADMIN_CHAT_ID no configurado — alerta descartada');
    return;
  }
  await sendTelegram(adminChatId, `🚨 Curator ALERTA\n${message}`, {}, logger);
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

module.exports = { sendTelegram, notifyAdmin, buildKarakeepButton };
