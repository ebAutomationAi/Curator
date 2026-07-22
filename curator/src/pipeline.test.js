'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extractUrl } = require('./pipeline');

test('extractUrl: text with URL returns the URL', () => {
  const result = extractUrl('Mira esto: https://example.com/articulo interesante');
  assert.equal(result, 'https://example.com/articulo');
});

test('extractUrl: text without URL returns null', () => {
  const result = extractUrl('Este mensaje no tiene ningún enlace');
  assert.equal(result, null);
});

test('extractUrl: empty string returns null', () => {
  const result = extractUrl('');
  assert.equal(result, null);
});

test('extractUrl: null returns null', () => {
  const result = extractUrl(null);
  assert.equal(result, null);
});

test('extractUrl: text with multiple URLs returns the first one', () => {
  const result = extractUrl('Enlace 1: https://first.com y enlace 2: https://second.com');
  assert.equal(result, 'https://first.com');
});
