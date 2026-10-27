import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { RefObject } from 'react';

import type { ChatMessage } from '@/shared/types';

/** A message the user typed: not a tool result, and not a task report the harness delivered as a user turn. */
export function isOwnPromptMessage(message: ChatMessage): boolean {
  if (message.type !== 'user' || typeof message.content !== 'string') {
    return false;
  }
  const content = message.content.trimStart();
  return content.length > 0 && !content.startsWith('<task-notification>');
}

/**
 * Where a jump lands among the user's own messages. Up starts from the
 * newest; down past the newest returns null, which means "back to the bottom".
 */
export function nextOwnMessageIndex(count: number, cursor: number | null, direction: 'up' | 'down'): number | null {
  if (count === 0) {
    return null;
  }
  if (direction === 'up') {
    return cursor === null ? count - 1 : Math.max(cursor - 1, 0);
  }
  if (cursor === null || cursor + 1 >= count) {
    return null;
  }
  return cursor + 1;
}

const FLASH_CLASS = 'chat-jump-flash';

type UseOwnMessageJumpArgs = {
  messages: ChatMessage[];
  /** Brings a row into view even when it is outside the rendered window. */
  revealMessage: (message: ChatMessage) => void;
  scrollContainerRef: RefObject<HTMLDivElement>;
  /** The conversation shown; switching it starts the next jump from the newest message again. */
  sessionKey: string | null;
};

/**
 * Alt+↑ / Alt+↓ (⌥ on a Mac) walk the transcript through the user's own
 * messages, newest first, so what the agent was last asked is one key away.
 * A composer with text in it keeps Alt+arrows for itself.
 */
export function useOwnMessageJump({ messages, revealMessage, scrollContainerRef, sessionKey }: UseOwnMessageJumpArgs) {
  const ownMessages = useMemo(() => messages.filter(isOwnPromptMessage), [messages]);
  const cursorRef = useRef<number | null>(null);

  // A new message, or another conversation, makes "previous" mean the newest again.
  useEffect(() => {
    cursorRef.current = null;
  }, [ownMessages.length, sessionKey]);

  const jump = useCallback((direction: 'up' | 'down') => {
    const target = nextOwnMessageIndex(ownMessages.length, cursorRef.current, direction);
    cursorRef.current = target;
    const container = scrollContainerRef.current;
    if (target === null) {
      container?.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
      return;
    }
    const message = ownMessages[target];
    revealMessage(message);
    // The row is in the DOM once the reveal has widened the window.
    window.setTimeout(() => {
      const row = container?.querySelector<HTMLElement>(`[data-message-timestamp="${CSS.escape(String(message.timestamp))}"]`);
      // The bubble rather than the full-width row: it is what the eye looks for.
      const bubble = row?.querySelector<HTMLElement>('.rounded-2xl') ?? row;
      if (!bubble) {
        return;
      }
      bubble.classList.remove(FLASH_CLASS);
      // Restart the animation when the same message is flashed twice in a row.
      void bubble.offsetWidth;
      bubble.classList.add(FLASH_CLASS);
      window.setTimeout(() => bubble.classList.remove(FLASH_CLASS), 1600);
    }, 350);
  }, [ownMessages, revealMessage, scrollContainerRef]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) {
        return;
      }
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
        return;
      }
      const active = document.activeElement;
      if ((active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement) && active.value.trim()) {
        return;
      }
      if (ownMessages.length === 0) {
        return;
      }
      event.preventDefault();
      jump(event.key === 'ArrowUp' ? 'up' : 'down');
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [jump, ownMessages.length]);

  return { jump, ownMessageCount: ownMessages.length };
}
