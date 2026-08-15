import React from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';

/**
 * Widgets analytiques réutilisables et 100 % présentationnels.
 * Aucune récupération de données : tout passe par les props.
 */

// Palette partagée
const PALETTE = {
  indigo: '#4f46e5',
  green: '#16a34a',
  orange: '#f97316',
  red: '#dc2626',
  slate: '#64748b',
} as const;

const DONUT_PALETTE: readonly string[] = [
  PALETTE.indigo,
  PALETTE.green,
  PALETTE.orange,
  PALETTE.red,
  PALETTE.slate,
];

const CARD_CLASS = 'bg-white rounded-2xl border border-slate-200 p-4';

// --- Sous-composants internes ---

const CardTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
    {children}
  </h3>
);

const EmptyState: React.FC<{ message?: string }> = ({
  message = 'Aucune donnée disponible',
}) => (
  <div className="flex h-40 items-center justify-center text-sm text-slate-400">
    {message}
  </div>
);

// --- 1) KpiTile ---

export const KpiTile: React.FC<{
  label: string;
  value: string | number;
  suffix?: string;
  deltaPct?: number | null;
  objective?: { target: number; direction: 'up' | 'down' };
  hint?: string;
}> = ({ label, value, suffix, deltaPct, objective, hint }) => {
  // Couleur de la valeur selon l'objectif
  let valueColor = 'text-slate-900';
  if (objective) {
    const numericValue = typeof value === 'number' ? value : Number(value);
    const meetsTarget = Number.isNaN(numericValue)
      ? false
      : objective.direction === 'up'
        ? numericValue >= objective.target
        : numericValue <= objective.target;
    valueColor = meetsTarget ? 'text-green-600' : 'text-amber-500';
  }

  // Couleur du delta : amélioration = vert, sinon rouge
  const direction = objective?.direction ?? 'up';
  const isImprovement =
    deltaPct != null &&
    (direction === 'up' ? deltaPct > 0 : deltaPct < 0);
  const isNeutral = deltaPct != null && deltaPct === 0;
  const deltaColor = isNeutral
    ? 'text-slate-500'
    : isImprovement
      ? 'text-green-600'
      : 'text-red-600';
  const arrow = deltaPct != null && deltaPct >= 0 ? '▲' : '▼';

  return (
    <div className={CARD_CLASS} title={hint}>
      <CardTitle>{label}</CardTitle>
      <div className="mt-2 flex items-baseline gap-1">
        <span className={`text-3xl font-bold ${valueColor}`}>{value}</span>
        {suffix && (
          <span className="text-lg font-semibold text-slate-500">{suffix}</span>
        )}
      </div>
      {deltaPct != null && (
        <div className={`mt-1 text-xs font-medium ${deltaColor}`}>
          {arrow} {Math.abs(deltaPct)}% vs période préc.
        </div>
      )}
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  );
};

// --- 2) TrendChart ---

export const TrendChart: React.FC<{
  label: string;
  data: { date: string; value: number }[];
  color?: string;
}> = ({ label, data, color = PALETTE.indigo }) => (
  <div className={CARD_CLASS}>
    <CardTitle>{label}</CardTitle>
    {data.length === 0 ? (
      <EmptyState />
    ) : (
      <div className="mt-3 w-full">
        <ResponsiveContainer width="100%" height={200}>
          <LineChart
            data={data}
            margin={{ top: 5, right: 12, left: 0, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11, fill: PALETTE.slate }}
              tickLine={false}
              axisLine={{ stroke: '#e2e8f0' }}
            />
            <YAxis
              tick={{ fontSize: 11, fill: PALETTE.slate }}
              tickLine={false}
              axisLine={false}
              width={36}
            />
            <Tooltip
              contentStyle={{
                borderRadius: 12,
                border: '1px solid #e2e8f0',
                fontSize: 12,
              }}
            />
            <Line
              type="monotone"
              dataKey="value"
              stroke={color}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    )}
  </div>
);

// --- 3) BarByDimension ---

export const BarByDimension: React.FC<{
  label: string;
  data: { name: string; value: number }[];
  color?: string;
}> = ({ label, data, color = PALETTE.indigo }) => (
  <div className={CARD_CLASS}>
    <CardTitle>{label}</CardTitle>
    {data.length === 0 ? (
      <EmptyState />
    ) : (
      <div className="mt-3 w-full">
        <ResponsiveContainer width="100%" height={220}>
          <BarChart
            data={data}
            margin={{ top: 5, right: 12, left: 0, bottom: 24 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            <XAxis
              dataKey="name"
              tick={{ fontSize: 11, fill: PALETTE.slate }}
              tickLine={false}
              axisLine={{ stroke: '#e2e8f0' }}
              interval={0}
              angle={-35}
              textAnchor="end"
              height={50}
              tickFormatter={(v: string) =>
                v.length > 12 ? `${v.slice(0, 12)}…` : v
              }
            />
            <YAxis
              tick={{ fontSize: 11, fill: PALETTE.slate }}
              tickLine={false}
              axisLine={false}
              width={36}
            />
            <Tooltip
              cursor={{ fill: 'rgba(148,163,184,0.1)' }}
              contentStyle={{
                borderRadius: 12,
                border: '1px solid #e2e8f0',
                fontSize: 12,
              }}
            />
            <Bar dataKey="value" fill={color} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    )}
  </div>
);

// --- 4) DonutStatuses ---

export const DonutStatuses: React.FC<{
  label: string;
  data: { name: string; value: number; color?: string }[];
}> = ({ label, data }) => (
  <div className={CARD_CLASS}>
    <CardTitle>{label}</CardTitle>
    {data.length === 0 ? (
      <EmptyState />
    ) : (
      <div className="mt-3 w-full">
        <ResponsiveContainer width="100%" height={220}>
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={50}
              outerRadius={80}
              paddingAngle={2}
            >
              {data.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={entry.color ?? DONUT_PALETTE[index % DONUT_PALETTE.length]}
                />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                borderRadius: 12,
                border: '1px solid #e2e8f0',
                fontSize: 12,
              }}
            />
            <Legend
              wrapperStyle={{ fontSize: 12 }}
              iconType="circle"
              verticalAlign="bottom"
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
    )}
  </div>
);

// --- 5) TopList ---

export const TopList: React.FC<{
  label: string;
  rows: { name: string; value: string | number; sub?: string }[];
}> = ({ label, rows }) => (
  <div className={CARD_CLASS}>
    <CardTitle>{label}</CardTitle>
    {rows.length === 0 ? (
      <EmptyState message="Aucun élément à afficher" />
    ) : (
      <ul className="mt-3 divide-y divide-slate-100">
        {rows.map((row, index) => (
          <li
            key={`${row.name}-${index}`}
            className="flex items-center gap-3 py-2"
          >
            <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
              {index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-900">
                {row.name}
              </p>
              {row.sub && (
                <p className="truncate text-xs text-slate-400">{row.sub}</p>
              )}
            </div>
            <span className="flex-shrink-0 text-sm font-semibold text-slate-900">
              {row.value}
            </span>
          </li>
        ))}
      </ul>
    )}
  </div>
);
