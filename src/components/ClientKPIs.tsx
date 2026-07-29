/**
 * CLIENT KPIs — Tableau de bord Client
 * 
 * Vue pour le client expéditeur :
 * - Pipeline colis (en attente → en transit → livré / échoué)
 * - Taux de livraison (jour / semaine / mois)
 * - Évolution du volume sur 14 jours
 * - Motifs d'échec (pour corriger les adresses, horaires, etc.)
 * - Top destinations
 */

import React, { useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, AreaChart, Area
} from 'recharts';
import {
  TrendingUp, Package as PackageIcon, CheckCircle, XCircle,
  Clock, MapPin, AlertTriangle, ArrowUp, ArrowDown, Minus,
  Truck, BarChart3, FileSpreadsheet, Printer
} from 'lucide-react';
import { Package, PackageStatus, Zone, ZONE_COLORS, FailureReason } from '../types';
import { exportReportExcel, printReportPDF } from '../utils/clientReport';

// ============================================================================
// TYPES
// ============================================================================

type Period = 'today' | 'week' | 'month';

type ShipmentFilter = 'all' | 'pending' | 'transit' | 'delivered' | 'failed';

interface ClientKPIsProps {
  packages: Package[];
  clientName?: string;
  onDrillDown?: (filter: ShipmentFilter) => void;
}

// ============================================================================
// HELPERS
// ============================================================================

const getDateRange = (period: Period): { start: string; end: string } => {
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  
  if (period === 'today') {
    return { start: today, end: today };
  }
  
  if (period === 'week') {
    const dayOfWeek = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return {
      start: monday.toISOString().split('T')[0],
      end: sunday.toISOString().split('T')[0]
    };
  }
  
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return {
    start: firstDay.toISOString().split('T')[0],
    end: lastDay.toISOString().split('T')[0]
  };
};

const isInRange = (dateStr: string, start: string, end: string) => 
  dateStr >= start && dateStr <= end;

// ============================================================================
// COMPOSANT
// ============================================================================

