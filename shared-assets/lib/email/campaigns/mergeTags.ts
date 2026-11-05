/**
 * Merge tags: `{{subscriber.first_name}}` or, with a fallback for when the
 * value is empty, `{{subscriber.first_name|there}}`.
 *
 * The owner inserts them from a menu in the designer, but they are plain
 * text in the stored document, so they work the same in a subject line, a
 * button label and rich text. Every tag is checked against the registry
 * below when a template is saved, and again when it is rendered, so a typo
 * is caught in the editor rather than mailed to a thousand people.
 */

export interface MergeTagDefinition {
  /** Shown in the preview and the designer's merge-tag menu. */
  sample: string;
  /** Holds a URL, so it may start a link's address. */
  url?: boolean;
}

export const MERGE_TAGS = {
  'subscriber.first_name': { sample: 'Alex' },
  'subscriber.email': { sample: 'alex@example.com' },
  'shop.name': { sample: 'Your Shop' },
  'shop.url': { sample: 'https://shop.example', url: true },
  /** The shop in the recipient's language, `https://shop.example/de`: links are shared by every locale. */
  'shop.locale_url': { sample: 'https://shop.example/en', url: true },
  unsubscribe_url: { sample: 'https://shop.example/unsubscribe', url: true },
  current_year: { sample: '2026' }
} as const satisfies Record<string, MergeTagDefinition>;

export type MergeTagKey = keyof typeof MERGE_TAGS;

export type MergeValues = Partial<Record<MergeTagKey, string | null | undefined>>;

export const MERGE_TAG_FALLBACK_MAX = 100;

/**
 * One tag: a key of lowercase words joined by dots, an optional `|` and
 * fallback text without braces or another `|`. Spaces inside the braces
 * are allowed (`{{ shop.name }}`), since people type them.
 */
const TAG_PATTERN = /\{\{\s*([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*)\s*(?:\|([^{}|]*))?\}\}/g;

export function isMergeTagKey(key: string): key is MergeTagKey {
  return Object.prototype.hasOwnProperty.call(MERGE_TAGS, key);
}

export interface MergeTagToken {
  key: string;
  fallback: string | null;
  /** The whole `{{...}}` as written. */
  raw: string;
  index: number;
}

export function findMergeTags(text: string): MergeTagToken[] {
  return Array.from(text.matchAll(TAG_PATTERN), (match) => ({
    key: match[1],
    fallback: match[2] === undefined ? null : match[2].trim(),
    raw: match[0],
    index: match.index ?? 0
  }));
}

export type MergeTagProblem =
  | { code: 'unknown'; key: string }
  | { code: 'malformed' }
  | { code: 'fallback-too-long'; key: string };

/**
 * What is wrong with the tags in a piece of text, if anything. Braces
 * left over once every well-formed tag is removed mean a tag was mistyped
 * (`{{shop.name}`, `{shop.name}}`), which would otherwise go out verbatim.
 */
export function mergeTagProblems(text: string): MergeTagProblem[] {
  const problems: MergeTagProblem[] = [];
  for (const token of findMergeTags(text)) {
    if (!isMergeTagKey(token.key)) problems.push({ code: 'unknown', key: token.key });
    if (token.fallback !== null && token.fallback.length > MERGE_TAG_FALLBACK_MAX) {
      problems.push({ code: 'fallback-too-long', key: token.key });
    }
  }
  const leftover = text.replace(TAG_PATTERN, '');
  if (leftover.includes('{{') || leftover.includes('}}')) problems.push({ code: 'malformed' });
  return problems;
}

/**
 * Replaces every tag with its value, the fallback when the value is empty,
 * or nothing. Unknown keys (a document saved before a tag was retired) are
 * reported through `onUnknown` and render as their fallback, never as the
 * raw `{{...}}`.
 */
export function interpolateMergeTags(
  text: string,
  values: MergeValues,
  onUnknown?: (key: string) => void
): string {
  return text.replace(TAG_PATTERN, (_raw, key: string, fallback: string | undefined) => {
    const fallbackText = fallback?.trim() ?? '';
    if (!isMergeTagKey(key)) {
      onUnknown?.(key);
      return fallbackText;
    }
    const value = values[key];
    return value && value.trim() ? value : fallbackText;
  });
}

/** Values for the designer preview, so tags show something realistic. */
export function sampleMergeValues(overrides: MergeValues = {}): MergeValues {
  const samples: MergeValues = {};
  for (const [key, definition] of Object.entries(MERGE_TAGS)) {
    samples[key as MergeTagKey] = definition.sample;
  }
  return { ...samples, ...overrides };
}

/** True when the text, before interpolation, starts with a URL-valued tag. */
export function startsWithUrlTag(text: string): boolean {
  const first = findMergeTags(text)[0];
  if (!first || first.index !== 0 || !isMergeTagKey(first.key)) return false;
  return Boolean((MERGE_TAGS[first.key] as MergeTagDefinition).url);
}
