/**
 * VUE DE DIEU — Cockpit opérationnel (président / direction)
 *
 * Vue temps réel, LECTURE SEULE, qui agrège l'activité du jour :
 * - KPIs livraison du jour (à livrer / livrés / en cours / échecs / taux)
 * - Tournées actives avec progression + chauffeur + véhicule
 * - Alertes : colis bloqués « En livraison » anormalement longs
 *
 * N'écrit rien : agrège les colis et missions abonnés en direct.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Package, Mission, PackageStatus, MissionStatus, StopStatus } from '../types';
import { subscribeToPackages, subscribeToMissions } from '../services/missionService';
import { Truck, PackageCheck, Clock, AlertTriangle, TrendingUp, MapPin, Users } from 'lucide-react';

const isToday = (iso?: string): boolean => {
  if (!iso) return false;
  const d = new Date(iso);
  return !isNaN(d.getTime()) && d.toDateString() === new Date().toDateString();
};

const lastMovement = (p: Package) => (p.movements || [])[(p.movements || []).length - 1];

const hoursSince = (iso?: string): number => {
  if (!iso) return 0;
  return (Date.now() - new Date(iso).getTime()) / 3_600_000;
};

const StatCard: React.FC<{ icon: React.ElementType; label: string; value: React.ReactNode; tone?: string; sub?: string }> = ({ icon: Icon, label, value, tone = 'text-slate-900', sub }) => (
  <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
    <div className="flex items-center gap-2 text-slate-400 mb-1"><Icon size={15} /><span className="text-[11px] font-bold uppercase tracking-wide">{label}</span></div>
    <div className={`text-2xl font-extrabold ${tone}`}>{value}</div>
    {sub && <div className="text-[11px] text-slate-400 mt-0.5">{sub}</div>}
  </div>
);

const PresidentOverview: React.FC = () => {
  const [packages, setPackages] = useState<Package[]>([]);
  const [missions, setMissions] = useState<Mission[]>([]);

  useEffect(() => {
    const unsubP = subscribeToPackages(setPackages);
    const unsubM = subscribeToMissions(setMissions);
    return () => { unsubP && unsubP(); unsubM && unsubM(); };
  }, []);

  const kpi = useMemo(() => {
    const deliveredToday = packages.filter(p => p.status === PackageStatus.DELIVERED && isToday(lastMovement(p)?.timestamp));
    const inDelivery = packages.filter(p => p.status === PackageStatus.IN_DELIVERY);
    const failedToday = packages.filter(p => (p.status === PackageStatus.FAILED || p.status === PackageStatus.RETURNED) && isToday(lastMovement(p)?.timestamp));
    const denom = deliveredToday.length + inDelivery.length + failedToday.length;
    const rate = denom > 0 ? Math.round((deliveredToday.length / denom) * 100) : 0;
    // Colis « En livraison » depuis > 3 h = potentiellement bloqués
    const stuck = inDelivery
      .filter(p => hoursSince(p.updatedAt) > 3)
      .sort((a, b) => hoursSince(b.updatedAt) - hoursSince(a.updatedAt));
    return { deliveredToday, inDelivery, failedToday, rate, stuck };
  }, [packages]);

  const activeTours = useMemo(() => {
    return missions
      .filter(m => m.status === MissionStatus.IN_PROGRESS)
      .map(m => {
        const stops = m.stops || [];
        const done = stops.filter(s => s.status === StopStatus.COMPLETED || s.status === StopStatus.FAILED || s.status === StopStatus.SKIPPED).length;
        return { m, done, total: stops.length, pct: stops.length ? Math.round((done / stops.length) * 100) : 0 };
      })
      .sort((a, b) => a.pct - b.pct);
  }, [missions]);

  const activeDrivers = new Set(activeTours.map(t => t.m.driverId).filter(Boolean)).size;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-slate-900 flex items-center gap-2">👁️ Vue de dieu</h1>
        <p className="text-sm text-slate-500">Cockpit opérationnel du jour — temps réel, lecture seule</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard icon={PackageCheck} label="Livrés aujourd'hui" value={kpi.deliveredToday.length} tone="text-green-600" />
        <StatCard icon={Truck} label="En livraison" value={kpi.inDelivery.length} tone="text-orange-600" />
        <StatCard icon={AlertTriangle} label="Échecs du jour" value={kpi.failedToday.length} tone="text-red-600" />
        <StatCard icon={TrendingUp} label="Taux du jour" value={`${kpi.rate}%`} tone={kpi.rate >= 90 ? 'text-green-600' : kpi.rate >= 70 ? 'text-amber-600' : 'text-red-600'} />
        <StatCard icon={Users} label="Chauffeurs en tournée" value={activeDrivers} tone="text-indigo-600" sub={`${activeTours.length} tournée(s) active(s)`} />
      </div>

      {/* Alertes colis bloqués */}
      {kpi.stuck.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4">
          <div className="flex items-center gap-2 text-red-700 font-bold mb-2"><AlertTriangle size={16} /> {kpi.stuck.length} colis « En livraison » depuis plus de 3 h (potentiellement bloqués)</div>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {kpi.stuck.slice(0, 15).map(p => (
              <div key={p.id} className="text-xs text-red-800 flex justify-between gap-2 bg-white/60 rounded-lg px-2 py-1">
                <span className="truncate">{p.orderNumber} · {p.contactName} · {p.city}</span>
                <span className="font-bold whitespace-nowrap">{Math.round(hoursSince(p.updatedAt))} h</span>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-red-600 mt-2">Astuce : outil « Resynchroniser les statuts » dans Missions si l'arrêt est déjà terminé.</p>
        </div>
      )}

      {/* Tournées actives */}
      <div>
        <h2 className="text-sm font-bold text-slate-700 mb-2 flex items-center gap-2"><MapPin size={16} /> Tournées en cours</h2>
        {activeTours.length === 0 ? (
          <p className="text-sm text-slate-400 bg-white border border-slate-200 rounded-2xl p-6 text-center">Aucune tournée en cours actuellement.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {activeTours.map(({ m, done, total, pct }) => (
              <div key={m.id} className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-slate-800 truncate">{m.driverName || 'Chauffeur ?'}</span>
                  <span className="text-xs font-mono text-slate-500">{m.vehiclePlate || '—'}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className={`h-2 rounded-full ${pct >= 100 ? 'bg-green-500' : 'bg-indigo-500'}`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs font-bold text-slate-600 whitespace-nowrap">{done}/{total} stops</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default PresidentOverview;
