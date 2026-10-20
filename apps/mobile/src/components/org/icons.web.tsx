/**
 * Workspace icons on the web: inline SVG, 24-unit grid, 1.75 px strokes, drawn here (no icon font, no
 * extra dependency). `icons.tsx` is the native fallback. Keep both exports identical.
 */
import { colors } from '@/components/ui';

export type IconName = 'dashboard' | 'courses' | 'review' | 'bank' | 'export' | 'members' | 'account' | 'search' | 'close' | 'check' | 'chevronLeft' | 'chevronRight' | 'chevronDown' | 'back' | 'menu' | 'upload' | 'plus' | 'logout' | 'help';

const PATHS: Record<IconName, string> = {
  dashboard: 'M4 4h6v7H4zM14 4h6v4h-6zM14 12h6v8h-6zM4 15h6v5H4z',
  courses: 'M5 4h9a3 3 0 0 1 3 3v13H8a3 3 0 0 0-3 3zM5 4v16M8 20h11M9 8h5M9 11h5',
  review: 'M5 5h14v14H5zM8.5 12.5l2.5 2.5 4.5-5',
  bank: 'M4 7c0-1.5 3.6-2.5 8-2.5s8 1 8 2.5-3.6 2.5-8 2.5-8-1-8-2.5zM4 7v10c0 1.5 3.6 2.5 8 2.5s8-1 8-2.5V7M4 12c0 1.5 3.6 2.5 8 2.5s8-1 8-2.5',
  export: 'M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19h14',
  members: 'M9 12a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM3.5 20c0-3 2.5-5 5.5-5s5.5 2 5.5 5M16 11.5a3 3 0 1 0 0-6M17.5 15c2 .5 3.5 2.3 3.5 5',
  account: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM5 20c0-3.5 3-6 7-6s7 2.5 7 6',
  search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM15.5 15.5 20 20',
  close: 'M6 6l12 12M18 6 6 18',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  chevronLeft: 'M14.5 6 8.5 12l6 6',
  chevronRight: 'M9.5 6l6 6-6 6',
  chevronDown: 'M6 9.5l6 6 6-6',
  back: 'M19 12H5M11 6l-6 6 6 6',
  menu: 'M4 7h16M4 12h16M4 17h16',
  upload: 'M12 16V5M7.5 9.5 12 5l4.5 4.5M5 19h14',
  plus: 'M12 5v14M5 12h14',
  logout: 'M10 5H5v14h5M14 8l4 4-4 4M18 12H9',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.8 2.1c-.8.5-1.3 1-1.3 1.9M12 17h.01',
};

export function Icon({ name, size = 20, color = colors.muted }: { name: IconName; size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" style={{ flexShrink: 0 }}>
      <path d={PATHS[name]} />
    </svg>
  );
}
