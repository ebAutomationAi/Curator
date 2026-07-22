'use strict';

const KARAKEEP_TIMEOUT_MS = 20000;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function checkAndNormalizeTags(etiquetas, logger = console) {
  if (!etiquetas?.length) return etiquetas;
  const baseUrl = process.env.KARAKEEP_URL ?? 'http://karakeep:3000';
  const apiKey = process.env.KARAKEEP_API_KEY;
  if (!apiKey) return etiquetas;

  // AbortController declarado fuera del try para que finally pueda limpiar timer
  // aunque el fetch lance antes de asignarlo.
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
      logger.warn({ status: res.status }, 'checkAndNormalizeTags: GET /tags falló — usando etiquetas sin normalizar');
      return etiquetas;
    }
    const data = await res.json();
    const existingTags = data.tags ?? [];
    const existingMap = new Map(existingTags.map((t) => [t.name.toLowerCase(), t.name]));
    const normalized = etiquetas.map((tag) => {
      const lower = tag.toLowerCase();
      return existingMap.has(lower) ? existingMap.get(lower) : lower;
    });
    logger.info({ original: etiquetas, normalized }, 'checkAndNormalizeTags — etiquetas normalizadas');
    return normalized;
  } catch (err) {
    // err.name === 'AbortError' cuando dispara el timeout; err.message lo recoge igual.
    logger.warn({ error: err.message }, 'checkAndNormalizeTags: error — usando etiquetas sin normalizar');
    return etiquetas;
  } finally {
    clearTimeout(timer);
  }
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
        await sleep(2000);
        continue;
      }
      if (!bookmarkRes.ok) {
        const errBody = await bookmarkRes.text().catch(() => '<no body>');
        if (bookmarkRes.status === 401) logger.warn({ body: errBody }, 'Karakeep 401 — segundo intento fallido');
        throw new Error(`HTTP ${bookmarkRes.status}`);
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
            logger.warn({ status: tagsRes.status }, 'Karakeep tags FAIL — bookmark creado sin etiquetas');
          }
        } catch (tagsErr) {
          // AbortError si timeout; cualquier error de red en otro caso.
          // El bookmark ya existe: este fallo es degradación controlada, no fatal.
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
  return { ok: false, error: 'Karakeep 401 — sesión inválida tras reintento' };
}

module.exports = { callKarakeep, checkAndNormalizeTags };
