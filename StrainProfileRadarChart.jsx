import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
} from 'recharts';

/**
 * @param {{ profileData: import('./EnneagramProfile').EnneagramProfile }} props
 */
export default function StrainProfileRadarChart({ profileData }) {
  const strainData = profileData.strain.points;

  return (
    <section className="w-full max-w-2xl rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_18px_60px_rgba(15,23,42,0.08)] sm:p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
            Strain Profile
          </p>
          <h2 className="mt-2 text-2xl font-black tracking-[-0.04em] text-slate-950 sm:text-3xl">
            Overall Strain: {profileData.strain.overallLabel}
          </h2>
        </div>

        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2 text-right">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700">
            Max Axis
          </p>
          <p className="text-lg font-extrabold text-amber-900">
            {profileData.strain.maxAxis}
          </p>
        </div>
      </div>

      <div className="mt-6 h-80 w-full rounded-2xl border border-slate-100 bg-slate-50/70 p-3 sm:h-96 sm:p-4">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={strainData} outerRadius="72%">
            <PolarGrid stroke="#cbd5e1" />
            <PolarAngleAxis
              dataKey="subject"
              tick={{ fill: '#475569', fontSize: 12, fontWeight: 600 }}
            />
            <PolarRadiusAxis
              angle={90}
              domain={[0, profileData.strain.maxAxis]}
              tickCount={profileData.strain.maxAxis + 1}
              tick={{ fill: '#94a3b8', fontSize: 11 }}
              stroke="#dbe4ee"
            />
            <Radar
              name="Strain"
              dataKey="value"
              stroke="#f59e0b"
              fill="#fbbf24"
              fillOpacity={0.28}
              strokeWidth={3}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}