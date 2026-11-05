import { NextResponse } from 'next/server';

import { DEFAULT_LOCALE, LOCALES } from '@/i18n/config';
import { unsubscribeByToken } from '@/lib/email/subscribers/service';

/**
 * One-click unsubscribe (RFC 8058). Mail clients show their own
 * "Unsubscribe" button for mail carrying List-Unsubscribe and
 * List-Unsubscribe-Post, and POST here when it is pressed: the token in
 * the address is all the authority needed, and nothing else is asked.
 *
 * A GET (someone pasting the address into a browser, or a scanner) never
 * unsubscribes; it is sent on to the page with the button.
 */
export async function POST(request: Request) {
  const token = new URL(request.url).searchParams.get('t');
  const result = await unsubscribeByToken(token, 'one-click');
  if (result === 'unsubscribed') return new NextResponse('Unsubscribed', { status: 200 });
  return new NextResponse(result === 'unavailable' ? 'Unavailable' : 'Invalid link', { status: result === 'unavailable' ? 503 : 400 });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requested = url.searchParams.get('l') ?? '';
  const locale = (LOCALES as readonly string[]).includes(requested) ? requested : DEFAULT_LOCALE;
  const page = new URL(`/${locale}/newsletter/unsubscribe`, url.origin);
  const token = url.searchParams.get('t');
  if (token) page.searchParams.set('t', token);
  return NextResponse.redirect(page, 303);
}
