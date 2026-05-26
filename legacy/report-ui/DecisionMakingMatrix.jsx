const strengths = [
  'Thrives under time pressure',
  'Crisis-ready and action-biased',
  'Risk-tolerant when stakes are high',
  'Moves teams out of analysis paralysis',
];

const risks = [
  'Unilateral decisions can reduce buy-in',
  'Impatient with details and edge cases',
  'Can fail to consult the right people',
  'May over-index on speed over alignment',
];

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" xmlns="http://www.w3.org/2000/svg">
      <path d="m5 12 4 4 10-10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M12 3 21 19H3L12 3Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M12 9v5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="12" cy="16.8" r="1" fill="currentColor" />
    </svg>
  );
}

export default function DecisionMakingMatrix() {
  return (
    <section className="w-full max-w-4xl rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_18px_60px_rgba(15,23,42,0.08)] sm:p-8">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Decision Architecture</p>
      <h2 className="mt-2 text-2xl font-black tracking-[-0.04em] text-slate-950 sm:text-3xl">
        Decision Style: Action-Centered
      </h2>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <article className="group rounded-2xl border border-emerald-200 bg-emerald-50/40 p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
          <h3 className="text-sm font-bold uppercase tracking-[0.18em] text-emerald-700">
            Strengths (Fast & Decisive)
          </h3>
          <ul className="mt-4 space-y-2">
            {strengths.map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm leading-6 text-slate-700">
                <span className="mt-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                  <CheckIcon />
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </article>

        <article className="group rounded-2xl border border-rose-200 bg-rose-50/40 p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
          <h3 className="text-sm font-bold uppercase tracking-[0.18em] text-rose-700">Risks (Impulsive)</h3>
          <ul className="mt-4 space-y-2">
            {risks.map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm leading-6 text-slate-700">
                <span className="mt-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-rose-100 text-rose-700">
                  <WarningIcon />
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </article>
      </div>
    </section>
  );
}
