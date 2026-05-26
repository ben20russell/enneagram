import { useState } from 'react';

function ChevronIcon({ open }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={[
        'h-5 w-5 text-slate-500 transition-transform duration-200',
        open ? 'rotate-180' : 'rotate-0',
      ].join(' ')}
      aria-hidden="true"
    >
      <path
        d="m6 9 6 6 6-6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * @param {{ title: string; children: import('react').ReactNode; defaultOpen?: boolean }} props
 */
export default function DeepDiveAccordion({ title, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="w-full rounded-2xl border border-slate-200 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition hover:bg-slate-50"
        aria-expanded={open}
      >
        <span className="text-sm font-bold tracking-[0.01em] text-slate-900 sm:text-base">{title}</span>
        <ChevronIcon open={open} />
      </button>

      <div
        className={[
          'grid transition-all duration-300 ease-out',
          open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
        ].join(' ')}
      >
        <div className="overflow-hidden">
          <div className="border-t border-slate-100 px-5 py-4 text-sm leading-7 text-slate-700">{children}</div>
        </div>
      </div>
    </section>
  );
}
