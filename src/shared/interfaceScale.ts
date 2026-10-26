/**
 * How large the whole interface is drawn, as a percentage of the browser's
 * default text size. Spacing is in rem, so the root font size scales layout,
 * text and controls together. Kept per device rather than with the synced
 * preferences: a phone and a laptop want different sizes.
 */
export const INTERFACE_SCALES = [80, 90, 100, 110] as const;

export type InterfaceScale = (typeof INTERFACE_SCALES)[number];

const STORAGE_KEY = 'interface-scale';
const DEFAULT_SCALE: InterfaceScale = 100;

export function readInterfaceScale(): InterfaceScale {
  try {
    const stored = Number(localStorage.getItem(STORAGE_KEY));
    return (INTERFACE_SCALES as readonly number[]).includes(stored) ? (stored as InterfaceScale) : DEFAULT_SCALE;
  } catch {
    return DEFAULT_SCALE;
  }
}

export function applyInterfaceScale(scale: InterfaceScale): void {
  document.documentElement.style.fontSize = scale === DEFAULT_SCALE ? '' : `${scale}%`;
}

export function writeInterfaceScale(scale: InterfaceScale): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(scale));
  } catch {
    // Storage unavailable: the size still applies until the page reloads.
  }
  applyInterfaceScale(scale);
}
