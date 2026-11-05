import { readFile, rm, stat } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  appendEmailTmpLog,
  DEFAULT_EMAIL_TMP_DIR,
  emailTmpDirFor,
  emailTmpPath,
  resolveEmailTmpDir,
  writeEmailTmpFile
} from './tmpDir';

describe('resolveEmailTmpDir', () => {
  it('defaults when unset or blank', () => {
    const before = process.env.EMAIL_TMP_DIR;
    delete process.env.EMAIL_TMP_DIR;
    try {
      expect(resolveEmailTmpDir()).toEqual({ ok: true, dir: DEFAULT_EMAIL_TMP_DIR });
    } finally {
      if (before !== undefined) process.env.EMAIL_TMP_DIR = before;
    }
    expect(resolveEmailTmpDir('  ')).toEqual({ ok: true, dir: DEFAULT_EMAIL_TMP_DIR });
  });

  it.each(['/tmp/sf-oak-email-builder', '/tmp/sf-elm-email-builder', '/tmp/sf-my-shop-2-email-builder/'])('accepts %s', (dir) => {
    expect(resolveEmailTmpDir(dir)).toEqual({ ok: true, dir: dir.replace(/\/$/, '') });
  });

  it.each([
    'tmp/sf-oak-email-builder',
    '/tmp/oak-email-builder',
    '/tmp/sf-oak-email',
    '/tmp/sf-Oak-email-builder',
    '/tmp/sf--email-builder',
    '/var/tmp/sf-oak-email-builder',
    '/home/me/sf-oak-email-builder',
    '/tmp/sf-oak-email-builder/logs',
    '/tmp/../etc/sf-oak-email-builder',
    '/tmp'
  ])('refuses %s', (dir) => {
    expect(resolveEmailTmpDir(dir).ok).toBe(false);
  });
});

describe('emailTmpDirFor', () => {
  it('turns a branch or shop name into a directory', () => {
    expect(emailTmpDirFor('oak')).toBe('/tmp/sf-oak-email-builder');
    expect(emailTmpDirFor('My Shop!')).toBe('/tmp/sf-my-shop-email-builder');
    expect(emailTmpDirFor('---')).toBe('/tmp/sf-shop-email-builder');
    expect(resolveEmailTmpDir(emailTmpDirFor('Feat/Email_Builder')).ok).toBe(true);
  });
});

describe('emailTmpPath', () => {
  const dir = '/tmp/sf-oak-email-builder';

  it('puts files in their area', () => {
    expect(emailTmpPath('logs', 'test-sends.jsonl', dir)).toBe('/tmp/sf-oak-email-builder/logs/test-sends.jsonl');
    expect(emailTmpPath('previews', 'campaign-en.html', dir)).toBe('/tmp/sf-oak-email-builder/previews/campaign-en.html');
  });

  it.each(['../escape.txt', 'a/b.txt', '.hidden', '', 'x'.repeat(200), '..'])('refuses the file name %j', (name) => {
    expect(() => emailTmpPath('logs', name, dir)).toThrow();
  });

  it('refuses an unknown area', () => {
    expect(() => emailTmpPath('secrets' as never, 'x.txt', dir)).toThrow();
  });

  it('refuses to work under a misconfigured EMAIL_TMP_DIR', () => {
    const before = process.env.EMAIL_TMP_DIR;
    process.env.EMAIL_TMP_DIR = '/home/me/logs';
    try {
      expect(() => emailTmpPath('logs', 'x.jsonl')).toThrow('EMAIL_TMP_DIR must be /tmp/sf-<name>-email-builder');
    } finally {
      if (before === undefined) delete process.env.EMAIL_TMP_DIR;
      else process.env.EMAIL_TMP_DIR = before;
    }
  });
});

describe('writing files', () => {
  // The configured directory, as the app would use it; the files are removed again.
  const resolved = resolveEmailTmpDir();
  const dir = resolved.ok ? resolved.dir : DEFAULT_EMAIL_TMP_DIR;
  const name = `vitest-${process.pid}`;

  it('appends JSON lines to a log, owner-only', async () => {
    const target = await appendEmailTmpLog(`${name}.jsonl`, { n: 1 }, dir);
    await appendEmailTmpLog(`${name}.jsonl`, { n: 2 }, dir);
    try {
      expect(target.startsWith(`${dir}/logs/`)).toBe(true);
      const lines = (await readFile(target, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
      expect(lines).toEqual([{ n: 1 }, { n: 2 }]);
      expect((await stat(target)).mode & 0o077).toBe(0);
    } finally {
      await rm(target, { force: true });
    }
  });

  it('only appends to .jsonl logs', async () => {
    await expect(appendEmailTmpLog(`${name}.txt`, {}, dir)).rejects.toThrow('.jsonl');
  });

  it('writes a whole file into an area', async () => {
    const target = await writeEmailTmpFile('build', `${name}.txt`, 'hello', dir);
    try {
      expect(target).toBe(`${dir}/build/${name}.txt`);
      expect(await readFile(target, 'utf8')).toBe('hello');
    } finally {
      await rm(target, { force: true });
    }
  });
});
