/**
 * Where email tooling writes its working files: send logs, rendered
 * previews, build output.
 *
 * Everything goes under one directory named `/tmp/sf-<tag>-email-builder`,
 * set as EMAIL_TMP_DIR (the generator writes it into .env.local), and
 * nothing is written anywhere else. Two checkouts or two shops on one
 * machine then never read or overwrite each other's files. A value that
 * is not of that form is refused rather than "fixed", so a typo cannot
 * point the logs at a real directory.
 *
 * On Vercel /tmp is per-instance and short-lived: fine for a log you read
 * back in the same request, not an archive.
 */

import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const EMAIL_TMP_ROOT = '/tmp';
export const EMAIL_TMP_NAME_PATTERN = /^sf-[a-z0-9]+(?:-[a-z0-9]+)*-email-builder$/;
export const DEFAULT_EMAIL_TMP_DIR = `${EMAIL_TMP_ROOT}/sf-shop-email-builder`;

export const EMAIL_TMP_AREAS = ['logs', 'previews', 'build'] as const;
export type EmailTmpArea = (typeof EMAIL_TMP_AREAS)[number];

const FILE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;

export type EmailTmpDirResult = { ok: true; dir: string } | { ok: false; reason: string };

/** EMAIL_TMP_DIR, checked; the default when unset. */
export function resolveEmailTmpDir(value: string | undefined = process.env.EMAIL_TMP_DIR): EmailTmpDirResult {
  const raw = value?.trim();
  if (!raw) return { ok: true, dir: DEFAULT_EMAIL_TMP_DIR };
  if (!path.isAbsolute(raw)) return { ok: false, reason: 'EMAIL_TMP_DIR must be an absolute path' };
  const dir = path.resolve(raw);
  if (path.dirname(dir) !== EMAIL_TMP_ROOT || !EMAIL_TMP_NAME_PATTERN.test(path.basename(dir))) {
    return { ok: false, reason: 'EMAIL_TMP_DIR must be /tmp/sf-<name>-email-builder' };
  }
  return { ok: true, dir };
}

/** Lowercase letters, digits and dashes, for the `<tag>` part. */
export function emailTmpDirFor(tag: string): string {
  const clean = tag
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${EMAIL_TMP_ROOT}/sf-${clean || 'shop'}-email-builder`;
}

/**
 * The full path for a file in one area. The name is a plain file name:
 * no directories, no `..`, so nothing can escape the area.
 */
export function emailTmpPath(area: EmailTmpArea, fileName: string, dir?: string): string {
  if (!EMAIL_TMP_AREAS.includes(area)) throw new Error(`Unknown email tmp area: ${area}`);
  if (!FILE_NAME_PATTERN.test(fileName) || fileName.includes('..')) {
    throw new Error(`Not a plain file name: ${fileName}`);
  }
  const root = dir ?? resolveRootOrThrow();
  // Always under /tmp, never the project: tell Turbopack not to trace it,
  // or it bundles the whole project into the server output.
  return path.join(/*turbopackIgnore: true*/ root, area, fileName);
}

function resolveRootOrThrow(): string {
  const resolved = resolveEmailTmpDir();
  if (!resolved.ok) throw new Error(resolved.reason);
  return resolved.dir;
}

async function ensureArea(area: EmailTmpArea, dir?: string): Promise<void> {
  // 0700: send logs hold (masked) addresses, other users have no business here.
  await mkdir(path.join(/*turbopackIgnore: true*/ dir ?? resolveRootOrThrow(), area), { recursive: true, mode: 0o700 });
}

/** Writes a whole file, e.g. a rendered preview. Returns its path. */
export async function writeEmailTmpFile(area: EmailTmpArea, fileName: string, content: string, dir?: string): Promise<string> {
  const target = emailTmpPath(area, fileName, dir);
  await ensureArea(area, dir);
  await writeFile(target, content, { mode: 0o600 });
  return target;
}

/** Appends one JSON object as a line to a `.jsonl` log. Returns its path. */
export async function appendEmailTmpLog(fileName: string, entry: unknown, dir?: string): Promise<string> {
  if (!fileName.endsWith('.jsonl')) throw new Error('Email logs are .jsonl files');
  const target = emailTmpPath('logs', fileName, dir);
  await ensureArea('logs', dir);
  await appendFile(target, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
  return target;
}
