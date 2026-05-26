import { useMemo, useState } from 'react';
import StrainProfileRadarChart from './StrainProfileRadarChart';

const STRAIN_LABELS = [
  'Happiness',
  'Vocational',
  'Interpersonal',
  'Physical',
  'Environmental',
  'Psychological',
];

/**
 * @param {{ profileData: import('./EnneagramProfile').EnneagramProfile }} props
 */
export default function DailyStrainLogger({ profileData }) {
  const initialValues = useMemo(() => {
    return STRAIN_LABELS.reduce((acc, label) => {
      const existing = profileData.strain.points.find((item) => item.subject === label);
      acc[label] = existing ? existing.value : 1;
      return acc;
    }, {});
  }, [profileData]);

  const [strainValues, setStrainValues] = useState(initialValues);

  const chartProfile = useMemo(() => {
    const points = STRAIN_LABELS.map((label) => ({
      subject: label,
      value: Number(strainValues[label]),
    }));

    const average = points.reduce((sum, point) => sum + point.value, 0) / points.length;
    const overallLabel = average >= 3.5 ? 'High' : average >= 2.25 ? 'Medium' : 'Low';

    return {
      ...profileData,
      strain: {
        ...profileData.strain,
        overallLabel,
        maxAxis: 5,
        points,
      },
    };
  }, [profileData, strainValues]);

  function updateStrain(subject, value) {
    setStrainValues((current) => ({ ...current, [subject]: Number(value) }));
  }

  return (
    <section className="w-full max-w-5xl rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_18px_60px_rgba(15,23,42,0.08)] sm:p-8">
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Daily Strain Check-In</p>
        <h2 className="mt-2 text-2xl font-black tracking-[-0.04em] text-slate-950 sm:text-3xl">
          Log Today&apos;s Strain
        </h2>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(260px,360px)_1fr]">
        <article className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 sm:p-5">
          <div className="space-y-4">
            {STRAIN_LABELS.map((label) => (
              <div key={label}>
                <div className="mb-1.5 flex items-center justify-between">
                  <label htmlFor={`strain-${label}`} className="text-sm font-semibold text-slate-800">
                    {label}
                  </label>
                  <span className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">
                    {strainValues[label]}
                  </span>
                </div>

                <input
                  id={`strain-${label}`}
                  type="range"
                  min={1}
                  max={5}
                  step={1}
                  value={strainValues[label]}
                  onChange={(event) => updateStrain(label, event.target.value)}
                  className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-slate-200 accent-sky-600"
                />
              </div>
            ))}
          </div>
        </article>

        <div className="rounded-2xl border border-slate-200 bg-white p-2 sm:p-3">
          <StrainProfileRadarChart profileData={chartProfile} />
        </div>
      </div>
    </section>
  );
}
