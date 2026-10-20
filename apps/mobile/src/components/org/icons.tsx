/**
 * Workspace icons on native: text glyphs sized like the web SVGs (`icons.web.tsx`), so the organization
 * screens read the same on a phone without an icon font. Keep both exports identical.
 */
import { Text } from 'react-native';
import { colors } from '@/components/ui';

export type IconName = 'dashboard' | 'courses' | 'review' | 'bank' | 'export' | 'members' | 'account' | 'search' | 'close' | 'check' | 'chevronLeft' | 'chevronRight' | 'chevronDown' | 'back' | 'menu' | 'upload' | 'plus' | 'logout' | 'help';

const GLYPHS: Record<IconName, string> = {
  dashboard: '▦',
  courses: '▤',
  review: '☑',
  bank: '≣',
  export: '↧',
  members: '⚇',
  account: '◯',
  search: '⌕',
  close: '✕',
  check: '✓',
  chevronLeft: '‹',
  chevronRight: '›',
  chevronDown: '⌄',
  back: '←',
  menu: '☰',
  upload: '↥',
  plus: '+',
  logout: '⇥',
  help: '?',
};

export function Icon({ name, size = 20, color = colors.muted }: { name: IconName; size?: number; color?: string }) {
  return (
    <Text style={{ fontSize: size, lineHeight: size + 2, color, width: size, textAlign: 'center' }} accessibilityElementsHidden importantForAccessibility="no">
      {GLYPHS[name]}
    </Text>
  );
}
