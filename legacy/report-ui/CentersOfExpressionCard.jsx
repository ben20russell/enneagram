const centers = [
  {
    label: 'Action Center',
    valueLabel: 'High',
    width: '90%',
    barClass: 'bg-gradient-to-r from-rose-500 via-red-500 to-orange-500',
  },
  {
    label: 'Feeling Center',
    valueLabel: 'Medium',
    width: '50%',
    barClass: 'bg-gradient-to-r from-emerald-400 to-green-500',
  },
  {
    label: 'Thinking Center',
    valueLabel: 'Low',
    width: '20%',
    barClass: 'bg-gradient-to-r from-sky-400 to-blue-500',
  },
];

export default function CentersOfExpressionCard() {
  return (
    <section className="w-full max-w-xl rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_18px_60px_rgba(15,23,42,0.08)] sm:p-8">
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
          Centers of Expression
        </p>
        <h2 className="mt-2 text-2xl font-black tracking-[-0.04em] text-slate-950 sm:text-3xl">
          Expression Balance
        </h2>
      </div>

      <div className="space-y-5">
        {centers.map((center) => (
          <div key={center.label} className="space-y-2">
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm font-semibold text-slate-800 sm:text-base">
                {center.label}
              </span>
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                {center.valueLabel}
              </span>
            </div>

            <div className="h-3.5 overflow-hidden rounded-full bg-slate-100 ring-1 ring-slate-200">
              <div
                className={`${center.barClass} h-full rounded-full`}
                style={{ width: center.width }}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
        <p className="text-sm text-slate-600">
          Sequence of expression:
          <span className="ml-2 font-semibold text-slate-900">
            Action -&gt; Feeling -&gt; Thinking
          </span>
        </p>
      </div>
    </section>
  );
}