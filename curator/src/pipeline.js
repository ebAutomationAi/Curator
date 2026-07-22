'use strict';

const { fetchJina } = require('./extractors');
const { buildPrompt, callGemini, callGroq } = require('./ai');
const { callKarakeep, checkAndNormalizeTags } = require('./karakeep');
const { sendTelegram, buildKarakeepButton } = require('./telegram');

function extractUrl(text) {
  if (!text) return null;
  const match = text.match(/https?:\/\/\S+/);
  return match ? match[0] : null;
}

async function processMessage(message, logger = console) {
  const text = message?.text ?? '';
  const chatId = message?.chat?.id;
  const url = extractUrl(text);

  if (!url) {
    logger.info({ chatId, text }, 'Mensaje sin URL — ignorado');
    return;
  }

  // Paso 1: Jina
  logger.info({ chatId, url }, 'URL recibida — llamando a Jina');
  const jina = await fetchJina(url, logger);

  if (jina.ok) {
    logger.info({ chatId, url, preview: jina.content.slice(0, 500) }, 'Jina OK');
  } else {
    logger.warn({ chatId, url, error: jina.error }, 'Jina FAIL — continuando solo con URL');
  }

  // Paso 2: IA (Gemini → Groq → fallback)
  const prompt = buildPrompt(url, jina.content ?? '', jina.ok);

  logger.info({ chatId, url }, 'Llamando a Gemini');
  let ai = await callGemini(prompt, logger);

  if (!ai.ok) {
    logger.warn({ chatId, url, error: ai.error }, 'Gemini FAIL — intentando Groq');
    ai = await callGroq(prompt);
  }

  if (ai.ok) {
    logger.info({ chatId, url, json: ai.result }, 'AI OK — JSON estructurado obtenido');
  } else {
    logger.error({ chatId, url, error: ai.error }, 'AI FAIL (Gemini + Groq) — marcando como Sin procesar');
    ai.result = {
      titulo: url.slice(0, 80),
      tipo: 'otro',
      categoria: 'otra',
      resumen: 'Sin procesar',
      puntos_clave: [],
      prioridad: 1,
      etiquetas: [],
    };
  }

  if (ai.ok && Array.isArray(ai.result.etiquetas)) {
    ai.result.etiquetas = ai.result.etiquetas.map((t) => t.toLowerCase());
    ai.result.etiquetas = await checkAndNormalizeTags(ai.result.etiquetas, logger);
  }

  // Paso 3: Karakeep
  logger.info({ chatId, url }, 'Guardando en Karakeep');
  const karakeep = await callKarakeep(url, ai.result, logger);

  if (karakeep.ok) {
    logger.info({ chatId, url, bookmarkId: karakeep.bookmarkId }, 'Karakeep OK — bookmark creado');
    const btn = buildKarakeepButton(karakeep.bookmarkId);

    if (!ai.ok) {
      await sendTelegram(chatId, `❌ Error al procesar\n🔗 ${url}\n💬 No se pudo analizar el contenido`, btn, logger);
    } else if (!jina.ok) {
      await sendTelegram(chatId,
        `⚠️ Guardado (contenido parcial)\n📌 ${ai.result.titulo}\n📂 ${ai.result.categoria} · ${ai.result.tipo}\nℹ️ No se pudo extraer el texto completo`,
        btn, logger,
      );
    } else {
      await sendTelegram(chatId,
        `✅ Guardado\n📌 ${ai.result.titulo}\n📂 ${ai.result.categoria} · ${ai.result.tipo} · prioridad ${ai.result.prioridad}/5\n🏷 ${ai.result.etiquetas.slice(0, 3).join(', ')}`,
        btn, logger,
      );
    }
  } else {
    logger.error({ chatId, url, error: karakeep.error }, 'Karakeep FAIL');
    await sendTelegram(chatId, `❌ Error al procesar\n🔗 ${url}\n💬 ${karakeep.error}`, {}, logger);
  }
}

module.exports = { processMessage, extractUrl };
