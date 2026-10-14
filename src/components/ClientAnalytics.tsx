/**
 * STATISTIQUES CLIENT (Studio Analytique — P2 "réponses")
 *
 * Le client ouvre "Statistiques" et TOUT est déjà là (zéro config) : KPI +
 * graphiques calculés en direct depuis ses colis, avec objectifs/couleurs et
 * comparaison à la période précédente. Filtres période / pharmacie / zone.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Package, PackageStatus } from '../types';
import { computeClientMetrics, MetricPeriod, metricsRange } from '../services/clientMetrics';
import { KpiTile, TrendChart, BarByDimension, DonutStatuses, TopList } from './analytics/AnalyticsWidgets';
import InsightsPanel from './analytics/InsightsPanel';
import AskData from './analytics/AskData';
import { getClientInsights } from '../services/clientInsights';
import { exportReportExcel, printReportPDF } from '../utils/clientReport';
import { currentDimensions, deliveryEvents, eventDimensions, formatLogisticsTimestamp } from '../services/logisticsMetrics';
import type { ParcelCoverage } from '../services/parcelFeed';
import { BarChart3 } from 'lucide-react';

interface ClientAnalyticsProps {
  packages: Package[];
  clientId?: string;
  clientName?: string;
  coverage?: Pick<ParcelCoverage, 'historyComplete' | 'fromCache' | 'refreshedAt'>;
  refreshPackages?: () => Promise<Package[]>;
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

const ClientAnalytics: React.FC<ClientAnalyticsProps> = ({ packages, clientId, clientName = 'Client', coverage, refreshPackages }) => {
  const [period, setPeriod] = useState<MetricPeriod>('30d');
  const [pharmacy, setPharmacy] = useState<string>('');
  const [zone, setZone] = useState<string>('');

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const scope = useRef(0);
  const reportWindow = useRef<Window | null>(null);
  useEffect(() => { scope.current++; setExporting(false); setExportError(''); return () => { scope.current++; reportWindow.current?.close(); reportWindow.current = null; }; }, [clientId]);
  const dimensions = useMemo(() => packages.flatMap(pkg => [currentDimensions(pkg), ...deliveryEvents(pkg).map(eventDimensions)]), [packages]);
  const pharmacies = useMemo(() => [...new Set(dimensions.map(value => value.pharmacy).filter(Boolean))].sort(), [dimensions]);
  const zones = useMemo(() => [...new Set(dimensions.map(value => value.zone).filter(Boolean))].sort(), [dimensions]);

  const m = useMemo(
    () => computeClientMetrics(packages, { period, pharmacy: pharmacy || undefined, zone: zone || undefined }),
    [packages, period, pharmacy, zone]
  );

  const insights = useMemo(() => getClientInsights(packages, { period, pharmacy, zone }), [packages, period, pharmacy, zone]);

  const exportReport = async (kind: 'excel' | 'pdf') => {
    if (exporting || !refreshPackages) return;
    const expectedScope = scope.current;
    let target: Window | null = null;
    setExportError('');
    if (kind === 'pdf') {
      target = window.open('', '_blank');
      if (!target) { setExportError('Autorisez les fenêtres du navigateur pour ouvrir le rapport PDF.'); return; }
      reportWindow.current = target;
      target.document.write('<p>Vérification de l’historique auprès du serveur…</p>'); target.document.close();
    }
    setExporting(true);
    try {
      const complete = await refreshPackages();
      if (scope.current !== expectedScope) { target?.close(); return; }
      const filters = { pharmacy, zone }, label = PERIODS.find(item => item.id === period)!.label;
      if (kind === 'excel') exportReportExcel(complete, clientName, label, metricsRange(period), filters);
      else printReportPDF(complete, clientName, label, metricsRange(period), filters, target!);
    } catch (error) {
      target?.close();
      if (scope.current === expectedScope) setExportError(error instanceof Error ? error.message : 'L’historique complet n’a pas pu être vérifié. Aucun rapport n’a été généré.');
    } finally { if (scope.current === expectedScope) { setExporting(false); reportWindow.current = null; } }
  };

  const donutData = m.statusBreakdown.map(s => ({ name: s.status, value: s.count, color: STATUS_HEX[s.status] }));
  const trendData = m.byDay.map(d => ({ date: d.date.slice(5), value: d.total }));
  const pharmaBar = m.byPharmacy.map(p => ({ name: p.name, value: p.count }));
  const zoneBar = m.byZone.map(z => ({ name: z.zone, value: z.count }));
  const topRows = m.byPharmacy.map(p => ({ name: p.name, value: p.count, sub: `${p.delivered} livrés` }));

  const selectCls = 'min-w-0 max-w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white';

  return (
    <div className="space-y-5">
      {/* En-tête */}
      <div>
        <h1 className="text-2xl font-extrabold text-slate-900 flex items-center gap-2"><BarChart3 size={24} className="text-indigo-600" /> Statistiques</h1>
        <p className="text-sm text-slate-500">Créations et tentatives sur la période · heures terrain à La Réunion.</p>
      </div>

      {/* Ce qui compte (insights automatiques) */}


      {/* Demander à mes données (IA — chiffres garantis exacts) */}


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

      <p className="text-sm text-slate-600">Filtres appliqués aux indicateurs, alertes et exports. Les tentatives utilisent leur destinataire historique ; les colis à traiter utilisent leur destination actuelle.</p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={exporting || !refreshPackages || !coverage?.historyComplete || coverage.fromCache} className="ui-button ui-button-secondary" onClick={() => void exportReport('excel')}>Exporter Excel</button>
        <button type="button" disabled={exporting || !refreshPackages || !coverage?.historyComplete || coverage.fromCache} className="ui-button ui-button-secondary" onClick={() => void exportReport('pdf')}>Rapport PDF</button>
        {exporting && <p role="status" className="text-sm text-slate-600">Vérification de tout l’historique…</p>}
      </div>
      {exportError && <p role="alert" className="text-sm text-red-700">{exportError}</p>}
      {coverage?.fromCache ? <p className="text-sm text-amber-800">Données disponibles sur cet appareil ; historique non confirmé par le serveur. Les exports attendent la reconnexion.</p> : coverage?.refreshedAt && <p className="text-sm text-slate-600">Historique vérifié le {formatLogisticsTimestamp(coverage.refreshedAt)} · La Réunion. Chaque export est vérifié à nouveau.</p>}
      <InsightsPanel insights={insights} />
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile label="Colis créés" value={m.total} deltaPct={pctDelta(m.total, m.previous.total)} hint="Sur la période sélectionnée" />
        <KpiTile
          label="Succès des tentatives" value={m.resolved ? `${Math.round(m.deliveryRate)}%` : '—'} hint="Livrés ÷ (livrés + échecs décidés), hors colis en cours"
          numericValue={m.resolved ? m.deliveryRate : null} deltaUnit="points"
          deltaPct={m.resolved && m.previous.resolved ? m.deliveryRate - m.previous.deliveryRate : null}
          objective={{ target: 95, direction: 'up' }}
        />
        <KpiTile
          label="Ponctualité" value={m.punctualityRate == null ? '—' : `${Math.round(m.punctualityRate)}%`}
          numericValue={m.punctualityRate} deltaUnit="points"
          deltaPct={m.punctualityRate != null && m.previous.punctualityRate != null ? m.punctualityRate - m.previous.punctualityRate : null}
          objective={{ target: 90, direction: 'up' }}
          hint="Heure terrain ≤ jour/créneau promis, hors estimation de tournée"
        />
        <KpiTile
          label="Délai moyen" value={fmtDelay(m.avgDelayHours)}
          numericValue={m.avgDelayHours}
          deltaPct={m.avgDelayHours === null ? null : pctDelta(m.avgDelayHours, m.previous.avgDelayHours)}
          objective={{ target: 24, direction: 'down' }}
          hint="Collecte → remise (création si collecte historique inconnue)"
        />
      </div>

      <p className="text-sm text-slate-500">{m.workInProgress} colis à traiter, toutes dates. Respect de l’estimation de tournée : {m.etaAdherenceRate === null ? 'non mesurable' : `${Math.round(m.etaAdherenceRate)}%`} (distinct de la promesse client).</p>
      {m.undatedOutcomes > 0 && <p className="text-sm text-amber-700">{m.undatedOutcomes} résultat(s) historique(s) sans date fiable : inclus uniquement dans « Tout ».</p>}
      {/* Graphiques */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <TrendChart label="Colis créés par jour" data={trendData} />
        <TrendChart label="Colis remis par jour de livraison" data={m.byDay.map(day => ({ date: day.date.slice(5), value: day.delivered }))} color="#16a34a" />
        <DonutStatuses label="Statut actuel des colis créés sur la période" data={donutData} />
        <BarByDimension label="Colis par pharmacie (top 10)" data={pharmaBar} />
        <BarByDimension label="Colis par zone" data={zoneBar} color="#0ea5e9" />
      </div>

      {/* Top pharmacies */}
      <TopList label="Top pharmacies · colis créés sur la période" rows={topRows} />
      <p className="text-sm text-slate-600">Les questions ci-dessous portent sur tout votre historique ; les filtres ci-dessus concernent les indicateurs et les exports.</p>
      <AskData packages={packages} />
    </div>
  );
};

export default ClientAnalytics;
