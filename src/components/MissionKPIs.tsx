/**
 * MISSION KPIs — Tableau de bord Direction
 *
 * Vue complète pour le président / directeur d'exploitation :
 * - Vue d'ensemble (taux de livraison, livrés, échecs, missions) — cartes cliquables
 * - Pipeline colis (en attente → au hub → triés → en livraison → livrés) — cliquable
 * - Tendances (14 jours : volumes + taux)
 * - Performance par chauffeur / par zone
 * - Motifs d'échec
 *
 * Les cartes chiffrées sont cliquables : un clic ouvre l'onglet « Colis »
 * pré-filtré sur le statut correspondant (drill-down).
 */

import React, { useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line
} from 'recharts';
import {
  TrendingUp, Package as PackageIcon, Truck,
  XCircle, Clock, MapPin, Users, AlertTriangle,
  ArrowUp, ArrowDown, Minus, ChevronRight, Hourglass,
  Warehouse, Layers, Navigation, CheckCircle2
} from 'lucide-react';
import {
  Mission, MissionStatus, Package, PackageStatus, Zone, ZONE_COLORS,
  User
} from '../types';

// ============================================================================
// TYPES
// ============================================================================

type Period = 'today' | 'week' | 'month';
type DrillStatus = PackageStatus | 'all' | 'failed';

interface MissionKPIsProps {
  missions: Mission[];
  packages: Package[];
  users: User[];
  selectedDate: string;
  /** Ouvre l'onglet Colis pré-filtré sur un statut. */
  onDrillDown?: (status: DrillStatus, scope: 'today' | 'all') => void;
  /** Ouvre l'onglet Missions. */
  onOpenMissions?: () => void;
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

const MissionKPIs: React.FC<MissionKPIsProps> = ({
  missions, packages, users, selectedDate, onDrillDown, onOpenMissions
}) => {
  const [period, setPeriod] = useState<Period>('today');

  const dateRange = useMemo(() => getDateRange(selectedDate, period), [selectedDate, period]);
  const scope: 'today' | 'all' = period === 'today' ? 'today' : 'all';

  const drill = (status: DrillStatus) => onDrillDown?.(status, scope);

  // Missions de la période
  const periodMissions = useMemo(() =>
    missions.filter(m => isInRange(m.date, dateRange.start, dateRange.end)),
    [missions, dateRange]
  );

  // Packages de la période (via createdAt ou updatedAt)
  const periodPackages = useMemo(() =>
    packages.filter(p =>
      isInRange(p.createdAt.split('T')[0], dateRange.start, dateRange.end) ||
      (p.updatedAt && isInRange(p.updatedAt.split('T')[0], dateRange.start, dateRange.end))
    ),
    [packages, dateRange]
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

    // Comparaison veille (pour les flèches) — MÊME source que le taux du jour :
    // statuts réels des colis (pas les compteurs de missions).
    const yesterday = new Date(selectedDate);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    const yesterdayPackages = packages.filter(p =>
      isInRange(p.createdAt.split('T')[0], yesterdayStr, yesterdayStr) ||
      (p.updatedAt && isInRange(p.updatedAt.split('T')[0], yesterdayStr, yesterdayStr))
    );
    const yesterdayPkgs = yesterdayPackages.length;
    const yesterdayDelivered = yesterdayPackages.filter(p => p.status === PackageStatus.DELIVERED).length;
    const yesterdayRate = yesterdayPkgs > 0 ? Math.round((yesterdayDelivered / yesterdayPkgs) * 100) : 0;

    const rateDelta = period === 'today' ? deliveryRate - yesterdayRate : 0;

    return {
      totalMissions, completedMissions, inProgress,
      totalPkgs, deliveredPkgs, failedPkgs,
      deliveryRate, rateDelta,
      totalDistance: Math.round(totalDistance),
      avgTimePerDelivery
    };
  }, [periodMissions, periodPackages, packages, selectedDate, period]);

  // ============================================================================
  // PIPELINE COLIS (funnel opérationnel)
  // ============================================================================

  const pipeline = useMemo(() => {
    const count = (s: PackageStatus) => periodPackages.filter(p => p.status === s).length;
    const pending = count(PackageStatus.PENDING);
    const atHub = count(PackageStatus.AT_HUB);
    const sorted = count(PackageStatus.SORTED);
    const inDelivery = count(PackageStatus.IN_DELIVERY);
    const delivered = count(PackageStatus.DELIVERED);
    return {
      pending, atHub, sorted, inDelivery, delivered,
      remaining: pending + atHub + sorted + inDelivery
    };
  }, [periodPackages]);

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

