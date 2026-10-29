import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/modules/chat/transcript/Reasoning';

const block = (props: { expanded?: boolean; isStreaming?: boolean }) => (
  <Reasoning {...props}>
    <ReasoningTrigger />
    <ReasoningContent>the thinking text</ReasoningContent>
  </Reasoning>
);

const isOpen = () => screen.getByRole('button').getAttribute('aria-expanded') === 'true';

describe('Expand thinking', () => {
  it('opens every block when on and closes them when turned off', () => {
    const view = render(block({ expanded: false }));
    expect(isOpen()).toBe(false);

    view.rerender(block({ expanded: true }));
    expect(isOpen()).toBe(true);

    view.rerender(block({ expanded: false }));
    expect(isOpen()).toBe(false);
  });

  it('starts open, and a block can still be closed by hand', () => {
    render(block({ expanded: true }));
    expect(isOpen()).toBe(true);

    fireEvent.click(screen.getByRole('button'));
    expect(isOpen()).toBe(false);
  });

  it('keeps a block open after its thinking finishes streaming', async () => {
    const view = render(block({ expanded: true, isStreaming: true }));
    view.rerender(block({ expanded: true, isStreaming: false }));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1200)); });
    expect(isOpen()).toBe(true);
  });

  it('still auto-closes after streaming when off', async () => {
    const view = render(block({ isStreaming: true }));
    expect(isOpen()).toBe(true);
    view.rerender(block({ isStreaming: false }));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1200)); });
    expect(isOpen()).toBe(false);
  });
});
