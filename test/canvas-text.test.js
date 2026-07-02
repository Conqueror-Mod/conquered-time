'use strict';

// Regression lock for defect cluster C4 (D-003): canvas label fitting.
// Uses a stub ctx where every character measures 6px wide, so widths are
// deterministic without a real canvas.

const assert = require('assert');
const { ellipsizeToWidth, radiusForLabel } = require('../src/renderer/canvas-text.js');

const CHAR_W = 6;
function stubCtx() {
  return {
    font: 'initial-font',
    measureText(s) { return { width: String(s).length * CHAR_W }; }
  };
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  PASS  ${name}`); }
  catch (e) { failed++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
}

console.log('canvas-text.test.js');

test('ellipsize: text that fits is returned unchanged', () => {
  const ctx = stubCtx();
  assert.strictEqual(ellipsizeToWidth(ctx, 'Acme', 100), 'Acme'); // 24px <= 100
});

test('ellipsize: exact-fit boundary is unchanged', () => {
  const ctx = stubCtx();
  assert.strictEqual(ellipsizeToWidth(ctx, 'Acme', 4 * CHAR_W), 'Acme');
});

test('ellipsize: overflow trims and appends …', () => {
  const ctx = stubCtx();
  // budget 30px = 5 chars → 4 chars + '…'
  const out = ellipsizeToWidth(ctx, 'Zenith Analytics', 30);
  assert.strictEqual(out, 'Zeni…');
  assert.ok(ctx.measureText(out).width <= 30);
});

test('ellipsize: result never exceeds maxWidth across budgets', () => {
  const ctx = stubCtx();
  const name = 'A'.repeat(120);
  for (let w = 12; w <= 200; w += 7) {
    const out = ellipsizeToWidth(ctx, name, w);
    assert.ok(ctx.measureText(out).width <= w, `budget ${w}: got ${out.length} chars`);
    assert.ok(out.endsWith('…'));
  }
});

test('ellipsize: tiny budget keeps at least one char + …', () => {
  const ctx = stubCtx();
  assert.strictEqual(ellipsizeToWidth(ctx, 'Zenith', 1), 'Z…');
});

test('ellipsize: null/empty input returns empty string', () => {
  const ctx = stubCtx();
  assert.strictEqual(ellipsizeToWidth(ctx, null, 50), '');
  assert.strictEqual(ellipsizeToWidth(ctx, '', 50), '');
});

test('radiusForLabel: short label clamps to baseR', () => {
  const ctx = stubCtx();
  // 'AB' = 12px → 6 + 10 pad = 16 < baseR 18
  assert.strictEqual(radiusForLabel(ctx, 'AB', '10px x', 18, 48), 18);
});

test('radiusForLabel: mid label grows between baseR and maxR', () => {
  const ctx = stubCtx();
  // 10 chars = 60px → 30 + 10 = 40
  assert.strictEqual(radiusForLabel(ctx, 'ABCDEFGHIJ', '10px x', 18, 48), 40);
});

test('radiusForLabel: long label clamps to maxR', () => {
  const ctx = stubCtx();
  assert.strictEqual(radiusForLabel(ctx, 'X'.repeat(120), '10px x', 18, 48), 48);
});

test('radiusForLabel: restores the ctx font after measuring', () => {
  const ctx = stubCtx();
  radiusForLabel(ctx, 'Whatever', '500 10px DM Sans', 18, 48);
  assert.strictEqual(ctx.font, 'initial-font');
});

test('radiusForLabel: custom padding is applied', () => {
  const ctx = stubCtx();
  // 10 chars = 60px → 30 + 4 = 34
  assert.strictEqual(radiusForLabel(ctx, 'ABCDEFGHIJ', '10px x', 18, 48, 4), 34);
});

console.log(`\ncanvas-text: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
