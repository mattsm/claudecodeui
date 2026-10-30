/**
 * Labels for a message's timestamp: the time alone for today, with the date
 * otherwise (and the year when it differs), plus a full label for the tooltip.
 */
export type MessageTimestampLabels = { short: string; full: string; iso: string };

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export function formatMessageTimestamp(
  timestamp: string | number | Date | undefined | null,
  now: Date = new Date(),
  locale?: string,
): MessageTimestampLabels | null {
  if (timestamp === undefined || timestamp === null || timestamp === '') {
    return null;
  }
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const time = date.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
  let short = time;
  if (!sameDay(date, now)) {
    const day = date.toLocaleDateString(locale, {
      month: 'short',
      day: 'numeric',
      ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
    });
    short = `${day}, ${time}`;
  }

  const full = date.toLocaleString(locale, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
  return { short, full, iso: date.toISOString() };
}
