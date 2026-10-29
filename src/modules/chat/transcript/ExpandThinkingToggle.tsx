import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { BrainIcon } from 'lucide-react';

import { cn } from '@/shared/utils';
import { useSetUiPreference, useUiPreferences } from '@/shared/context/UiPreferencesContext';

/**
 * One-click switch for the `expandThinking` preference, floated over the
 * transcript's bottom edge, with Alt+T as its shortcut. `event.code` because
 * Alt+T types a character on macOS.
 */
export default function ExpandThinkingToggle({ className }: { className?: string }) {
  const { t } = useTranslation('settings');
  const { expandThinking, showThinking } = useUiPreferences();
  const setPreference = useSetUiPreference();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.altKey || event.metaKey || event.ctrlKey || event.shiftKey || event.code !== 'KeyT') {
        return;
      }
      event.preventDefault();
      setPreference('expandThinking', !expandThinking);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [expandThinking, setPreference]);

  if (!showThinking) {
    return null;
  }

  const label = `${t('quickSettings.expandThinking')} (Alt+T)`;
  return (
    <button
      type="button"
      onClick={() => setPreference('expandThinking', !expandThinking)}
      aria-label={label}
      aria-pressed={expandThinking}
      title={label}
      className={cn(
        'pointer-events-auto flex h-8 w-8 items-center justify-center rounded-full border shadow-sm transition-all duration-200',
        expandThinking
          ? 'border-primary/60 bg-primary/15 text-primary hover:bg-primary/25'
          : 'border-border/50 bg-card text-muted-foreground hover:bg-accent hover:text-foreground',
        className,
      )}
    >
      <BrainIcon className="h-4 w-4" aria-hidden />
    </button>
  );
}
