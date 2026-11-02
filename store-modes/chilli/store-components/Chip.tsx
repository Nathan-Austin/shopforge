'use client';

import type { ReactNode } from 'react';

interface ChipProps {
  children: ReactNode;
  /** `filter` renders the chip with a remove button next to the label. */
  variant?: 'default' | 'filter';
  /** Shown as an ✕ button; omit for a plain, non-removable chip. */
  onRemove?: () => void;
  className?: string;
}

export default function Chip({
  children,
  variant = 'default',
  onRemove,
  className = ''
}: ChipProps) {
  const showRemove = variant === 'filter' && Boolean(onRemove);

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-foreground ${className}`}
    >
      {children}
      {showRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove filter"
          className="text-text-muted transition-colors hover:text-emerald-700"
        >
          ✕
        </button>
      )}
    </span>
  );
}
