
import React, { useState, useMemo } from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  PieChart, Pie, Cell, ComposedChart, Line 
} from 'recharts';
import { 
  AlertTriangle, TrendingUp, TrendingDown, Activity, Wrench, CheckCircle2, 
  Droplet, ChevronRight, ChevronLeft, User as UserIcon, Truck, Filter,
  ArrowUpRight, Calendar, FileSignature, AlertOctagon, Users, Clock,
  ShieldAlert, CreditCard, CalendarDays, Heart, BadgeCheck,
  AlertCircle, CheckSquare, XCircle, PlayCircle, Gauge, Fuel,
  Route, Calculator, Trophy, Award, Target, TrendingDown as TrendDown, Wallet
} from 'lucide-react';
import { Vehicle, VehicleStatus, FuelLog, MaintenanceLog, User, UserRole, ViewState, QuoteRequest, Issue, IssueStatus, LeaveRequest, LeaveStatus, Absence, AbsenceStatus, AbsenceType } from '../types';
import Modal from './shared/Modal';
import { usePermissions, Permission } from '../usePermissions';

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

interface DashboardProps {
  vehicles: Vehicle[];
  logs: FuelLog[];
  maintenanceLogs: MaintenanceLog[];
  issues: Issue[];
  quotes?: QuoteRequest[];
  leaves?: LeaveRequest[];
  absences?: Absence[];  // Nouveau: pour compter les congés en attente
  currentUser: User;
  users: User[];
  pendingDocuments?: number;
  onNavigate: (view: ViewState) => void;
}

interface AlertItem {
  type: 'danger' | 'warning';
  icon: React.ReactNode;
  label: string;
  count: number;
  onClick: () => void;
}

// ============================================================================
// HELPERS
// ============================================================================

const normalizeRole = (role: string | UserRole): UserRole => {
  const r = String(role).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (r.includes('admin')) return UserRole.ADMIN;
  if (r.includes('presiden')) return UserRole.PRESIDENT;
  if (r.includes('direction') || r.includes('directeur')) return UserRole.DIRECTOR;
  if (r.includes('secret')) return UserRole.SECRETARY;
  if (r.includes('chauff') || r.includes('driver')) return UserRole.DRIVER;
  if (r.includes('mecan') || r.includes('mech')) return UserRole.MECHANIC;
  if (r.includes('client')) return UserRole.CLIENT;
  if (r.includes('stag') || r.includes('intern')) return UserRole.INTERN;
  return role as UserRole;
};

const getEffectiveStatus = (v: Vehicle, allIssues: Issue[], allMaint: MaintenanceLog[]): VehicleStatus => {
  const hasActiveMaintenance = allMaint.some(m => m.vehicleId === v.id && m.status === 'Pending');
  if (hasActiveMaintenance) return VehicleStatus.MAINTENANCE;
  const activeIssue = allIssues.find(i => i.vehicleId === v.id && i.status !== IssueStatus.RESOLVED);
  if (activeIssue) {
    if (activeIssue.status === IssueStatus.IN_PROGRESS) return VehicleStatus.MAINTENANCE;
    return VehicleStatus.ISSUE;
  }
  if (v.status === VehicleStatus.MAINTENANCE) return VehicleStatus.MAINTENANCE;
  if (v.status === VehicleStatus.ISSUE) return VehicleStatus.ISSUE;
  return VehicleStatus.ACTIVE;
};

const calculateRealDistance = (logs: FuelLog[], targetMonth: number, targetYear: number) => {
  const relevantLogs = [...logs].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const vehicleLastMileage = new Map<string, number>();
  let totalDistance = 0;

  for (const log of relevantLogs) {
    const logDate = new Date(log.date);
    const prevMileage = vehicleLastMileage.get(log.vehicleId);
    vehicleLastMileage.set(log.vehicleId, log.mileage);

    if (prevMileage !== undefined && log.mileage > prevMileage) {
      const distance = log.mileage - prevMileage;
      if (logDate.getMonth() === targetMonth && logDate.getFullYear() === targetYear) {
        totalDistance += distance;
      }
    }
  }
  return totalDistance;
};

const daysUntil = (dateStr: string | undefined): number => {
  if (!dateStr) return 999;
  const target = new Date(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
};

const isExpired = (dateStr: string | undefined): boolean => daysUntil(dateStr) < 0;
const isExpiringSoon = (dateStr: string | undefined, days: number): boolean => {
  const d = daysUntil(dateStr);
  return d >= 0 && d <= days;
};

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

const STATUS_COLORS: Record<string, string> = {
  'En Service': '#10b981',
  'Maintenance': '#f97316',
  'Problème': '#ef4444',
  'Disponible': '#94a3b8'
};

// --- KPI Card ---
interface KpiCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
  trend?: { value: number; inverse?: boolean };
  onClick?: () => void;
  color?: 'blue' | 'green' | 'orange' | 'red' | 'purple' | 'slate';
}

const KpiCard: React.FC<KpiCardProps> = ({ title, value, subtitle, icon, trend, onClick, color = 'blue' }) => {
  const colorClasses = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-emerald-50 text-emerald-600',
    orange: 'bg-orange-50 text-orange-600',
    red: 'bg-red-50 text-red-600',
    purple: 'bg-purple-50 text-purple-600',
    slate: 'bg-slate-100 text-slate-600'
  };

  return (
    <div 
      onClick={onClick}
      className={`bg-white p-5 rounded-2xl shadow-sm border border-slate-100 relative overflow-hidden group ${onClick ? 'cursor-pointer hover:shadow-md hover:border-brand-200 transition-all' : ''}`}
    >
      {onClick && (
        <div className="absolute top-0 right-0 bg-brand-50 p-2 rounded-bl-xl opacity-0 group-hover:opacity-100 transition-opacity z-10">
          <ArrowUpRight size={16} className="text-brand-600" />
        </div>
      )}
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">{title}</p>
          <p className="text-2xl font-extrabold text-slate-800">{value}</p>
          {subtitle && <p className="text-sm text-slate-500 mt-1">{subtitle}</p>}
          {trend && (
            <div className={`mt-2 flex items-center text-xs font-medium ${
              (trend.inverse ? trend.value < 0 : trend.value > 0) ? 'text-emerald-600' : 'text-red-500'
            }`}>
              {trend.value > 0 ? <TrendingUp size={14} className="mr-1"/> : <TrendingDown size={14} className="mr-1"/>}
              <span>{Math.abs(trend.value).toFixed(1)}% vs M-1</span>
            </div>
          )}
        </div>
        <div className={`p-3 rounded-xl ${colorClasses[color]}`}>
          {icon}
        </div>
      </div>
    </div>
  );
};

// --- Alert Banner ---
interface AlertBannerProps {
  alerts: AlertItem[];
}