    // Résolution du nom : prop users → dernier mouvement du colis → 'Inconnu'
    const usersById = new Map(users.map(u => [u.id, `${u.firstName} ${u.lastName}`.trim()]));
    const resolveDriverName = (driverId: string, p: Package): string => {
      const fromUsers = usersById.get(driverId);
      if (fromUsers) return fromUsers;
      const movName = (p.movements || [])
        .filter(mv => mv.driverName)
        .slice(-1)[0]?.driverName;
      return movName || 'Inconnu';
    };

    const ensure = (driverId: string, name: string) => {
      const existing = driverMap.get(driverId) || {
        name, missions: 0, delivered: 0, failed: 0, total: 0, distance: 0
      };
      driverMap.set(driverId, existing);
      return existing;
    };

    // Agrégation par CHAUFFEUR à partir des VRAIS colis de la période
    // (source de vérité unique = statuts colis, via currentDriverId).
    for (const p of periodPackages) {
      if (!p.currentDriverId) continue;
      const entry = ensure(p.currentDriverId, resolveDriverName(p.currentDriverId, p));
      entry.total++;
      if (p.status === PackageStatus.DELIVERED) entry.delivered++;
      else if (p.status === PackageStatus.FAILED || p.status === PackageStatus.RETURNED) entry.failed++;
    }

    // Nombre de missions et km : basés sur periodMissions (compteur de tournées,
    // pas de colis) — n'affecte pas les taux de livraison.
    for (const m of periodMissions) {
      if (!m.driverId) continue;
      const entry = driverMap.has(m.driverId)
        ? driverMap.get(m.driverId)!
        : ensure(m.driverId, m.driverName || usersById.get(m.driverId) || 'Inconnu');
      entry.missions++;
      entry.distance += m.totalDistance || 0;
    }

