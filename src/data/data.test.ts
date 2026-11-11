import assert from 'node:assert/strict';
import { test } from 'node:test';
import { coerceSavedTrades } from './validate.ts';

test('saved trades from storage or a backup keep only well-formed entries', () => {
  const good = { id: 'x', name: '  Nic deal ', savedAt: '2026-11-10T00:00:00Z', a: 10, b: 3, aGives: ['pl-0001'], bGives: [], extra: 1 };
  const out = coerceSavedTrades([good, { ...good }, { ...good, id: 'y', a: 3 }, { ...good, id: 'z', aGives: ['Bijan'] }, null, 'junk']);
  assert.deepEqual(out, [{ id: 'x', name: 'Nic deal', savedAt: good.savedAt, a: 10, b: 3, aGives: ['pl-0001'], bGives: [] }]);
  assert.deepEqual(coerceSavedTrades({ not: 'a list' }), []);
});
