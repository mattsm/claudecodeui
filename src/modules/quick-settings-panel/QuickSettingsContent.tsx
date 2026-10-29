import {
  Brain,
  ChevronsUpDown,
  Eye,
  Languages,
  Mic,
  Moon,
  Sun,
  ZoomOut,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DarkModeToggle } from '@/shared/ui';
import { LanguageSelector } from '@/modules/i18n';
import { SETTING_ROW_CLASS } from '@/shared/constants';
import { INTERFACE_SCALES, readInterfaceScale, writeInterfaceScale } from '@/shared/interfaceScale';
import type { InterfaceScale } from '@/shared/interfaceScale';
import type { PreferenceToggleKey, QuickSettingsPreferences } from '@/shared/types';
import QuickSettingsSection from '@/modules/quick-settings-panel/QuickSettingsSection';
import QuickSettingsToggleRow from '@/modules/quick-settings-panel/QuickSettingsToggleRow';

/** Declarative description of one quick settings toggle row - its preference key, translation key and icon - so the rows can be rendered from a list instead of hand-written. */
type PreferenceToggleItem = {
  key: PreferenceToggleKey;
  labelKey: string;
  icon: LucideIcon;
};

const TOOL_DISPLAY_TOGGLES: PreferenceToggleItem[] = [
  {
    key: 'showRawParameters',
    labelKey: 'quickSettings.showRawParameters',
    icon: Eye,
  },
  {
    key: 'showThinking',
    labelKey: 'quickSettings.showThinking',
    icon: Brain,
  },
  {
    key: 'expandThinking',
    labelKey: 'quickSettings.expandThinking',
    icon: ChevronsUpDown,
  },
];

const INPUT_SETTING_TOGGLES: PreferenceToggleItem[] = [
  {
    key: 'sendByCtrlEnter',
    labelKey: 'quickSettings.sendByCtrlEnter',
    icon: Languages,
  },
  {
    key: 'voiceEnabled',
    labelKey: 'quickSettings.voiceEnabled',
    icon: Mic,
  },
];

type QuickSettingsContentProps = {
  isDarkMode: boolean;
  preferences: QuickSettingsPreferences;
  onPreferenceChange: (key: PreferenceToggleKey, value: boolean) => void;
};

/** Rendered by QuickSettingsPanelView to show the drawer's appearance, tool display and input preference rows. */
export default function QuickSettingsContent({
  isDarkMode,
  preferences,
  onPreferenceChange,
}: QuickSettingsContentProps) {
  const { t } = useTranslation('settings');
  const [interfaceScale, setInterfaceScale] = useState<InterfaceScale>(readInterfaceScale);
  const inputSettingToggles = preferences.voiceEnabled
    ? INPUT_SETTING_TOGGLES
    : INPUT_SETTING_TOGGLES.filter(({ key }) => key !== 'voiceEnabled');

  const renderToggleRows = (items: PreferenceToggleItem[]) => (
    items.map(({ key, labelKey, icon }) => (
      <QuickSettingsToggleRow
        key={key}
        label={t(labelKey)}
        icon={icon}
        checked={preferences[key]}
        onCheckedChange={(value) => onPreferenceChange(key, value)}
      />
    ))
  );

  return (
    <div className="flex-1 space-y-6 overflow-y-auto overflow-x-hidden bg-background p-4">
      <QuickSettingsSection title={t('quickSettings.sections.appearance')}>
        <div className={SETTING_ROW_CLASS}>
          <span className="flex items-center gap-2 text-sm text-foreground">
            {isDarkMode ? (
              <Moon className="h-4 w-4 text-muted-foreground" />
            ) : (
              <Sun className="h-4 w-4 text-muted-foreground" />
            )}
            {t('quickSettings.darkMode')}
          </span>
          <DarkModeToggle />
        </div>
        <div className={SETTING_ROW_CLASS}>
          <span className="flex items-center gap-2 text-sm text-foreground">
            <ZoomOut className="h-4 w-4 text-muted-foreground" />
            {t('quickSettings.interfaceScale', { defaultValue: 'Interface size' })}
          </span>
          <div role="radiogroup" aria-label={t('quickSettings.interfaceScale', { defaultValue: 'Interface size' })} className="flex overflow-hidden rounded-md border border-border/60 text-xs">
            {INTERFACE_SCALES.map((scale) => (
              <button
                key={scale}
                type="button"
                role="radio"
                aria-checked={interfaceScale === scale}
                onClick={() => {
                  writeInterfaceScale(scale);
                  setInterfaceScale(scale);
                }}
                className={`px-2 py-1 ${interfaceScale === scale ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
              >
                {scale}%
              </button>
            ))}
          </div>
        </div>
        <LanguageSelector compact />
      </QuickSettingsSection>

      <QuickSettingsSection title={t('quickSettings.sections.toolDisplay')}>
        {renderToggleRows(TOOL_DISPLAY_TOGGLES)}
      </QuickSettingsSection>

      <QuickSettingsSection title={t('quickSettings.sections.inputSettings')}>
        {renderToggleRows(inputSettingToggles)}
        <p className="ml-3 text-xs text-muted-foreground">
          {t('quickSettings.sendByCtrlEnterDescription')}
        </p>
      </QuickSettingsSection>
    </div>
  );
}
