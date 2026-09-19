// karakeep.js — /opt/curator/curator/src/karakeep.js — reemplazo total
'use strict';

const KARAKEEP_TIMEOUT_MS = 20000;
const TAGS_CACHE_TTL_MS = 5 * 60 * 1000;

let tagsCache = { tags: null, fetchedAt: 0 };

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function checkAndNormalizeTags(etiquetas, logger = console) {
  if (!etiquetas?.length) return etiquetas;
  const baseUrl = process.env.KARAKEEP_URL ?? 'http://karakeep:3000';
  const apiKey = process.env.KARAKEEP_API_KEY;
  if (!apiKey) return etiquetas;

  const isFresh = tagsCache.tags !== null && (Date.now() - tagsCache.fetchedAt < TAGS_CACHE_TTL_MS);

  let existingMap;

  if (isFresh) {
    existingMap = tagsCache.tags;
  } else {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), KARAKEEP_TIMEOUT_MS);

    try {
      const res = await fetch(`${baseUrl}/api/v1/tags`, {
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          'authorization': `Bearer ${apiKey}`,
        },
      });
      if (!res.ok) {
        if (res.status === 401) tagsCache = { tags: null, fetchedAt: 0 };
        if (tagsCache.tags !== null) {
          logger.warn({ status: res.status }, 'checkAndNormalizeTags: GET /tags falló — usando caché desactualizada');
          existingMap = tagsCache.tags;
        } else {
          logger.warn({ status: res.status }, 'checkAndNormalizeTags: GET /tags falló — usando etiquetas sin normalizar');
          return etiquetas;
        }
      } else {
        const data = await res.json();
        const existingTags = data.tags ?? [];
        existingMap = new Map(existingTags.map((t) => [t.name.toLowerCase(), t.name]));
        tagsCache = { tags: existingMap, fetchedAt: Date.now() };
      }
    } catch (err) {
      if (tagsCache.tags !== null) {
        logger.warn({ error: err.message }, 'checkAndNormalizeTags: error — usando caché desactualizada');
        existingMap = tagsCache.tags;
      } else {
        logger.warn({ error: err.message }, 'checkAndNormalizeTags: error — usando etiquetas sin normalizar');
        return etiquetas;
      }
    } finally {
      clearTimeout(timer);
    }
  }

  const normalized = etiquetas.map((tag) => {
    const lower = tag.toLowerCase();
    return existingMap.has(lower) ? existingMap.get(lower) : lower;
  });
  logger.info({ original: etiquetas, normalized }, 'checkAndNormalizeTags — etiquetas normalizadas');
  return normalized;
}

async function callKarakeep(url, aiResult, logger = console) {
  const baseUrl = process.env.KARAKEEP_URL ?? 'http://karakeep:3000';
  const apiKey = process.env.KARAKEEP_API_KEY;
  logger.info({ keyPrefix: apiKey ? apiKey.slice(0, 8) : '<vacía>' }, 'callKarakeep — API key en uso');
  if (!apiKey) return { ok: false, error: 'KARAKEEP_API_KEY no configurada' };

  const headers = {
    'content-type': 'application/json',
    'authorization': `Bearer ${apiKey}`,
  };

  for (let attempt = 1; attempt <= 2; attempt++) {
    let timer;
    try {
      const controller = new AbortController();
      timer = setTimeout(() => controller.abort(), KARAKEEP_TIMEOUT_MS);

      // ── Paso 1: crear el bookmark ─────────────────────────────────────────
      const bookmarkRes = await fetch(`${baseUrl}/api/v1/bookmarks`, {
        method: 'POST',
        signal: controller.signal,
        headers,
        body: JSON.stringify({
          type: 'link',
          url,
          title: aiResult.titulo,
          note: aiResult.resumen,
        }),
      });

      if (bookmarkRes.status === 401 && attempt === 1) {
        const body401 = await bookmarkRes.text().catch(() => '<no body>');
        logger.warn({ body: body401 }, 'Karakeep 401 — sesión inválida, reintentando en 2s');
        clearTimeout(timer);
        await sleep(2000);
        continue;
      }

      if (bookmarkRes.status === 500 && attempt === 1) {
        const body500 = await bookmarkRes.text().catch(() => '<no body>');
        logger.warn({ body: body500 }, 'Karakeep 500 — error interno, reintentando en 3s');
        clearTimeout(timer);
        await sleep(3000);
        continue;
      }

      if (!bookmarkRes.ok) {
        const errBody = await bookmarkRes.text().catch(() => '<no body>');
        logger.error({ status: bookmarkRes.status, body: errBody }, 'Karakeep error no recuperable');
        throw new Error(`HTTP ${bookmarkRes.status}: ${errBody.slice(0, 200)}`);
      }

      const bookmark = await bookmarkRes.json();

      // ── Paso 2: adjuntar etiquetas ────────────────────────────────────────
      // Controller independiente: el timer del paso 1 puede tener milisegundos
      // restantes si ese fetch tardó; el paso 2 merece su propia ventana completa.
      if (aiResult.etiquetas?.length > 0) {
        const tagsController = new AbortController();
        const tagsTimer = setTimeout(() => tagsController.abort(), KARAKEEP_TIMEOUT_MS);
        try {
          const tagsRes = await fetch(`${baseUrl}/api/v1/bookmarks/${bookmark.id}/tags`, {
            method: 'POST',
            signal: tagsController.signal,
            headers,
            body: JSON.stringify({
              tags: aiResult.etiquetas.map((t) => ({ tagName: t })),
            }),
          });
          if (!tagsRes.ok) {
            const tagsErrBody = await tagsRes.text().catch(() => '<no body>');
            logger.warn({ status: tagsRes.status, body: tagsErrBody }, 'Karakeep tags FAIL — bookmark creado sin etiquetas');
          }
        } catch (tagsErr) {
          logger.warn({ error: tagsErr.message }, 'Karakeep tags ERROR — bookmark creado sin etiquetas');
        } finally {
          clearTimeout(tagsTimer);
        }
      }

      return { ok: true, bookmarkId: bookmark.id };
    } catch (err) {
      return { ok: false, error: err.message };
    } finally {
      clearTimeout(timer);
    }
  }

  // Inalcanzable con la lógica actual: el catch del loop siempre hace return.
  // Se conserva como contrato explícito para futuros cambios en el flujo de reintentos.
  return { ok: false, error: 'Karakeep — error no recuperable tras reintento' };
}

module.exports = { callKarakeep, checkAndNormalizeTags };
