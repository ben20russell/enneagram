import { useState } from 'react';

const feedbackRulesByType = {
  '1': {
    label: 'Type 1 - Principled Reformer',
    dos: [
      'Be specific and objective about what needs to improve.',
      'Acknowledge effort, standards, and integrity first.',
      'Frame changes as quality upgrades with clear criteria.',
    ],
    donts: [
      'Do not be vague or careless with facts.',
      'Do not dismiss their concern for correctness.',
      'Do not use a sloppy or unstructured delivery.',
    ],
  },
  '2': {
    label: 'Type 2 - Caring Helper',
    dos: [
      'Lead with appreciation and relational safety.',
      'Use warm language while staying clear and direct.',
      'Explain impact and needs without shaming intent.',
    ],
    donts: [
      'Do not deliver cold feedback with no context.',
      'Do not imply their value depends on pleasing others.',
      'Do not ignore emotional tone in the room.',
    ],
  },
  '3': {
    label: 'Type 3 - Driven Achiever',
    dos: [
      'Keep it concise, practical, and outcome-focused.',
      'Tie feedback to performance impact and next moves.',
      'Offer measurable goals and a fast path to improve.',
    ],
    donts: [
      'Do not ramble or over-theorize.',
      'Do not attack identity or image directly.',
      'Do not give criticism without a solution path.',
    ],
  },
  '4': {
    label: 'Type 4 - Individualist',
    dos: [
      'Acknowledge perspective and emotional nuance.',
      'Be honest, respectful, and grounded in examples.',
      'Invite collaboration on how to express strengths better.',
    ],
    donts: [
      'Do not minimize or mock emotional experience.',
      'Do not flatten feedback into generic corporate language.',
      'Do not compare them to others as the main lever.',
    ],
  },
  '5': {
    label: 'Type 5 - Investigative Observer',
    dos: [
      'Be prepared, calm, and evidence-based.',
      'Give them time to process and respond thoughtfully.',
      'Separate facts, assumptions, and requested actions.',
    ],
    donts: [
      'Do not crowd them with emotional pressure.',
      'Do not force immediate verbal processing.',
      'Do not confuse volume with clarity.',
    ],
  },
  '6': {
    label: 'Type 6 - Loyal Skeptic',
    dos: [
      'Be transparent about expectations and rationale.',
      'Show consistency between words, actions, and standards.',
      'Invite questions and respond with clarity, not defensiveness.',
    ],
    donts: [
      'Do not hide key context or shift criteria midstream.',
      'Do not use authority posturing as the main tactic.',
      'Do not dismiss their risk concerns as negativity.',
    ],
  },
  '7': {
    label: 'Type 7 - Enthusiastic Visionary',
    dos: [
      'Keep feedback energetic, direct, and future-focused.',
      'Prioritize the top few changes with visible upside.',
      'Use short commitments and momentum checkpoints.',
    ],
    donts: [
      'Do not overload them with heavy, endless critique.',
      'Do not trap them in abstract negativity.',
      'Do not skip accountability on follow-through.',
    ],
  },
  '8': {
    label: 'Type 8 - Challenger',
    dos: [
      'Be direct, respectful, and candid from the start.',
      'Ground feedback in impact and shared outcomes.',
      'Signal strength and fairness without power games.',
    ],
    donts: [
      'Do not be indirect or manipulative.',
      'Do not challenge for dominance instead of clarity.',
      'Do not confuse intensity with hostility.',
    ],
  },
  '9': {
    label: 'Type 9 - Peacemaker',
    dos: [
      'Use calm, clear language with concrete examples.',
      'Invite their viewpoint and confirm understanding.',
      'Define specific next actions and timeline.',
    ],
    donts: [
      'Do not overwhelm with rapid-fire confrontation.',
      'Do not leave expectations implicit or fuzzy.',
      'Do not interpret silence as agreement.',
    ],
  },
};

function ChatIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="h-5 w-5"
    >
      <path
        d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7A2.5 2.5 0 0 1 17.5 16H10l-4 4v-4h-.5A2.5 2.5 0 0 1 3 13.5v-7Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M8 9.5h7.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M8 12.5h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export default function FeedbackBlueprintCard() {
  const [selectedType, setSelectedType] = useState('8');
  const selectedRules = feedbackRulesByType[selectedType];

  return (
    <section className="w-full max-w-3xl rounded-3xl border border-sky-200 bg-gradient-to-br from-sky-50 via-white to-blue-50 p-6 shadow-[0_18px_60px_rgba(15,23,42,0.08)] sm:p-8">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-sky-200 bg-white text-sky-600 shadow-sm">
            <ChatIcon />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-600">
              Feedback Blueprint
            </p>
            <h2 className="mt-2 text-2xl font-black tracking-[-0.04em] text-slate-950 sm:text-3xl">
              Do&apos;s & Don&apos;ts by Enneagram Type
            </h2>
          </div>
        </div>
      </div>

      <div className="mt-6 max-w-md">
        <label
          htmlFor="feedbackType"
          className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500"
        >
          Who are you giving feedback to?
        </label>
        <select
          id="feedbackType"
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
          value={selectedType}
          onChange={(event) => setSelectedType(event.target.value)}
        >
          {Object.entries(feedbackRulesByType).map(([type, config]) => (
            <option key={type} value={type}>
              {config.label}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <article className="rounded-2xl border border-emerald-200 bg-white p-4 shadow-sm">
          <h3 className="text-sm font-bold uppercase tracking-[0.16em] text-emerald-700">Do&apos;s</h3>
          <ul className="mt-3 space-y-2">
            {selectedRules.dos.map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm leading-6 text-slate-700">
                <span className="mt-2 h-2 w-2 rounded-full bg-emerald-500" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </article>

        <article className="rounded-2xl border border-rose-200 bg-white p-4 shadow-sm">
          <h3 className="text-sm font-bold uppercase tracking-[0.16em] text-rose-700">Don&apos;ts</h3>
          <ul className="mt-3 space-y-2">
            {selectedRules.donts.map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm leading-6 text-slate-700">
                <span className="mt-2 h-2 w-2 rounded-full bg-rose-500" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </article>
      </div>
    </section>
  );
}
