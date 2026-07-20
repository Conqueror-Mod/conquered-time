'use strict';

// Unit tests for src/renderer/identity-color.js — the single source of truth
// for company identity color (renderer surfaces via BubbleWeb.colorMap, main
// process via require for the emailed report). Regression coverage for
// Crucible III defects D-304 (multi-override order instability) and D-305
// (non-finite id → invalid hsl), plus the adjacent legal behavior the probe
// confirmed clean (hostile hex fallback, unknown-company fallback, groupKey).

const { test } = require('node:test');
const assert   = require('node:assert');
const IC = require('../src/renderer/identity-color.js');

test('paletteHue: finite ids index the palette; non-finite pin to slot 0 (D-305)', () => {
  assert.strictEqual(IC.paletteHue(3, false), IC.PALETTE[3]);
  assert.strictEqual(IC.paletteHue(-5, false), IC.PALETTE[5]);
  for (const bad of [undefined, NaN, null, 'x', Infinity]) {
    assert.strictEqual(IC.paletteHue(bad, false), IC.PALETTE[0], `id=${String(bad)}`);
    assert.strictEqual(IC.paletteHue(bad, true), IC.PALETTE_CB[0], `cb id=${String(bad)}`);
  }
  // string-numeric ids still land deterministically
  assert.strictEqual(IC.paletteHue('7', false), IC.PALETTE[7]);
});

test('galaxyHue: hue is finite for pathological rows (D-305)', () => {
  for (const id of [undefined, NaN, -5, 0, 1e15]) {
    const spec = IC.galaxyHue({ rows: [{ id, name: 'P' }], lastDays: 0 }, {});
    assert.ok(Number.isFinite(spec.h), `id=${String(id)} → h=${spec.h}`);
  }
});

test('galaxyHue: with two different overrides, min-rowid wins regardless of row order (D-304)', () => {
  const rows = [
    { id: 9, name: 'X', color: '#ff0000' },   // red, higher rowid
    { id: 2, name: 'X2', color: '#0000ff' },  // blue, min rowid → must win
  ];
  const h1 = IC.galaxyHue({ rows, lastDays: 0 }, {}).h;
  const h2 = IC.galaxyHue({ rows: [...rows].reverse(), lastDays: 0 }, {}).h;
  assert.strictEqual(h1, h2, 'row order changed the winning override');
  assert.strictEqual(h1, 240, 'expected the min-rowid (blue) override');
});

test('galaxyHue: single override still wins over the palette (adjacent legal behavior)', () => {
  const spec = IC.galaxyHue({ rows: [{ id: 4, name: 'H', color: '#ff0000' }], lastDays: 0 }, {});
  assert.strictEqual(spec.h, 0);
});

test('galaxyHue: hostile hex values fall back to the palette, never NaN', () => {
  for (const bad of ['#GGGGGG', '#abc', 'red', '', null, '#12345']) {
    const spec = IC.galaxyHue({ rows: [{ id: 4, name: 'H', color: bad }], lastDays: 0 }, {});
    assert.ok(Number.isFinite(spec.h) && Number.isFinite(spec.s), `color=${String(bad)}`);
  }
});

test('colorMap: unknown company → fallback; hostile log_dates never produce NaN colors', () => {
  const m = IC.colorMap(
    [{ id: 1, name: 'A' }],
    [{ company_id: 1, log_date: 'garbage' }, { company_id: 1, log_date: '9999-12-31' }],
    { today: '2026-07-19', fallback: 'FB' });
  assert.strictEqual(m.colorFor(999), 'FB');
  const c = m.colorFor(1);
  assert.match(c, /^hsl\(/);
  assert.ok(!c.includes('NaN'), c);
});

test('groupKey: whitespace/missing collapse to placeholder; hier_company wins', () => {
  assert.strictEqual(IC.groupKey({ name: '   ' }), '—');
  assert.strictEqual(IC.groupKey({}), '—');
  assert.strictEqual(IC.groupKey({ hier_company: 'H', name: 'N' }), 'H');
});