    return Array.from(driverMap.values())
      .map(d => ({
        ...d,
        rate: d.total > 0 ? Math.round((d.delivered / d.total) * 100) : 0,
        distance: Math.round(d.distance)
      }))
      .sort((a, b) => b.delivered - a.delivered);
  }, [periodPackages, periodMissions, users]);

  // ============================================================================
  // PERFORMANCE PAR ZONE
  // ============================================================================

  const zonePerformance = useMemo(() =>
    [Zone.NORD, Zone.SUD, Zone.EST, Zone.OUEST].map(zone => {
      // Source de vérité unique = statuts colis (p.zone / p.status)
      const zonePkgs = periodPackages.filter(p => p.zone === zone);
      const total = zonePkgs.length;
      const delivered = zonePkgs.filter(p => p.status === PackageStatus.DELIVERED).length;
      const failed = zonePkgs.filter(p => p.status === PackageStatus.FAILED || p.status === PackageStatus.RETURNED).length;
      const rate = total > 0 ? Math.round((delivered / total) * 100) : 0;
      const missions = periodMissions.filter(m => m.zone === zone).length;

      return { zone, missions, delivered, failed, total, rate };
    }).filter(z => z.total > 0),
    [periodPackages, periodMissions]
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
      // delivered (mouvement DELIVERED ce jour) et total (colis créés ce jour)
      // ne coïncident pas → on borne le taux affiché à 100 %.
      const rate = total > 0 ? Math.min(100, Math.round((delivered / total) * 100)) : 0;

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
    rate: '#8b5cf6'
  };

  const PIE_COLORS = ['#ef4444', '#f97316', '#eab308', '#3b82f6', '#8b5cf6', '#6b7280'];

  const periodLabel = period === 'today' ? "aujourd'hui" : period === 'week' ? 'cette semaine' : 'ce mois';

  // ============================================================================
  // SOUS-COMPOSANTS DE RENDU
  // ============================================================================

  const DeltaIndicator = ({ value }: { value: number }) => {
    if (value === 0) return <span className="text-xs text-slate-400 flex items-center gap-0.5"><Minus size={10} /> =</span>;
    if (value > 0) return <span className="text-xs text-green-600 flex items-center gap-0.5"><ArrowUp size={10} /> +{value}%</span>;
    return <span className="text-xs text-red-600 flex items-center gap-0.5"><ArrowDown size={10} /> {value}%</span>;
  };

  // Carte KPI cliquable (drill-down). onClick optionnel → sinon carte statique.
  const StatCard = ({
    icon, iconBg, iconColor, value, label, valueColor = 'text-slate-800',
    onClick, hint
  }: {
    icon: React.ReactNode;
    iconBg: string;
    iconColor: string;
    value: React.ReactNode;
    label: string;
    valueColor?: string;
    onClick?: () => void;
    hint?: string;
  }) => {
    const clickable = !!onClick;
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={!clickable}
        className={`group text-left bg-white rounded-xl border border-slate-200 p-4 transition-all ${
          clickable ? 'hover:border-brand-300 hover:shadow-md cursor-pointer' : 'cursor-default'
        }`}
      >
        <div className="flex items-center justify-between mb-2">
          <div className={`w-10 h-10 ${iconBg} rounded-lg flex items-center justify-center`}>
            <span className={iconColor}>{icon}</span>
          </div>
          {clickable && (
            <ChevronRight size={16} className="text-slate-300 group-hover:text-brand-500 transition-colors" />
          )}
        </div>
        <p className={`text-3xl font-black ${valueColor}`}>{value}</p>
        <p className="text-xs text-slate-500 mt-0.5">{label}</p>
        {hint && <p className="text-[10px] text-slate-400 mt-0.5">{hint}</p>}
      </button>
    );
  };

  // Carte compacte du pipeline (funnel).
  const PipelineCard = ({
    icon, count, label, color, onClick
  }: {
    icon: React.ReactNode;
    count: number;
    label: string;
    color: string;
    onClick?: () => void;
  }) => (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`group flex flex-col gap-1 rounded-xl border border-slate-200 bg-white p-3 text-left transition-all ${
        onClick ? 'hover:border-brand-300 hover:shadow-md cursor-pointer' : 'cursor-default'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className={color}>{icon}</span>
        <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">{label}</span>
      </div>
      <span className="text-2xl font-black text-slate-800">{formatNumber(count)}</span>
    </button>
  );

  const SectionTitle = ({ children }: { children: React.ReactNode }) => (
    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">{children}</h3>
  );

  // ============================================================================
  // RENDER
  // ============================================================================

  return (
    <div className="space-y-8">
      {/* En-tête : filtre période + aide */}
      <div className="flex items-center justify-between flex-wrap gap-3">
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
        {onDrillDown && (
          <p className="text-xs text-slate-400 flex items-center gap-1">
            <ChevronRight size={12} /> Cliquez sur une carte pour voir les colis
          </p>
        )}
      </div>

      {/* ================= VUE D'ENSEMBLE ================= */}
      <section className="space-y-3">
        <SectionTitle>Vue d'ensemble — {periodLabel}</SectionTitle>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {/* Taux de livraison (hero, non filtrable) */}
          <div className="bg-gradient-to-br from-indigo-600 to-violet-600 rounded-xl p-4 text-white shadow-lg shadow-indigo-200">
            <div className="flex items-center justify-between mb-2">
              <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center">
                <TrendingUp size={20} className="text-white" />
              </div>
              {period === 'today' && (
                <span className="bg-white/15 rounded-full px-2 py-0.5">
                  <DeltaIndicator value={mainKPIs.rateDelta} />
                </span>
              )}
            </div>
            <p className="text-3xl font-black">{mainKPIs.deliveryRate}%</p>
            <p className="text-xs text-white/80 mt-0.5">Taux de livraison</p>
          </div>

          {/* Livrés → drill DELIVERED */}
          <StatCard
            icon={<PackageIcon size={20} />}
            iconBg="bg-green-100"
            iconColor="text-green-600"
            value={formatNumber(mainKPIs.deliveredPkgs)}
            valueColor="text-green-600"
            label="Colis livrés"
            hint={`sur ${formatNumber(mainKPIs.totalPkgs)} au total`}
            onClick={onDrillDown ? () => drill(PackageStatus.DELIVERED) : undefined}
          />

          {/* Échecs → drill failed */}
          <StatCard
            icon={<XCircle size={20} />}
            iconBg="bg-red-100"
            iconColor="text-red-600"
            value={mainKPIs.failedPkgs}
            valueColor={mainKPIs.failedPkgs > 0 ? 'text-red-600' : 'text-slate-400'}
            label="Échecs + retours"
            onClick={onDrillDown ? () => drill('failed') : undefined}
          />

          {/* Missions → onglet Missions */}
          <StatCard
            icon={<Truck size={20} />}
            iconBg="bg-purple-100"
            iconColor="text-purple-600"
            value={mainKPIs.totalMissions}
            label="Missions"
            hint={mainKPIs.inProgress > 0 ? `${mainKPIs.inProgress} en cours` : `${mainKPIs.completedMissions} terminées`}
            onClick={onOpenMissions}
          />
        </div>
      </section>

      {/* ================= PIPELINE COLIS ================= */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <SectionTitle>Pipeline colis</SectionTitle>
          <span className="text-xs text-slate-400">
            {formatNumber(pipeline.remaining)} colis restant à livrer
          </span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <PipelineCard
            icon={<Hourglass size={16} />}
            color="text-slate-500"
            count={pipeline.pending}
            label="En attente"
            onClick={onDrillDown ? () => drill(PackageStatus.PENDING) : undefined}
          />
          <PipelineCard
            icon={<Warehouse size={16} />}
            color="text-amber-500"
            count={pipeline.atHub}
            label="Au hub"
            onClick={onDrillDown ? () => drill(PackageStatus.AT_HUB) : undefined}
          />
          <PipelineCard
            icon={<Layers size={16} />}
            color="text-blue-500"
            count={pipeline.sorted}
            label="Triés"
            onClick={onDrillDown ? () => drill(PackageStatus.SORTED) : undefined}
          />
          <PipelineCard
            icon={<Navigation size={16} />}
            color="text-indigo-500"
            count={pipeline.inDelivery}
            label="En livraison"
            onClick={onDrillDown ? () => drill(PackageStatus.IN_DELIVERY) : undefined}
          />
          <PipelineCard
            icon={<CheckCircle2 size={16} />}
            color="text-green-500"
            count={pipeline.delivered}
            label="Livrés"
            onClick={onDrillDown ? () => drill(PackageStatus.DELIVERED) : undefined}
          />
        </div>
      </section>

      {/* ================= TENDANCES ================= */}
      <section className="space-y-3">
        <SectionTitle>Tendances — 14 derniers jours</SectionTitle>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {/* Volumes */}
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h4 className="text-sm font-bold text-slate-800 mb-4">Volumes (livrés / échecs)</h4>
            <ResponsiveContainer width="100%" height={240}>
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

          {/* Taux */}
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <div className="flex items-baseline justify-between mb-4">
              <h4 className="text-sm font-bold text-slate-800">Taux de livraison</h4>
              <span className="text-xs text-slate-400">Objectif : 95 %</span>
            </div>
            <ResponsiveContainer width="100%" height={240}>
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
        </div>
      </section>

      {/* ================= PERFORMANCE ================= */}
      <section className="space-y-3">
        <SectionTitle>Performance</SectionTitle>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* PAR CHAUFFEUR */}
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h4 className="text-base font-bold text-slate-800 mb-4 flex items-center gap-2">
              <Users size={16} className="text-indigo-600" />
              Chauffeurs
            </h4>
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

          {/* PAR ZONE */}
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h4 className="text-base font-bold text-slate-800 mb-4 flex items-center gap-2">
              <MapPin size={16} className="text-indigo-600" />
              Zones
            </h4>
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
      </section>

      {/* ================= MOTIFS D'ÉCHEC ================= */}
      {failureReasons.length > 0 && (
        <section className="space-y-3">
          <SectionTitle>Analyse des échecs</SectionTitle>
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h4 className="text-base font-bold text-slate-800 mb-4 flex items-center gap-2">
              <AlertTriangle size={16} className="text-red-500" />
              Motifs d'échec
            </h4>
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
        </section>
      )}

      {/* ================= MÉTRIQUES SECONDAIRES ================= */}
      <section className="space-y-3">
        <SectionTitle>Indicateurs complémentaires</SectionTitle>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-slate-50 rounded-xl p-4 text-center">
            <p className="text-2xl font-black text-slate-700">{formatNumber(mainKPIs.totalDistance)}</p>
            <p className="text-xs text-slate-500">km parcourus</p>
          </div>
          <div className="bg-slate-50 rounded-xl p-4 text-center">
            <div className="flex items-center justify-center gap-1 text-slate-700">
              <Clock size={16} className="text-slate-400" />
              <p className="text-2xl font-black">{mainKPIs.avgTimePerDelivery}</p>
            </div>
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
      </section>
    </div>
  );
};

export default MissionKPIs;
