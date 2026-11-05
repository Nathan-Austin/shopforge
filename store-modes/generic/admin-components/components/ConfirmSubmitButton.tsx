'use client';

import type { ReactNode } from 'react';

/** A submit button that asks first; cancelling stops the form. */
export default function ConfirmSubmitButton({
  message,
  className,
  children
}: {
  message: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="submit"
      className={className}
      onClick={(event) => {
        if (!window.confirm(message)) event.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
