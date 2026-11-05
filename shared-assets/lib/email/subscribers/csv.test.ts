import { describe, expect, it } from 'vitest';

import { csvCell, matchLocale, MAX_IMPORT_ROWS, parseSubscriberCsv, toSubscriberCsv } from './csv';

const LOCALES = ['en', 'de', 'de-at', 'ar'];

describe('parseSubscriberCsv', () => {
  it('reads a Mailchimp export', () => {
    const csv = '"Email Address","First Name","Last Name"\r\n"Sam@Example.com","Sam","Lee"\r\n"jo@example.com","",""\r\n';
    expect(parseSubscriberCsv(csv, LOCALES, 'en')).toEqual({
      rows: [
        { email: 'sam@example.com', firstName: 'Sam', locale: 'en' },
        { email: 'jo@example.com', firstName: null, locale: 'en' }
      ],
      errors: [],
      duplicates: 0,
      tooLarge: false
    });
  });

  it('reads a German Excel file: semicolons, a byte-order mark, Vorname and Sprache', () => {
    const csv = '﻿E-Mail;Vorname;Sprache\nkim@example.de;Kim;de-AT\nalex@example.de;"Müller; Alex";de_DE\n';
    expect(parseSubscriberCsv(csv, LOCALES, 'en').rows).toEqual([
      { email: 'kim@example.de', firstName: 'Kim', locale: 'de-at' },
      { email: 'alex@example.de', firstName: 'Müller; Alex', locale: 'de' }
    ]);
  });

  it('reads a bare column of addresses with no header', () => {
    expect(parseSubscriberCsv('a@example.com\nb@example.com', LOCALES, 'de').rows).toEqual([
      { email: 'a@example.com', firstName: null, locale: 'de' },
      { email: 'b@example.com', firstName: null, locale: 'de' }
    ]);
  });

  it('handles quotes, doubled quotes and line breaks inside quotes', () => {
    const csv = 'email,first_name\n"q@example.com","Sam ""the man""\nLee"\n';
    expect(parseSubscriberCsv(csv, LOCALES, 'en').rows).toEqual([{ email: 'q@example.com', firstName: 'Sam "the man" Lee', locale: 'en' }]);
  });

  it('reports bad addresses by spreadsheet line and keeps the first of duplicates', () => {
    const csv = 'email\nok@example.com\nnot an address\n\nOK@example.com\n';
    expect(parseSubscriberCsv(csv, LOCALES, 'en')).toMatchObject({
      rows: [{ email: 'ok@example.com' }],
      errors: [{ line: 3, code: 'invalid-email', value: 'not an address' }],
      duplicates: 1
    });
  });

  it(`refuses more than ${MAX_IMPORT_ROWS} rows`, () => {
    const csv = ['email', ...Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `p${i}@example.com`)].join('\n');
    expect(parseSubscriberCsv(csv, LOCALES, 'en')).toMatchObject({ tooLarge: true, rows: [] });
  });

  it('copes with an empty file', () => {
    expect(parseSubscriberCsv('', LOCALES, 'en')).toEqual({ rows: [], errors: [], duplicates: 0, tooLarge: false });
  });
});

describe('matchLocale', () => {
  it('takes the exact locale, then its language, then the default', () => {
    expect(matchLocale('de-at', LOCALES, 'en')).toBe('de-at');
    expect(matchLocale('de-CH', LOCALES, 'en')).toBe('de');
    expect(matchLocale('fr', LOCALES, 'en')).toBe('en');
    expect(matchLocale('', LOCALES, 'en')).toBe('en');
  });
});

describe('export', () => {
  it('quotes what needs quoting', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('Lee, Sam')).toBe('"Lee, Sam"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell(null)).toBe('');
  });

  it.each(['=HYPERLINK("x")', '+1', '-2+3', '@SUM(A1)', '\tx'])('neutralises the formula %j', (value) => {
    expect(csvCell(value).replace(/^"|"$/g, '').startsWith("'")).toBe(true);
  });

  it('writes a header, a byte-order mark and CRLF lines', () => {
    const csv = toSubscriberCsv([
      {
        email: 'sam@example.com',
        firstName: '=cmd',
        locale: 'de',
        status: 'subscribed',
        source: 'footer',
        consentedAt: '2026-11-01T10:00:00Z',
        confirmedAt: '2026-11-01T10:05:00Z',
        unsubscribedAt: null
      }
    ]);
    expect(csv.startsWith('﻿email,first_name,locale,status,source,consented_at,confirmed_at,unsubscribed_at\r\n')).toBe(true);
    expect(csv).toContain("sam@example.com,'=cmd,de,subscribed,footer,2026-11-01T10:00:00Z,2026-11-01T10:05:00Z,\r\n");
  });

  it('round-trips through the importer', () => {
    const csv = toSubscriberCsv([
      { email: 'a@example.com', firstName: 'Ana, Maria', locale: 'ar', status: 'subscribed', source: 'import', consentedAt: null, confirmedAt: null, unsubscribedAt: null }
    ]);
    expect(parseSubscriberCsv(csv, LOCALES, 'en').rows).toEqual([{ email: 'a@example.com', firstName: 'Ana, Maria', locale: 'ar' }]);
  });
});
