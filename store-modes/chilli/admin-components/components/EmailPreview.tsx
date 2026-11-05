'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

const WIDTHS = { desktop: 640, phone: 375 } as const;
type Device = keyof typeof WIDTHS;

/**
 * The rendered email in a sandboxed frame, at desktop or phone width. The
 * phone width is narrow enough to trigger the email's own media query, so
 * columns stack here exactly as they will in a phone's mail app.
 */
export default function EmailPreview({ html }: { html: string }) {
  const t = useTranslations('Admin.email.preview');
  const [device, setDevice] = useState<Device>('desktop');
  const width = WIDTHS[device];

  return (
    <div className="space-y-3">
      <div role="group" aria-label={t('heading')} className="inline-flex rounded-full border border-border bg-white p-1 text-sm">
        {(Object.keys(WIDTHS) as Device[]).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={device === option}
            onClick={() => setDevice(option)}
            className={`rounded-full px-4 py-1 ${device === option ? 'bg-emerald-700 text-white' : 'text-stone-700 hover:text-emerald-700'}`}
          >
            {t(option)}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto rounded-lg border border-border bg-stone-100 p-4">
        <iframe
          title={t('frameTitle', { width })}
          srcDoc={html}
          // No scripts, no same-origin access; links may open in a new tab.
          sandbox="allow-popups allow-popups-to-escape-sandbox"
          width={width}
          height={900}
          className="mx-auto block rounded-md border border-border bg-white transition-[width]"
          style={{ width }}
        />
      </div>
    </div>
  );
}
