import React, { useState } from 'react';
import { User } from '../types';
import { FileText, CheckCircle, AlertTriangle, Upload, Calendar, Clock, Truck } from 'lucide-react';
import { useToast } from './shared/Toast';

interface DriverDocumentsProps {
  currentUser: User;
}

const DriverDocuments: React.FC<DriverDocumentsProps> = ({ currentUser }) => {
  const { showToast } = useToast();

  const [lastScanDate, setLastScanDate] = useState<string>(currentUser.driverLicenseScanDate || '2023-01-01');
  const [fcoDate, setFcoDate] = useState<string>(currentUser.fcoDate || '2024-06-01');
  const [isUploading, setIsUploading] = useState(false);

  // Helper to check 6 month rule for license
  const checkLicenseValidity = () => {
      const scan = new Date(lastScanDate);
      const now = new Date();
      const diffMonths = (now.getTime() - scan.getTime()) / (1000 * 3600 * 24 * 30);
      return diffMonths < 6;
  };

  const isLicenseValid = checkLicenseValidity();
  
  // Helper to check FCO validity (e.g. valid if date is in future)
  const isFcoValid = new Date(fcoDate) > new Date();
  
  const handleUploadLicense = () => {
      setIsUploading(true);
      setTimeout(() => {
          setIsUploading(false);
          setLastScanDate(new Date().toISOString().split('T')[0]);
          showToast("Nouveau scan de permis validé et enregistré !", 'success');
      }, 1500);
  };

  return (
    <div className="space-y-6 animate-fade-in">
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
                <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                    <FileText className="text-brand-600" /> Mes Documents
                </h2>
                <p className="text-slate-500">Gestion de la conformité de vos permis et formations.</p>
            </div>
            <div className="bg-blue-50 text-blue-700 px-4 py-2 rounded-lg text-sm font-medium">
                Chauffeur : {currentUser.firstName} {currentUser.lastName}
            </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            
            {/* --- CARD 1: PERMIS DE CONDUIRE --- */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                <div className="p-6 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                    <h3 className="font-bold text-slate-800 flex items-center gap-2">
                        <Truck size={20} className="text-slate-500" /> Permis de Conduire
                    </h3>
                    {isLicenseValid ? (
                        <span className="bg-green-100 text-green-700 text-xs px-2 py-1 rounded-full font-bold flex items-center gap-1">
                            <CheckCircle size={12} /> À jour
                        </span>
                    ) : (
                        <span className="bg-red-100 text-red-700 text-xs px-2 py-1 rounded-full font-bold flex items-center gap-1 animate-pulse">
                            <AlertTriangle size={12} /> Action Requise
                        </span>
                    )}
                </div>
                <div className="p-6 space-y-6">
                    <div className="flex items-start gap-4">
                         <div className={`p-3 rounded-full ${isLicenseValid ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>
                             {isLicenseValid ? <CheckCircle size={32} /> : <AlertTriangle size={32} />}
                         </div>
                         <div>
                             <p className="font-bold text-slate-800 text-lg">Vérification Semestrielle</p>
                             <p className="text-sm text-slate-500 mt-1">
                                 Vous devez déposer une preuve de détention de permis valide tous les 6 mois.
                             </p>
                             <div className="mt-2 flex items-center gap-2 text-sm font-medium text-slate-600 bg-slate-50 inline-block px-3 py-1 rounded">
                                 <Clock size={16} /> Dernier scan : {new Date(lastScanDate).toLocaleDateString()}
                             </div>
                         </div>
                    </div>

                    <div className="border-t border-slate-100 pt-6">
                        <label className="block text-sm font-bold text-slate-700 mb-2">Mettre à jour mon permis</label>
                        <div className="border-2 border-dashed border-slate-300 rounded-xl p-6 flex flex-col items-center justify-center text-center cursor-pointer hover:bg-slate-50 hover:border-brand-400 transition-colors group">
                            <Upload size={32} className="text-slate-400 group-hover:text-brand-500 mb-2" />
                            <p className="text-slate-600 font-medium">Cliquez pour scanner ou déposer le fichier</p>
                            <p className="text-xs text-slate-400 mt-1">PDF, JPG ou PNG (Max 5Mo)</p>
                        </div>
                        <button 
                            onClick={handleUploadLicense}
                            disabled={isUploading}
                            className="w-full mt-4 bg-brand-600 hover:bg-brand-700 text-white py-3 rounded-xl font-bold transition-colors flex items-center justify-center gap-2"
                        >
                            {isUploading ? 'Envoi en cours...' : 'Valider le dépôt'}
                        </button>
                    </div>
                </div>
            </div>

            {/* --- CARD 2: FCO / FIMO (PL ONLY) --- */}
            {currentUser.isHeavyGoodsDriver && (
                <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                    <div className="p-6 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                        <h3 className="font-bold text-slate-800 flex items-center gap-2">
                            <FileText size={20} className="text-slate-500" /> Formations (PL)
                        </h3>
                        {isFcoValid ? (
                            <span className="bg-green-100 text-green-700 text-xs px-2 py-1 rounded-full font-bold flex items-center gap-1">
                                <CheckCircle size={12} /> Valide
                            </span>
                        ) : (
                            <span className="bg-orange-100 text-orange-700 text-xs px-2 py-1 rounded-full font-bold flex items-center gap-1">
                                <AlertTriangle size={12} /> Expire Bientôt
                            </span>
                        )}
                    </div>
                    <div className="p-6 space-y-6">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                                <p className="text-xs text-slate-400 uppercase font-bold mb-1">FIMO (Initiale)</p>
                                <p className="font-bold text-slate-800 flex items-center gap-2">
                                    <CheckCircle size={16} className="text-green-500" /> Obtenue
                                </p>
                                <p className="text-xs text-slate-500 mt-1">Date: {currentUser.fimoDate || 'N/A'}</p>
                            </div>
                            <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                                <p className="text-xs text-slate-400 uppercase font-bold mb-1">FCO (Continue)</p>
                                <p className={`font-bold flex items-center gap-2 ${isFcoValid ? 'text-green-600' : 'text-orange-600'}`}>
                                    {isFcoValid ? 'Valide' : 'Expire'}
                                </p>
                                <p className="text-xs text-slate-500 mt-1 flex items-center gap-1">
                                    <Calendar size={12} /> Fin: {fcoDate}
                                </p>
                            </div>
                        </div>

                        {!isFcoValid && (
                            <div className="p-4 bg-orange-50 text-orange-800 rounded-xl text-sm border border-orange-100 flex gap-3">
                                <AlertTriangle className="flex-shrink-0 mt-0.5" size={18} />
                                <div>
                                    <span className="font-bold block">Renouvellement Nécessaire</span>
                                    Votre FCO arrive à expiration. Veuillez contacter le service RH pour planifier votre stage de renouvellement.
                                </div>
                            </div>
                        )}

                        <div className="border-t border-slate-100 pt-6">
                            <label className="block text-sm font-bold text-slate-700 mb-2">Mise à jour Certificat FCO</label>
                            <div className="flex gap-2">
                                <input 
                                    type="date" 
                                    className="flex-1 px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-brand-500 outline-none"
                                    value={fcoDate}
                                    onChange={(e) => setFcoDate(e.target.value)}
                                />
                                <button className="bg-slate-800 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-900">
                                    Sauvegarder
                                </button>
                            </div>
                            <p className="text-xs text-slate-400 mt-2">
                                Modifiez la date uniquement après réception de votre nouvelle carte de qualification.
                            </p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    </div>
  );
};

export default DriverDocuments;