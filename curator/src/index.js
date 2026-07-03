'use strict';

const fastify = require('fastify')({ logger: true });

const PORT = 3001;
const HOST = '0.0.0.0';
const JINA_TIMEOUT_MS = 20000;
const AI_TIMEOUT_MS = 30000;
const KARAKEEP_TIMEOUT_MS = 20000;
const TELEGRAM_API = `https://api.telegram.org/bot${process.env.BOT_TOKEN}`;
const GEMINI_API = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions';

const TIPOS_VALIDOS = ['articulo', 'video', 'hilo', 'podcast', 'otro'];
const CATEGORIAS_VALIDAS = [
  'tecnologia', 'ciencia', 'negocios', 'educacion', 'salud',
  'inteligencia-artificial', 'programacion', 'vibe-coding', 'llm',
  'agentes-ia', 'herramientas-ia', 'prompt-engineering', 'devops', 'otra',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractUrl(text) {
  if (!text) return null;
  const match = text.match(/https?:\/\/\S+/);
  return match ? match[0] : null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function buildPrompt(url, content, jinaOk) {
  const contenido = jinaOk
    ? content.slice(0, 8000)
    : `[No se pudo extraer el texto completo. Resume con la información disponible.]\nURL: ${url}`;

  return `Analiza el siguiente contenido web y devuelve ÚNICAMENTE un objeto JSON válido con exactamente estos campos. Sin texto antes ni después. Sin bloques de código markdown.

{
  "titulo": "string máx 80 caracteres",
  "tipo": "articulo | video | hilo | podcast | otro",
  "categoria": "<elige exactamente una de la lista de abajo>",
  "resumen": "2 a 3 frases en español",
  "puntos_clave": ["string", "string", "string"],
  "prioridad": 3,
  "etiquetas": ["minúsculas", "minúsculas", "minúsculas"]
}

CATEGORÍAS — elige exactamente una:
tecnologia, ciencia, negocios, educacion, salud, inteligencia-artificial, programacion, vibe-coding, llm, agentes-ia, herramientas-ia, prompt-engineering, devops, otra

ETIQUETAS — elige 3-6 de esta lista base, o crea nuevas si no encajan (siempre en minúsculas):
ia, llm, chatgpt, claude, gemini, openai, anthropic, machine-learning, deep-learning, agentes, rag, fine-tuning, prompt-engineering, multimodal, programacion, python, javascript, typescript, nodejs, docker, linux, git, api, backend, frontend, arquitectura, base-datos, seguridad, vibe-coding, cursor, claude-code, copilot, automatizacion, no-code, low-code, workflow, youtube, podcast, tutorial, articulo, herramienta, comparativa, noticias, caso-practico, emprendimiento, marketing, finanzas, productividad, privacidad, startups

URL: ${url}
CONTENIDO:
${contenido}`;
}

function parseAIJson(text) {
  const cleaned = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
  return JSON.parse(cleaned);
}

function validateSchema(obj) {
  if (typeof obj !== 'object' || obj === null) throw new Error('No es un objeto');
  if (typeof obj.titulo !== 'string' || obj.titulo.length > 80) throw new Error('titulo inválido');
  if (!TIPOS_VALIDOS.includes(obj.tipo)) {
    console.warn(`[validateSchema] tipo desconocido "${obj.tipo}" → normalizado a "otro"`);
    obj.tipo = 'otro';
  }
  if (!CATEGORIAS_VALIDAS.includes(obj.categoria)) {
    console.warn(`[validateSchema] categoria desconocida "${obj.categoria}" → normalizada a "otra"`);
    obj.categoria = 'otra';
  }
  if (typeof obj.resumen !== 'string') throw new Error('resumen inválido');
  if (!Array.isArray(obj.puntos_clave) || obj.puntos_clave.length === 0) throw new Error('puntos_clave inválido');
  if (!Number.isInteger(obj.prioridad) || obj.prioridad < 1 || obj.prioridad > 5) throw new Error(`prioridad inválida: ${obj.prioridad}`);
  if (!Array.isArray(obj.etiquetas) || obj.etiquetas.length === 0) throw new Error('etiquetas inválido');
}

// ── Jina ──────────────────────────────────────────────────────────────────────

// Señales de login que aparecen solas en su línea (botones/CTAs, no prosa).
// Umbral 2: análisis real de TikTok via Jina muestra "Log in" ×4 standalone;
// un artículo normal produce 0 señales aunque mencione "log in" en texto.
const LOGIN_SIGNALS = [
  'log in',
  'login',
  'sign in',
  'sign up',
  'continue with google',
  'continue with facebook',
  'continue with apple',
  'use qr code',
];

function detectLoginWall(content) {
  const lower = content.toLowerCase();
  let signalCount = 0;
  for (const signal of LOGIN_SIGNALS) {
    const escaped = signal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const matches = lower.match(new RegExp(`^\\s*${escaped}\\s*$`, 'gim'));
    if (matches) signalCount += matches.length;
  }
  return { isWall: signalCount >= 2, signalCount };
}

async function fetchJina(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), JINA_TIMEOUT_MS);
  try {
    const response = await fetch(`https://r.jina.ai/${url}`, {
      signal: controller.signal,
      headers: { 'Accept': 'text/plain' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const content = await response.text();

    const { isWall, signalCount } = detectLoginWall(content);
    if (isWall) {
      fastify.log.warn({ url, signalCount }, 'fetchJina: wall de login detectado — descartando contenido');
      return { content: null, ok: false, error: 'Login wall detectado' };
    }

    if (content.trim().length < 200) {
      fastify.log.warn({ url, length: content.trim().length }, 'fetchJina: contenido insuficiente — descartando');
      return { content: null, ok: false, error: 'Contenido insuficiente' };
    }

    return { content, ok: true };
  } catch (err) {
    return { content: null, ok: false, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

// ── Gemini ────────────────────────────────────────────────────────────────────

async function callGemini(prompt) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
    try {
      const res = await fetch(GEMINI_API, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
        }),
      });

      if (res.status === 429) {
        fastify.log.warn('Gemini 429 — límite agotado, pasando a fallback');
        return { result: null, ok: false, error: 'Gemini 429 — límite diario agotado' };
      }

      if ((res.status === 502 || res.status === 503) && attempt === 1) {
        fastify.log.warn(`Gemini ${res.status} — reintentando`);
        await sleep(5000);
        continue;
      }

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error('Respuesta vacía de Gemini');
      const parsed = parseAIJson(text);
      validateSchema(parsed);
      return { result: parsed, ok: true };
    } catch (err) {
      return { result: null, ok: false, error: err.message };
    } finally {
      clearTimeout(timer);
    }
  }
  return { result: null, ok: false, error: 'Gemini error tras reintento' };
}

// ── Groq ──────────────────────────────────────────────────────────────────────

async function callGroq(prompt) {
  // split(/\s/)[0] descarta comentarios inline del .env (ej: "key # comentario")
  const apiKey = (process.env.GROQ_API_KEY ?? '').split(/\s/)[0];
  if (!apiKey) return { result: null, ok: false, error: 'GROQ_API_KEY no configurada' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  try {
    const res = await fetch(GROQ_API, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        response_format: { type: 'json_object' },
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error('Respuesta vacía de Groq');
    const parsed = parseAIJson(text);
    validateSchema(parsed);
    return { result: parsed, ok: true };
  } catch (err) {
    return { result: null, ok: false, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

// ── Telegram notifications ────────────────────────────────────────────────────

async function sendTelegram(chatId, text) {
  const targetChatId = chatId ?? process.env.TELEGRAM_CHAT_ID;
  if (!targetChatId) {
    fastify.log.warn('sendTelegram: no hay chat ID disponible');
    return;
  }
  try {
    const res = await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: targetChatId, text }),
    });
    if (!res.ok) fastify.log.warn({ status: res.status }, 'sendTelegram: fallo al enviar notificación');
  } catch (err) {
    fastify.log.warn({ error: err.message }, 'sendTelegram: error de red');
  }
}

// ── Tag normalization ─────────────────────────────────────────────────────────

// index.js — checkAndNormalizeTags — reemplazo total de la función

async function checkAndNormalizeTags(etiquetas) {
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
      signal: controller.signal,          // ← único cambio funcional
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${apiKey}`,
      },
    });
    if (!res.ok) {
      fastify.log.warn({ status: res.status }, 'checkAndNormalizeTags: GET /tags falló — usando etiquetas sin normalizar');
      return etiquetas;
    }
    const data = await res.json();
    const existingTags = data.tags ?? [];
    const existingMap = new Map(existingTags.map((t) => [t.name.toLowerCase(), t.name]));
    const normalized = etiquetas.map((tag) => {
      const lower = tag.toLowerCase();
      return existingMap.has(lower) ? existingMap.get(lower) : lower;
    });
    fastify.log.info({ original: etiquetas, normalized }, 'checkAndNormalizeTags — etiquetas normalizadas');
    return normalized;
  } catch (err) {
    // err.name === 'AbortError' cuando dispara el timeout; err.message lo recoge igual.
    fastify.log.warn({ error: err.message }, 'checkAndNormalizeTags: error — usando etiquetas sin normalizar');
    return etiquetas;
  } finally {
    clearTimeout(timer);  // ← evita que el timer siga vivo si fetch resolvió antes
  }
}

// ── Karakeep ──────────────────────────────────────────────────────────────────

// index.js — callKarakeep — reemplazo total de la función

async function callKarakeep(url, aiResult) {
  const baseUrl = process.env.KARAKEEP_URL ?? 'http://karakeep:3000';
  const apiKey = process.env.KARAKEEP_API_KEY;
  fastify.log.info({ keyPrefix: apiKey ? apiKey.slice(0, 8) : '<vacía>' }, 'callKarakeep — API key en uso');
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
        fastify.log.warn({ body: body401 }, 'Karakeep 401 — sesión inválida, reintentando en 2s');
        await sleep(2000);
        continue;
      }
      if (!bookmarkRes.ok) {
        const errBody = await bookmarkRes.text().catch(() => '<no body>');
        if (bookmarkRes.status === 401) fastify.log.warn({ body: errBody }, 'Karakeep 401 — segundo intento fallido');
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
            signal: tagsController.signal,   // ← fix principal
            headers,
            body: JSON.stringify({
              tags: aiResult.etiquetas.map((t) => ({ tagName: t })),
            }),
          });
          if (!tagsRes.ok) {
            fastify.log.warn({ status: tagsRes.status }, 'Karakeep tags FAIL — bookmark creado sin etiquetas');
          }
        } catch (tagsErr) {
          // AbortError si timeout; cualquier error de red en otro caso.
          // El bookmark ya existe: este fallo es degradación controlada, no fatal.
          fastify.log.warn({ error: tagsErr.message }, 'Karakeep tags ERROR — bookmark creado sin etiquetas');
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
// ── Pipeline ──────────────────────────────────────────────────────────────────

async function processMessage(message) {
  const text = message?.text ?? '';
  const chatId = message?.chat?.id;
  const url = extractUrl(text);

  if (!url) {
    fastify.log.info({ chatId, text }, 'Mensaje sin URL — ignorado');
    return;
  }

  // Paso 1: Jina
  fastify.log.info({ chatId, url }, 'URL recibida — llamando a Jina');
  const jina = await fetchJina(url);

  if (jina.ok) {
    fastify.log.info({ chatId, url, preview: jina.content.slice(0, 500) }, 'Jina OK');
  } else {
    fastify.log.warn({ chatId, url, error: jina.error }, 'Jina FAIL — continuando solo con URL');
  }

  // Paso 2: IA (Gemini → Groq → fallback)
  const prompt = buildPrompt(url, jina.content ?? '', jina.ok);

  fastify.log.info({ chatId, url }, 'Llamando a Gemini');
  let ai = await callGemini(prompt);

  if (!ai.ok) {
    fastify.log.warn({ chatId, url, error: ai.error }, 'Gemini FAIL — intentando Groq');
    ai = await callGroq(prompt);
  }

  if (ai.ok) {
    fastify.log.info({ chatId, url, json: ai.result }, 'AI OK — JSON estructurado obtenido');
  } else {
    fastify.log.error({ chatId, url, error: ai.error }, 'AI FAIL (Gemini + Groq) — marcando como Sin procesar');
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
    ai.result.etiquetas = await checkAndNormalizeTags(ai.result.etiquetas);
  }

  // Paso 3: Karakeep
  fastify.log.info({ chatId, url }, 'Guardando en Karakeep');
  const karakeep = await callKarakeep(url, ai.result);

  if (karakeep.ok) {
    fastify.log.info({ chatId, url, bookmarkId: karakeep.bookmarkId }, 'Karakeep OK — bookmark creado');

    if (!ai.ok) {
      await sendTelegram(chatId, `❌ Error al procesar\n🔗 ${url}\n💬 No se pudo analizar el contenido`);
    } else if (!jina.ok) {
      await sendTelegram(chatId,
        `⚠️ Guardado (contenido parcial)\n📌 ${ai.result.titulo}\n📂 ${ai.result.categoria} · ${ai.result.tipo}\nℹ️ No se pudo extraer el texto completo`
      );
    } else {
      await sendTelegram(chatId,
        `✅ Guardado\n📌 ${ai.result.titulo}\n📂 ${ai.result.categoria} · ${ai.result.tipo} · prioridad ${ai.result.prioridad}/5\n🏷 ${ai.result.etiquetas.slice(0, 3).join(', ')}`
      );
    }
  } else {
    fastify.log.error({ chatId, url, error: karakeep.error }, 'Karakeep FAIL');
    await sendTelegram(chatId, `❌ Error al procesar\n🔗 ${url}\n💬 ${karakeep.error}`);
  }
}

// ── Webhook mode ──────────────────────────────────────────────────────────────

fastify.post('/webhook/telegram', async (request) => {
  await processMessage(request.body?.message);
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
        await processMessage(update.message);
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