const AlertBanner: React.FC<AlertBannerProps> = ({ alerts }) => {
  const criticalAlerts = alerts.filter(a => a.count > 0);
  if (criticalAlerts.length === 0) return null;

  return (
    <div className="bg-gradient-to-r from-red-600 to-red-700 rounded-2xl p-4 shadow-lg mb-6">
      <div className="flex items-center gap-2 mb-3">
        <AlertOctagon className="text-white" size={20} />
        <span className="text-white font-bold">Alertes critiques</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {criticalAlerts.map((alert, idx) => (
          <button
            key={idx}
            onClick={alert.onClick}
            className={`flex items-center gap-2 px-3 py-2 rounded-xl font-bold text-sm transition-all hover:scale-105 ${
              alert.type === 'danger' 
                ? 'bg-white/20 text-white hover:bg-white/30' 
                : 'bg-orange-500/30 text-white hover:bg-orange-500/40'
            }`}
          >
            {alert.icon}
            <span>{alert.count} {alert.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

// --- Stat List Card ---
interface StatListItem {
  label: string;
  value: number;
  status: 'danger' | 'warning' | 'ok';
  onClick?: () => void;
}

interface StatListCardProps {
  title: string;
  icon: React.ReactNode;
  items: StatListItem[];
}

const StatListCard: React.FC<StatListCardProps> = ({ title, icon, items }) => {
  const statusStyles = {
    danger: 'bg-red-100 text-red-700',
    warning: 'bg-orange-100 text-orange-700',
    ok: 'bg-green-100 text-green-700'
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
      <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
        {icon}
        <h3 className="font-bold text-slate-800">{title}</h3>
      </div>
      <div className="divide-y divide-slate-100">
        {items.map((item, idx) => (
          <div 
            key={idx} 
            onClick={item.onClick}
            className={`p-3 flex items-center justify-between ${item.onClick ? 'cursor-pointer hover:bg-slate-50' : ''}`}
          >
            <span className="text-sm text-slate-700">{item.label}</span>
            <span className={`text-xs font-bold px-2 py-1 rounded-full ${statusStyles[item.status]}`}>
              {item.value}
            </span>
          </div>
        ))}
        {items.length === 0 && (
          <div className="p-6 text-center text-slate-400">
            <CheckCircle2 size={32} className="mx-auto mb-2 text-green-400" />
            <p className="text-sm">Tout est OK</p>
          </div>
        )}
      </div>
    </div>
  );
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

const Dashboard: React.FC<DashboardProps> = ({ 
  vehicles, logs, maintenanceLogs, issues, quotes = [], leaves = [], absences = [],
  currentUser, users, pendingDocuments = 0, onNavigate 
}) => {
  const [currentDate, setCurrentDate] = useState(() => {
    // Si on est en début de mois et qu'il n'y a pas encore de données,
    // on affiche le mois précédent par défaut
    const now = new Date();
    if (now.getDate() <= 5) {
      // On vérifie au premier rendu - sera ajusté par l'effet ci-dessous
      const prev = new Date(now);
      prev.setMonth(prev.getMonth() - 1);
      return prev;
    }
    return now;
  });
  
  // Auto-basculer : si le mois affiché n'a aucune donnée, revenir au mois précédent
  useEffect(() => {
    const month = currentDate.getMonth();
    const year = currentDate.getFullYear();
    const now = new Date();
    
    // Seulement si on est sur le mois en cours et en début de mois
    if (month === now.getMonth() && year === now.getFullYear() && now.getDate() <= 5) {
      const hasData = logs.some(l => {
        const d = new Date(l.date);
        return d.getMonth() === month && d.getFullYear() === year;
      }) || maintenanceLogs.some(l => {
        const d = new Date(l.date);
        return d.getMonth() === month && d.getFullYear() === year;
      });
      
      if (!hasData && logs.length > 0) {
        const prev = new Date(currentDate);
        prev.setMonth(prev.getMonth() - 1);
        setCurrentDate(prev);
      }
    }
  }, [logs, maintenanceLogs]); // Se déclenche quand les données sont chargées
  
  // Hook des permissions
  const { hasPermission, hasAnyPermission } = usePermissions();

  // Anciennes vérifications de rôle (gardées pour compatibilité avec le rendu conditionnel existant)
  const effectiveRole = normalizeRole(currentUser.role);
  const isDriver = effectiveRole === UserRole.DRIVER;
  const isMechanic = effectiveRole === UserRole.MECHANIC;
  
  // Nouvelles vérifications basées sur les permissions
  const canViewDashboard = hasPermission(Permission.DASHBOARD_VIEW);
  const canViewFleetKpis = hasPermission(Permission.DASHBOARD_KPI_FLEET);
  const canViewFuelKpis = hasPermission(Permission.DASHBOARD_KPI_FUEL);
  const canViewFuelCosts = hasPermission(Permission.DASHBOARD_KPI_FUEL_COSTS);
  const canViewMaintenanceKpis = hasPermission(Permission.DASHBOARD_KPI_MAINTENANCE);
  const canViewMaintenanceCosts = hasPermission(Permission.DASHBOARD_KPI_MAINTENANCE_COSTS);
  const canViewHrKpis = hasPermission(Permission.DASHBOARD_KPI_HR);
  const canViewFinancialKpis = hasPermission(Permission.DASHBOARD_KPI_FINANCIAL);
  const canViewDocumentAlerts = hasPermission(Permission.DASHBOARD_ALERTS_DOCUMENTS);
  const canViewTodoAlerts = hasPermission(Permission.DASHBOARD_ALERTS_TODO);
  
  // Pour la compatibilité avec le code existant
  const isPresident = canViewFinancialKpis; // Les KPIs financiers = accès Président
  const isDirector = canViewFleetKpis && !canViewFinancialKpis; // Accès flotte mais pas financier

  // --- Navigation période ---
  const handleNavigateDate = (direction: -1 | 1) => {
    const newDate = new Date(currentDate);
    newDate.setMonth(newDate.getMonth() + direction);
    setCurrentDate(newDate);
  };

  const getPeriodLabel = () => {
    return new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(currentDate);
  };

  // ============================================================================
  // CALCULS KPIs COMMUNS
  // ============================================================================

  const commonKpis = useMemo(() => {
    const month = currentDate.getMonth();
    const year = currentDate.getFullYear();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Mois précédent pour tendances
    const prevMonth = month === 0 ? 11 : month - 1;
    const prevYear = month === 0 ? year - 1 : year;

    // --- FLOTTE ---
    const activeVehicles = vehicles.filter(v => getEffectiveStatus(v, issues, maintenanceLogs) === VehicleStatus.ACTIVE);
    const vehiclesInMaintenance = vehicles.filter(v => getEffectiveStatus(v, issues, maintenanceLogs) === VehicleStatus.MAINTENANCE);
    const vehiclesWithIssues = vehicles.filter(v => getEffectiveStatus(v, issues, maintenanceLogs) === VehicleStatus.ISSUE);
    const availabilityRate = vehicles.length > 0 ? (activeVehicles.length / vehicles.length) * 100 : 100;

    // CT et échéances
    const vehiclesCTExpired = vehicles.filter(v => isExpired(v.technicalControlDate));
    const vehiclesCTSoon = vehicles.filter(v => isExpiringSoon(v.technicalControlDate, 30));
    
    // --- CARBURANT ---
    const monthlyFuelLogs = logs.filter(l => {
      const d = new Date(l.date);
      return d.getMonth() === month && d.getFullYear() === year;
    });
    const prevMonthFuelLogs = logs.filter(l => {
      const d = new Date(l.date);
      return d.getMonth() === prevMonth && d.getFullYear() === prevYear;
    });

    const fuelCost = monthlyFuelLogs.reduce((acc, l) => acc + l.cost + (l.adBlueCost || 0), 0);
    const prevFuelCost = prevMonthFuelLogs.reduce((acc, l) => acc + l.cost + (l.adBlueCost || 0), 0);
    const fuelTrend = prevFuelCost > 0 ? ((fuelCost - prevFuelCost) / prevFuelCost) * 100 : 0;

    const totalVolume = monthlyFuelLogs.reduce((acc, l) => acc + l.volume, 0);
    const totalDistance = calculateRealDistance(logs, month, year);
    const avgConsumption = totalDistance > 0 ? (totalVolume / totalDistance) * 100 : 0;

    // Surconsommation (véhicules > 15% au-dessus de la moyenne)
    const vehicleFuelStats = vehicles.map(v => {
      const vLogs = monthlyFuelLogs.filter(l => l.vehicleId === v.id);
      const vVolume = vLogs.reduce((acc, l) => acc + l.volume, 0);
      const vDistance = calculateRealDistance(logs.filter(l => l.vehicleId === v.id), month, year);
      const vConso = vDistance > 0 ? (vVolume / vDistance) * 100 : 0;
      return { ...v, consumption: vConso, fuelCost: vLogs.reduce((acc, l) => acc + l.cost, 0) };
    }).filter(v => v.consumption > 0);

    const avgConso = vehicleFuelStats.length > 0 
      ? vehicleFuelStats.reduce((acc, v) => acc + v.consumption, 0) / vehicleFuelStats.length 
      : 0;
    const overConsumingVehicles = vehicleFuelStats.filter(v => v.consumption > avgConso * 1.15);

    // --- MAINTENANCE ---
    const monthlyMaintLogs = maintenanceLogs.filter(l => {
      const d = new Date(l.date);
      return d.getMonth() === month && d.getFullYear() === year;
    });
    const prevMonthMaintLogs = maintenanceLogs.filter(l => {
      const d = new Date(l.date);
      return d.getMonth() === prevMonth && d.getFullYear() === prevYear;
    });

    const maintCost = monthlyMaintLogs.reduce((acc, l) => acc + l.cost, 0);
    const prevMaintCost = prevMonthMaintLogs.reduce((acc, l) => acc + l.cost, 0);
    const maintTrend = prevMaintCost > 0 ? ((maintCost - prevMaintCost) / prevMaintCost) * 100 : 0;

    // --- RH ---
    const drivers = users.filter(u => {
      const r = normalizeRole(u.role);
      return r === UserRole.DRIVER;
    });

    const driversOnLeaveToday = absences.filter(a => {
      const start = new Date(a.startDate);
      const end = new Date(a.endDate);
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      return a.status === AbsenceStatus.APPROVED && today >= start && today <= end;
    });

    // Congés en attente de validation (type Congés Payés uniquement pour le compteur)
    const pendingLeaves = absences.filter(a => a.status === AbsenceStatus.PENDING);

    // Permis expirant
    const driversLicenseExpired = drivers.filter(u => isExpired(u.driverLicenseScanDate));
    const driversLicenseSoon = drivers.filter(u => isExpiringSoon(u.driverLicenseScanDate, 30));

    // FCO/FIMO expirant (chauffeurs PL)
    const driversFCOExpired = drivers.filter(u => u.isHeavyGoodsDriver && isExpired(u.fcoDate));
    const driversFCOSoon = drivers.filter(u => u.isHeavyGoodsDriver && isExpiringSoon(u.fcoDate, 60));

    // Visite médicale
    // Visite médicale (chauffeurs PL uniquement)
    const driversMedicalExpired = drivers.filter(u => u.isHeavyGoodsDriver && isExpired(u.medicalVisitDate));
    const driversMedicalSoon = drivers.filter(u => u.isHeavyGoodsDriver && isExpiringSoon(u.medicalVisitDate, 30));

    // --- INCIDENTS ---
    const openIssues = issues.filter(i => i.status !== IssueStatus.RESOLVED);
    const criticalIssues = openIssues.filter(i => i.priority === 'high');

    // ============================================================================
    // KPIs FINANCIERS PRÉSIDENT
    // ============================================================================

    // Calculs mois précédent pour tendances financières
    const prevTotalVolume = prevMonthFuelLogs.reduce((acc, l) => acc + l.volume, 0);
    const prevTotalDistance = calculateRealDistance(logs, prevMonth, prevYear);
    const prevAvgConsumption = prevTotalDistance > 0 ? (prevTotalVolume / prevTotalDistance) * 100 : 0;

    // Coût/km carburant
    const fuelCostPerKm = totalDistance > 0 ? fuelCost / totalDistance : 0;
    const prevFuelCostPerKm = prevTotalDistance > 0 ? prevFuelCost / prevTotalDistance : 0;
    const fuelCostPerKmTrend = prevFuelCostPerKm > 0 ? ((fuelCostPerKm - prevFuelCostPerKm) / prevFuelCostPerKm) * 100 : 0;

    // Coût/km maintenance
    const maintCostPerKm = totalDistance > 0 ? maintCost / totalDistance : 0;
    const prevMaintCostPerKm = prevTotalDistance > 0 ? prevMaintCost / prevTotalDistance : 0;
    const maintCostPerKmTrend = prevMaintCostPerKm > 0 ? ((maintCostPerKm - prevMaintCostPerKm) / prevMaintCostPerKm) * 100 : 0;

    // Coût total/km
    const totalCost = fuelCost + maintCost;
    const prevTotalCost = prevFuelCost + prevMaintCost;
    const totalCostPerKm = totalDistance > 0 ? totalCost / totalDistance : 0;
    const prevTotalCostPerKm = prevTotalDistance > 0 ? prevTotalCost / prevTotalDistance : 0;
    const totalCostPerKmTrend = prevTotalCostPerKm > 0 ? ((totalCostPerKm - prevTotalCostPerKm) / prevTotalCostPerKm) * 100 : 0;

    // Tendance km parcourus
    const distanceTrend = prevTotalDistance > 0 ? ((totalDistance - prevTotalDistance) / prevTotalDistance) * 100 : 0;

    // Tendance consommation
    const consumptionTrend = prevAvgConsumption > 0 ? ((avgConsumption - prevAvgConsumption) / prevAvgConsumption) * 100 : 0;

    // Tendance litres
    const volumeTrend = prevTotalVolume > 0 ? ((totalVolume - prevTotalVolume) / prevTotalVolume) * 100 : 0;

    // Coût moyen par véhicule (véhicules actifs)
    const costPerVehicle = activeVehicles.length > 0 ? totalCost / activeVehicles.length : 0;
    const prevCostPerVehicle = activeVehicles.length > 0 ? prevTotalCost / activeVehicles.length : 0;
    const costPerVehicleTrend = prevCostPerVehicle > 0 ? ((costPerVehicle - prevCostPerVehicle) / prevCostPerVehicle) * 100 : 0;

    // Coût moyen par chauffeur
    const costPerDriver = drivers.length > 0 ? totalCost / drivers.length : 0;
    const prevCostPerDriver = drivers.length > 0 ? prevTotalCost / drivers.length : 0;
    const costPerDriverTrend = prevCostPerDriver > 0 ? ((costPerDriver - prevCostPerDriver) / prevCostPerDriver) * 100 : 0;

    // Taux d'utilisation flotte (véhicules avec au moins 1 plein ce mois)
    const vehiclesWithFuelThisMonth = new Set(monthlyFuelLogs.map(l => l.vehicleId)).size;
    const fleetUtilizationRate = vehicles.length > 0 ? (vehiclesWithFuelThisMonth / vehicles.length) * 100 : 0;

    // ============================================================================
    // TOP 5 VÉHICULES LES PLUS COÛTEUX
    // ============================================================================
    const vehicleCosts = vehicles.map(v => {
      const vFuelCost = monthlyFuelLogs
        .filter(l => l.vehicleId === v.id)
        .reduce((acc, l) => acc + l.cost + (l.adBlueCost || 0), 0);
      const vMaintCost = monthlyMaintLogs
        .filter(l => l.vehicleId === v.id)
        .reduce((acc, l) => acc + l.cost, 0);
      const vTotalCost = vFuelCost + vMaintCost;
      
      // Calcul km pour ce véhicule
      const vLogs = logs.filter(l => l.vehicleId === v.id);
      const vDistance = calculateRealDistance(vLogs, month, year);
      const vCostPerKm = vDistance > 0 ? vTotalCost / vDistance : 0;
      
      return {
        ...v,
        fuelCost: vFuelCost,
        maintCost: vMaintCost,
        totalCost: vTotalCost,
        distance: vDistance,
        costPerKm: vCostPerKm
      };
    });
    
    const top5CostlyVehicles = [...vehicleCosts]
      .filter(v => v.totalCost > 0)
      .sort((a, b) => b.totalCost - a.totalCost)
      .slice(0, 5);

    // ============================================================================
    // TOP 5 CHAUFFEURS LES PLUS ÉCONOMES
    // ============================================================================
    const driverConsumptions = drivers.map(driver => {
      // Trouver le véhicule assigné au chauffeur
      const assignedVehicle = vehicles.find(v => 
        v.driverId === driver.id || v.assignedDriverId === driver.id
      );
      
      if (!assignedVehicle) {
        return { driver, consumption: null, distance: 0, volume: 0 };
      }
      
      const driverLogs = monthlyFuelLogs.filter(l => l.vehicleId === assignedVehicle.id);
      const driverVolume = driverLogs.reduce((acc, l) => acc + l.volume, 0);
      const driverDistance = calculateRealDistance(
        logs.filter(l => l.vehicleId === assignedVehicle.id), 
        month, 
        year
      );
      const driverConsumption = driverDistance > 0 ? (driverVolume / driverDistance) * 100 : null;
      
      return {
        driver,
        vehicle: assignedVehicle,
        consumption: driverConsumption,
        distance: driverDistance,
        volume: driverVolume
      };
    });
    
    const top5EconomicDrivers = [...driverConsumptions]
      .filter(d => d.consumption !== null && d.consumption > 0 && d.distance > 100) // Au moins 100km pour être significatif
      .sort((a, b) => (a.consumption || 999) - (b.consumption || 999))
      .slice(0, 5);

    return {
      // Flotte
      totalVehicles: vehicles.length,
      activeVehicles: activeVehicles.length,
      availabilityRate,
      vehiclesInMaintenance,
      vehiclesWithIssues,
      vehiclesCTExpired,
      vehiclesCTSoon,

      // Carburant
      fuelCost,
      fuelTrend,
      avgConsumption,
      overConsumingVehicles,
      totalDistance,
      totalVolume,

      // Maintenance
      maintCost,
      maintTrend,

      // RH
      totalDrivers: drivers.length,
      driversOnLeaveToday,
      activeDrivers: drivers.length - driversOnLeaveToday.length,
      pendingLeaves,
      driversLicenseExpired,
      driversLicenseSoon,
      driversFCOExpired,
      driversFCOSoon,
      driversMedicalExpired,
      driversMedicalSoon,

      // Incidents
      openIssues,
      criticalIssues,

      // Documents
      pendingDocuments,

      // KPIs Financiers Président
      fuelCostPerKm,
      fuelCostPerKmTrend,
      maintCostPerKm,
      maintCostPerKmTrend,
      totalCost,
      totalCostPerKm,
      totalCostPerKmTrend,
      distanceTrend,
      consumptionTrend,
      volumeTrend,
      costPerVehicle,
      costPerVehicleTrend,
      costPerDriver,
      costPerDriverTrend,
      fleetUtilizationRate,
      top5CostlyVehicles,
      top5EconomicDrivers
    };
  }, [vehicles, logs, maintenanceLogs, issues, absences, users, currentDate, pendingDocuments]);

  // ============================================================================
  // DONNÉES GRAPHIQUES
  // ============================================================================

  const chartData = useMemo(() => {
    const data = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(currentDate);
      d.setMonth(d.getMonth() - i);
      const m = d.getMonth();
      const y = d.getFullYear();
      const monthName = d.toLocaleString('fr-FR', { month: 'short' });

      const fuelCost = logs
        .filter(l => new Date(l.date).getMonth() === m && new Date(l.date).getFullYear() === y)
        .reduce((sum, l) => sum + l.cost + (l.adBlueCost || 0), 0);
      
      const maintCost = maintenanceLogs
        .filter(l => new Date(l.date).getMonth() === m && new Date(l.date).getFullYear() === y)
        .reduce((sum, l) => sum + l.cost, 0);

      data.push({ 
        name: monthName, 
        carburant: fuelCost, 
        maintenance: maintCost,
        total: fuelCost + maintCost
      });
    }
    return data;
  }, [logs, maintenanceLogs, currentDate]);

  const statusData = useMemo(() => {
    let active = 0, maintenance = 0, issue = 0, idle = 0;
    vehicles.forEach(v => {
      const status = getEffectiveStatus(v, issues, maintenanceLogs);
      if (status === VehicleStatus.MAINTENANCE) maintenance++;
      else if (status === VehicleStatus.ISSUE) issue++;
      else if (status === VehicleStatus.IDLE) idle++;
      else active++;
    });
    return [
      { name: 'En Service', value: active },
      { name: 'Maintenance', value: maintenance },
      { name: 'Problème', value: issue },
      { name: 'Disponible', value: idle },
    ].filter(item => item.value > 0);
  }, [vehicles, issues, maintenanceLogs]);

  // ============================================================================
  // ALERTES CRITIQUES (Président uniquement)
  // ============================================================================

  const criticalAlerts: AlertItem[] = useMemo(() => {
    if (!isPresident) return [];

    return [
      {
        type: 'danger' as const,
        icon: <Truck size={16} />,
        label: 'CT expirés',
        count: commonKpis.vehiclesCTExpired.length,
        onClick: () => onNavigate('vehicles')
      },
      {
        type: 'warning' as const,
        icon: <BadgeCheck size={16} />,
        label: 'Permis < 30j',
        count: commonKpis.driversLicenseSoon.length + commonKpis.driversLicenseExpired.length,
        onClick: () => onNavigate('drivers')
      },
      {
        type: 'warning' as const,
        icon: <FileSignature size={16} />,
        label: 'FCO < 60j',
        count: commonKpis.driversFCOSoon.length + commonKpis.driversFCOExpired.length,
        onClick: () => onNavigate('drivers')
      },
      {
        type: 'warning' as const,
        icon: <Heart size={16} />,
        label: 'Visite médicale < 30j',
        count: commonKpis.driversMedicalSoon.length + commonKpis.driversMedicalExpired.length,
        onClick: () => onNavigate('drivers')
      }
    ];
  }, [isPresident, commonKpis, onNavigate]);

  // ============================================================================
  // RENDER: CHAUFFEUR
  // ============================================================================

  // --- Calculs spécifiques chauffeur ---
  const driverAlerts = useMemo(() => {
    if (!isDriver) return { alerts: [], assignedVehicle: null };

    const alerts: { type: 'danger' | 'warning'; icon: React.ReactNode; label: string; detail: string }[] = [];
    
    // Véhicule assigné au chauffeur
    const assignedVehicle = vehicles.find(v => v.assignedDriverId === currentUser.id || v.driverId === currentUser.id);
    
    // CT du véhicule assigné
    if (assignedVehicle) {
      if (isExpired(assignedVehicle.technicalControlDate)) {
        alerts.push({
          type: 'danger',
          icon: <Truck size={16} />,
          label: 'CT expiré',
          detail: `${assignedVehicle.plate} - Contrôle technique dépassé !`
        });
      } else if (isExpiringSoon(assignedVehicle.technicalControlDate, 30)) {
        const days = daysUntil(assignedVehicle.technicalControlDate);
        alerts.push({
          type: 'warning',
          icon: <Truck size={16} />,
          label: 'CT bientôt',
          detail: `${assignedVehicle.plate} - CT dans ${days} jours`
        });
      }
    }

    // Permis de conduire
    if (isExpired(currentUser.driverLicenseScanDate)) {
      alerts.push({
        type: 'danger',
        icon: <BadgeCheck size={16} />,
        label: 'Permis expiré',
        detail: 'Votre permis de conduire est expiré !'
      });
    } else if (isExpiringSoon(currentUser.driverLicenseScanDate, 30)) {
      const days = daysUntil(currentUser.driverLicenseScanDate);
      alerts.push({
        type: 'warning',
        icon: <BadgeCheck size={16} />,
        label: 'Permis bientôt',
        detail: `Permis expire dans ${days} jours`
      });
    }

    // FCO/FIMO (si chauffeur PL)
    if (currentUser.isHeavyGoodsDriver) {
      if (isExpired(currentUser.fcoDate)) {
        alerts.push({
          type: 'danger',
          icon: <FileSignature size={16} />,
          label: 'FCO expirée',
          detail: 'Votre FCO/FIMO est expirée !'
        });
      } else if (isExpiringSoon(currentUser.fcoDate, 60)) {
        const days = daysUntil(currentUser.fcoDate);
        alerts.push({
          type: 'warning',
          icon: <FileSignature size={16} />,
          label: 'FCO bientôt',
          detail: `FCO/FIMO expire dans ${days} jours`
        });
      }
    }

    // Visite médicale (chauffeurs PL uniquement)
    if (currentUser.isHeavyGoodsDriver) {
      if (isExpired(currentUser.medicalVisitDate)) {
        alerts.push({
          type: 'danger',
          icon: <Heart size={16} />,
          label: 'Visite médicale',
          detail: 'Visite médicale expirée !'
        });
      } else if (isExpiringSoon(currentUser.medicalVisitDate, 30)) {
        const days = daysUntil(currentUser.medicalVisitDate);
        alerts.push({
          type: 'warning',
          icon: <Heart size={16} />,
          label: 'Visite médicale',
          detail: `Visite médicale dans ${days} jours`
        });
      }
    }

    return { alerts, assignedVehicle };
  }, [isDriver, vehicles, currentUser]);

  if (isDriver) {
    const { alerts, assignedVehicle } = driverAlerts;
    const dangerAlerts = alerts.filter(a => a.type === 'danger');
    const warningAlerts = alerts.filter(a => a.type === 'warning');

    return (
      <div className="space-y-6 animate-fade-in pb-10">
        <div className="mb-4">
          <h2 className="text-2xl font-bold text-slate-800">Mon Espace Chauffeur</h2>
          <p className="text-slate-500">Bonne route, {currentUser.firstName}.</p>
        </div>

        {/* Alertes critiques chauffeur */}
        {dangerAlerts.length > 0 && (
          <div className="bg-gradient-to-r from-red-600 to-red-700 rounded-2xl p-4 shadow-lg">
            <div className="flex items-center gap-2 mb-3">
              <AlertOctagon className="text-white" size={20} />
              <span className="text-white font-bold">Attention !</span>
            </div>
            <div className="space-y-2">
              {dangerAlerts.map((alert, idx) => (
                <div key={idx} className="flex items-center gap-3 bg-white/20 rounded-xl px-3 py-2">
                  <div className="text-white">{alert.icon}</div>
                  <div>
                    <p className="text-white font-bold text-sm">{alert.label}</p>
                    <p className="text-white/80 text-xs">{alert.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Alertes warning chauffeur */}
        {warningAlerts.length > 0 && (
          <div className="bg-gradient-to-r from-orange-500 to-orange-600 rounded-2xl p-4 shadow-lg">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="text-white" size={20} />
              <span className="text-white font-bold">À prévoir</span>
            </div>
            <div className="space-y-2">
              {warningAlerts.map((alert, idx) => (
                <div key={idx} className="flex items-center gap-3 bg-white/20 rounded-xl px-3 py-2">
                  <div className="text-white">{alert.icon}</div>
                  <div>
                    <p className="text-white font-bold text-sm">{alert.label}</p>
                    <p className="text-white/80 text-xs">{alert.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* KPIs */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <KpiCard
            title="Ma Conso. Moyenne"
            value={`${commonKpis.avgConsumption.toFixed(1)} L`}
            subtitle="/ 100km"
            icon={<Droplet size={24} />}
            color="blue"
            onClick={() => onNavigate('fuel')}
          />
          <KpiCard
            title="Distance (Ce mois)"
            value={commonKpis.totalDistance.toLocaleString()}
            subtitle="km parcourus"
            icon={<Activity size={24} />}
            color="orange"
            onClick={() => onNavigate('vehicles')}
          />
          {assignedVehicle && (
            <KpiCard
              title="Mon Véhicule"
              value={assignedVehicle.plate}
              subtitle={assignedVehicle.model}
              icon={<Truck size={24} />}
              color="slate"
              onClick={() => onNavigate('vehicles')}
            />
          )}
        </div>

        {/* Mes échéances */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="p-4 border-b border-slate-100 bg-slate-50">
            <h3 className="font-bold text-slate-800 flex items-center gap-2">
              <Calendar size={18} className="text-blue-500" /> Mes échéances
            </h3>
          </div>
          <div className="divide-y divide-slate-100">
            {assignedVehicle?.technicalControlDate && (
              <div className="p-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-100 rounded-lg"><Truck size={16} className="text-blue-600" /></div>
                  <div>
                    <p className="font-bold text-slate-800 text-sm">Contrôle Technique</p>
                    <p className="text-xs text-slate-500">{assignedVehicle.plate}</p>
                  </div>
                </div>
                <div className="text-right">
                  <span className={`text-xs font-bold px-2 py-1 rounded-full ${
                    isExpired(assignedVehicle.technicalControlDate) ? 'bg-red-100 text-red-700' :
                    isExpiringSoon(assignedVehicle.technicalControlDate, 30) ? 'bg-orange-100 text-orange-700' :
                    'bg-green-100 text-green-700'
                  }`}>
                    {isExpired(assignedVehicle.technicalControlDate) ? 'Expiré' : 
                     `J-${daysUntil(assignedVehicle.technicalControlDate)}`}
                  </span>
                  <p className="text-[10px] text-slate-400 mt-1">
                    {new Date(assignedVehicle.technicalControlDate).toLocaleDateString()}
                  </p>
                </div>
              </div>
            )}
            
            {currentUser.driverLicenseScanDate && (
              <div className="p-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-purple-100 rounded-lg"><BadgeCheck size={16} className="text-purple-600" /></div>
                  <div>
                    <p className="font-bold text-slate-800 text-sm">Permis de Conduire</p>
                    <p className="text-xs text-slate-500">Validité</p>
                  </div>
                </div>
                <div className="text-right">
                  <span className={`text-xs font-bold px-2 py-1 rounded-full ${
                    isExpired(currentUser.driverLicenseScanDate) ? 'bg-red-100 text-red-700' :
                    isExpiringSoon(currentUser.driverLicenseScanDate, 30) ? 'bg-orange-100 text-orange-700' :
                    'bg-green-100 text-green-700'
                  }`}>
                    {isExpired(currentUser.driverLicenseScanDate) ? 'Expiré' : 
                     `J-${daysUntil(currentUser.driverLicenseScanDate)}`}
                  </span>
                  <p className="text-[10px] text-slate-400 mt-1">
                    {new Date(currentUser.driverLicenseScanDate).toLocaleDateString()}
                  </p>
                </div>
              </div>
            )}

            {currentUser.isHeavyGoodsDriver && currentUser.fcoDate && (
              <div className="p-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-amber-100 rounded-lg"><FileSignature size={16} className="text-amber-600" /></div>
                  <div>
                    <p className="font-bold text-slate-800 text-sm">FCO / FIMO</p>
                    <p className="text-xs text-slate-500">Formation continue</p>
                  </div>
                </div>
                <div className="text-right">
                  <span className={`text-xs font-bold px-2 py-1 rounded-full ${
                    isExpired(currentUser.fcoDate) ? 'bg-red-100 text-red-700' :
                    isExpiringSoon(currentUser.fcoDate, 60) ? 'bg-orange-100 text-orange-700' :
                    'bg-green-100 text-green-700'
                  }`}>
                    {isExpired(currentUser.fcoDate) ? 'Expiré' : 
                     `J-${daysUntil(currentUser.fcoDate)}`}
                  </span>
                  <p className="text-[10px] text-slate-400 mt-1">
                    {new Date(currentUser.fcoDate).toLocaleDateString()}
                  </p>
                </div>
              </div>
            )}

            {currentUser.isHeavyGoodsDriver && currentUser.medicalVisitDate && (
              <div className="p-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-rose-100 rounded-lg"><Heart size={16} className="text-rose-600" /></div>
                  <div>
                    <p className="font-bold text-slate-800 text-sm">Visite Médicale</p>
                    <p className="text-xs text-slate-500">Aptitude</p>
                  </div>
                </div>
                <div className="text-right">
                  <span className={`text-xs font-bold px-2 py-1 rounded-full ${
                    isExpired(currentUser.medicalVisitDate) ? 'bg-red-100 text-red-700' :
                    isExpiringSoon(currentUser.medicalVisitDate, 30) ? 'bg-orange-100 text-orange-700' :
                    'bg-green-100 text-green-700'
                  }`}>
                    {isExpired(currentUser.medicalVisitDate) ? 'Expiré' : 
                     `J-${daysUntil(currentUser.medicalVisitDate)}`}
                  </span>
                  <p className="text-[10px] text-slate-400 mt-1">
                    {new Date(currentUser.medicalVisitDate).toLocaleDateString()}
                  </p>
                </div>
              </div>
            )}

            {!assignedVehicle?.technicalControlDate && !currentUser.driverLicenseScanDate && 
             !(currentUser.isHeavyGoodsDriver && currentUser.fcoDate) && 
             !(currentUser.isHeavyGoodsDriver && currentUser.medicalVisitDate) && (
              <div className="p-6 text-center text-slate-400">
                <CheckCircle2 size={32} className="mx-auto mb-2 text-green-400" />
                <p className="text-sm">Aucune échéance enregistrée</p>
              </div>
            )}
          </div>
        </div>

        {/* Solde congés */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-green-100 rounded-xl">
                <Calendar size={24} className="text-green-600" />
              </div>
              <div>
                <p className="text-xs font-bold text-slate-500 uppercase">Solde Congés</p>
                <p className="text-2xl font-extrabold text-slate-800">{currentUser.leaveBalance || 0} <span className="text-sm font-medium text-slate-400">jours</span></p>
              </div>
            </div>
            <button 
              onClick={() => onNavigate('leaves')}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-xl font-bold text-sm transition-colors"
            >
              Poser des congés
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ============================================================================
  // RENDER: MÉCANICIEN
  // ============================================================================

  if (isMechanic) {
    return (
      <div className="space-y-6 animate-fade-in pb-10">
        <div className="flex justify-between items-end mb-4">
          <div>
            <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
              <Wrench className="text-orange-500" /> Atelier & Maintenance
            </h2>
            <p className="text-slate-500">Bonjour {currentUser.firstName}, voici l'état de l'atelier.</p>
          </div>
          <button 
            onClick={() => onNavigate('maintenance')}
            className="px-4 py-2 bg-slate-900 text-white rounded-xl font-bold text-sm hover:bg-black transition-colors"
          >
            Voir tout l'atelier
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <KpiCard
            title="Incidents ouverts"
            value={commonKpis.openIssues.length}
            subtitle={`${commonKpis.criticalIssues.length} critique(s)`}
            icon={<AlertTriangle size={24} />}
            color="red"
            onClick={() => onNavigate('issues')}
          />
          <KpiCard
            title="En maintenance"
            value={commonKpis.vehiclesInMaintenance.length}
            subtitle="véhicules"
            icon={<Wrench size={24} />}
            color="orange"
            onClick={() => onNavigate('maintenance')}
          />
          <KpiCard
            title="CT < 30 jours"
            value={commonKpis.vehiclesCTSoon.length}
            subtitle="à planifier"
            icon={<Calendar size={24} />}
            color={commonKpis.vehiclesCTSoon.length > 0 ? 'orange' : 'green'}
            onClick={() => onNavigate('vehicles')}
          />
          <KpiCard
            title="Coût maintenance"
            value={`${commonKpis.maintCost.toLocaleString()} €`}
            subtitle="ce mois"
            icon={<CreditCard size={24} />}
            color="purple"
            trend={{ value: commonKpis.maintTrend, inverse: true }}
          />
        </div>

        {/* Liste des incidents ouverts */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
            <h3 className="font-bold text-slate-800 flex items-center gap-2">
              <AlertTriangle size={18} className="text-red-500" /> Incidents à traiter
            </h3>
            <span className="text-xs font-bold bg-red-100 text-red-700 px-2 py-1 rounded-full">
              {commonKpis.openIssues.length}
            </span>
          </div>
          <div className="divide-y divide-slate-100 max-h-[300px] overflow-y-auto">
            {commonKpis.openIssues.slice(0, 5).map(issue => {
              const vehicle = vehicles.find(v => v.id === issue.vehicleId);
              return (
                <div key={issue.id} className="p-3 hover:bg-slate-50 flex items-center justify-between">
                  <div>
                    <p className="font-bold text-slate-800 text-sm">{vehicle?.plate || 'Véhicule inconnu'}</p>
                    <p className="text-xs text-slate-500 truncate max-w-[200px]">{issue.description}</p>
                  </div>
                  <span className={`text-xs font-bold px-2 py-1 rounded-full ${
                    issue.priority === 'high' ? 'bg-red-100 text-red-700' :
                    issue.priority === 'medium' ? 'bg-orange-100 text-orange-700' :
                    'bg-slate-100 text-slate-600'
                  }`}>
                    {issue.status}
                  </span>
                </div>
              );
            })}
            {commonKpis.openIssues.length === 0 && (
              <div className="p-6 text-center text-slate-400">
                <CheckCircle2 size={32} className="mx-auto mb-2 text-green-400" />
                <p className="text-sm">Aucun incident en attente</p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ============================================================================
  // RENDER: PRÉSIDENT (Stratégique)
  // ============================================================================

  if (isPresident) {
    return (
      <div className="space-y-6 animate-fade-in pb-10">
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 mb-2">
          <div>
            <h2 className="text-2xl font-bold text-slate-800">Tableau de Bord Stratégique</h2>
            <p className="text-slate-500">Bonjour {currentUser.firstName}, voici la situation de votre flotte.</p>
          </div>
          <div className="flex items-center bg-white rounded-xl border border-slate-200 shadow-sm p-1">
            <button onClick={() => handleNavigateDate(-1)} className="p-2 hover:bg-slate-100 rounded-lg text-slate-500"><ChevronLeft size={18} /></button>
            <div className="px-3 min-w-[140px] text-center">
              <span className="block text-sm font-bold text-slate-800 capitalize">{getPeriodLabel()}</span>
            </div>
            <button onClick={() => handleNavigateDate(1)} className="p-2 hover:bg-slate-100 rounded-lg text-slate-500"><ChevronRight size={18} /></button>
          </div>
        </div>

        {/* Alertes critiques */}
        <AlertBanner alerts={criticalAlerts} />

        {/* KPIs principaux */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            title="Disponibilité Flotte"
            value={`${commonKpis.availabilityRate.toFixed(0)}%`}
            subtitle={`${commonKpis.activeVehicles}/${commonKpis.totalVehicles} véhicules`}
            icon={<Truck size={24} />}
            color={commonKpis.availabilityRate >= 85 ? 'green' : 'orange'}
            onClick={() => onNavigate('vehicles')}
          />
          <KpiCard
            title="Carburant"
            value={`${commonKpis.fuelCost.toLocaleString()} €`}
            subtitle="ce mois"
            icon={<Droplet size={24} />}
            color="blue"
            trend={{ value: commonKpis.fuelTrend, inverse: true }}
            onClick={() => onNavigate('fuel')}
          />
          <KpiCard
            title="Maintenance"
            value={`${commonKpis.maintCost.toLocaleString()} €`}
            subtitle="ce mois"
            icon={<Wrench size={24} />}
            color="orange"
            trend={{ value: commonKpis.maintTrend, inverse: true }}
            onClick={() => onNavigate('maintenance')}
          />
          <KpiCard
            title="Équipe active"
            value={commonKpis.activeDrivers}
            subtitle={`${commonKpis.driversOnLeaveToday.length} en congés`}
            icon={<Users size={24} />}
            color="purple"
            onClick={() => onNavigate('drivers')}
          />
        </div>

        {/* ============================================================================ */}
        {/* SECTION KPIs FINANCIERS & PERFORMANCE */}
        {/* ============================================================================ */}
        <div className="bg-gradient-to-br from-slate-50 to-blue-50 p-6 rounded-2xl border border-slate-200">
          <div className="flex items-center gap-3 mb-5">
            <div className="p-2 bg-blue-100 rounded-xl">
              <Wallet size={20} className="text-blue-600" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-800">Performance Financière</h3>
              <p className="text-xs text-slate-500">Analyse détaillée de la période</p>
            </div>
          </div>

          {/* Première ligne : 4 KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            {/* Km parcourus */}
            <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-slate-500 uppercase">Km parcourus</span>
                <Route size={16} className="text-slate-400" />
              </div>
              <div className="text-2xl font-bold text-slate-800">
                {commonKpis.totalDistance.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} <span className="text-sm font-normal text-slate-500">km</span>
              </div>
              {commonKpis.distanceTrend !== 0 && (
                <div className={`flex items-center gap-1 mt-1 text-xs ${commonKpis.distanceTrend > 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {commonKpis.distanceTrend > 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                  {commonKpis.distanceTrend > 0 ? '+' : ''}{commonKpis.distanceTrend.toFixed(1)}% vs M-1
                </div>
              )}
            </div>

            {/* Consommation moyenne */}
            <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-slate-500 uppercase">Consommation</span>
                <Gauge size={16} className="text-slate-400" />
              </div>
              <div className="text-2xl font-bold text-slate-800">
                {commonKpis.avgConsumption.toFixed(1)} <span className="text-sm font-normal text-slate-500">L/100km</span>
              </div>
              {commonKpis.consumptionTrend !== 0 && (
                <div className={`flex items-center gap-1 mt-1 text-xs ${commonKpis.consumptionTrend < 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {commonKpis.consumptionTrend < 0 ? <TrendingDown size={12} /> : <TrendingUp size={12} />}
                  {commonKpis.consumptionTrend > 0 ? '+' : ''}{commonKpis.consumptionTrend.toFixed(1)}% vs M-1
                </div>
              )}
            </div>

            {/* Coût/km carburant */}
            <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-slate-500 uppercase">Coût/km Carb.</span>
                <Droplet size={16} className="text-blue-400" />
              </div>
              <div className="text-2xl font-bold text-blue-600">
                {commonKpis.fuelCostPerKm.toFixed(2)} <span className="text-sm font-normal text-slate-500">€/km</span>
              </div>
              {commonKpis.fuelCostPerKmTrend !== 0 && (
                <div className={`flex items-center gap-1 mt-1 text-xs ${commonKpis.fuelCostPerKmTrend < 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {commonKpis.fuelCostPerKmTrend < 0 ? <TrendingDown size={12} /> : <TrendingUp size={12} />}
                  {commonKpis.fuelCostPerKmTrend > 0 ? '+' : ''}{commonKpis.fuelCostPerKmTrend.toFixed(1)}% vs M-1
                </div>
              )}
            </div>

            {/* Coût/km maintenance */}
            <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-slate-500 uppercase">Coût/km Maint.</span>
                <Wrench size={16} className="text-orange-400" />
              </div>
              <div className="text-2xl font-bold text-orange-600">
                {commonKpis.maintCostPerKm.toFixed(2)} <span className="text-sm font-normal text-slate-500">€/km</span>
              </div>
              {commonKpis.maintCostPerKmTrend !== 0 && (
                <div className={`flex items-center gap-1 mt-1 text-xs ${commonKpis.maintCostPerKmTrend < 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {commonKpis.maintCostPerKmTrend < 0 ? <TrendingDown size={12} /> : <TrendingUp size={12} />}
                  {commonKpis.maintCostPerKmTrend > 0 ? '+' : ''}{commonKpis.maintCostPerKmTrend.toFixed(1)}% vs M-1
                </div>
              )}
            </div>
          </div>

          {/* Deuxième ligne : 4 KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {/* Coût total/km */}
            <div className="bg-white p-4 rounded-xl border border-blue-200 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-blue-600 uppercase">Coût Total/km</span>
                <Calculator size={16} className="text-blue-500" />
              </div>
              <div className="text-2xl font-bold text-blue-700">
                {commonKpis.totalCostPerKm.toFixed(2)} <span className="text-sm font-normal text-slate-500">€/km</span>
              </div>
              {commonKpis.totalCostPerKmTrend !== 0 && (
                <div className={`flex items-center gap-1 mt-1 text-xs ${commonKpis.totalCostPerKmTrend < 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {commonKpis.totalCostPerKmTrend < 0 ? <TrendingDown size={12} /> : <TrendingUp size={12} />}
                  {commonKpis.totalCostPerKmTrend > 0 ? '+' : ''}{commonKpis.totalCostPerKmTrend.toFixed(1)}% vs M-1
                </div>
              )}
            </div>

            {/* Litres consommés */}
            <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-slate-500 uppercase">Litres totaux</span>
                <Droplet size={16} className="text-slate-400" />
              </div>
              <div className="text-2xl font-bold text-slate-800">
                {commonKpis.totalVolume.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} <span className="text-sm font-normal text-slate-500">L</span>
              </div>
              {commonKpis.volumeTrend !== 0 && (
                <div className={`flex items-center gap-1 mt-1 text-xs ${commonKpis.volumeTrend < 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {commonKpis.volumeTrend < 0 ? <TrendingDown size={12} /> : <TrendingUp size={12} />}
                  {commonKpis.volumeTrend > 0 ? '+' : ''}{commonKpis.volumeTrend.toFixed(1)}% vs M-1
                </div>
              )}
            </div>

            {/* Coût moyen/véhicule */}
            <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-slate-500 uppercase">Coût/véhicule</span>
                <Truck size={16} className="text-slate-400" />
              </div>
              <div className="text-2xl font-bold text-slate-800">
                {commonKpis.costPerVehicle.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} <span className="text-sm font-normal text-slate-500">€</span>
              </div>
              {commonKpis.costPerVehicleTrend !== 0 && (
                <div className={`flex items-center gap-1 mt-1 text-xs ${commonKpis.costPerVehicleTrend < 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {commonKpis.costPerVehicleTrend < 0 ? <TrendingDown size={12} /> : <TrendingUp size={12} />}
                  {commonKpis.costPerVehicleTrend > 0 ? '+' : ''}{commonKpis.costPerVehicleTrend.toFixed(1)}% vs M-1
                </div>
              )}
            </div>

            {/* Coût moyen/chauffeur */}
            <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-slate-500 uppercase">Coût/chauffeur</span>
                <UserIcon size={16} className="text-slate-400" />
              </div>
              <div className="text-2xl font-bold text-slate-800">
                {commonKpis.costPerDriver.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} <span className="text-sm font-normal text-slate-500">€</span>
              </div>
              {commonKpis.costPerDriverTrend !== 0 && (
                <div className={`flex items-center gap-1 mt-1 text-xs ${commonKpis.costPerDriverTrend < 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {commonKpis.costPerDriverTrend < 0 ? <TrendingDown size={12} /> : <TrendingUp size={12} />}
                  {commonKpis.costPerDriverTrend > 0 ? '+' : ''}{commonKpis.costPerDriverTrend.toFixed(1)}% vs M-1
                </div>
              )}
            </div>
          </div>

          {/* Indicateur taux d'utilisation */}
          <div className="mt-4 pt-4 border-t border-slate-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Target size={16} className="text-slate-500" />
                <span className="text-sm text-slate-600">Taux d'utilisation flotte</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-32 h-2 bg-slate-200 rounded-full overflow-hidden">
                  <div 
                    className={`h-full rounded-full ${commonKpis.fleetUtilizationRate >= 80 ? 'bg-green-500' : commonKpis.fleetUtilizationRate >= 60 ? 'bg-yellow-500' : 'bg-red-500'}`}
                    style={{ width: `${commonKpis.fleetUtilizationRate}%` }}
                  />
                </div>
                <span className="text-sm font-bold text-slate-700">{commonKpis.fleetUtilizationRate.toFixed(0)}%</span>
              </div>
            </div>
          </div>
        </div>

        {/* ============================================================================ */}
        {/* TOP 5 VÉHICULES COÛTEUX & TOP 5 CHAUFFEURS ÉCONOMES */}
        {/* ============================================================================ */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Top 5 Véhicules les plus coûteux */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
            <div className="p-4 border-b border-slate-100 bg-gradient-to-r from-red-50 to-orange-50 flex items-center justify-between">
              <h3 className="font-bold text-slate-800 flex items-center gap-2">
                <AlertTriangle size={18} className="text-red-500" /> Top 5 véhicules les plus coûteux
              </h3>
              <span className="text-xs font-medium text-slate-500">Ce mois</span>
            </div>
            <div className="divide-y divide-slate-100">
              {commonKpis.top5CostlyVehicles.length > 0 ? (
                commonKpis.top5CostlyVehicles.map((v, idx) => (
                  <div 
                    key={v.id} 
                    className="p-3 hover:bg-slate-50 cursor-pointer transition-colors flex items-center justify-between"
                    onClick={() => onNavigate('vehicles')}
                  >
                    <div className="flex items-center gap-3">
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                        idx === 0 ? 'bg-red-100 text-red-700' : 
                        idx === 1 ? 'bg-orange-100 text-orange-700' : 
                        'bg-slate-100 text-slate-600'
                      }`}>
                        {idx + 1}
                      </span>
                      <div>
                        <div className="font-semibold text-slate-800">{v.plate}</div>
                        <div className="text-xs text-slate-500">{v.model}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-red-600">{v.totalCost.toLocaleString('fr-FR')} €</div>
                      <div className="text-xs text-slate-500">
                        {v.costPerKm > 0 ? `${v.costPerKm.toFixed(2)} €/km` : '—'}
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="p-6 text-center text-slate-400">
                  <CheckCircle2 size={32} className="mx-auto mb-2 text-green-400" />
                  <p className="text-sm">Aucune donnée ce mois</p>
                </div>
              )}
            </div>
          </div>

          {/* Top 5 Chauffeurs les plus économes */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
            <div className="p-4 border-b border-slate-100 bg-gradient-to-r from-green-50 to-emerald-50 flex items-center justify-between">
              <h3 className="font-bold text-slate-800 flex items-center gap-2">
                <Trophy size={18} className="text-green-500" /> Top 5 chauffeurs les plus économes
              </h3>
              <span className="text-xs font-medium text-slate-500">Ce mois</span>
            </div>
            <div className="divide-y divide-slate-100">
              {commonKpis.top5EconomicDrivers.length > 0 ? (
                commonKpis.top5EconomicDrivers.map((d, idx) => (
                  <div 
                    key={d.driver.id} 
                    className="p-3 hover:bg-slate-50 cursor-pointer transition-colors flex items-center justify-between"
                    onClick={() => onNavigate('drivers')}
                  >
                    <div className="flex items-center gap-3">
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                        idx === 0 ? 'bg-yellow-100 text-yellow-700' : 
                        idx === 1 ? 'bg-slate-200 text-slate-700' : 
                        idx === 2 ? 'bg-orange-100 text-orange-700' :
                        'bg-slate-100 text-slate-600'
                      }`}>
                        {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : idx + 1}
                      </span>
                      <div>
                        <div className="font-semibold text-slate-800">{d.driver.firstName} {d.driver.lastName}</div>
                        <div className="text-xs text-slate-500">{d.vehicle?.plate || '—'}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-green-600">{d.consumption?.toFixed(1)} L/100km</div>
                      <div className="text-xs text-slate-500">{d.distance.toLocaleString('fr-FR')} km</div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="p-6 text-center text-slate-400">
                  <UserIcon size={32} className="mx-auto mb-2 text-slate-300" />
                  <p className="text-sm">Données insuffisantes</p>
                  <p className="text-xs mt-1">Min. 100 km requis</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Deux colonnes : État flotte / Suivi RH */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <StatListCard
            title="État de la Flotte"
            icon={<Truck size={18} className="text-blue-500" />}
            items={[
              { 
                label: 'CT expirés', 
                value: commonKpis.vehiclesCTExpired.length, 
                status: commonKpis.vehiclesCTExpired.length > 0 ? 'danger' : 'ok',
                onClick: () => onNavigate('vehicles')
              },
              { 
                label: 'CT < 30 jours', 
                value: commonKpis.vehiclesCTSoon.length, 
                status: commonKpis.vehiclesCTSoon.length > 0 ? 'warning' : 'ok',
                onClick: () => onNavigate('vehicles')
              },
              { 
                label: 'Véhicules immobilisés', 
                value: commonKpis.vehiclesInMaintenance.length, 
                status: commonKpis.vehiclesInMaintenance.length > 0 ? 'danger' : 'ok',
                onClick: () => onNavigate('issues')
              },
              { 
                label: 'Incidents ouverts', 
                value: commonKpis.openIssues.length, 
                status: commonKpis.openIssues.length > 0 ? 'warning' : 'ok',
                onClick: () => onNavigate('issues')
              },
            ]}
          />
          <StatListCard
            title="Suivi RH"
            icon={<Users size={18} className="text-purple-500" />}
            items={[
              { 
                label: 'Congés à valider', 
                value: commonKpis.pendingLeaves.length, 
                status: commonKpis.pendingLeaves.length > 0 ? 'warning' : 'ok',
                onClick: () => onNavigate('leaves')
              },
              { 
                label: 'Permis expirés/< 30j', 
                value: commonKpis.driversLicenseExpired.length + commonKpis.driversLicenseSoon.length, 
                status: commonKpis.driversLicenseExpired.length > 0 ? 'danger' : commonKpis.driversLicenseSoon.length > 0 ? 'warning' : 'ok',
                onClick: () => onNavigate('drivers')
              },
              { 
                label: 'FCO/FIMO < 60j', 
                value: commonKpis.driversFCOExpired.length + commonKpis.driversFCOSoon.length, 
                status: commonKpis.driversFCOExpired.length > 0 ? 'danger' : commonKpis.driversFCOSoon.length > 0 ? 'warning' : 'ok',
                onClick: () => onNavigate('drivers')
              },
              { 
                label: 'Visite médicale < 30j', 
                value: commonKpis.driversMedicalExpired.length + commonKpis.driversMedicalSoon.length, 
                status: commonKpis.driversMedicalExpired.length > 0 ? 'danger' : commonKpis.driversMedicalSoon.length > 0 ? 'warning' : 'ok',
                onClick: () => onNavigate('drivers')
              },
              { 
                label: 'Documents non signés', 
                value: pendingDocuments, 
                status: pendingDocuments > 0 ? 'warning' : 'ok',
                onClick: () => onNavigate('company_docs')
              },
            ]}
          />
        </div>

        {/* Graphique évolution */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <h3 className="text-lg font-bold text-slate-800 mb-4">Évolution des coûts (6 mois)</h3>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#64748b'}} />
                <YAxis axisLine={false} tickLine={false} tick={{fill: '#64748b'}} />
                <Tooltip 
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                  formatter={(value: number) => `${value.toLocaleString()} €`}
                />
                <Bar dataKey="carburant" name="Carburant" fill="#0ea5e9" radius={[4, 4, 0, 0]} stackId="stack" />
                <Bar dataKey="maintenance" name="Maintenance" fill="#f97316" radius={[4, 4, 0, 0]} stackId="stack" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Véhicules en surconsommation + État du parc */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Surconsommation */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
            <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
              <h3 className="font-bold text-slate-800 flex items-center gap-2">
                <AlertTriangle size={18} className="text-orange-500" /> Véhicules en surconsommation
              </h3>
              <span className="text-xs font-bold bg-orange-100 text-orange-700 px-2 py-1 rounded-full">
                +15% vs moyenne
              </span>
            </div>
            <div className="divide-y divide-slate-100 max-h-[250px] overflow-y-auto">
              {commonKpis.overConsumingVehicles.slice(0, 5).map(v => (
                <div key={v.id} className="p-3 flex items-center justify-between hover:bg-slate-50">
                  <div>
                    <p className="font-bold text-slate-800 text-sm">{v.plate}</p>
                    <p className="text-xs text-slate-500">{v.model}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-orange-600">{v.consumption.toFixed(1)} L/100km</p>
                    <p className="text-xs text-slate-400">+{((v.consumption / commonKpis.avgConsumption - 1) * 100).toFixed(0)}%</p>
                  </div>
                </div>
              ))}
              {commonKpis.overConsumingVehicles.length === 0 && (
                <div className="p-6 text-center text-slate-400">
                  <CheckCircle2 size={32} className="mx-auto mb-2 text-green-400" />
                  <p className="text-sm">Aucune anomalie détectée</p>
                </div>
              )}
            </div>
          </div>

          {/* État du parc (Pie) */}
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
            <h3 className="text-lg font-bold text-slate-800 mb-4">État du Parc</h3>
            <div className="flex items-center justify-center">
              <div className="relative w-48 h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={statusData} innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value" stroke="none">
                      {statusData.map((entry, index) => <Cell key={`cell-${index}`} fill={STATUS_COLORS[entry.name] || '#94a3b8'} />)}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-3xl font-extrabold text-slate-800">{vehicles.length}</span>
                  <span className="text-xs font-bold text-slate-400 uppercase">Total</span>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 mt-4">
              {statusData.map((item, index) => (
                <div key={index} className="flex items-center justify-between text-sm bg-slate-50 p-2 rounded-lg">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: STATUS_COLORS[item.name] }}></div>
                    <span className="text-slate-600 text-xs">{item.name}</span>
                  </div>
                  <span className="font-bold text-slate-800 text-xs">{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ============================================================================
  // RENDER: DIRECTEUR / SECRÉTAIRE (Opérationnel)
  // ============================================================================

  return (
    <div className="space-y-6 animate-fade-in pb-10">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 mb-2">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Tableau de Bord Opérationnel</h2>
          <p className="text-slate-500">Bonjour {currentUser.firstName}, voici les actions du jour.</p>
        </div>
        <div className="flex items-center bg-white rounded-xl border border-slate-200 shadow-sm p-1">
          <button onClick={() => handleNavigateDate(-1)} className="p-2 hover:bg-slate-100 rounded-lg text-slate-500"><ChevronLeft size={18} /></button>
          <div className="px-3 min-w-[140px] text-center">
            <span className="block text-sm font-bold text-slate-800 capitalize">{getPeriodLabel()}</span>
          </div>
          <button onClick={() => handleNavigateDate(1)} className="p-2 hover:bg-slate-100 rounded-lg text-slate-500"><ChevronRight size={18} /></button>
        </div>
      </div>

      {/* KPIs principaux */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          title="Véhicules disponibles"
          value={`${commonKpis.activeVehicles}/${commonKpis.totalVehicles}`}
          subtitle={`${commonKpis.availabilityRate.toFixed(0)}% disponibilité`}
          icon={<Truck size={24} />}
          color={commonKpis.availabilityRate >= 85 ? 'green' : 'orange'}
          onClick={() => onNavigate('vehicles')}
        />
        <KpiCard
          title="Incidents ouverts"
          value={commonKpis.openIssues.length}
          subtitle={commonKpis.criticalIssues.length > 0 ? `${commonKpis.criticalIssues.length} critique(s)` : 'Aucun critique'}
          icon={<AlertTriangle size={24} />}
          color={commonKpis.criticalIssues.length > 0 ? 'red' : commonKpis.openIssues.length > 0 ? 'orange' : 'green'}
          onClick={() => onNavigate('issues')}
        />
        <KpiCard
          title="Chauffeurs disponibles"
          value={`${commonKpis.activeDrivers}/${commonKpis.totalDrivers}`}
          subtitle={`${commonKpis.driversOnLeaveToday.length} en congés`}
          icon={<Users size={24} />}
          color="purple"
          onClick={() => onNavigate('drivers')}
        />
        <KpiCard
          title="Actions à traiter"
          value={commonKpis.pendingLeaves.length + commonKpis.openIssues.length + pendingDocuments}
          subtitle="en attente"
          icon={<CheckSquare size={24} />}
          color={commonKpis.pendingLeaves.length + commonKpis.openIssues.length > 0 ? 'orange' : 'green'}
        />
      </div>

      {/* Deux colonnes : À traiter + Véhicules immobilisés */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* À traiter aujourd'hui */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="p-4 border-b border-slate-100 bg-slate-50">
            <h3 className="font-bold text-slate-800 flex items-center gap-2">
              <CheckSquare size={18} className="text-blue-500" /> À traiter aujourd'hui
            </h3>
          </div>
          <div className="divide-y divide-slate-100">
            {commonKpis.pendingLeaves.length > 0 && (
              <button onClick={() => onNavigate('leaves')} className="w-full p-3 flex items-center justify-between hover:bg-slate-50 text-left">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-purple-100 rounded-lg"><Calendar size={16} className="text-purple-600" /></div>
                  <span className="text-sm text-slate-700">Valider les congés</span>
                </div>
                <span className="text-xs font-bold bg-purple-100 text-purple-700 px-2 py-1 rounded-full">
                  {commonKpis.pendingLeaves.length}
                </span>
              </button>
            )}
            {commonKpis.openIssues.length > 0 && (
              <button onClick={() => onNavigate('issues')} className="w-full p-3 flex items-center justify-between hover:bg-slate-50 text-left">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-red-100 rounded-lg"><AlertTriangle size={16} className="text-red-600" /></div>
                  <span className="text-sm text-slate-700">Incidents à traiter</span>
                </div>
                <span className="text-xs font-bold bg-red-100 text-red-700 px-2 py-1 rounded-full">
                  {commonKpis.openIssues.length}
                </span>
              </button>
            )}
            {commonKpis.overConsumingVehicles.length > 0 && (
              <button onClick={() => onNavigate('fuel')} className="w-full p-3 flex items-center justify-between hover:bg-slate-50 text-left">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-orange-100 rounded-lg"><Droplet size={16} className="text-orange-600" /></div>
                  <span className="text-sm text-slate-700">Vérifier surconsommations</span>
                </div>
                <span className="text-xs font-bold bg-orange-100 text-orange-700 px-2 py-1 rounded-full">
                  {commonKpis.overConsumingVehicles.length}
                </span>
              </button>
            )}
            {pendingDocuments > 0 && (
              <button onClick={() => onNavigate('company_docs')} className="w-full p-3 flex items-center justify-between hover:bg-slate-50 text-left">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-slate-100 rounded-lg"><FileSignature size={16} className="text-slate-600" /></div>
                  <span className="text-sm text-slate-700">Documents en attente</span>
                </div>
                <span className="text-xs font-bold bg-slate-100 text-slate-700 px-2 py-1 rounded-full">
                  {pendingDocuments}
                </span>
              </button>
            )}
            {commonKpis.pendingLeaves.length === 0 && commonKpis.openIssues.length === 0 && pendingDocuments === 0 && (
              <div className="p-6 text-center text-slate-400">
                <CheckCircle2 size={32} className="mx-auto mb-2 text-green-400" />
                <p className="text-sm font-medium">Tout est à jour !</p>
              </div>
            )}
          </div>
        </div>

        {/* Véhicules immobilisés */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
            <h3 className="font-bold text-slate-800 flex items-center gap-2">
              <XCircle size={18} className="text-red-500" /> Véhicules immobilisés
            </h3>
            {commonKpis.vehiclesInMaintenance.length > 0 && (
              <span className="text-xs font-bold bg-red-100 text-red-700 px-2 py-1 rounded-full animate-pulse">
                {commonKpis.vehiclesInMaintenance.length}
              </span>
            )}
          </div>
          <div className="divide-y divide-slate-100 max-h-[250px] overflow-y-auto">
            {commonKpis.vehiclesInMaintenance.map(v => {
              const issue = issues.find(i => i.vehicleId === v.id && i.status !== IssueStatus.RESOLVED);
              return (
                <div key={v.id} className="p-3 flex items-center justify-between hover:bg-slate-50">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-red-100 rounded-lg"><Truck size={16} className="text-red-600" /></div>
                    <div>
                      <p className="font-bold text-slate-800 text-sm">{v.plate}</p>
                      <p className="text-xs text-slate-500 truncate max-w-[150px]">
                        {issue?.description || 'En maintenance'}
                      </p>
                    </div>
                  </div>
                  <button 
                    onClick={() => onNavigate('issues')} 
                    className="text-xs font-bold text-brand-600 hover:text-brand-700"
                  >
                    Gérer
                  </button>
                </div>
              );
            })}
            {commonKpis.vehiclesInMaintenance.length === 0 && (
              <div className="p-6 text-center text-slate-400">
                <CheckCircle2 size={32} className="mx-auto mb-2 text-green-400" />
                <p className="text-sm">Tous les véhicules sont opérationnels</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Graphique + État du parc */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Graphique évolution (2 colonnes) */}
        <div className="lg:col-span-2 bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <h3 className="text-lg font-bold text-slate-800 mb-4">Évolution des coûts (6 mois)</h3>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#64748b'}} />
                <YAxis axisLine={false} tickLine={false} tick={{fill: '#64748b'}} />
                <Tooltip 
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                  formatter={(value: number) => `${value.toLocaleString()} €`}
                />
                <Bar dataKey="carburant" name="Carburant" fill="#0ea5e9" radius={[4, 4, 0, 0]} stackId="stack" />
                <Bar dataKey="maintenance" name="Maintenance" fill="#f97316" radius={[4, 4, 0, 0]} stackId="stack" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* État du parc (Pie) */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <h3 className="text-lg font-bold text-slate-800 mb-4">État du Parc</h3>
          <div className="flex items-center justify-center">
            <div className="relative w-40 h-40">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={statusData} innerRadius={50} outerRadius={70} paddingAngle={5} dataKey="value" stroke="none">
                    {statusData.map((entry, index) => <Cell key={`cell-${index}`} fill={STATUS_COLORS[entry.name] || '#94a3b8'} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl font-extrabold text-slate-800">{vehicles.length}</span>
                <span className="text-[10px] font-bold text-slate-400 uppercase">Total</span>
              </div>
            </div>
          </div>
          <div className="space-y-1 mt-4">
            {statusData.map((item, index) => (
              <div key={index} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: STATUS_COLORS[item.name] }}></div>
                  <span className="text-slate-600 text-xs">{item.name}</span>
                </div>
                <span className="font-bold text-slate-800 text-xs">{item.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Derniers pleins */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
          <h3 className="font-bold text-slate-800 flex items-center gap-2">
            <Droplet size={18} className="text-blue-500" /> Derniers pleins de carburant
          </h3>
          <button onClick={() => onNavigate('fuel')} className="text-xs font-bold text-brand-600 hover:text-brand-700">
            Voir tout →
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-3 text-left">Véhicule</th>
                <th className="px-4 py-3 text-left">Date</th>
                <th className="px-4 py-3 text-right">Volume</th>
                <th className="px-4 py-3 text-right">Coût</th>
                <th className="px-4 py-3 text-center">Statut</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {[...logs].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 5).map(log => {
                const vehicle = vehicles.find(v => v.id === log.vehicleId);
                const isOverConsuming = commonKpis.overConsumingVehicles.some(v => v.id === log.vehicleId);
                return (
                  <tr key={log.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <p className="font-bold text-slate-800 text-sm">{vehicle?.plate || 'N/A'}</p>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">
                      {new Date(log.date).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-medium text-slate-800">
                      {log.volume} L
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-bold text-slate-800">
                      {log.cost.toFixed(2)} €
                    </td>
                    <td className="px-4 py-3 text-center">
                      {isOverConsuming ? (
                        <span className="text-xs font-bold bg-orange-100 text-orange-700 px-2 py-1 rounded-full">
                          ⚠️ Surconso
                        </span>
                      ) : (
                        <span className="text-xs font-bold bg-green-100 text-green-700 px-2 py-1 rounded-full">
                          ✓ OK
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
