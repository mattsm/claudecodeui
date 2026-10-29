import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { BrainIcon } from 'lucide-react';

import { cn } from '@/shared/utils';
import { PromptInputButton } from '@/modules/chat/composer/PromptInput';
import { useOptionalSetUiPreference, useOptionalUiPreferences } from '@/shared/context/UiPreferencesContext';

/**
 * Composer toolbar switch for the `expandThinking` preference, with Alt+T as
 * its shortcut. `event.code` because Alt+T types a character on macOS.
 * Renders nothing outside a preferences provider.
 */
export default function ExpandThinkingToggle() {
  const { t } = useTranslation('settings');
  const preferences = useOptionalUiPreferences();
  const setPreference = useOptionalSetUiPreference();
  const expandThinking = preferences?.expandThinking ?? false;

  useEffect(() => {
    if (!setPreference) {
      return undefined;
    }
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

  if (!preferences?.showThinking || !setPreference) {
    return null;
  }

  const label = t('quickSettings.expandThinking');
  return (
    <PromptInputButton
      tooltip={{ content: label, shortcut: 'Alt+T' }}
      onClick={() => setPreference('expandThinking', !expandThinking)}
      aria-label={`${label} (Alt+T)`}
      aria-pressed={expandThinking}
      className={cn(expandThinking && 'bg-primary/15 text-primary hover:bg-primary/25 hover:text-primary')}
    >
      <BrainIcon />
    </PromptInputButton>
  );
}
