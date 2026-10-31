import { WifiIcon } from 'lucide-react';

import { cn } from '@/shared/utils';

/**
 * Bench-lock markers at the front of a chat title. `~/bin/board-lock-title.mjs`
 * prefixes the title of the chat holding a bench resource with "[A3] ",
 * "[A1] ", "🍎 " (Mac mini) or "🐧 " (goliath Wi-Fi client), or the older
 * "🔒A3 "-style markers; the sidebar draws them as icons.
 */
export type BenchLock = 'A1' | 'A3' | 'MAC' | 'WIFI1';

const MARKER = /^(?:🔒(A1|A3|MAC|WIFI1)|\[(A1|A3)\]|(🍎)|(🐧)) /u;
const EMOJI_LOCKS: Record<string, BenchLock> = { '🍎': 'MAC', '🐧': 'WIFI1' };

export function splitBenchLockPrefix(name: string): { locks: BenchLock[]; title: string } {
  const locks: BenchLock[] = [];
  let rest = name;
  for (let match = MARKER.exec(rest); match; match = MARKER.exec(rest)) {
    locks.push((match[1] ?? match[2] ?? EMOJI_LOCKS[match[3] ?? match[4]]) as BenchLock);
    rest = rest.slice(match[0].length);
  }
  return { locks, title: rest };
}

const LOCK_LABELS: Record<BenchLock, string> = {
  A1: 'Holds the bench A1',
  A3: 'Holds the bench A3',
  MAC: 'Holds the bench Mac mini',
  WIFI1: 'Holds the goliath Wi-Fi client',
};

/** A Meter access point: a white rounded square with the model in bold and a status light. */
function AccessPointIcon({ model }: { model: string }) {
  return (
    <span className="relative inline-flex h-4 min-w-[22px] items-center justify-center rounded-[4px] border border-gray-300 bg-white px-0.5 text-[9px] font-extrabold leading-none tracking-tight text-gray-900 shadow-sm dark:border-gray-500">
      {model}
      <span className="absolute bottom-[1px] right-[1px] h-[3px] w-[3px] rounded-full bg-emerald-500" />
    </span>
  );
}

/** A Mac mini seen from the front: a low silver box with its status light. */
function MacMiniIcon() {
  return (
    <svg viewBox="0 0 20 12" className="h-3 w-5" aria-hidden>
      <rect x="1" y="3" width="18" height="6.5" rx="2" className="fill-gray-200 stroke-gray-500 dark:fill-gray-300" strokeWidth="0.8" />
      <rect x="3" y="9.5" width="14" height="1" rx="0.5" className="fill-gray-500" />
      <circle cx="16" cy="6.3" r="0.8" className="fill-emerald-500" />
    </svg>
  );
}

function LockIcon({ lock }: { lock: BenchLock }) {
  const icon = lock === 'MAC'
    ? <MacMiniIcon />
    : lock === 'WIFI1'
      ? <WifiIcon className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" aria-hidden />
      : <AccessPointIcon model={lock} />;
  return (
    <span role="img" aria-label={LOCK_LABELS[lock]} title={LOCK_LABELS[lock]} className="inline-flex flex-shrink-0 items-center">
      {icon}
    </span>
  );
}

/** A chat title with its bench-lock markers drawn as icons. */
export function SessionTitle({ name, className }: { name: string; className?: string }) {
  const { locks, title } = splitBenchLockPrefix(name);
  if (locks.length === 0) {
    return <>{name}</>;
  }
  return (
    <span className={cn('inline-flex min-w-0 max-w-full items-center gap-1 align-middle', className)}>
      {locks.map((lock) => <LockIcon key={lock} lock={lock} />)}
      <span className="min-w-0 truncate">{title}</span>
    </span>
  );
}
