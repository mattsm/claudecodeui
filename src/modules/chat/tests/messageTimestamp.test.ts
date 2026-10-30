import { describe, expect, it } from 'vitest';

import { formatMessageTimestamp } from '@/modules/chat/utils/messageTimestamp';

const NOW = new Date(2026, 9, 30, 15, 0, 0);

describe('message timestamps', () => {
  it('shows only the time for a message from today', () => {
    const labels = formatMessageTimestamp(new Date(2026, 9, 30, 9, 5, 7), NOW, 'en-US');
    expect(labels?.short).toBe('9:05 AM');
    expect(labels?.full).toBe('Fri, Oct 30, 2026, 9:05:07 AM');
  });

  it('adds the date for an earlier day, and the year for an earlier year', () => {
    expect(formatMessageTimestamp(new Date(2026, 9, 29, 23, 59), NOW, 'en-US')?.short).toBe('Oct 29, 11:59 PM');
    expect(formatMessageTimestamp(new Date(2025, 11, 31, 8, 0), NOW, 'en-US')?.short).toBe('Dec 31, 2025, 8:00 AM');
  });

  it('returns nothing for a missing or unparseable timestamp', () => {
    expect(formatMessageTimestamp(undefined, NOW)).toBeNull();
    expect(formatMessageTimestamp('', NOW)).toBeNull();
    expect(formatMessageTimestamp('not a date', NOW)).toBeNull();
  });
});
