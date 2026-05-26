/**
 * @param {{ profileData: import('./EnneagramProfile').EnneagramProfile }} props
 */
export default function EnneagramIdentityCard({ profileData }) {
  const totalSteps = profileData.integration.totalSteps;
  const activeStep = profileData.integration.currentStep;
  const steps = Array.from({ length: totalSteps }, (_, index) => index + 1);

  return (
    <section className="w-full max-w-xl rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_18px_60px_rgba(15,23,42,0.08)] sm:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-3">
          <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
            {profileData.subtype}
          </span>

          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              Enneagram Identity
            </p>
            <h2 className="text-3xl font-black tracking-[-0.04em] text-slate-950 sm:text-4xl">
              Type {profileData.typeNumber}: {profileData.typeLabel}
            </h2>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left sm:min-w-44">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            Integration Level
          </p>
          <div className="mt-3 flex items-center gap-2">
            {steps.map((step) => {
              const active = step <= activeStep;

              return (
                <div
                  key={step}
                  className={[
                    "h-3 flex-1 rounded-full transition-colors",
                    active ? "bg-sky-600" : "bg-slate-200",
                  ].join(" ")}
                />
              );
            })}
          </div>
          <p className="mt-3 text-sm font-semibold text-slate-900">
            {profileData.integration.levelLabel}
          </p>
        </div>
      </div>

      <div className="mt-8 rounded-2xl border border-slate-200 bg-slate-50/80 p-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          Meta-Message
        </p>
        <blockquote className="mt-3 border-l-4 border-sky-600 pl-4 text-base italic leading-7 text-slate-700 sm:text-lg">
          {profileData.metaMessage}
        </blockquote>
      </div>
    </section>
  );
}