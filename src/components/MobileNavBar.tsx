import React from 'react';
import { LayoutDashboard, Truck, AlertCircle, Menu, Wrench, Route, Package, ScanLine, HelpCircle } from 'lucide-react';
import { ViewState, UserRole } from '../types';
import { normalizeRole } from '../utils/role';
import { usePermissions, Permission } from '../usePermissions';

interface MobileNavBarProps {
  currentView: ViewState;
  role: UserRole;
  onChangeView: (view: ViewState) => void;
  onOpenMenu: () => void;
  onScan?: () => void;
}
export default function MobileNavBar({ currentView, role, onChangeView, onOpenMenu, onScan }: MobileNavBarProps) {
  const { hasPermission } = usePermissions();
  const driver = normalizeRole(role) === UserRole.DRIVER;
  const entries: { id: ViewState | 'scan'; label: string; icon: React.ElementType }[] = driver ? [
    { id: 'dashboard', label: 'Accueil', icon: LayoutDashboard },
    { id: 'driver_tour', label: 'Ma tournée', icon: Route },
    { id: 'scan', label: 'Scanner', icon: ScanLine },
    { id: 'help', label: 'Aide', icon: HelpCircle },
  ] : [
    ...(hasPermission(Permission.DASHBOARD_VIEW) ? [{ id: 'dashboard' as const, label: 'Accueil', icon: LayoutDashboard }] : []),
    ...(hasPermission(Permission.MISSIONS_VIEW) ? [{ id: 'missions' as const, label: 'Tournées', icon: Route }, { id: 'hub_operations' as const, label: 'Hub', icon: Package }] : []),
    ...(hasPermission(Permission.VEHICLES_VIEW) ? [{ id: 'vehicles' as const, label: 'Véhicules', icon: Truck }] : []),
    ...(hasPermission(Permission.MAINTENANCE_VIEW) ? [{ id: 'maintenance' as const, label: 'Atelier', icon: Wrench }] : [{ id: 'issues' as const, label: 'Incidents', icon: AlertCircle }]),
  ].slice(0, 4);
  return <nav aria-label="Raccourcis métier" className="fixed bottom-0 inset-x-0 z-40 lg:hidden bg-white border-t border-slate-200 px-1 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] shadow-sm">
    <div className="flex items-stretch">
      {entries.map(({ id, label, icon: Icon }) => <button key={id} type="button" aria-current={currentView === id ? 'page' : undefined} onClick={() => id === 'scan' ? onScan?.() : onChangeView(id)} className={`min-h-16 min-w-0 flex-1 flex flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-xs font-semibold ${currentView === id ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100'}`}>
        <Icon aria-hidden="true" size={22}/><span>{label}</span>
      </button>)}
      <button type="button" onClick={onOpenMenu} className="min-h-16 min-w-0 flex-1 flex flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100"><Menu aria-hidden="true" size={22}/><span>Menu</span></button>
    </div>
  </nav>;
}
