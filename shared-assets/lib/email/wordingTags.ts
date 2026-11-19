/**
 * Personal details the owner can put in the receipt, shipping and refund
 * wording (brand → copy), written the same way as campaign merge tags:
 * `{{customer.first_name|there}}`. A separate, smaller registry than the
 * campaign one: these emails are about an order, not a subscriber.
 *
 * Pure. The brand schema refuses an unknown or malformed tag when the owner
 * saves; the renderer fills in what it knows and uses the fallback text,
 * or nothing, for the rest.
 */

export const WORDING_TAGS = ['customer.first_name', 'order.reference', 'shop.name'] as const;
export type WordingTag = (typeof WORDING_TAGS)[number];
export type WordingValues = Partial<Record<WordingTag, string | null | undefined>>;

/** At most this many characters of fallback text after the `|`. */
export const WORDING_TAG_FALLBACK_MAX = 60;

const TAG_PATTERN = /\{\{\s*([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*)\s*(?:\|([^{}|]*))?\}\}/g;

function isWordingTag(key: string): key is WordingTag {
  return (WORDING_TAGS as readonly string[]).includes(key);
}

export type WordingTagProblem =
  | { code: 'unknown'; key: string }
  | { code: 'fallback-too-long'; key: string }
  | { code: 'malformed' };

export function wordingTagProblems(text: string): WordingTagProblem[] {
  const problems: WordingTagProblem[] = [];
  for (const match of text.matchAll(TAG_PATTERN)) {
    const key = match[1];
    if (!isWordingTag(key)) problems.push({ code: 'unknown', key });
    if (match[2] !== undefined && match[2].trim().length > WORDING_TAG_FALLBACK_MAX) {
      problems.push({ code: 'fallback-too-long', key });
    }
  }
  const leftover = text.replace(TAG_PATTERN, '');
  if (leftover.includes('{{') || leftover.includes('}}')) problems.push({ code: 'malformed' });
  return problems;
}

export function describeWordingTagProblem(problem: WordingTagProblem): string {
  switch (problem.code) {
    case 'unknown':
      return `Unknown tag {{${problem.key}}}; use ${WORDING_TAGS.map((tag) => `{{${tag}}}`).join(', ')}`;
    case 'fallback-too-long':
      return `The fallback for {{${problem.key}}} is too long`;
    case 'malformed':
      return 'A tag is missing a brace: write {{tag}}';
  }
}

/** Fill the tags in; an unknown or empty one becomes its fallback text. */
export function interpolateWording(text: string, values: WordingValues): string {
  return text.replace(TAG_PATTERN, (_raw, key: string, fallback: string | undefined) => {
    const fallbackText = fallback?.trim() ?? '';
    if (!isWordingTag(key)) return fallbackText;
    const value = values[key]?.trim();
    return value || fallbackText;
  });
}

/** "Jo Smith" -> "Jo". Null for nothing usable. */
export function firstNameOf(fullName: string | null | undefined): string | null {
  const first = fullName?.trim().split(/\s+/)[0];
  return first || null;
}
