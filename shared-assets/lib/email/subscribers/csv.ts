/**
 * Subscriber lists in and out as CSV, the format every newsletter service
 * and spreadsheet speaks.
 *
 * Import reads what people actually have: a Mailchimp export ("Email
 * Address", "First Name"), a German Excel file (semicolons, "Vorname"), a
 * bare column of addresses with no header. Export opens cleanly in Excel
 * (UTF-8 with a byte-order mark) and neutralises cells that a spreadsheet
 * would run as a formula, since names and addresses came from strangers.
 */

import { languageOf } from '../../i18n/locales';
import { cleanFirstName, normalizeEmail, type ImportRow, type SubscriberSource, type SubscriberStatus } from './rules';

export const MAX_IMPORT_ROWS = 10_000;
export const MAX_IMPORT_BYTES = 2_000_000;

const HEADERS = {
  email: ['email', 'e-mail', 'email address', 'e-mail address', 'e-mail-adresse', 'emailadresse', 'mail', 'e-posta', 'البريد الإلكتروني'],
  firstName: ['first_name', 'firstname', 'first name', 'fname', 'name', 'vorname', 'ad', 'الاسم'],
  locale: ['locale', 'language', 'lang', 'sprache', 'dil', 'اللغة']
} as const;

/** RFC 4180 fields: quotes, doubled quotes, separators and line breaks inside quotes. */
function parseRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"' && field === '') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ''));
}

/** The separator the first line uses most: comma, semicolon or tab. */
function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const counts = [',', ';', '\t'].map((delimiter) => ({ delimiter, count: firstLine.split(delimiter).length - 1 }));
  counts.sort((a, b) => b.count - a.count);
  return counts[0].count > 0 ? counts[0].delimiter : ',';
}

function columnFor(header: string[], names: readonly string[]): number {
  return header.findIndex((cell) => (names as readonly string[]).includes(cell.trim().toLowerCase()));
}

/** A locale from the file as one of the shop's: exact, then its language, then the default. */
export function matchLocale(value: string | undefined, locales: readonly string[], defaultLocale: string): string {
  const code = value?.trim().toLowerCase().replace('_', '-') ?? '';
  if (locales.includes(code)) return code;
  const language = code ? languageOf(code) : '';
  return locales.includes(language) ? language : defaultLocale;
}

export interface CsvImportError {
  /** 1-based, as a spreadsheet numbers rows. */
  line: number;
  code: 'invalid-email';
  value: string;
}

export interface CsvImport {
  rows: ImportRow[];
  errors: CsvImportError[];
  /** Addresses that appeared more than once; the first is kept. */
  duplicates: number;
  tooLarge: boolean;
}

export function parseSubscriberCsv(input: string, locales: readonly string[], defaultLocale: string): CsvImport {
  const text = input.replace(/^﻿/, '');
  if (text.length > MAX_IMPORT_BYTES) return { rows: [], errors: [], duplicates: 0, tooLarge: true };
  const table = parseRows(text, detectDelimiter(text));
  if (!table.length) return { rows: [], errors: [], duplicates: 0, tooLarge: false };

  // A header row names an email column; otherwise the first column is the address.
  const headerEmail = columnFor(table[0], HEADERS.email);
  const hasHeader = headerEmail >= 0;
  const columns = hasHeader
    ? { email: headerEmail, firstName: columnFor(table[0], HEADERS.firstName), locale: columnFor(table[0], HEADERS.locale) }
    : { email: 0, firstName: 1, locale: 2 };
  const body = hasHeader ? table.slice(1) : table;
  if (body.length > MAX_IMPORT_ROWS) return { rows: [], errors: [], duplicates: 0, tooLarge: true };

  const rows: ImportRow[] = [];
  const errors: CsvImportError[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  body.forEach((cells, index) => {
    const line = index + (hasHeader ? 2 : 1);
    const raw = cells[columns.email] ?? '';
    const email = normalizeEmail(raw);
    if (!email) {
      errors.push({ line, code: 'invalid-email', value: raw.slice(0, 100) });
      return;
    }
    if (seen.has(email)) {
      duplicates++;
      return;
    }
    seen.add(email);
    rows.push({
      email,
      firstName: columns.firstName >= 0 ? cleanFirstName(cells[columns.firstName]) : null,
      locale: matchLocale(columns.locale >= 0 ? cells[columns.locale] : undefined, locales, defaultLocale)
    });
  });
  return { rows, errors, duplicates, tooLarge: false };
}

export interface ExportRow {
  email: string;
  firstName: string | null;
  locale: string;
  status: SubscriberStatus;
  source: SubscriberSource;
  consentedAt: string | null;
  confirmedAt: string | null;
  unsubscribedAt: string | null;
}

/**
 * One cell, quoted when it must be. A cell a spreadsheet would read as a
 * formula (`=`, `+`, `-`, `@`, tab, carriage return first) gets a leading
 * apostrophe, the usual defence against CSV injection.
 */
export function csvCell(value: string | null): string {
  let cell = value ?? '';
  if (/^[=+\-@\t\r]/.test(cell)) cell = `'${cell}`;
  return /[",\r\n;]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

export const EXPORT_COLUMNS = ['email', 'first_name', 'locale', 'status', 'source', 'consented_at', 'confirmed_at', 'unsubscribed_at'];

export function toSubscriberCsv(rows: ExportRow[]): string {
  const lines = [
    EXPORT_COLUMNS.join(','),
    ...rows.map((row) =>
      [row.email, row.firstName, row.locale, row.status, row.source, row.consentedAt, row.confirmedAt, row.unsubscribedAt]
        .map(csvCell)
        .join(',')
    )
  ];
  // A byte-order mark so Excel reads the file as UTF-8 (umlauts, Arabic).
  return `﻿${lines.join('\r\n')}\r\n`;
}
