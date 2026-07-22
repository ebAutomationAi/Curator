'use strict';

const TIPOS_VALIDOS = ['articulo', 'video', 'hilo', 'podcast', 'otro'];
const CATEGORIAS_VALIDAS = [
  'tecnologia', 'ciencia', 'negocios', 'educacion', 'salud',
  'inteligencia-artificial', 'programacion', 'vibe-coding', 'llm',
  'agentes-ia', 'herramientas-ia', 'prompt-engineering', 'devops', 'otra',
];

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

module.exports = { TIPOS_VALIDOS, CATEGORIAS_VALIDAS, parseAIJson, validateSchema };
