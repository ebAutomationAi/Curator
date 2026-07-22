'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { detectLoginWall } = require('./extractors');

test('detectLoginWall: normal article content has no signals', () => {
  const content = `
    Este es un artículo normal sobre tecnología.
    Habla de inteligencia artificial y programación.
    No contiene ningún muro de login ni llamadas a la acción.
  `;
  const result = detectLoginWall(content);
  assert.deepEqual(result, { isWall: false, signalCount: 0 });
});

test('detectLoginWall: "log in" mentioned inside a sentence (not standalone) does not count', () => {
  const content = `
    Please log in to continue reading this article, said the author,
    explaining why registration matters for readers.
  `;
  const result = detectLoginWall(content);
  assert.equal(result.isWall, false);
});

test('detectLoginWall: 3 standalone "Log in" lines trigger the wall', () => {
  const content = `
Log in
Log in
Log in
  `;
  const result = detectLoginWall(content);
  assert.equal(result.isWall, true);
  assert.ok(result.signalCount >= 2);
});

test('detectLoginWall: TikTok-style wall with multiple standalone CTAs', () => {
  const content = `
Log in
Sign up
Continue with Google
  `;
  const result = detectLoginWall(content);
  assert.equal(result.isWall, true);
});
