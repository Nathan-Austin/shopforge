"use client";

interface ChipProps {
  children: React.ReactNode;
  variant?: "filter";
  onRemove?: () => void;
}

export default function Chip({ children, onRemove }: ChipProps) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1 text-xs font-semibold text-foreground">
      {children}
      {onRemove && (
        <button
          onClick={onRemove}
          aria-label="Remove filter"
          className="ml-1 rounded-full hover:text-brand-red focus:outline-none"
        >
          ×
        </button>
      )}
    </span>
  );
}
