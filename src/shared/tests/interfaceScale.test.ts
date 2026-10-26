import assert from 'node:assert/strict';

import { afterEach, test } from 'vitest';

import { applyInterfaceScale, readInterfaceScale, writeInterfaceScale } from '@/shared/interfaceScale';

afterEach(() => {
  localStorage.clear();
  document.documentElement.style.fontSize = '';
});

test('the interface scale defaults to 100% and leaves the root font size alone', () => {
  assert.equal(readInterfaceScale(), 100);
  applyInterfaceScale(readInterfaceScale());
  assert.equal(document.documentElement.style.fontSize, '');
});

test('a chosen scale sets the root font size and is read back on the next load', () => {
  writeInterfaceScale(80);
  assert.equal(document.documentElement.style.fontSize, '80%');
  assert.equal(readInterfaceScale(), 80);
});

test('an unknown stored value falls back to 100%', () => {
  localStorage.setItem('interface-scale', '37');
  assert.equal(readInterfaceScale(), 100);
});