const ClientKPIs: React.FC<ClientKPIsProps> = ({ packages, clientName = 'Client', onDrillDown }) => {
  // Rend une carte KPI cliquable (drill-down vers la liste filtrée) si onDrillDown fourni
  const drill = (filter: ShipmentFilter) => onDrillDown ? {
    onClick: () => onDrillDown(filter),
    role: 'button' as const,
    tabIndex: 0,
    title: 'Voir ces colis'
  } : {};
  const drillClass = onDrillDown ? ' cursor-pointer hover:shadow-md hover:border-indigo-300 transition-all active:scale-95' : '';
  const [period, setPeriod] = useState<Period>('today');
  const dateRange = useMemo(() => getDateRange(period), [period]);
  const periodLabel = useMemo(() => {
    const fr = (d: string) => new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
    if (period === 'today') return `Aujourd'hui (${fr(dateRange.start)})`;
    if (period === 'week') return `Semaine du ${fr(dateRange.start)} au ${fr(dateRange.end)}`;
    return new Date(dateRange.start).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  }, [period, dateRange]);
  const today = new Date().toISOString().split('T')[0];

  // Packages de la période
  const periodPackages = useMemo(() => 
    packages.filter(p => isInRange(p.createdAt.split('T')[0], dateRange.start, dateRange.end)),
    [packages, dateRange]
  );

  // ============================================================================
  // PIPELINE — Statut actuel de TOUS les colis actifs
  // ============================================================================

  const pipeline = useMemo(() => {
    const pending = packages.filter(p => p.status === PackageStatus.PENDING).length;
    const inTransit = packages.filter(p => 
      [PackageStatus.COLLECTED, PackageStatus.AT_HUB, PackageStatus.SORTED, 
       PackageStatus.LOADED, PackageStatus.IN_TRANSIT, PackageStatus.IN_DELIVERY
      ].includes(p.status)
    ).length;
    const delivered = periodPackages.filter(p => p.status === PackageStatus.DELIVERED).length;
    const failed = periodPackages.filter(p => 
      p.status === PackageStatus.FAILED || p.status === PackageStatus.RETURNED
    ).length;
    const total = periodPackages.length;
    
    return { pending, inTransit, delivered, failed, total };
  }, [packages, periodPackages]);

  // ============================================================================
  // TAUX DE LIVRAISON
  // ============================================================================

  const deliveryRate = useMemo(() => {
    const resolved = pipeline.delivered + pipeline.failed;
    return resolved > 0 ? Math.round((pipeline.delivered / resolved) * 100) : 0;
  }, [pipeline]);

  // Comparaison veille
  const yesterdayRate = useMemo(() => {
    if (period !== 'today') return null;
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yStr = yesterday.toISOString().split('T')[0];
    const yPkgs = packages.filter(p => p.createdAt.split('T')[0] === yStr);
    const yDelivered = yPkgs.filter(p => p.status === PackageStatus.DELIVERED).length;
    const yFailed = yPkgs.filter(p => p.status === PackageStatus.FAILED || p.status === PackageStatus.RETURNED).length;
    const yResolved = yDelivered + yFailed;
    return yResolved > 0 ? Math.round((yDelivered / yResolved) * 100) : null;
  }, [packages, period]);

  const rateDelta = yesterdayRate !== null ? deliveryRate - yesterdayRate : 0;

  // ============================================================================
  // GRAPHE 14 JOURS
  // ============================================================================

  const dailyTrend = useMemo(() => {
    const days: { label: string; envoyés: number; livrés: number; échecs: number }[] = [];
    
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const dayLabel = d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
      
      const dayPkgs = packages.filter(p => p.createdAt.split('T')[0] === dateStr);
      
      days.push({
        label: dayLabel,
        envoyés: dayPkgs.length,
        livrés: dayPkgs.filter(p => p.status === PackageStatus.DELIVERED).length,
        échecs: dayPkgs.filter(p => p.status === PackageStatus.FAILED || p.status === PackageStatus.RETURNED).length
      });
    }
    
    return days;
  }, [packages]);

  // ============================================================================
  // MOTIFS D'ÉCHEC
  // ============================================================================

  const failureReasons = useMemo(() => {
    const reasons: Record<string, number> = {};
    
    for (const pkg of periodPackages) {
      if ((pkg.status === PackageStatus.FAILED || pkg.status === PackageStatus.RETURNED) && pkg.failureReason) {
        reasons[pkg.failureReason] = (reasons[pkg.failureReason] || 0) + 1;
      }
    }

    return Object.entries(reasons)
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count);
  }, [periodPackages]);

  // ============================================================================
  // TOP DESTINATIONS
  // ============================================================================

  const topDestinations = useMemo(() => {
    const cities: Record<string, { total: number; delivered: number; failed: number }> = {};
    
    for (const pkg of periodPackages) {
      const city = pkg.city || 'Inconnu';
      if (!cities[city]) cities[city] = { total: 0, delivered: 0, failed: 0 };
      cities[city].total++;
      if (pkg.status === PackageStatus.DELIVERED) cities[city].delivered++;
      if (pkg.status === PackageStatus.FAILED || pkg.status === PackageStatus.RETURNED) cities[city].failed++;
    }

    return Object.entries(cities)
      .map(([city, data]) => ({ city, ...data, rate: data.total > 0 ? Math.round((data.delivered / data.total) * 100) : 0 }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 8);
  }, [periodPackages]);

  // ============================================================================
  // PAR ZONE
  // ============================================================================

  const zoneData = useMemo(() => 
    [Zone.NORD, Zone.SUD, Zone.EST, Zone.OUEST].map(zone => {
      const zonePkgs = periodPackages.filter(p => p.zone === zone);
      const delivered = zonePkgs.filter(p => p.status === PackageStatus.DELIVERED).length;
      const failed = zonePkgs.filter(p => p.status === PackageStatus.FAILED || p.status === PackageStatus.RETURNED).length;
      return { zone, total: zonePkgs.length, delivered, failed };
    }).filter(z => z.total > 0),
    [periodPackages]
  );

  // ============================================================================
  // COULEURS
  // ============================================================================

  const COLORS = {
    delivered: '#22c55e',
    failed: '#ef4444',
    transit: '#3b82f6',
    pending: '#94a3b8'
  };
  const PIE_COLORS = ['#ef4444', '#f97316', '#eab308', '#3b82f6', '#8b5cf6', '#6b7280'];

  // ============================================================================
  // RENDER
  // ============================================================================

  const DeltaIndicator = ({ value }: { value: number }) => {
    if (value === 0) return <span className="text-xs text-slate-400 flex items-center gap-0.5"><Minus size={10} /> =</span>;
    if (value > 0) return <span className="text-xs text-green-600 flex items-center gap-0.5"><ArrowUp size={10} /> +{value}%</span>;
    return <span className="text-xs text-red-600 flex items-center gap-0.5"><ArrowDown size={10} /> {value}%</span>;
  };

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div className="bg-gradient-to-r from-blue-700 to-indigo-600 rounded-3xl p-6 text-white shadow-xl">
        <h2 className="text-2xl font-bold flex items-center gap-3">
          <BarChart3 size={28} />
          Tableau de bord
        </h2>
        <p className="text-blue-100 mt-1">
          Suivi en temps réel de vos expéditions
        </p>
      </div>

      {/* Filtre période + export rapports */}
      <div className="flex items-center gap-2 flex-wrap">
        {(['today', 'week', 'month'] as Period[]).map(p => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${
              period === p
                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-200'
                : 'bg-white text-slate-600 border border-slate-200 hover:border-indigo-300'
            }`}
          >
            {p === 'today' ? "Aujourd'hui" : p === 'week' ? 'Semaine' : 'Mois'}
          </button>
        ))}

        {/* Boutons d'export — rapport de la période sélectionnée */}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => exportReportExcel(periodPackages, clientName, periodLabel)}
            disabled={periodPackages.length === 0}
            title="Exporter le rapport en Excel"
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-bold bg-green-600 text-white hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <FileSpreadsheet size={16} /> Excel
          </button>
          <button
            onClick={() => printReportPDF(periodPackages, clientName, periodLabel)}
            disabled={periodPackages.length === 0}
            title="Rapport imprimable / PDF"
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-bold bg-slate-800 text-white hover:bg-slate-900 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Printer size={16} /> PDF
          </button>
        </div>
      </div>

      {/* === PIPELINE === */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {/* Total */}
        <div className={"bg-white rounded-xl border border-slate-200 p-4 text-center" + drillClass} {...drill('all')}>
          <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center mx-auto mb-2">
            <PackageIcon size={20} className="text-indigo-600" />
          </div>
          <p className="text-2xl font-black text-slate-800">{pipeline.total}</p>
          <p className="text-[10px] text-slate-500 font-medium uppercase">Total</p>
        </div>

        {/* En attente */}
        <div className={"bg-white rounded-xl border border-slate-200 p-4 text-center" + drillClass} {...drill('pending')}>
          <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center mx-auto mb-2">
            <Clock size={20} className="text-slate-600" />
          </div>
          <p className="text-2xl font-black text-slate-600">{pipeline.pending}</p>
          <p className="text-[10px] text-slate-500 font-medium uppercase">En attente</p>
        </div>

        {/* En transit */}
        <div className={"bg-white rounded-xl border border-slate-200 p-4 text-center" + drillClass} {...drill('transit')}>
          <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center mx-auto mb-2">
            <Truck size={20} className="text-blue-600" />
          </div>
          <p className="text-2xl font-black text-blue-600">{pipeline.inTransit}</p>
          <p className="text-[10px] text-slate-500 font-medium uppercase">En transit</p>
        </div>

        {/* Livrés */}
        <div className={"bg-white rounded-xl border border-slate-200 p-4 text-center" + drillClass} {...drill('delivered')}>
          <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center mx-auto mb-2">
            <CheckCircle size={20} className="text-green-600" />
          </div>
          <p className="text-2xl font-black text-green-600">{pipeline.delivered}</p>
          <p className="text-[10px] text-slate-500 font-medium uppercase">Livrés</p>
        </div>

        {/* Échecs */}
        <div className={"bg-white rounded-xl border border-slate-200 p-4 text-center" + drillClass} {...drill('failed')}>
          <div className="w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center mx-auto mb-2">
            <XCircle size={20} className="text-red-600" />
          </div>
          <p className={`text-2xl font-black ${pipeline.failed > 0 ? 'text-red-600' : 'text-slate-400'}`}>
            {pipeline.failed}
          </p>
          <p className="text-[10px] text-slate-500 font-medium uppercase">Échecs</p>
        </div>
      </div>

      {/* === TAUX DE LIVRAISON (bandeau) === */}
      <div className={`rounded-2xl p-6 flex items-center justify-between ${
        deliveryRate >= 95 ? 'bg-green-50 border-2 border-green-200' :
        deliveryRate >= 80 ? 'bg-amber-50 border-2 border-amber-200' :
        'bg-red-50 border-2 border-red-200'
      }`}>
        <div>
          <p className="text-sm font-bold text-slate-700">Taux de livraison</p>
          <p className={`text-4xl font-black mt-1 ${
            deliveryRate >= 95 ? 'text-green-600' :
            deliveryRate >= 80 ? 'text-amber-600' : 'text-red-600'
          }`}>
            {deliveryRate}%
          </p>
          <p className="text-xs text-slate-500 mt-1">
            {pipeline.delivered} livrés sur {pipeline.delivered + pipeline.failed} traités
          </p>
        </div>
        <div className="text-right">
          {period === 'today' && yesterdayRate !== null && (
            <div>
              <DeltaIndicator value={rateDelta} />
              <p className="text-[10px] text-slate-400 mt-0.5">vs hier</p>
            </div>
          )}
          <div className={`w-16 h-16 rounded-full border-4 flex items-center justify-center mt-2 ${
            deliveryRate >= 95 ? 'border-green-400' :
            deliveryRate >= 80 ? 'border-amber-400' : 'border-red-400'
          }`}>
            {deliveryRate >= 95 
              ? <CheckCircle size={28} className="text-green-500" />
              : deliveryRate >= 80 
                ? <TrendingUp size={28} className="text-amber-500" />
                : <AlertTriangle size={28} className="text-red-500" />
            }
          </div>
        </div>
      </div>

      {/* === VOLUME QUOTIDIEN 14 JOURS === */}
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h3 className="text-base font-bold text-slate-800 mb-4">Volume d'expéditions — 14 derniers jours</h3>
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={dailyTrend}>
            <defs>
              <linearGradient id="colorEnvoyes" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
              </linearGradient>
              <linearGradient id="colorLivres" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3}/>
                <stop offset="95%" stopColor="#22c55e" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis 
              dataKey="label" 
              tick={{ fontSize: 11, fill: '#94a3b8' }}
              tickLine={false}
              axisLine={{ stroke: '#e2e8f0' }}
            />
            <YAxis 
              tick={{ fontSize: 11, fill: '#94a3b8' }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip 
              contentStyle={{ borderRadius: '12px', border: '1px solid #e2e8f0', fontSize: '12px' }}
            />
            <Area 
              type="monotone" 
              dataKey="envoyés" 
              stroke="#6366f1" 
              strokeWidth={2}
              fill="url(#colorEnvoyes)"
              name="Envoyés"
            />
            <Area 
              type="monotone" 
              dataKey="livrés" 
              stroke="#22c55e" 
              strokeWidth={2}
              fill="url(#colorLivres)"
              name="Livrés"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* === MOTIFS D'ÉCHEC === */}
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h3 className="text-base font-bold text-slate-800 mb-4 flex items-center gap-2">
            <AlertTriangle size={16} className="text-red-500" />
            Motifs d'échec
          </h3>
          {failureReasons.length > 0 ? (
            <div className="flex gap-6">
              <div className="w-40 flex-shrink-0">
                <ResponsiveContainer width="100%" height={160}>
                  <PieChart>
                    <Pie
                      data={failureReasons}
                      dataKey="count"
                      nameKey="reason"
                      cx="50%"
                      cy="50%"
                      innerRadius={35}
                      outerRadius={65}
                      paddingAngle={3}
                    >
                      {failureReasons.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ borderRadius: '12px', border: '1px solid #e2e8f0', fontSize: '12px' }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex-1 space-y-2 flex flex-col justify-center">
                {failureReasons.map((r, i) => (
                  <div key={r.reason} className="flex items-center gap-2">
                    <div 
                      className="w-3 h-3 rounded-full flex-shrink-0" 
                      style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}
                    />
                    <span className="text-sm text-slate-700 flex-1 truncate">{r.reason}</span>
                    <span className="text-sm font-bold text-slate-800">{r.count}</span>
                  </div>
                ))}
                <p className="text-[10px] text-slate-400 mt-2 pt-2 border-t border-slate-100">
                  💡 Les adresses erronées peuvent être corrigées dans vos fichiers d'import
                </p>
              </div>
            </div>
          ) : (
            <div className="text-center py-8">
              <CheckCircle size={32} className="mx-auto text-green-400 mb-2" />
              <p className="text-sm text-slate-500">Aucun échec sur cette période</p>
            </div>
          )}
        </div>

        {/* === TOP DESTINATIONS === */}
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h3 className="text-base font-bold text-slate-800 mb-4 flex items-center gap-2">
            <MapPin size={16} className="text-indigo-600" />
            Top destinations
          </h3>
          {topDestinations.length > 0 ? (
            <div className="space-y-2">
              {topDestinations.map((d, i) => (
                <div key={d.city} className="flex items-center gap-3">
                  <span className="text-xs font-bold text-slate-400 w-5 text-right">{i + 1}.</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <p className="text-sm font-medium text-slate-700 truncate">{d.city}</p>
                      <span className="text-xs text-slate-500">{d.total} colis</span>
                    </div>
                    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-indigo-400 rounded-full"
                        style={{ width: `${topDestinations[0]?.total > 0 ? (d.total / topDestinations[0].total) * 100 : 0}%` }}
                      />
                    </div>
                  </div>
                  <span className={`text-xs font-bold w-10 text-right ${
                    d.rate >= 95 ? 'text-green-600' : d.rate >= 80 ? 'text-amber-600' : 'text-red-600'
                  }`}>
                    {d.rate}%
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-400 text-center py-8">Aucune donnée pour cette période</p>
          )}
        </div>
      </div>

      {/* === PAR ZONE === */}
      {zoneData.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h3 className="text-base font-bold text-slate-800 mb-4">Répartition par zone</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {zoneData.map(z => {
              const colors = ZONE_COLORS[z.zone];
              const rate = z.total > 0 ? Math.round((z.delivered / z.total) * 100) : 0;
              return (
                <div key={z.zone} className={`rounded-xl p-4 ${colors.bg}`}>
                  <p className={`text-sm font-bold ${colors.text}`}>{z.zone}</p>
                  <p className="text-2xl font-black text-slate-800 mt-1">{z.total}</p>
                  <p className="text-xs text-slate-600">
                    {z.delivered} livrés • {z.failed} échecs
                  </p>
                  <div className="h-1.5 bg-white/60 rounded-full overflow-hidden mt-2">
                    <div 
                      className={`h-full rounded-full ${rate >= 95 ? 'bg-green-500' : rate >= 80 ? 'bg-amber-500' : 'bg-red-500'}`}
                      style={{ width: `${rate}%` }}
                    />
                  </div>
                  <p className="text-xs font-bold text-slate-700 mt-1">{rate}%</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* === MÉTRIQUES SECONDAIRES === */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-slate-50 rounded-xl p-4 text-center">
          <p className="text-2xl font-black text-slate-700">
            {periodPackages.length > 0 
              ? Math.round(periodPackages.length / (period === 'today' ? 1 : period === 'week' ? 7 : 30))
              : 0}
          </p>
          <p className="text-xs text-slate-500">colis/jour (moy.)</p>
        </div>
        <div className="bg-slate-50 rounded-xl p-4 text-center">
          <p className="text-2xl font-black text-slate-700">
            {new Set(periodPackages.map(p => p.city)).size}
          </p>
          <p className="text-xs text-slate-500">destinations</p>
        </div>
        <div className="bg-slate-50 rounded-xl p-4 text-center">
          <p className="text-2xl font-black text-slate-700">
            {new Set(periodPackages.map(p => p.zone)).size}
          </p>
          <p className="text-xs text-slate-500">zones desservies</p>
        </div>
      </div>
    </div>
  );
};

export default ClientKPIs;
