'use client';

import type { ReactNode } from 'react';

interface ChipProps {
  children: ReactNode;
  onRemove?: () => void;
  variant?: 'default' | 'filter';
}

export default function Chip({ children, onRemove, variant = 'default' }: ChipProps) {
  const base =
    'inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold transition-colors';
  const styles =
    variant === 'filter'
      ? 'border-border bg-card text-foreground hover:border-roh-flag-green hover:bg-roh-flag-green/10'
      : 'border-roh-ash-grey bg-white text-gray-700';

  return (
    <span className={`${base} ${styles}`}>
      {children}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="ml-1 rounded-full p-0.5 hover:bg-roh-flag-green/10"
          aria-label="Remove filter"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      )}
    </span>
  );
}
