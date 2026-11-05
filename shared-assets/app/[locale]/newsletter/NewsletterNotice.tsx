import Link from 'next/link';
import type { ReactNode } from 'react';

/** The frame of the confirm and unsubscribe pages. */
export default function NewsletterNotice({
  title,
  tone = 'neutral',
  children,
  backHref,
  backLabel
}: {
  title: string;
  tone?: 'neutral' | 'good' | 'bad';
  children: ReactNode;
  backHref: string;
  backLabel: string;
}) {
  const border = tone === 'good' ? 'border-emerald-200 bg-emerald-50' : tone === 'bad' ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-white';
  return (
    <div className="mx-auto max-w-lg px-4 py-16">
      <div className={`space-y-4 rounded-lg border p-6 ${border}`}>
        <h1 className="text-xl font-bold">{title}</h1>
        {children}
      </div>
      <p className="mt-6 text-sm">
        <Link href={backHref} className="underline">
          {backLabel}
        </Link>
      </p>
    </div>
  );
}
