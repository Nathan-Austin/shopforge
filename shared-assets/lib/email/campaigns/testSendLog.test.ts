import { describe, expect, it } from 'vitest';

import { maskEmail, testSendLogEntry, testSendLogFile, type TestSendResult } from './testSendLog';

describe('maskEmail', () => {
  it.each([
    ['owner@shop.test', 'o***@shop.test'],
    ['a@b.c', 'a***@b.c'],
    ['weird@name@shop.test', 'w***@shop.test'],
    ['nope', '***'],
    ['@shop.test', '***'],
    ['', null],
    [null, null]
  ])('%j -> %j', (input, expected) => {
    expect(maskEmail(input)).toBe(expected);
  });
});

describe('testSendLogFile', () => {
  it('is one file per UTC day', () => {
    expect(testSendLogFile(new Date('2026-11-05T23:59:59Z'))).toBe('test-sends-2026-11-05.jsonl');
    expect(testSendLogFile(new Date('2026-11-06T00:00:00Z'))).toBe('test-sends-2026-11-06.jsonl');
  });
});

describe('testSendLogEntry', () => {
  const result: TestSendResult = {
    ok: false,
    status: 'provider-error',
    at: '2026-11-05T12:00:00.000Z',
    templateId: 't1',
    locale: 'de',
    to: 'o***@shop.test',
    provider: 'resend',
    subject: '[Test] Neu bei Shop',
    durationMs: 120,
    warnings: [{ code: 'missing-translation', blockId: 'h1', detail: 'text:en' }],
    error: 'x'.repeat(2000),
    log: { file: '/tmp/sf-oak-email-builder/logs/test-sends-2026-11-05.jsonl' }
  };

  it('is the result without where it was logged, tagged as a test send', () => {
    const entry = testSendLogEntry(result);
    expect(entry).not.toHaveProperty('log');
    expect(entry).toMatchObject({ event: 'test-send', status: 'provider-error', to: 'o***@shop.test', locale: 'de' });
    expect(entry.warnings).toEqual(result.warnings);
  });

  it('shortens long provider errors', () => {
    expect(testSendLogEntry(result).error).toHaveLength(500);
  });

  it('is one line of JSON', () => {
    expect(JSON.stringify(testSendLogEntry(result))).not.toContain('\n');
  });
});
