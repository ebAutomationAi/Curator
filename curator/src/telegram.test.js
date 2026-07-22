'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildKarakeepButton } = require('./telegram');

test('buildKarakeepButton: with NEXTAUTH_URL and bookmarkId returns inline keyboard with correct URL', () => {
  const original = process.env.NEXTAUTH_URL;
  process.env.NEXTAUTH_URL = 'https://karakeep.example.com';
  try {
    const result = buildKarakeepButton('abc123');
    assert.deepEqual(result, {
      reply_markup: {
        inline_keyboard: [[
          { text: '📖 Ver en Karakeep', url: 'https://karakeep.example.com/dashboard/preview/abc123' },
        ]],
      },
    });
  } finally {
    process.env.NEXTAUTH_URL = original;
  }
});

test('buildKarakeepButton: without NEXTAUTH_URL returns empty object', () => {
  const original = process.env.NEXTAUTH_URL;
  delete process.env.NEXTAUTH_URL;
  try {
    const result = buildKarakeepButton('abc123');
    assert.deepEqual(result, {});
  } finally {
    process.env.NEXTAUTH_URL = original;
  }
});

test('buildKarakeepButton: with NEXTAUTH_URL but no bookmarkId returns empty object', () => {
  const original = process.env.NEXTAUTH_URL;
  process.env.NEXTAUTH_URL = 'https://karakeep.example.com';
  try {
    const result = buildKarakeepButton(undefined);
    assert.deepEqual(result, {});
  } finally {
    process.env.NEXTAUTH_URL = original;
  }
});
