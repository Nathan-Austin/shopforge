import { describe, expect, it } from 'vitest';

import { sampleContext, sampleDocument } from './fixtures';
import { broadcastContext, broadcastName, localeStatusFromProvider, overallStatus, parseSchedule, renderBroadcast } from './broadcast';

describe('renderBroadcast', () => {
  it('renders one email for a language with Resend\'s placeholders and no warnings', () => {
    const { recipient: _r, unsubscribeUrl: _u, mergeValues: _m, ...base } = sampleContext({ locale: 'de' });
    void _r; void _u; void _m;
    const result = renderBroadcast(sampleDocument(), broadcastContext(base));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.email.html).toContain('Hallo {{{FIRST_NAME|du}}}!');
    expect(result.email.html).toContain('href="{{{RESEND_UNSUBSCRIBE_URL}}}"');
    expect(result.email.warnings.filter((w) => w.code !== 'missing-translation')).toEqual([]);
  });
});

describe('statuses', () => {
  it('derives the campaign status from its languages', () => {
    expect(overallStatus({}, false)).toBe('draft');
    expect(overallStatus({ en: { broadcastId: null, recipients: 0, status: 'skipped' } }, false)).toBe('draft');
    expect(overallStatus({ en: { broadcastId: 'b', recipients: 3, status: 'pending' } }, false)).toBe('sending');
    expect(overallStatus({ en: { broadcastId: 'b', recipients: 3, status: 'queued' }, de: { broadcastId: 'c', recipients: 1, status: 'sent' } }, false)).toBe('sending');
    expect(overallStatus({ en: { broadcastId: 'b', recipients: 3, status: 'scheduled' } }, true)).toBe('scheduled');
    expect(overallStatus({ en: { broadcastId: 'b', recipients: 3, status: 'sent' }, de: { broadcastId: null, recipients: 0, status: 'skipped' } }, false)).toBe('sent');
    expect(overallStatus({ en: { broadcastId: 'b', recipients: 3, status: 'failed' }, de: { broadcastId: 'c', recipients: 1, status: 'sent' } }, false)).toBe('failed');
  });

  it('maps the provider\'s words', () => {
    expect(localeStatusFromProvider('sent')).toBe('sent');
    expect(localeStatusFromProvider('queued')).toBe('queued');
    expect(localeStatusFromProvider('scheduled')).toBe('scheduled');
    expect(localeStatusFromProvider('canceled')).toBe('failed');
    expect(localeStatusFromProvider('something-new')).toBe('queued');
  });

  it('names broadcasts after the campaign and language', () => {
    expect(broadcastName('Spring sale', 'de-at')).toBe('Spring sale (de-at)');
  });
});

describe('parseSchedule', () => {
  const now = new Date('2026-11-05T12:00:00Z');
  it('is "now" when empty, otherwise 5 minutes to 30 days ahead', () => {
    expect(parseSchedule('', now)).toEqual({ ok: true, at: null });
    expect(parseSchedule('2026-11-05T13:00:00Z', now)).toEqual({ ok: true, at: '2026-11-05T13:00:00.000Z' });
    expect(parseSchedule('2026-11-05T12:03:00Z', now)).toEqual({ ok: false, reason: 'past' });
    expect(parseSchedule('2027-01-01T00:00:00Z', now)).toEqual({ ok: false, reason: 'too-far' });
    expect(parseSchedule('tomorrow', now)).toEqual({ ok: false, reason: 'invalid' });
  });
});
