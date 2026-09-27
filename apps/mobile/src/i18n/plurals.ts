/**
 * Fills plural forms a locale doesn't define with its `_other` form, so i18next never falls back
 * to a raw key (e.g. Spanish/French `_many`, used for millions). Pure; unit-tested.
 */
type Dict = { [k: string]: string | Dict };
const SUFFIXES = ['zero', 'one', 'two', 'few', 'many', 'other'] as const;

export function pluralCategories(lang: string): string[] {
  return new Intl.PluralRules(lang).resolvedOptions().pluralCategories as string[];
}

export function completePlurals<T extends Dict>(dict: T, lang: string): T {
  const needed = pluralCategories(lang);
  const walk = (node: Dict): Dict => {
    const out: Dict = {};
    for (const [k, v] of Object.entries(node)) out[k] = typeof v === 'string' ? v : walk(v);
    for (const key of Object.keys(node)) {
      const m = key.match(/^(.*)_other$/);
      if (!m || typeof node[key] !== 'string') continue;
      for (const cat of needed) if (!(`${m[1]}_${cat}` in out)) out[`${m[1]}_${cat}`] = node[key];
    }
    return out;
  };
  return walk(dict) as T;
}

export const PLURAL_SUFFIXES = SUFFIXES;
