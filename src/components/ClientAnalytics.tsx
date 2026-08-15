/**
 * STATISTIQUES CLIENT (Studio Analytique — P2 "réponses")
 *
 * Le client ouvre "Statistiques" et TOUT est déjà là (zéro config) : KPI +
 * graphiques calculés en direct depuis ses colis, avec objectifs/couleurs et
 * comparaison à la période précédente. Filtres période / pharmacie / zone.
 */
import React, { useMemo, useState } from 'react';
import { Package, PackageStatus } from '../types';
import { computeClientMetrics, MetricPeriod } from '../services/clientMetrics';
import { KpiTile, TrendChart, BarByDimension, DonutStatuses, TopList } from './analytics/AnalyticsWidgets';
import InsightsPanel from './analytics/InsightsPanel';
import { getClientInsights } from '../services/clientInsights';
import { BarChart3 } from 'lucide-react';

interface ClientAnalyticsProps {
  packages: Package[];
}

const PERIODS: { id: MetricPeriod; label: string }[] = [
  { id: '7d', label: '7 jours' },
  { id: '30d', label: '30 jours' },
  { id: 'month', label: 'Ce mois' },
  { id: 'all', label: 'Tout' },
];

const STATUS_HEX: Record<string, string> = {
  [PackageStatus.DELIVERED]: '#16a34a',
  [PackageStatus.IN_DELIVERY]: '#f97316',
  [PackageStatus.FAILED]: '#dc2626',
  [PackageStatus.RETURNED]: '#e11d48',
  [PackageStatus.PENDING]: '#94a3b8',
  [PackageStatus.IN_TRANSIT]: '#06b6d4',
  [PackageStatus.AT_HUB]: '#6366f1',
  [PackageStatus.SORTED]: '#8b5cf6',
  [PackageStatus.LOADED]: '#f59e0b',
  [PackageStatus.COLLECTED]: '#3b82f6',
};

const fmtDelay = (h: number | null): string => {
  if (h == null) return '—';
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 48) return `${h.toFixed(1)} h`;
  return `${Math.round(h / 24)} j`;
};

const pctDelta = (cur: number, prev: number | null | undefined): number | null =>
  prev == null || prev === 0 ? null : ((cur - prev) / prev) * 100;

const ClientAnalytics: React.FC<ClientAnalyticsProps> = ({ packages }) => {
  const [period, setPeriod] = useState<MetricPeriod>('30d');
  const [pharmacy, setPharmacy] = useState<string>('');
  const [zone, setZone] = useState<string>('');

  // Options de filtres (depuis tous les colis)
  const pharmacies = useMemo(
    () => Array.from(new Set(packages.map(p => (p.contactName || '').trim()).filter(Boolean))).sort(),
    [packages]
  );
  const zones = useMemo(
    () => Array.from(new Set(packages.map(p => String(p.zone || '').trim()).filter(Boolean))).sort(),
    [packages]
  );

  const m = useMemo(
    () => computeClientMetrics(packages, { period, pharmacy: pharmacy || undefined, zone: zone || undefined }),
    [packages, period, pharmacy, zone]
  );

  const insights = useMemo(() => getClientInsights(packages), [packages]);

  const donutData = m.statusBreakdown.map(s => ({ name: s.status, value: s.count, color: STATUS_HEX[s.status] }));
  const trendData = m.byDay.map(d => ({ date: d.date.slice(5), value: d.total }));
  const pharmaBar = m.byPharmacy.map(p => ({ name: p.name, value: p.count }));
  const zoneBar = m.byZone.map(z => ({ name: z.zone, value: z.count }));
  const topRows = m.byPharmacy.map(p => ({ name: p.name, value: p.count, sub: `${p.delivered} livrés` }));

  const selectCls = 'px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white';

  return (
    <div className="space-y-5">
      {/* En-tête */}
      <div>
        <h1 className="text-2xl font-extrabold text-slate-900 flex items-center gap-2"><BarChart3 size={24} className="text-indigo-600" /> Statistiques</h1>
        <p className="text-sm text-slate-500">Vos indicateurs, calculés en direct — rien à configurer.</p>
      </div>

      {/* Ce qui compte (insights automatiques) */}
      <InsightsPanel insights={insights} />

      {/* Filtres */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-xl bg-white border border-slate-200 p-1">
          {PERIODS.map(p => (
            <button
              key={p.id}
              onClick={() => setPeriod(p.id)}
              className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-colors ${period === p.id ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <select value={pharmacy} onChange={e => setPharmacy(e.target.value)} className={selectCls}>
          <option value="">Toutes les pharmacies</option>
          {pharmacies.map(ph => <option key={ph} value={ph}>{ph}</option>)}
        </select>
        <select value={zone} onChange={e => setZone(e.target.value)} className={selectCls}>
          <option value="">Toutes les zones</option>
          {zones.map(z => <option key={z} value={z}>{z}</option>)}
        </select>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile label="Colis" value={m.total} deltaPct={pctDelta(m.total, m.previous.total)} hint="Sur la période sélectionnée" />
        <KpiTile
          label="Taux de livraison" value={`${Math.round(m.deliveryRate)}%`}
          deltaPct={m.previous.deliveryRate != null ? m.deliveryRate - m.previous.deliveryRate : null}
          objective={{ target: 95, direction: 'up' }}
        />
        <KpiTile
          label="Ponctualité" value={m.punctualityRate == null ? '—' : `${Math.round(m.punctualityRate)}%`}
          deltaPct={m.punctualityRate != null && m.previous.punctualityRate != null ? m.punctualityRate - m.previous.punctualityRate : null}
          objective={{ target: 90, direction: 'up' }}
          hint="Livrés à l'heure prévue"
        />
        <KpiTile
          label="Délai moyen" value={fmtDelay(m.avgDelayHours)}
          deltaPct={pctDelta(m.avgDelayHours ?? 0, m.previous.avgDelayHours)}
          objective={{ target: 24, direction: 'down' }}
          hint="Prise en charge → livraison"
        />
      </div>

      {/* Graphiques */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <TrendChart label="Colis par jour" data={trendData} />
        <DonutStatuses label="Répartition par statut" data={donutData} />
        <BarByDimension label="Colis par pharmacie (top 10)" data={pharmaBar} />
        <BarByDimension label="Colis par zone" data={zoneBar} color="#0ea5e9" />
      </div>

      {/* Top pharmacies */}
      <TopList label="Top pharmacies" rows={topRows} />
    </div>
  );
};

export default ClientAnalytics;
