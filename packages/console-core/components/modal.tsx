'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/** A native <dialog>, opened modally: the browser handles focus trapping, Escape, and the backdrop. */
export function Modal({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  return <dialog ref={ref} onClose={onClose}>{open ? children : null}</dialog>;
}
