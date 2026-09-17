import React from 'react';
import { Package } from '../types';
export default function PackageScanInfo({ pkg }: { pkg: Package }) {
  const latest = [...(pkg.movements || [])].reverse().find(m => m.action === 'SCANNED');
  const sameTour = pkg.lastScannedMissionId === pkg.missionId;
  return <span className="block text-sm font-normal text-slate-600 mt-1">
    {pkg.missionId ? <>Tournée {sameTour && pkg.missionDate ? `du ${pkg.missionDate.split('-').reverse().join('/')} · ` : ''}<span className="break-all">{pkg.missionId}</span></> : 'Aucune tournée affectée'}
    <span className="block">{pkg.lastScannedAt ? <>Dernier scan : {new Date(pkg.lastScannedAt).toLocaleString('fr-FR', { timeZone: 'Indian/Reunion' })}{latest?.driverName ? ` · ${latest.driverName}` : ''}{!sameTour && latest?.missionDate ? ` · tournée du ${latest.missionDate.split('-').reverse().join('/')}` : ''}</> : 'Aucun scan horodaté enregistré'}</span>
  </span>;
}
