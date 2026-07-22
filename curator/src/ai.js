'use strict';

const { parseAIJson, validateSchema } = require('./validation');

const AI_TIMEOUT_MS = 30000;
const GEMINI_API = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions';

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

async function callGemini(prompt, logger = console) {
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
        logger.warn('Gemini 429 — límite agotado, pasando a fallback');
        return { result: null, ok: false, error: 'Gemini 429 — límite diario agotado' };
      }

      if ((res.status === 502 || res.status === 503) && attempt === 1) {
        logger.warn(`Gemini ${res.status} — reintentando`);
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

module.exports = { callGemini, callGroq, buildPrompt };
