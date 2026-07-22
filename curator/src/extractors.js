'use strict';

const JINA_TIMEOUT_MS = 20000;

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

async function fetchJina(url, logger = console) {
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
      logger.warn({ url, signalCount }, 'fetchJina: wall de login detectado — descartando contenido');
      return { content: null, ok: false, error: 'Login wall detectado' };
    }

    if (content.trim().length < 200) {
      logger.warn({ url, length: content.trim().length }, 'fetchJina: contenido insuficiente — descartando');
      return { content: null, ok: false, error: 'Contenido insuficiente' };
    }

    return { content, ok: true };
  } catch (err) {
    return { content: null, ok: false, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { fetchJina, detectLoginWall };
