// src/app/core/shared/utils/merge.utils.ts

/**
 * Merge two time-indexed arrays (e.g., bars or predictions) by `key` (default 'ts15'),
 * preferring items from `primary` when both exist.
 */
export function mergeByKey<T extends Record<string, any>>(
  primary: T[],
  secondary: T[],
  key: keyof T = 'ts15',
): T[] {
  const map = new Map<any, T>();
  for (const s of secondary) map.set(s[key], s);
  for (const p of primary) map.set(p[key], p); // primary wins
  return Array.from(map.values()).sort((a, b) => String(a[key]).localeCompare(String(b[key])));
}
