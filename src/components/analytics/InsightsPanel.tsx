import React from 'react';
import {
  CheckCircle,
  AlertTriangle,
  AlertOctagon,
  Info,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';

/**
 * Panneau d'insights automatiques « Ce qui compte ».
 * 100 % présentationnel : aucune récupération de données, tout passe par les props.
 */

interface Insight {
  id: string;
  kind: 'positive' | 'warning' | 'critical' | 'info';
  title: string;
  detail: string;
}

export interface InsightsPanelProps {
  insights: Insight[];
  compact?: boolean;
}

interface KindStyle {
  Icon: LucideIcon;
  row: string;
  iconWrap: string;
  iconColor: string;
  label: string;
}

const KIND_STYLES: Record<Insight['kind'], KindStyle> = {
  positive: {
    Icon: CheckCircle,
    row: 'bg-green-50 border-green-200',
    iconWrap: 'bg-green-100',
    iconColor: 'text-green-600',
    label: 'Positif',
  },
  warning: {
    Icon: AlertTriangle,
    row: 'bg-amber-50 border-amber-200',
    iconWrap: 'bg-amber-100',
    iconColor: 'text-amber-600',
    label: 'Avertissement',
  },
  critical: {
    Icon: AlertOctagon,
    row: 'bg-red-50 border-red-200',
    iconWrap: 'bg-red-100',
    iconColor: 'text-red-600',
    label: 'Critique',
  },
  info: {
    Icon: Info,
    row: 'bg-slate-50 border-slate-200',
    iconWrap: 'bg-indigo-100',
    iconColor: 'text-indigo-600',
    label: 'Information',
  },
};

const COMPACT_LIMIT = 3;

const InsightsPanel: React.FC<InsightsPanelProps> = ({ insights, compact = false }) => {
  const cardClass = compact
    ? 'bg-white rounded-2xl border border-slate-200 p-3'
    : 'bg-white rounded-2xl border border-slate-200 p-4';

  const visible = compact ? insights.slice(0, COMPACT_LIMIT) : insights;

  return (
    <section className={cardClass} aria-label="Ce qui compte">
      <h2
        className={
          compact
            ? 'text-sm font-semibold text-slate-800 mb-2'
            : 'text-base font-semibold text-slate-800 mb-3'
        }
      >
        <span aria-hidden="true">💡</span> Ce qui compte
      </h2>

      {visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-center gap-2 py-6 text-slate-400">
          <ShieldCheck className="w-6 h-6" aria-hidden="true" />
          <p className="text-sm">Aucune alerte — tout est sous contrôle.</p>
        </div>
      ) : (
        <ul className={compact ? 'space-y-1.5' : 'space-y-2.5'} role="list">
          {visible.map((insight) => {
            const style = KIND_STYLES[insight.kind];
            const { Icon } = style;
            return (
              <li
                key={insight.id}
                className={`flex items-start gap-3 rounded-xl border ${style.row} ${
                  compact ? 'p-2' : 'p-3'
                }`}
              >
                <span
                  className={`flex-shrink-0 flex items-center justify-center rounded-full ${
                    style.iconWrap
                  } ${compact ? 'w-7 h-7' : 'w-9 h-9'}`}
                >
                  <Icon
                    className={`${style.iconColor} ${compact ? 'w-4 h-4' : 'w-5 h-5'}`}
                    aria-label={style.label}
                  />
                </span>
                <div className="min-w-0 flex-1">
                  <p
                    className={`font-semibold text-slate-800 ${
                      compact ? 'text-xs' : 'text-sm'
                    }`}
                  >
                    {insight.title}
                  </p>
                  <p
                    className={`text-slate-500 break-words ${
                      compact ? 'text-[11px] leading-snug' : 'text-xs'
                    }`}
                  >
                    {insight.detail}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};

export default InsightsPanel;
