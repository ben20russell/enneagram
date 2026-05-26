import { useState } from 'react';

const stageOrder = ['Forming', 'Storming', 'Norming', 'Performing'];

const stageContent = {
  Forming: {
    summary:
      'Type 8s often set direction quickly, scan for competence, and establish early expectations around ownership and pace.',
    tendencies: [
      'Takes initiative when the group is still orienting.',
      'Clarifies decision rights and accountability fast.',
      'Can unintentionally dominate before trust is built.',
    ],
  },
  Storming: {
    summary:
      'In conflict-heavy phases, Type 8 intensity can be a strength for confronting reality, but reactivity can spike and escalate friction.',
    tendencies: [
      'Calls out misalignment and weak execution directly.',
      'Pushes hard for speed and clear commitments.',
      'May become aggressive or impatient if resistance feels evasive.',
    ],
    warning: true,
  },
  Norming: {
    summary:
      'As norms settle, Type 8s are strongest when they channel power into protection, fairness, and predictable standards.',
    tendencies: [
      'Supports clear rituals and no-drama accountability.',
      'Creates safety by defending the team against politics.',
      'Needs to leave room for quieter voices in process design.',
    ],
  },
  Performing: {
    summary:
      'At peak function, Type 8s drive momentum while delegating authority and amplifying ownership across the team.',
    tendencies: [
      'Leads with decisive execution under pressure.',
      'Protects focus and removes blockers quickly.',
      'Performs best when pairing force with collaboration.',
    ],
  },
};

function AlertIcon() {
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

export default function TeamDynamicsTabs() {
  const [activeStage, setActiveStage] = useState('Forming');
  const data = stageContent[activeStage];

  return (
    <section className="w-full max-w-3xl rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_18px_60px_rgba(15,23,42,0.08)] sm:p-8">
      <div className="mb-5">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Team Dynamics</p>
        <h2 className="mt-2 text-2xl font-black tracking-[-0.04em] text-slate-950 sm:text-3xl">
          Tuckman Stages - Type 8 Lens
        </h2>
      </div>

      <nav className="grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-2 md:grid-cols-4">
        {stageOrder.map((stage) => {
          const isActive = stage === activeStage;
          const isWarning = stage === 'Storming';

          return (
            <button
              key={stage}
              type="button"
              onClick={() => setActiveStage(stage)}
              className={[
                'rounded-xl px-3 py-2.5 text-sm font-semibold transition-all',
                isActive
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:bg-white/70 hover:text-slate-900',
              ].join(' ')}
            >
              <span className="inline-flex items-center gap-1.5">
                {isWarning ? <span className="text-orange-500"><AlertIcon /></span> : null}
                {stage}
              </span>
            </button>
          );
        })}
      </nav>

      <article
        className={[
          'mt-5 rounded-2xl border p-5 shadow-sm transition-all duration-300',
          data.warning ? 'border-orange-200 bg-orange-50/70' : 'border-slate-200 bg-slate-50/70',
        ].join(' ')}
      >
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-bold text-slate-900">{activeStage}</h3>
          {data.warning ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-orange-300 bg-white px-2 py-0.5 text-xs font-semibold uppercase tracking-[0.14em] text-orange-700">
              <AlertIcon /> Watch Reactivity
            </span>
          ) : null}
        </div>

        <p className="mt-3 text-sm leading-6 text-slate-700">{data.summary}</p>

        <ul className="mt-4 space-y-2">
          {data.tendencies.map((item) => (
            <li key={item} className="flex items-start gap-2 text-sm leading-6 text-slate-700">
              <span
                className={
                  data.warning
                    ? 'mt-2 h-2 w-2 rounded-full bg-orange-500'
                    : 'mt-2 h-2 w-2 rounded-full bg-sky-500'
                }
              />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </article>
    </section>
  );
}
