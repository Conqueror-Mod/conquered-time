'use strict';

// Regression lock for defect cluster C3 (D-004/D-011): the shared
// "is this row real?" predicate must consider EVERY user-content field —
// including the description, which every hand-rolled filter missed.

const assert = require('assert');
const { rowHasContent, rowDesc } = require('../src/renderer/row-utils.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  PASS  ${name}`); }
  catch (e) { failed++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
}

console.log('row-utils.test.js');

test('empty row has no content', () => {
  assert.strictEqual(rowHasContent({}), false);
  assert.strictEqual(rowHasContent(null), false);
  assert.strictEqual(rowHasContent(undefined), false);
  assert.strictEqual(rowHasContent({ label: '', name: '', desc: '', clock_in: '', clock_out: '' }), false);
});

test('whitespace-only fields do not count', () => {
  assert.strictEqual(rowHasContent({ label: '  ', name: '\t', desc: ' \n ' }), false);
});

test('each single field counts on its own', () => {
  assert.strictEqual(rowHasContent({ clock_in: '09:00' }), true);
  assert.strictEqual(rowHasContent({ clock_out: '17:00' }), true);
  assert.strictEqual(rowHasContent({ label: 'QA' }), true);
  assert.strictEqual(rowHasContent({ name: 'Ticket triage' }), true);
});

test('D-004/D-011: a desc-only row COUNTS (the historical gap)', () => {
  assert.strictEqual(rowHasContent({ label: '', name: '', clock_in: '', clock_out: '', desc: 'user content, no punch' }), true);
});

test('legacy `description` field is honored too', () => {
  assert.strictEqual(rowHasContent({ description: 'old-style field' }), true);
});

test('total_mins alone does NOT make a row real (matches audit semantics)', () => {
  assert.strictEqual(rowHasContent({ total_mins: 45 }), false);
});

test('rowDesc prefers desc, falls back to description, else empty', () => {
  assert.strictEqual(rowDesc({ desc: 'a', description: 'b' }), 'a');
  assert.strictEqual(rowDesc({ description: 'b' }), 'b');
  assert.strictEqual(rowDesc({}), '');
  assert.strictEqual(rowDesc(null), '');
});

console.log(`\nrow-utils: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
