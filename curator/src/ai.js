// ai.js — /opt/curator/curator/src/ai.js — reemplazo total
'use strict';

const { parseAIJson, validateSchema } = require('./validation');
const { notifyAdmin } = require('./telegram');

const AI_TIMEOUT_MS = 30000;
const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODELS_API = 'https://api.groq.com/openai/v1/models';
const GEMINI_MODELS_API = `https://generativelanguage.googleapis.com/v1beta/models`;

// ── Modelos activos — la Solución 3 los sobreescribe en caliente ──────────────
let geminiModel = 'gemini-2.5-flash';
let groqModel = 'openai/gpt-oss-120b';

function geminiUrl() {
  return `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${process.env.GEMINI_API_KEY}`;
}

// ── Clasificación de errores (Solución 2) ─────────────────────────────────────
const ERROR_CLASS = {
  PERMANENT: 'permanent',
  TRANSIENT: 'transient',
};

function classifyGeminiError(status, body) {
  if (status === 404) return ERROR_CLASS.PERMANENT;
  if (status === 403) return ERROR_CLASS.PERMANENT;
  if (status === 400 && body.includes('not found')) return ERROR_CLASS.PERMANENT;
  if (status === 429) return ERROR_CLASS.TRANSIENT;
  if (status === 502 || status === 503) return ERROR_CLASS.TRANSIENT;
  return ERROR_CLASS.TRANSIENT;
}

function classifyGroqError(status, body) {
  if (status === 404 && body.includes('model_not_found')) return ERROR_CLASS.PERMANENT;
  if (status === 404 && body.includes('does not exist')) return ERROR_CLASS.PERMANENT;
  if (status === 403 && body.includes('permission')) return ERROR_CLASS.PERMANENT;
  if (status === 400 && body.includes('invalid model')) return ERROR_CLASS.PERMANENT;
  if (status === 429) return ERROR_CLASS.TRANSIENT;
  if (status === 502 || status === 503) return ERROR_CLASS.TRANSIENT;
  return ERROR_CLASS.TRANSIENT;
}

// ── Circuit breaker (Solución 4) ──────────────────────────────────────────────
const PERMANENT_STREAK_THRESHOLD = 3;
const ALERT_DEBOUNCE_MS = 30 * 60 * 1000;

const providerState = {
  gemini: { consecutivePermanent: 0, lastAlertAt: 0 },
  groq: { consecutivePermanent: 0, lastAlertAt: 0 },
};

async function handlePermanentError(provider, status, body, logger) {
  const state = providerState[provider];
  state.consecutivePermanent++;
  logger.error(
    { provider, status, body: body.slice(0, 200), streak: state.consecutivePermanent },
    `${provider} error PERMANENTE — streak ${state.consecutivePermanent}/${PERMANENT_STREAK_THRESHOLD}`,
  );

  const shouldAlert =
    state.consecutivePermanent >= PERMANENT_STREAK_THRESHOLD &&
    Date.now() - state.lastAlertAt > ALERT_DEBOUNCE_MS;

  if (shouldAlert) {
    state.lastAlertAt = Date.now();
    const msg = [
      `Proveedor: ${provider.toUpperCase()}`,
      `HTTP ${status}`,
      `Modelo: ${provider === 'gemini' ? geminiModel : groqModel}`,
      `Detalle: ${body.slice(0, 150)}`,
      `Fallos consecutivos: ${state.consecutivePermanent}`,
    ].join('\n');
    await notifyAdmin(msg, logger);
  }
}

function resetStreak(provider) {
  providerState[provider].consecutivePermanent = 0;
}

// ── Solución 3: autodescubrimiento de modelo ──────────────────────────────────
// Gemini: filtra por modelos que soporten generateContent y nombre *flash* o *pro*
// Groq:   filtra por modelos con context_window >= 8192 y nombre que no sea whisper/guard/allam
// En ambos casos se prefiere el modelo con mayor context_window / más reciente.

