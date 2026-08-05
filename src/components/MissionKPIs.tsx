/**
 * MISSION KPIs — Tableau de bord Direction
 * 
 * Vue complète pour le président / directeur d'exploitation :
 * - Taux de livraison (jour / semaine / mois)
 * - Performance par chauffeur
 * - Performance par zone
 * - Motifs d'échec
 * - Comparatif journalier (graphe sur 14 jours)
 */

import React, { useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, Legend
} from 'recharts';
import {
  TrendingUp, TrendingDown, Package as PackageIcon, Truck,
  CheckCircle, XCircle, Clock, MapPin, Users, AlertTriangle,
  ChevronDown, ArrowUp, ArrowDown, Minus
} from 'lucide-react';
import {
  Mission, MissionStatus, Package, PackageStatus, Zone, ZONE_COLORS,
  FailureReason, User, UserRole
} from '../types';

// ============================================================================
// TYPES
// ============================================================================

type Period = 'today' | 'week' | 'month';

interface MissionKPIsProps {
  missions: Mission[];
  packages: Package[];
  users: User[];
  selectedDate: string;
}

// ============================================================================
// HELPERS
// ============================================================================

const getDateRange = (selectedDate: string, period: Period): { start: string; end: string } => {
  const date = new Date(selectedDate);
  
  if (period === 'today') {
    return { start: selectedDate, end: selectedDate };
  }
  
  if (period === 'week') {
    const dayOfWeek = date.getDay();
    const monday = new Date(date);
    monday.setDate(date.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return {
      start: monday.toISOString().split('T')[0],
      end: sunday.toISOString().split('T')[0]
    };
  }
  
  // month
  const firstDay = new Date(date.getFullYear(), date.getMonth(), 1);
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return {
    start: firstDay.toISOString().split('T')[0],
    end: lastDay.toISOString().split('T')[0]
  };
};

const isInRange = (dateStr: string, start: string, end: string) => 
  dateStr >= start && dateStr <= end;

const formatNumber = (n: number) => n.toLocaleString('fr-FR');

// ============================================================================
// COMPOSANT PRINCIPAL
// ============================================================================

const MissionKPIs: React.FC<MissionKPIsProps> = ({ missions, packages, users, selectedDate }) => {
  const [period, setPeriod] = useState<Period>('today');
  
  const dateRange = useMemo(() => getDateRange(selectedDate, period), [selectedDate, period]);
  
  // Missions de la période
  const periodMissions = useMemo(() => 
    missions.filter(m => isInRange(m.date, dateRange.start, dateRange.end)),
    [missions, dateRange]
  );

  // Packages de la période (via missions ou createdAt)
  const periodPackages = useMemo(() => 
    packages.filter(p => 
      isInRange(p.createdAt.split('T')[0], dateRange.start, dateRange.end) ||
      (p.updatedAt && isInRange(p.updatedAt.split('T')[0], dateRange.start, dateRange.end))
    ),
    [packages, dateRange]
  );

  const drivers = useMemo(() => 
    users.filter(u => u.role === UserRole.DRIVER && !u.isDisabled),
    [users]
  );

  // ============================================================================
  // KPIs PRINCIPAUX
  // ============================================================================

  const mainKPIs = useMemo(() => {
    const totalMissions = periodMissions.length;
    const completedMissions = periodMissions.filter(m => m.status === MissionStatus.COMPLETED).length;
    const inProgress = periodMissions.filter(m => m.status === MissionStatus.IN_PROGRESS).length;
    
    // Colis comptés sur les VRAIS colis de la période (importés/livrés),
    // pas seulement ceux rattachés à une mission → le tableau reflète l'activité
    // même sans tournée créée (ex : colis importés du jour, en attente).
    const totalPkgs = periodPackages.length;
    const deliveredPkgs = periodPackages.filter(p => p.status === PackageStatus.DELIVERED).length;
    const failedPkgs = periodPackages.filter(p => p.status === PackageStatus.FAILED || p.status === PackageStatus.RETURNED).length;

    const deliveryRate = totalPkgs > 0 ? Math.round((deliveredPkgs / totalPkgs) * 100) : 0;
    
    const totalDistance = periodMissions.reduce((acc, m) => acc + (m.totalDistance || 0), 0);
    const totalDuration = periodMissions.reduce((acc, m) => acc + (m.estimatedDuration || 0), 0);
    
    // Temps moyen par livraison (en minutes)
    const avgTimePerDelivery = deliveredPkgs > 0 ? Math.round(totalDuration / deliveredPkgs) : 0;

    // Comparaison veille (pour les flèches)
    const yesterday = new Date(selectedDate);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    const yesterdayMissions = missions.filter(m => m.date === yesterdayStr);
    const yesterdayPkgs = yesterdayMissions.reduce((acc, m) => acc + (m.totalPackages || 0), 0);
    const yesterdayDelivered = yesterdayMissions.reduce((acc, m) => acc + (m.deliveredPackages || 0), 0);
    const yesterdayRate = yesterdayPkgs > 0 ? Math.round((yesterdayDelivered / yesterdayPkgs) * 100) : 0;
    
    const rateDelta = period === 'today' ? deliveryRate - yesterdayRate : 0;

    return {
      totalMissions, completedMissions, inProgress,
      totalPkgs, deliveredPkgs, failedPkgs,
      deliveryRate, rateDelta,
      totalDistance: Math.round(totalDistance),
      avgTimePerDelivery
    };
  }, [periodMissions, periodPackages, missions, selectedDate, period]);

  // ============================================================================
  // PERFORMANCE PAR CHAUFFEUR
  // ============================================================================

  const driverPerformance = useMemo(() => {
    const driverMap = new Map<string, {
      name: string;
      missions: number;
      delivered: number;
      failed: number;
      total: number;
      distance: number;
    }>();

    for (const m of periodMissions) {
      if (!m.driverId) continue;
      const existing = driverMap.get(m.driverId) || {
        name: m.driverName || 'Inconnu',
        missions: 0, delivered: 0, failed: 0, total: 0, distance: 0
      };
      
      existing.missions++;
      existing.delivered += m.deliveredPackages || 0;
      existing.failed += m.failedPackages || 0;
      existing.total += m.totalPackages || 0;
      existing.distance += m.totalDistance || 0;
      
      driverMap.set(m.driverId, existing);
    }

    return Array.from(driverMap.values())
      .map(d => ({
        ...d,
        rate: d.total > 0 ? Math.round((d.delivered / d.total) * 100) : 0,
        distance: Math.round(d.distance)
      }))
      .sort((a, b) => b.delivered - a.delivered);
  }, [periodMissions]);

  // ============================================================================
  // PERFORMANCE PAR ZONE
  // ============================================================================

  const zonePerformance = useMemo(() => 
    [Zone.NORD, Zone.SUD, Zone.EST, Zone.OUEST].map(zone => {
      const zoneMissions = periodMissions.filter(m => m.zone === zone);
      const delivered = zoneMissions.reduce((acc, m) => acc + (m.deliveredPackages || 0), 0);
      const failed = zoneMissions.reduce((acc, m) => acc + (m.failedPackages || 0), 0);
      const total = zoneMissions.reduce((acc, m) => acc + (m.totalPackages || 0), 0);
      const rate = total > 0 ? Math.round((delivered / total) * 100) : 0;
      
      return { zone, missions: zoneMissions.length, delivered, failed, total, rate };
    }).filter(z => z.total > 0),
    [periodMissions]
  );

  // ============================================================================
  // MOTIFS D'ÉCHEC
  // ============================================================================

  const failureReasons = useMemo(() => {
    const reasons: Record<string, number> = {};
    
    for (const pkg of periodPackages) {
      if (pkg.status === PackageStatus.FAILED && pkg.failureReason) {
        reasons[pkg.failureReason] = (reasons[pkg.failureReason] || 0) + 1;
      }
    }

    return Object.entries(reasons)
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count);
  }, [periodPackages]);

  // ============================================================================
  // GRAPHE HISTORIQUE 14 JOURS
  // ============================================================================

  const dailyTrend = useMemo(() => {
    const days: { date: string; label: string; delivered: number; failed: number; total: number; rate: number }[] = [];

    // Basé sur les COLIS (disponibles sur toutes les dates), pas sur les missions
    // (qui ne sont chargées que pour le jour sélectionné). Par jour :
    // total = colis importés ce jour ; delivered/failed = via leurs mouvements.
    const movedOn = (p: Package, day: string, actions: string[]) =>
      (p.movements || []).some(m => actions.includes(m.action) && (m.timestamp || '').startsWith(day));

    for (let i = 13; i >= 0; i--) {
      const d = new Date(selectedDate);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const dayLabel = d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });

      const total = packages.filter(p => (p.createdAt || '').startsWith(dateStr)).length;
      const delivered = packages.filter(p => movedOn(p, dateStr, ['DELIVERED'])).length;
      const failed = packages.filter(p => movedOn(p, dateStr, ['FAILED', 'RETURNED'])).length;
      const rate = total > 0 ? Math.round((delivered / total) * 100) : 0;

      days.push({ date: dateStr, label: dayLabel, delivered, failed, total, rate });
    }

    return days;
  }, [packages, selectedDate]);

  // ============================================================================
  // COULEURS GRAPHIQUES
  // ============================================================================

  const COLORS = {
    delivered: '#22c55e',
    failed: '#ef4444',
    pending: '#94a3b8',
    rate: '#8b5cf6',
    zones: {
      [Zone.NORD]: '#3b82f6',
      [Zone.SUD]: '#f97316',
      [Zone.EST]: '#22c55e',
      [Zone.OUEST]: '#8b5cf6'
    }
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
      {/* Filtre période */}
      <div className="flex items-center gap-2">
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
      </div>

      {/* === KPIs PRINCIPAUX === */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Taux de livraison */}
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
              <TrendingUp size={20} className="text-green-600" />
            </div>
            {period === 'today' && <DeltaIndicator value={mainKPIs.rateDelta} />}
          </div>
          <p className={`text-3xl font-black ${mainKPIs.deliveryRate >= 95 ? 'text-green-600' : mainKPIs.deliveryRate >= 80 ? 'text-amber-600' : 'text-red-600'}`}>
            {mainKPIs.deliveryRate}%
          </p>
          <p className="text-xs text-slate-500 mt-0.5">Taux de livraison</p>
        </div>

        {/* Colis livrés */}
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center mb-2">
            <PackageIcon size={20} className="text-blue-600" />
          </div>
          <p className="text-3xl font-black text-slate-800">{formatNumber(mainKPIs.deliveredPkgs)}</p>
          <p className="text-xs text-slate-500 mt-0.5">
            Livrés / {formatNumber(mainKPIs.totalPkgs)} total
          </p>
        </div>

        {/* Échecs */}
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center mb-2">
            <XCircle size={20} className="text-red-600" />
          </div>
          <p className={`text-3xl font-black ${mainKPIs.failedPkgs > 0 ? 'text-red-600' : 'text-slate-400'}`}>
            {mainKPIs.failedPkgs}
          </p>
          <p className="text-xs text-slate-500 mt-0.5">Échecs livraison</p>
        </div>

        {/* Missions */}
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center mb-2">
            <Truck size={20} className="text-purple-600" />
          </div>
          <p className="text-3xl font-black text-slate-800">{mainKPIs.totalMissions}</p>
          <p className="text-xs text-slate-500 mt-0.5">
            Missions • {mainKPIs.inProgress > 0 ? `${mainKPIs.inProgress} en cours` : `${mainKPIs.completedMissions} terminées`}
          </p>
        </div>
      </div>

      {/* === GRAPHE HISTORIQUE 14 JOURS === */}
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h3 className="text-base font-bold text-slate-800 mb-4">Évolution sur 14 jours</h3>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={dailyTrend} barGap={0} barCategoryGap="20%">
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
              formatter={(value: number, name: string) => [
                value, name === 'delivered' ? 'Livrés' : name === 'failed' ? 'Échecs' : name
              ]}
            />
            <Bar dataKey="delivered" fill={COLORS.delivered} radius={[4, 4, 0, 0]} name="Livrés" />
            <Bar dataKey="failed" fill={COLORS.failed} radius={[4, 4, 0, 0]} name="Échecs" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* === TAUX DE LIVRAISON 14 JOURS (courbe) === */}
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h3 className="text-base font-bold text-slate-800 mb-1">Taux de livraison</h3>
        <p className="text-xs text-slate-400 mb-4">Objectif : 95%</p>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={dailyTrend}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis 
              dataKey="label" 
              tick={{ fontSize: 11, fill: '#94a3b8' }}
              tickLine={false}
            />
            <YAxis 
              domain={[0, 100]}
              tick={{ fontSize: 11, fill: '#94a3b8' }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip 
              contentStyle={{ borderRadius: '12px', border: '1px solid #e2e8f0', fontSize: '12px' }}
              formatter={(value: number) => [`${value}%`, 'Taux']}
            />
            {/* Ligne objectif 95% */}
            <Line 
              type="monotone" 
              dataKey={() => 95} 
              stroke="#e2e8f0" 
              strokeDasharray="5 5" 
              dot={false}
              name="Objectif"
            />
            <Line 
              type="monotone" 
              dataKey="rate" 
              stroke={COLORS.rate}
              strokeWidth={3}
              dot={{ fill: COLORS.rate, r: 4 }}
              activeDot={{ r: 6 }}
              name="Taux"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* === PERFORMANCE PAR CHAUFFEUR === */}
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h3 className="text-base font-bold text-slate-800 mb-4 flex items-center gap-2">
            <Users size={16} className="text-indigo-600" />
            Performance chauffeurs
          </h3>
          {driverPerformance.length > 0 ? (
            <div className="space-y-3">
              {driverPerformance.map((d, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-600">
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-sm font-medium text-slate-800 truncate">{d.name}</p>
                      <span className={`text-xs font-bold ${d.rate >= 95 ? 'text-green-600' : d.rate >= 80 ? 'text-amber-600' : 'text-red-600'}`}>
                        {d.rate}%
                      </span>
                    </div>
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div 
                        className={`h-full rounded-full transition-all ${d.rate >= 95 ? 'bg-green-500' : d.rate >= 80 ? 'bg-amber-500' : 'bg-red-500'}`}
                        style={{ width: `${d.rate}%` }}
                      />
                    </div>
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      {d.delivered} livrés • {d.failed} échecs • {d.missions} mission{d.missions > 1 ? 's' : ''} • {d.distance} km
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-400 text-center py-6">Aucune donnée pour cette période</p>
          )}
        </div>

        {/* === PERFORMANCE PAR ZONE === */}
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h3 className="text-base font-bold text-slate-800 mb-4 flex items-center gap-2">
            <MapPin size={16} className="text-indigo-600" />
            Performance par zone
          </h3>
          {zonePerformance.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={zonePerformance} layout="vertical" barSize={20}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} />
                  <YAxis 
                    type="category" 
                    dataKey="zone" 
                    tick={{ fontSize: 12, fontWeight: 600, fill: '#475569' }}
                    tickLine={false}
                    axisLine={false}
                    width={50}
                  />
                  <Tooltip 
                    contentStyle={{ borderRadius: '12px', border: '1px solid #e2e8f0', fontSize: '12px' }}
                    formatter={(value: number, name: string) => [
                      value, name === 'delivered' ? 'Livrés' : 'Échecs'
                    ]}
                  />
                  <Bar dataKey="delivered" fill={COLORS.delivered} radius={[0, 4, 4, 0]} name="Livrés" />
                  <Bar dataKey="failed" fill={COLORS.failed} radius={[0, 4, 4, 0]} name="Échecs" />
                </BarChart>
              </ResponsiveContainer>
              <div className="mt-4 space-y-2">
                {zonePerformance.map(z => {
                  const colors = ZONE_COLORS[z.zone];
                  return (
                    <div key={z.zone} className="flex items-center justify-between text-sm">
                      <span className={`px-2 py-0.5 rounded text-xs font-bold ${colors.bg} ${colors.text}`}>{z.zone}</span>
                      <span className="text-slate-600">{z.delivered}/{z.total} colis</span>
                      <span className={`font-bold ${z.rate >= 95 ? 'text-green-600' : z.rate >= 80 ? 'text-amber-600' : 'text-red-600'}`}>
                        {z.rate}%
                      </span>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <p className="text-sm text-slate-400 text-center py-6">Aucune donnée pour cette période</p>
          )}
        </div>
      </div>

      {/* === MOTIFS D'ÉCHEC === */}
      {failureReasons.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h3 className="text-base font-bold text-slate-800 mb-4 flex items-center gap-2">
            <AlertTriangle size={16} className="text-red-500" />
            Motifs d'échec
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={failureReasons}
                  dataKey="count"
                  nameKey="reason"
                  cx="50%"
                  cy="50%"
                  innerRadius={45}
                  outerRadius={80}
                  paddingAngle={3}
                >
                  {failureReasons.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip 
                  contentStyle={{ borderRadius: '12px', border: '1px solid #e2e8f0', fontSize: '12px' }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-2 flex flex-col justify-center">
              {failureReasons.map((r, i) => (
                <div key={r.reason} className="flex items-center gap-3">
                  <div 
                    className="w-3 h-3 rounded-full flex-shrink-0" 
                    style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}
                  />
                  <span className="text-sm text-slate-700 flex-1">{r.reason}</span>
                  <span className="text-sm font-bold text-slate-800">{r.count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* === MÉTRIQUES SECONDAIRES === */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-slate-50 rounded-xl p-4 text-center">
          <p className="text-2xl font-black text-slate-700">{formatNumber(mainKPIs.totalDistance)}</p>
          <p className="text-xs text-slate-500">km parcourus</p>
        </div>
        <div className="bg-slate-50 rounded-xl p-4 text-center">
          <p className="text-2xl font-black text-slate-700">{mainKPIs.avgTimePerDelivery}</p>
          <p className="text-xs text-slate-500">min/livraison (moy.)</p>
        </div>
        <div className="bg-slate-50 rounded-xl p-4 text-center">
          <p className="text-2xl font-black text-slate-700">{driverPerformance.length}</p>
          <p className="text-xs text-slate-500">chauffeurs actifs</p>
        </div>
        <div className="bg-slate-50 rounded-xl p-4 text-center">
          <p className="text-2xl font-black text-slate-700">
            {mainKPIs.totalMissions > 0 
              ? Math.round(mainKPIs.totalPkgs / mainKPIs.totalMissions) 
              : 0}
          </p>
          <p className="text-xs text-slate-500">colis/mission (moy.)</p>
        </div>
      </div>
    </div>
  );
};

export default MissionKPIs;
