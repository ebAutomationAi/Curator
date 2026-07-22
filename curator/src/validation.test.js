'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseAIJson, validateSchema } = require('./validation');

function validObj() {
  return {
    titulo: 'Un título válido',
    tipo: 'articulo',
    categoria: 'tecnologia',
    resumen: 'Resumen de prueba.',
    puntos_clave: ['punto 1', 'punto 2'],
    prioridad: 3,
    etiquetas: ['ia', 'javascript'],
  };
}

test('parseAIJson: valid JSON string parses correctly', () => {
  const result = parseAIJson('{"a": 1, "b": "dos"}');
  assert.deepEqual(result, { a: 1, b: 'dos' });
});

test('parseAIJson: JSON wrapped in ```json ... ``` fences parses correctly', () => {
  const text = '```json\n{"a": 1}\n```';
  const result = parseAIJson(text);
  assert.deepEqual(result, { a: 1 });
});

test('parseAIJson: invalid JSON throws', () => {
  assert.throws(() => parseAIJson('not json at all'));
});

test('validateSchema: valid object with all fields does not throw', () => {
  assert.doesNotThrow(() => validateSchema(validObj()));
});

test('validateSchema: titulo longer than 80 chars throws', () => {
  const obj = validObj();
  obj.titulo = 'x'.repeat(81);
  assert.throws(() => validateSchema(obj));
});

test('validateSchema: unknown tipo normalizes to "otro" without throwing', () => {
  const obj = validObj();
  obj.tipo = 'algo-desconocido';
  assert.doesNotThrow(() => validateSchema(obj));
  assert.equal(obj.tipo, 'otro');
});

test('validateSchema: unknown categoria normalizes to "otra" without throwing', () => {
  const obj = validObj();
  obj.categoria = 'algo-desconocida';
  assert.doesNotThrow(() => validateSchema(obj));
  assert.equal(obj.categoria, 'otra');
});

test('validateSchema: missing resumen throws', () => {
  const obj = validObj();
  delete obj.resumen;
  assert.throws(() => validateSchema(obj));
});

test('validateSchema: empty puntos_clave array throws', () => {
  const obj = validObj();
  obj.puntos_clave = [];
  assert.throws(() => validateSchema(obj));
});

test('validateSchema: prioridad outside 1-5 throws', () => {
  const obj = validObj();
  obj.prioridad = 6;
  assert.throws(() => validateSchema(obj));
});

test('validateSchema: empty etiquetas array throws', () => {
  const obj = validObj();
  obj.etiquetas = [];
  assert.throws(() => validateSchema(obj));
});
