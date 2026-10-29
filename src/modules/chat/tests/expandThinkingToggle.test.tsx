import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import '@/modules/i18n';
import ExpandThinkingToggle from '@/modules/chat/transcript/ExpandThinkingToggle';
import { UiPreferencesProvider, useUiPreferences } from '@/shared/context/UiPreferencesContext';
import { resetUserPreferences } from '@/shared/userSettings';

const Probe = () => <span data-testid="state">{String(useUiPreferences().expandThinking)}</span>;

const mount = () => render(
  <UiPreferencesProvider>
    <ExpandThinkingToggle />
    <Probe />
  </UiPreferencesProvider>,
);

const state = () => screen.getByTestId('state').textContent;

beforeEach(() => {
  localStorage.clear();
  resetUserPreferences();
});

describe('the Expand thinking button', () => {
  it('flips the preference on each click and shows it as pressed', () => {
    mount();
    const button = screen.getByRole('button', { name: /Expand thinking/ });
    expect(state()).toBe('false');
    expect(button.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(button);
    expect(state()).toBe('true');
    expect(button.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(button);
    expect(state()).toBe('false');
  });

  it('flips on Alt+T by key position, and ignores other chords', () => {
    mount();
    fireEvent.keyDown(document, { key: '†', code: 'KeyT', altKey: true });
    expect(state()).toBe('true');

    fireEvent.keyDown(document, { key: 't', code: 'KeyT', altKey: true, ctrlKey: true });
    fireEvent.keyDown(document, { key: 't', code: 'KeyT' });
    expect(state()).toBe('true');

    fireEvent.keyDown(document, { key: 't', code: 'KeyT', altKey: true });
    expect(state()).toBe('false');
  });
});
