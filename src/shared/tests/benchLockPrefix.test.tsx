import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { SessionTitle, splitBenchLockPrefix } from '@/shared/ui/SessionTitle';

describe('bench-lock title markers', () => {
  it('peels every marker off the front of the title, in order', () => {
    expect(splitBenchLockPrefix('🔒WIFI1 🔒MAC 🔒A3 🔒A1 combined perf')).toEqual({
      locks: ['WIFI1', 'MAC', 'A3', 'A1'],
      title: 'combined perf',
    });
    expect(splitBenchLockPrefix('combined perf')).toEqual({ locks: [], title: 'combined perf' });
  });

  it('leaves markers that are not at the front, and unknown ones, as text', () => {
    expect(splitBenchLockPrefix('notes on 🔒A3 handoff').locks).toEqual([]);
    expect(splitBenchLockPrefix('🔒A2 spare').locks).toEqual([]);
  });

  it('draws the markers as labelled icons and keeps the rest of the title', () => {
    render(<SessionTitle name="🔒A3 🔒MAC flash test" />);
    expect(screen.getByRole('img', { name: 'Holds the bench A3' }).textContent).toBe('A3');
    expect(screen.getByRole('img', { name: 'Holds the bench Mac mini' })).toBeTruthy();
    expect(screen.getByText('flash test')).toBeTruthy();
  });
});
