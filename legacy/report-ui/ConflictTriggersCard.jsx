const triggers = [
  'Injustice & unfairness',
  'People not taking responsibility (blame-shifting)',
  'Being blindsided or deceived',
  'Not being allowed to state views',
];

function FlameIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="h-5 w-5"
    >
      <path
        d="M14.5 3.5c.4 2.4-.6 4-2.1 5.5-1.4 1.4-2.4 2.7-2.4 4.8a3.9 3.9 0 0 0 7.8 0c0-1.8-.8-3.2-2.2-4.7-.9-1-1.5-2.2-1.1-5.6Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9.4 9.6c-2 1.3-3.4 3.2-3.4 5.6a6 6 0 1 0 12 0c0-1.4-.4-2.7-1.2-3.8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function ConflictTriggersCard() {
  return (
    <section className="w-full max-w-xl rounded-3xl border border-rose-200 bg-gradient-to-br from-rose-50 via-white to-slate-50 p-6 shadow-[0_18px_60px_rgba(15,23,42,0.08)] sm:p-8">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-rose-200 bg-white text-rose-600 shadow-sm">
          <FlameIcon />
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-rose-500">
            Conflict & Triggers
          </p>
          <h2 className="mt-2 text-2xl font-black tracking-[-0.04em] text-slate-950 sm:text-3xl">
            Quick Reference
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Common pressure points that tend to escalate reactivity quickly.
          </p>
        </div>
      </div>

      <ul className="mt-6 space-y-3">
        {triggers.map((trigger) => (
          <li
            key={trigger}
            className="flex items-start gap-3 rounded-2xl border border-white/80 bg-white/80 px-4 py-3 text-sm font-medium leading-6 text-slate-700 shadow-sm backdrop-blur"
          >
            <span className="mt-1.5 h-2.5 w-2.5 flex-shrink-0 rounded-full bg-gradient-to-r from-rose-500 to-orange-400" />
            <span>{trigger}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}