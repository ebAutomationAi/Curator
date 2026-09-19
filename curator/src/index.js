'use strict';

const fastify = require('fastify')({ logger: true });
const fs = require('fs/promises');
const path = require('path');
const { processMessage } = require('./pipeline');
const { canaryCheck } = require('./ai');
const { notifyAdmin } = require('./telegram');

const PORT = 3001;
const HOST = '0.0.0.0';
const TELEGRAM_API = `https://api.telegram.org/bot${process.env.BOT_TOKEN}`;
const OFFSET_FILE = '/app/data/offset.json';

// Solución 1: canary periódico cada 6 horas
const CANARY_INTERVAL_MS = 6 * 60 * 60 * 1000;

let isShuttingDown = false;
let activeJobs = 0;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function readPersistedOffset() {
  try {
    const raw = await fs.readFile(OFFSET_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (typeof parsed.offset === 'number') return parsed.offset;
    fastify.log.warn({ parsed }, 'offset.json con formato inesperado — usando offset 0');
    return 0;
  } catch (err) {
    fastify.log.warn({ error: err.message }, 'No se pudo leer offset.json — usando offset 0');
    return 0;
  }
}

async function persistOffset(offset) {
  try {
    await fs.mkdir(path.dirname(OFFSET_FILE), { recursive: true });
    await fs.writeFile(OFFSET_FILE, JSON.stringify({ offset }));
  } catch (err) {
    fastify.log.warn({ error: err.message }, 'No se pudo escribir offset.json — continuando solo en memoria');
  }
}

// Solución 1: ejecuta canary y alerta si algún proveedor falla
async function runCanary() {
  fastify.log.info('Canary check — verificando proveedores IA');
  try {
    const result = await canaryCheck(fastify.log);
    for (const [provider, status] of Object.entries(result)) {
      if (!status.ok) {
        fastify.log.error({ provider, error: status.error }, 'Canary FAIL');
        await notifyAdmin(
          `⚠️ Canary periódico\nProveedor: ${provider.toUpperCase()}\nModelo: ${status.model}\nError: ${status.error}`,
          fastify.log,
        );
      } else {
        fastify.log.info({ provider, model: status.model }, 'Canary OK');
      }
    }
  } catch (err) {
    fastify.log.error({ error: err.message }, 'Canary check — error inesperado');
  }
}

// ── Webhook mode ──────────────────────────────────────────────────────────────

fastify.post('/webhook/telegram', async (request) => {
  activeJobs++;
  try {
    await processMessage(request.body?.message, fastify.log);
  } finally {
    activeJobs--;
  }
  return { ok: true };
});

fastify.get('/health', async () => ({ status: 'ok' }));

// Solución 5: endpoint HTTP para check de salud IA (curl desde Orange Pi o monitorización externa)
fastify.get('/health/ai', async () => {
  const result = await canaryCheck(fastify.log);
  return result;
});

// ── Polling mode ──────────────────────────────────────────────────────────────

async function startPolling() {
  fastify.log.info('Modo polling activo (TELEGRAM_POLLING=true)');
  await fetch(`${TELEGRAM_API}/deleteWebhook`).catch(() => { });

  let offset = await readPersistedOffset();

  while (!isShuttingDown) {
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
        await persistOffset(offset);
        activeJobs++;
        try {
          await processMessage(update.message, fastify.log);
        } finally {
          activeJobs--;
        }
      }
    } catch (err) {
      fastify.log.error({ error: err.message }, 'Polling error — reintentando en 5s');
      await sleep(5000);
    }
  }
}

// ── Apagado ordenado ──────────────────────────────────────────────────────────

async function shutdown() {
  fastify.log.info('Señal de apagado recibida, iniciando shutdown ordenado');
  isShuttingDown = true;

  const maxWaitMs = 10000;
  const pollIntervalMs = 200;
  let waited = 0;
  while (activeJobs > 0 && waited < maxWaitMs) {
    await sleep(pollIntervalMs);
    waited += pollIntervalMs;
  }

  await fastify.close();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// ── Arranque ──────────────────────────────────────────────────────────────────

fastify.listen({ port: PORT, host: HOST }, async (err) => {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }

  // Canary en arranque + periódico cada 6h (Solución 1)
  await runCanary();
  setInterval(runCanary, CANARY_INTERVAL_MS);

  if (process.env.TELEGRAM_POLLING === 'true') {
    startPolling();
  }
});
