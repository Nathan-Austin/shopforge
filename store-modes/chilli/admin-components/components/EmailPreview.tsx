'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Monitor, Smartphone } from 'lucide-react';

const WIDTHS = { desktop: 640, phone: 375 } as const;
const HEIGHT = 900;
type Device = keyof typeof WIDTHS;

/**
 * The rendered email in a sandboxed frame, at desktop or phone width. The
 * phone width is narrow enough to trigger the email's own media query, so
 * columns stack here exactly as they will in a phone's mail app. When the
 * space is narrower than the email, the frame is scaled down to fit rather
 * than cut off: the email still lays out at its real width.
 */
export default function EmailPreview({ html }: { html: string }) {
  const t = useTranslations('Admin.email.preview');
  const [device, setDevice] = useState<Device>('desktop');
  const [available, setAvailable] = useState<number>(WIDTHS.desktop);
  const box = useRef<HTMLDivElement>(null);
  const width = WIDTHS[device];
  const scale = Math.min(1, available / width);

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setAvailable(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="space-y-3">
      <div role="group" aria-label={t('heading')} className="inline-flex rounded-full border border-border bg-white p-1 text-sm">
        {(Object.keys(WIDTHS) as Device[]).map((option) => {
          const Icon = option === 'desktop' ? Monitor : Smartphone;
          return (
            <button
              key={option}
              type="button"
              aria-pressed={device === option}
              onClick={() => setDevice(option)}
              className={`inline-flex items-center gap-1.5 rounded-full px-4 py-1 ${device === option ? 'bg-emerald-700 text-white' : 'text-stone-700 hover:text-emerald-700'}`}
            >
              <Icon className="h-4 w-4" aria-hidden />
              {t(option)}
            </button>
          );
        })}
      </div>
      <div ref={box} className="rounded-lg border border-border bg-stone-100 p-4">
        {/* ltr: the scale is anchored top-left; in a right-to-left admin it would clip. */}
        <div dir="ltr" className="mx-auto overflow-hidden" style={{ width: width * scale, height: HEIGHT * scale }}>
          <iframe
            title={t('frameTitle', { width })}
            srcDoc={html}
            // No scripts, no same-origin access; links may open in a new tab.
            sandbox="allow-popups allow-popups-to-escape-sandbox"
            width={width}
            height={HEIGHT}
            className="block origin-top-left rounded-md border border-border bg-white"
            style={{ width, height: HEIGHT, transform: scale < 1 ? `scale(${scale})` : undefined }}
          />
        </div>
      </div>
    </div>
  );
}
