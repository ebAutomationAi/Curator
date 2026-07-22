'use strict';

const fastify = require('fastify')({ logger: true });
const { processMessage } = require('./pipeline');

const PORT = 3001;
const HOST = '0.0.0.0';
const TELEGRAM_API = `https://api.telegram.org/bot${process.env.BOT_TOKEN}`;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Webhook mode ──────────────────────────────────────────────────────────────

fastify.post('/webhook/telegram', async (request) => {
  await processMessage(request.body?.message, fastify.log);
  return { ok: true };
});

fastify.get('/health', async () => ({ status: 'ok' }));

// ── Polling mode ──────────────────────────────────────────────────────────────

async function startPolling() {
  fastify.log.info('Modo polling activo (TELEGRAM_POLLING=true)');
  await fetch(`${TELEGRAM_API}/deleteWebhook`).catch(() => {});

  let offset = 0;

  while (true) {
    try {
      const res = await fetch(
        `${TELEGRAM_API}/getUpdates?offset=${offset}&timeout=30`
      );
      if (!res.ok) {
        fastify.log.error({ status: res.status }, 'getUpdates error');
        await sleep(5000);
        continue;
      }
      const { result = [] } = await res.json();
      for (const update of result) {
        offset = update.update_id + 1;
        await processMessage(update.message, fastify.log);
      }
    } catch (err) {
      fastify.log.error({ error: err.message }, 'Polling error — reintentando en 5s');
      await sleep(5000);
    }
  }
}

// ── Arranque ──────────────────────────────────────────────────────────────────

fastify.listen({ port: PORT, host: HOST }, (err) => {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
  if (process.env.TELEGRAM_POLLING === 'true') {
    startPolling();
  }
});
