import assert from 'node:assert/strict';

import { renderHook } from '@testing-library/react';
import { createRef } from 'react';
import { test, vi } from 'vitest';

import { isOwnPromptMessage, nextOwnMessageIndex, useOwnMessageJump } from '@/modules/chat/hooks/useOwnMessageJump';
import type { ChatMessage } from '@/shared/types';

/**
 * Alt+↑ / Alt+↓ walk the transcript through the user's own messages, so what
 * the agent was last asked is one key away.
 */

const user = (content: string, timestamp: string): ChatMessage => ({ type: 'user', content, timestamp });
const assistant = (content: string, timestamp: string): ChatMessage => ({ type: 'assistant', content, timestamp });

test('only messages the user typed count', () => {
  assert.equal(isOwnPromptMessage(user('check the lab', 't1')), true);
  assert.equal(isOwnPromptMessage(user('<task-notification>\n<task-id>a1</task-id>', 't2')), false);
  assert.equal(isOwnPromptMessage(user('   ', 't3')), false);
  assert.equal(isOwnPromptMessage(assistant('done', 't4')), false);
});

test('up starts at the newest and stops at the oldest; down past the newest returns to the bottom', () => {
  assert.equal(nextOwnMessageIndex(3, null, 'up'), 2);
  assert.equal(nextOwnMessageIndex(3, 2, 'up'), 1);
  assert.equal(nextOwnMessageIndex(3, 0, 'up'), 0);
  assert.equal(nextOwnMessageIndex(3, 1, 'down'), 2);
  assert.equal(nextOwnMessageIndex(3, 2, 'down'), null);
  assert.equal(nextOwnMessageIndex(3, null, 'down'), null);
  assert.equal(nextOwnMessageIndex(0, null, 'up'), null);
});

const press = (key: 'ArrowUp' | 'ArrowDown', options: KeyboardEventInit = { altKey: true }) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
  document.dispatchEvent(event);
  return event;
};

test('Alt+↑ reveals the user\'s messages newest first; a composer with text keeps the keys', () => {
  const messages = [
    user('first ask', '2026-10-27T01:00:00.000Z'),
    assistant('working', '2026-10-27T01:00:05.000Z'),
    user('<task-notification>\n<task-id>a1</task-id>', '2026-10-27T01:01:00.000Z'),
    user('second ask', '2026-10-27T01:02:00.000Z'),
  ];
  const revealMessage = vi.fn();
  const scrollContainerRef = createRef<HTMLDivElement>();
  const { unmount } = renderHook(() => useOwnMessageJump({ messages, revealMessage, scrollContainerRef, sessionKey: 's1' }));

  assert.equal(press('ArrowUp').defaultPrevented, true);
  assert.equal(revealMessage.mock.calls.at(-1)?.[0].content, 'second ask');
  press('ArrowUp');
  assert.equal(revealMessage.mock.calls.at(-1)?.[0].content, 'first ask');
  press('ArrowDown');
  assert.equal(revealMessage.mock.calls.at(-1)?.[0].content, 'second ask');

  press('ArrowUp', {});
  assert.equal(revealMessage.mock.calls.length, 3, 'a plain arrow is left alone');

  const textarea = document.createElement('textarea');
  document.body.appendChild(textarea);
  textarea.value = 'a draft';
  textarea.focus();
  assert.equal(press('ArrowUp').defaultPrevented, false, 'the composer keeps Alt+arrows while it has text');
  assert.equal(revealMessage.mock.calls.length, 3);
  textarea.remove();
  unmount();
});
