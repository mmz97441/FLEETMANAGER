import React from 'react';
import { LayoutDashboard, Truck, AlertCircle, Menu, Droplet } from 'lucide-react';
import { ViewState } from '../types';

interface MobileNavBarProps {
  currentView: ViewState;
  onChangeView: (view: ViewState) => void;
  onOpenMenu: () => void;
}

const MobileNavBar: React.FC<MobileNavBarProps> = ({ currentView, onChangeView, onOpenMenu }) => {
  const navItems = [
    { id: 'dashboard', icon: LayoutDashboard, label: 'Accueil' },
    { id: 'vehicles', icon: Truck, label: 'Véhicules' },
    { id: 'fuel', icon: Droplet, label: 'Carburant' },
    { id: 'issues', icon: AlertCircle, label: 'Incidents' },
  ];

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 lg:hidden z-40 px-4 py-2 pb-safe safe-area-bottom shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
      <div className="flex justify-around items-end">
        {navItems.map((item) => {
            const isActive = currentView === item.id;
            return (
                <button
                    key={item.id}
                    onClick={() => onChangeView(item.id as ViewState)}
                    className={`flex flex-col items-center gap-1 transition-all w-16 py-2 ${
                        isActive ? 'text-brand-600' : 'text-slate-400 hover:text-slate-600'
                    }`}
                >
                    <div className={`p-1 rounded-xl transition-all ${isActive ? 'bg-brand-50 -translate-y-1' : ''}`}>
                        <item.icon size={22} strokeWidth={isActive ? 2.5 : 2} />
                    </div>
                    <span className={`text-[10px] font-medium ${isActive ? 'font-bold' : ''}`}>{item.label}</span>
                </button>
            );
        })}
        
        {/* Menu Button to open Sidebar for other items */}
        <button
            onClick={onOpenMenu}
            className="flex flex-col items-center gap-1 text-slate-400 hover:text-slate-600 transition-colors w-16 py-2"
        >
            <div className="p-1">
                <Menu size={22} />
            </div>
            <span className="text-[10px] font-medium">Menu</span>
        </button>
      </div>
    </div>
  );
};

export default MobileNavBar;