async function resolveGeminiModel(logger) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(`${GEMINI_MODELS_API}?key=${key}`, {
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, 'resolveGeminiModel: no se pudo listar modelos');
      return null;
    }
    const data = await res.json();
    const candidates = (data.models ?? []).filter((m) => {
      const name = m.name ?? '';                           // "models/gemini-2.5-flash"
      const methods = m.supportedGenerationMethods ?? [];
      return (
        methods.includes('generateContent') &&
        (name.includes('flash') || name.includes('pro')) &&
        !name.includes('vision') &&
        !name.includes('embedding') &&
        !name.includes('aqa')
      );
    });
    if (!candidates.length) {
      logger.warn('resolveGeminiModel: sin candidatos válidos en la lista');
      return null;
    }
    // Preferir modelos más recientes: ordenar por nombre desc (gemini-2.5 > gemini-2.0 > gemini-1.5)
    candidates.sort((a, b) => b.name.localeCompare(a.name));
    // Extraer solo el slug: "models/gemini-2.5-flash" → "gemini-2.5-flash"
    const resolved = candidates[0].name.replace('models/', '');
    logger.info({ resolved, total: candidates.length }, 'resolveGeminiModel — modelo seleccionado');
    return resolved;
  } catch (err) {
    logger.warn({ error: err.message }, 'resolveGeminiModel: error al listar modelos');
    return null;
  }
}

async function resolveGroqModel(logger) {
  const apiKey = (process.env.GROQ_API_KEY ?? '').trim().split(/\s/)[0].trim();
  if (!apiKey) return null;
  try {
    const res = await fetch(GROQ_MODELS_API, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, 'resolveGroqModel: no se pudo listar modelos');
      return null;
    }
    const data = await res.json();
    // Excluir modelos de audio (whisper), safety (guard), embeddings y modelos pequeños (<8k ctx)
    const EXCLUDE = ['whisper', 'guard', 'allam', 'orpheus', 'safeguard'];
    const candidates = (data.data ?? []).filter((m) => {
      const id = m.id ?? '';
      const ctx = m.context_window ?? 0;
      return (
        ctx >= 8192 &&
        !EXCLUDE.some((ex) => id.toLowerCase().includes(ex))
      );
    });
    if (!candidates.length) {
      logger.warn('resolveGroqModel: sin candidatos válidos en la lista');
      return null;
    }
    // Preferir mayor context_window; en empate, id más reciente (orden lexicográfico desc)
    candidates.sort((a, b) => {
      if (b.context_window !== a.context_window) return b.context_window - a.context_window;
      return b.id.localeCompare(a.id);
    });
    const resolved = candidates[0].id;
    logger.info({ resolved, total: candidates.length }, 'resolveGroqModel — modelo seleccionado');
    return resolved;
  } catch (err) {
    logger.warn({ error: err.message }, 'resolveGroqModel: error al listar modelos');
    return null;
  }
}

// ── Canary check (Solución 1 + 5) ────────────────────────────────────────────
const CANARY_PROMPT = 'Responde ÚNICAMENTE con este JSON exacto, sin texto adicional: {"ok":true}';

