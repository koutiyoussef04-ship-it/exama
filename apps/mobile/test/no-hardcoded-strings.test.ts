/**
 * Guard: screens and components must not contain hardcoded user-facing English.
 * Flags JSX text with letters and literal title/label/placeholder/message/accessibility props.
 * Opt out for a deliberate literal (e.g. the brand wordmark) with an `i18n-ignore` comment on the
 * line above.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const ROOTS = [
  fileURLToPath(new URL('../src/app', import.meta.url)),
  fileURLToPath(new URL('../src/components', import.meta.url)),
];
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.tsx') ? [p] : [];
  });

const JSX_TEXT = />\s*([^<>{}\n]*[A-Za-z]{2,}[^<>{}\n]*)\s*</g;
const LITERAL_PROP = /\b(title|label|placeholder|message|confirmText|cancelText|accessibilityLabel|accessibilityHint)=["']([^"']*[A-Za-z]{2,}[^"']*)["']/g;
const LITERAL_OPTION = /\b(title|message|confirmText|label):\s*['"`]([^'"`]*[A-Za-z]{3,}[^'"`]*)['"`]/g;

test('no hardcoded user-facing strings in screens and components', () => {
  const problems: string[] = [];
  for (const file of ROOTS.flatMap(files)) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (/i18n-ignore/.test(lines[i - 1] ?? '') || /^\s*(\/\/|\*|\/\*)/.test(line)) return;
      for (const re of [JSX_TEXT, LITERAL_PROP, LITERAL_OPTION]) {
        for (const m of line.matchAll(re)) {
          const text = (m[2] ?? m[1]).trim();
          if (/^(=>|&&|\|\||\?|:)/.test(text) || /[=;()]|&&|\|\||\w\.\w/.test(text)) continue; // code, not text
          problems.push(`${file.split('/src/')[1]}:${i + 1}  "${text}"`);
        }
      }
    });
  }
  assert.deepEqual(problems, [], `Move these strings into src/i18n/locales:\n${problems.join('\n')}`);
});