async function canaryCheck(logger = console) {
  const geminiResult = await callGemini(CANARY_PROMPT, logger, true);
  const groqResult = await callGroq(CANARY_PROMPT, logger, true);
  return {
    gemini: { ok: geminiResult.ok, model: geminiModel, error: geminiResult.error ?? null },
    groq: { ok: groqResult.ok, model: groqModel, error: groqResult.error ?? null },
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Gemini ────────────────────────────────────────────────────────────────────
async function callGemini(prompt, logger = console, isCanary = false) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
    try {
      const res = await fetch(geminiUrl(), {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        const errClass = classifyGeminiError(res.status, body);

        if (res.status === 429) {
          logger.warn('Gemini 429 — límite agotado, pasando a fallback');
          clearTimeout(timer);
          return { result: null, ok: false, error: 'Gemini 429', errorClass: ERROR_CLASS.TRANSIENT };
        }

        if ((res.status === 502 || res.status === 503) && attempt === 1) {
          logger.warn(`Gemini ${res.status} — reintentando`);
          clearTimeout(timer);
          await sleep(5000);
          continue;
        }

        if (errClass === ERROR_CLASS.PERMANENT) {
          clearTimeout(timer);
          // Solución 3: intentar autodescubrimiento antes de rendirse
          if (!isCanary) {
            logger.warn({ status: res.status }, 'Gemini PERMANENTE — intentando autodescubrir modelo');
            const newModel = await resolveGeminiModel(logger);
            if (newModel && newModel !== geminiModel) {
              const oldModel = geminiModel;
              geminiModel = newModel;
              logger.info({ oldModel, newModel }, 'Gemini — modelo actualizado automáticamente');
              await notifyAdmin(
                `🔄 Gemini autodescubrimiento\nModelo anterior: ${oldModel}\nModelo nuevo: ${newModel}\nMotivo: HTTP ${res.status}`,
                logger,
              );
              // Reintentar con el modelo nuevo (segundo intento del loop)
              await sleep(1000);
              continue;
            }
            await handlePermanentError('gemini', res.status, body, logger);
          }
          return { result: null, ok: false, error: `HTTP ${res.status}`, errorClass: ERROR_CLASS.PERMANENT };
        }

        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error('Respuesta vacía de Gemini');

      if (!isCanary) {
        const parsed = parseAIJson(text);
        validateSchema(parsed);
      }
      resetStreak('gemini');
      return { result: isCanary ? null : parseAIJson(text), ok: true };

    } catch (err) {
      if (attempt === 1 && (err instanceof SyntaxError || err.message.includes('inválid'))) {
        logger.warn({ error: err.message }, 'Gemini parseo/schema error — reintentando');
        clearTimeout(timer);
        await sleep(3000);
        continue;
      }
      logger.error({ error: err.message }, `Gemini error en intento ${attempt}`);
      return { result: null, ok: false, error: err.message, errorClass: ERROR_CLASS.TRANSIENT };
    } finally {
      clearTimeout(timer);
    }
  }
  return { result: null, ok: false, error: 'Gemini error tras reintento', errorClass: ERROR_CLASS.TRANSIENT };
}

// ── Groq ──────────────────────────────────────────────────────────────────────
async function callGroq(prompt, logger = console, isCanary = false) {
  const apiKey = (process.env.GROQ_API_KEY ?? '').trim().split(/\s/)[0].trim();
  if (!apiKey) return { result: null, ok: false, error: 'GROQ_API_KEY no configurada', errorClass: ERROR_CLASS.PERMANENT };

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
        model: groqModel,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        response_format: { type: 'json_object' },
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const errClass = classifyGroqError(res.status, body);
      logger.error({ status: res.status, body: body.slice(0, 200) }, 'Groq HTTP error');

      if (errClass === ERROR_CLASS.PERMANENT) {
        clearTimeout(timer);
        // Solución 3: intentar autodescubrimiento antes de rendirse
        if (!isCanary) {
          logger.warn({ status: res.status }, 'Groq PERMANENTE — intentando autodescubrir modelo');
          const newModel = await resolveGroqModel(logger);
          if (newModel && newModel !== groqModel) {
            const oldModel = groqModel;
            groqModel = newModel;
            logger.info({ oldModel, newModel }, 'Groq — modelo actualizado automáticamente');
            await notifyAdmin(
              `🔄 Groq autodescubrimiento\nModelo anterior: ${oldModel}\nModelo nuevo: ${newModel}\nMotivo: HTTP ${res.status}`,
              logger,
            );
            // Reintentar con el modelo nuevo en una llamada recursiva única
            return callGroq(prompt, logger, isCanary);
          }
          await handlePermanentError('groq', res.status, body, logger);
        }
        return { result: null, ok: false, error: `HTTP ${res.status}`, errorClass: ERROR_CLASS.PERMANENT };
      }

      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error('Respuesta vacía de Groq');
    logger.info({ preview: text.slice(0, 200) }, 'Groq respuesta raw');

    if (!isCanary) {
      const parsed = parseAIJson(text);
      validateSchema(parsed);
      resetStreak('groq');
      return { result: parsed, ok: true };
    }
    resetStreak('groq');
    return { result: null, ok: true };

  } catch (err) {
    logger.error({ error: err.message }, 'Groq error');
    return { result: null, ok: false, error: err.message, errorClass: ERROR_CLASS.TRANSIENT };
  } finally {
    clearTimeout(timer);
  }
}

// ── Prompt ────────────────────────────────────────────────────────────────────
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

module.exports = {
  callGemini,
  callGroq,
  buildPrompt,
  canaryCheck,
  getCurrentModels: () => ({ gemini: geminiModel, groq: groqModel }),
};
