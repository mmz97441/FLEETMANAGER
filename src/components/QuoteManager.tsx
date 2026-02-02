
import React, { useState, useMemo } from 'react';
import Modal from './shared/Modal';
import { QuoteRequest, QuoteStatus } from '../types';
import { Package, MapPin, Search, CheckCircle, Clock, XCircle, Euro, Send, Filter, ArrowRight, User, Phone, Box, Calendar, AlertTriangle, FileText, ChevronRight, Calculator, StickyNote, Printer } from 'lucide-react';
import ShippingLabel, { quoteToLabelData, ShippingLabelData } from './ShippingLabel';

interface QuoteManagerProps {
  quotes: QuoteRequest[];
  onUpdateQuote: (quote: QuoteRequest) => void;
}

const QuoteManager: React.FC<QuoteManagerProps> = ({ quotes, onUpdateQuote }) => {
  const [filter, setFilter] = useState<'all' | 'pending' | 'sent' | 'done'>('all');
  const [selectedQuote, setSelectedQuote] = useState<QuoteRequest | null>(null);
  
  // Form State
  const [offerPrice, setOfferPrice] = useState<string>('');
  const [offerNote, setOfferNote] = useState<string>('');
  
  // Confirmation Modal State
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  const [labelData, setLabelData] = useState<ShippingLabelData | null>(null);

  const filteredQuotes = quotes.filter(q => {
      if (filter === 'pending') return q.status === QuoteStatus.REQUESTED;
      if (filter === 'sent') return q.status === QuoteStatus.OFFER_SENT;
      if (filter === 'done') return [QuoteStatus.ACCEPTED, QuoteStatus.REJECTED].includes(q.status);
      return true;
  }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const handleOpenOffer = (quote: QuoteRequest) => {
      setSelectedQuote(quote);
      setOfferPrice(quote.priceOffer ? quote.priceOffer.toString() : '');
      setOfferNote(quote.adminNotes || '');
  };

  const handlePreSubmit = () => {
      if (!selectedQuote || !offerPrice) return;
      setIsConfirmModalOpen(true);
  };

  const handleConfirmSend = () => {
      if (!selectedQuote) return;
      
      const updatedQuote: QuoteRequest = {
          ...selectedQuote,
          priceOffer: Number(offerPrice),
          adminNotes: offerNote,
          status: QuoteStatus.OFFER_SENT
      };
      
      onUpdateQuote(updatedQuote);
      setIsConfirmModalOpen(false);
      setSelectedQuote(null); // On ferme pour passer au suivant
  };

  // Helper pour la timeline
  const getStepStatus = (step: number, currentStatus: QuoteStatus) => {
      let currentStep = 1;
      if (currentStatus === QuoteStatus.OFFER_SENT) currentStep = 2;
      if (currentStatus === QuoteStatus.ACCEPTED || currentStatus === QuoteStatus.REJECTED) currentStep = 3;

      if (step < currentStep) return 'completed';
      if (step === currentStep) return 'active';
      return 'pending';
  };

  return (
    <div className="space-y-6 animate-fade-in pb-10 relative">
        {/* En-tête */}
        <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <div>
                <h2 className="text-2xl font-bold text-slate-900">Gestion des Devis</h2>
                <p className="text-slate-600">Traitez les demandes entrantes et suivez les opportunités.</p>
            </div>
            
            <div className="flex bg-white p-1 rounded-xl border border-slate-200 shadow-sm">
                <button onClick={() => setFilter('all')} className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors ${filter === 'all' ? 'bg-slate-100 text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}>Tous</button>
                <button onClick={() => setFilter('pending')} className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors ${filter === 'pending' ? 'bg-orange-100 text-orange-800' : 'text-slate-500 hover:text-slate-700'}`}>À Traiter</button>
                <button onClick={() => setFilter('sent')} className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors ${filter === 'sent' ? 'bg-blue-100 text-blue-800' : 'text-slate-500 hover:text-slate-700'}`}>Offres en cours</button>
            </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-[calc(100vh-180px)]">
            {/* Colonne Liste (Gauche) */}
            <div className="lg:col-span-4 space-y-4 overflow-y-auto custom-scrollbar pr-2 h-full">
                {filteredQuotes.map(quote => (
                    <div 
                        key={quote.id} 
                        onClick={() => handleOpenOffer(quote)}
                        className={`p-5 rounded-xl border cursor-pointer transition-all hover:shadow-md relative overflow-hidden group ${
                            selectedQuote?.id === quote.id 
                            ? 'bg-blue-50 border-blue-500 ring-1 ring-blue-500' 
                            : 'bg-white border-slate-200 hover:border-blue-300'
                        }`}
                    >
                        {/* Indicateur visuel status */}
                        <div className={`absolute left-0 top-0 bottom-0 w-1 ${
                            quote.status === QuoteStatus.REQUESTED ? 'bg-orange-500' :
                            quote.status === QuoteStatus.OFFER_SENT ? 'bg-blue-500' :
                            quote.status === QuoteStatus.ACCEPTED ? 'bg-green-500' : 'bg-red-500'
                        }`}></div>

                        <div className="flex justify-between items-start mb-2 pl-2">
                            <div>
                                <h3 className="font-bold text-slate-900 text-sm truncate w-48" title={quote.clientName}>{quote.clientName}</h3>
                                {quote.requesterName && (
                                    <p className="text-[10px] text-slate-500 flex items-center gap-1"><User size={10}/> {quote.requesterName}</p>
                                )}
                                <p className="text-xs text-slate-400 font-medium mt-0.5">{new Date(quote.date).toLocaleDateString()}</p>
                            </div>
                            <div className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                quote.status === QuoteStatus.REQUESTED ? 'bg-orange-100 text-orange-800' :
                                quote.status === QuoteStatus.OFFER_SENT ? 'bg-blue-100 text-blue-800' :
                                quote.status === QuoteStatus.ACCEPTED ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                            }`}>
                                {quote.status === QuoteStatus.REQUESTED ? 'Nouveau' : quote.status}
                            </div>
                        </div>
                        
                        <div className="pl-2">
                            <div className="flex items-center gap-2 mb-2 text-xs font-bold text-slate-700">
                                <span className="truncate max-w-[80px]">{quote.origin}</span>
                                <ArrowRight size={12} className="text-slate-400 flex-shrink-0" />
                                <span className="truncate max-w-[80px]">{quote.destination}</span>
                            </div>
                            
                            <div className="flex justify-between items-end">
                                <span className="text-xs text-slate-600 truncate max-w-[150px] bg-slate-100 px-2 py-1 rounded">{quote.goodsDescription}</span>
                                {quote.priceOffer && <span className="font-bold text-slate-900 text-sm">{quote.priceOffer} €</span>}
                            </div>
                        </div>
                    </div>
                ))}
                {filteredQuotes.length === 0 && (
                    <div className="text-center py-12 bg-slate-50 rounded-xl border border-dashed border-slate-300 text-slate-500">
                        <Search size={32} className="mx-auto mb-2 opacity-50"/>
                        <p className="font-medium text-sm">Aucun dossier trouvé.</p>
                    </div>
                )}
            </div>

            {/* Colonne Détail / Action (Droite) */}
            <div className="lg:col-span-8 h-full">
                {selectedQuote ? (
                    <div className="bg-white rounded-2xl shadow-lg border border-slate-200 h-full flex flex-col overflow-hidden">
                        
                        {/* Header Detail */}
                        <div className="p-6 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                            <div>
                                <h3 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                                    <FileText size={20} className="text-blue-600" />
                                    Dossier #{selectedQuote.id.slice(-6).toUpperCase()}
                                </h3>
                                <p className="text-sm text-slate-600 font-medium mt-1">
                                    Client : <span className="text-slate-900 font-bold">{selectedQuote.clientName}</span>
                                    {selectedQuote.requesterName && (
                                        <span className="ml-2 bg-slate-200 px-2 py-0.5 rounded text-xs text-slate-700 font-semibold">
                                            Contact: {selectedQuote.requesterName}
                                        </span>
                                    )}
                                </p>
                            </div>
                            
                            {/* STATUS TIMELINE */}
                            <div className="hidden md:flex items-center gap-2">
                                <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold ${getStepStatus(1, selectedQuote.status) === 'active' ? 'bg-orange-600 text-white' : 'bg-slate-200 text-slate-500'}`}>
                                    1. Demande
                                </div>
                                <div className="h-0.5 w-4 bg-slate-300"></div>
                                <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold ${getStepStatus(2, selectedQuote.status) === 'active' ? 'bg-blue-600 text-white' : getStepStatus(2, selectedQuote.status) === 'completed' ? 'bg-blue-100 text-blue-800' : 'bg-slate-200 text-slate-500'}`}>
                                    2. Offre
                                </div>
                                <div className="h-0.5 w-4 bg-slate-300"></div>
                                <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold ${selectedQuote.status === QuoteStatus.ACCEPTED ? 'bg-green-600 text-white' : selectedQuote.status === QuoteStatus.REJECTED ? 'bg-red-600 text-white' : 'bg-slate-200 text-slate-500'}`}>
                                    3. Décision
                                </div>
                            </div>
                        </div>
                        
                        <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
                            
                            {/* --- ALERTE NOTES CLIENT (SI EXISTE) --- */}
                            {selectedQuote.clientNotes && (
                                <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 rounded-r-xl mb-6 shadow-sm">
                                    <h4 className="text-sm font-bold text-yellow-800 flex items-center gap-2 uppercase tracking-wide mb-1">
                                        <StickyNote size={16} /> Remarques Client
                                    </h4>
                                    <p className="text-slate-800 font-medium text-sm">
                                        "{selectedQuote.clientNotes}"
                                    </p>
                                </div>
                            )}

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {/* INFO MARCHANDISE */}
                                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                                    <h4 className="text-xs font-bold text-slate-500 uppercase mb-3 flex items-center gap-2">
                                        <Package size={14} /> Détails Marchandise
                                    </h4>
                                    <div className="space-y-3">
                                        <div className="bg-slate-50 p-3 rounded-lg text-sm text-slate-900 font-medium border border-slate-100">
                                            {selectedQuote.goodsDescription}
                                        </div>
                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <span className="text-xs text-slate-500 block">Poids</span>
                                                <span className="text-sm font-bold text-slate-900">{selectedQuote.weight ? `${selectedQuote.weight} kg` : '-'}</span>
                                            </div>
                                            <div>
                                                <span className="text-xs text-slate-500 block">Volume</span>
                                                <span className="text-sm font-bold text-slate-900">{selectedQuote.volume ? `${selectedQuote.volume.toFixed(3)} m3` : '-'}</span>
                                            </div>
                                            {selectedQuote.dimensions && (
                                                <div className="col-span-2">
                                                    <span className="text-xs text-slate-500 block">Dimensions</span>
                                                    <span className="text-sm font-bold text-slate-900">{selectedQuote.dimensions.length}x{selectedQuote.dimensions.width}x{selectedQuote.dimensions.height} cm</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* INFO TEMPORELLE */}
                                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                                    <h4 className="text-xs font-bold text-slate-500 uppercase mb-3 flex items-center gap-2">
                                        <Calendar size={14} /> Planning Souhaité
                                    </h4>
                                    <div className="space-y-4">
                                        <div className="flex items-start gap-3">
                                            <div className="mt-1 w-2 h-2 rounded-full bg-slate-400"></div>
                                            <div>
                                                <span className="text-xs text-slate-500 font-bold uppercase block">Enlèvement</span>
                                                <span className="text-sm font-bold text-slate-900">{new Date(selectedQuote.pickupDate).toLocaleString('fr-FR')}</span>
                                            </div>
                                        </div>
                                        <div className="h-4 border-l border-dashed border-slate-300 ml-1"></div>
                                        <div className="flex items-start gap-3">
                                            <div className="mt-1 w-2 h-2 rounded-full bg-blue-500"></div>
                                            <div>
                                                <span className="text-xs text-blue-600 font-bold uppercase block">Livraison</span>
                                                <span className="text-sm font-bold text-slate-900">{new Date(selectedQuote.deliveryDate).toLocaleString('fr-FR')}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* ITINÉRAIRE & CONTACTS */}
                                <div className="col-span-1 md:col-span-2 bg-slate-50 p-5 rounded-xl border border-slate-200">
                                    <h4 className="text-xs font-bold text-slate-500 uppercase mb-4 flex items-center gap-2">
                                        <MapPin size={14} /> Itinéraire & Contacts
                                    </h4>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                        {/* Départ - CORRIGÉ AVEC FLEXBOX */}
                                        <div className="flex gap-4">
                                            <div className="flex-shrink-0 mt-1">
                                                <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-slate-500">
                                                    <MapPin size={18}/>
                                                </div>
                                            </div>
                                            <div className="flex-1">
                                                <p className="text-xs text-slate-500 uppercase font-bold mb-1">Départ</p>
                                                <p className="text-lg font-bold text-slate-900 leading-tight">{selectedQuote.origin}</p>
                                                <p className="text-sm text-slate-600 mt-1">{selectedQuote.originAddress}</p>
                                                
                                                {selectedQuote.originContact && (
                                                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs bg-white p-2 rounded border border-slate-200 shadow-sm w-fit">
                                                        <User size={14} className="text-slate-400"/>
                                                        <span className="font-bold text-slate-800">{selectedQuote.originContact.name}</span>
                                                        <span className="text-slate-300">|</span>
                                                        <Phone size={14} className="text-slate-400"/>
                                                        <span className="font-medium text-slate-700">{selectedQuote.originContact.phone}</span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {/* Arrivée - CORRIGÉ AVEC FLEXBOX */}
                                        <div className="flex gap-4">
                                            <div className="flex-shrink-0 mt-1">
                                                <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600">
                                                    <MapPin size={18}/>
                                                </div>
                                            </div>
                                            <div className="flex-1">
                                                <p className="text-xs text-blue-600 uppercase font-bold mb-1">Arrivée</p>
                                                <p className="text-lg font-bold text-slate-900 leading-tight">{selectedQuote.destination}</p>
                                                <p className="text-sm text-slate-600 mt-1">{selectedQuote.destinationAddress}</p>
                                                
                                                {selectedQuote.destinationContact && (
                                                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs bg-white p-2 rounded border border-slate-200 shadow-sm w-fit">
                                                        <User size={14} className="text-blue-400"/>
                                                        <span className="font-bold text-slate-800">{selectedQuote.destinationContact.name}</span>
                                                        <span className="text-slate-300">|</span>
                                                        <Phone size={14} className="text-blue-400"/>
                                                        <span className="font-medium text-slate-700">{selectedQuote.destinationContact.phone}</span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* FOOTER ACTIONS */}
                        <div className="p-6 border-t border-slate-200 bg-white shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] z-10">
                            {selectedQuote.status === QuoteStatus.REQUESTED || selectedQuote.status === QuoteStatus.OFFER_SENT ? (
                                <div className="space-y-4">
                                    <div className="flex flex-col md:flex-row gap-4">
                                        <div className="flex-1">
                                            <label className="block text-xs font-bold text-slate-700 mb-1 uppercase">Prix de l'offre (HT)</label>
                                            <div className="relative">
                                                <Euro className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                                                <input 
                                                    type="number" 
                                                    className="w-full pl-10 pr-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-600 outline-none font-bold text-xl text-slate-900 bg-white"
                                                    value={offerPrice}
                                                    onChange={(e) => setOfferPrice(e.target.value)}
                                                    placeholder="0.00"
                                                />
                                            </div>
                                        </div>
                                        <div className="flex-[2]">
                                            <label className="block text-xs font-bold text-slate-700 mb-1 uppercase">Message / Conditions de l'offre</label>
                                            <input 
                                                type="text"
                                                className="w-full px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-600 outline-none text-slate-900 font-medium bg-white"
                                                value={offerNote}
                                                onChange={(e) => setOfferNote(e.target.value)}
                                                placeholder="Ex: Inclus frais de péage, validité 48h..."
                                            />
                                        </div>
                                    </div>
                                    
                                    <div className="flex justify-end">
                                        <button 
                                            onClick={handlePreSubmit}
                                            className="px-8 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold shadow-lg shadow-blue-200 flex items-center gap-2 transition-transform active:scale-95"
                                        >
                                            <Send size={18} /> {selectedQuote.status === QuoteStatus.OFFER_SENT ? 'Mettre à jour l\'offre' : 'Envoyer l\'offre au client'}
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div className={`p-4 rounded-xl text-center flex flex-col items-center justify-center gap-2 ${selectedQuote.status === QuoteStatus.ACCEPTED ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                                    {selectedQuote.status === QuoteStatus.ACCEPTED ? <CheckCircle size={32} className="text-green-600" /> : <XCircle size={32} className="text-red-600" />}
                                    <span className={`text-lg font-bold ${selectedQuote.status === QuoteStatus.ACCEPTED ? 'text-green-800' : 'text-red-800'}`}>
                                        Ce devis a été {selectedQuote.status === QuoteStatus.ACCEPTED ? 'accepté' : 'refusé'}.
                                    </span>
                                    {selectedQuote.status === QuoteStatus.ACCEPTED && (
                                        <button
                                            onClick={() => setLabelData(quoteToLabelData(selectedQuote))}
                                            className="mt-2 flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-xl text-sm font-bold hover:bg-green-700 transition-colors"
                                        >
                                            <Printer size={14} />
                                            Imprimer l'étiquette
                                        </button>
                                    )}
                                    {selectedQuote.convertedToPackageId && (
                                        <p className="text-xs text-green-600 mt-1">
                                            Colis #{selectedQuote.convertedToPackageId.slice(-6)} créé automatiquement
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="bg-slate-50 rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-500 h-full flex flex-col items-center justify-center">
                        <div className="bg-white p-4 rounded-full shadow-sm mb-4">
                            <Calculator size={48} className="text-blue-200" />
                        </div>
                        <h3 className="text-lg font-bold text-slate-700">Aucun devis sélectionné</h3>
                        <p className="font-medium">Sélectionnez une demande dans la liste pour établir une proposition.</p>
                    </div>
                )}
            </div>
        </div>

        {/* --- CONFIRMATION MODAL --- */}
        <Modal
            isOpen={isConfirmModalOpen && !!selectedQuote}
            onClose={() => setIsConfirmModalOpen(false)}
            size="sm"
            showCloseButton={false}
        >
            {selectedQuote && (
                <>
                    <div className="flex flex-col items-center text-center mb-6">
                        <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mb-4">
                            <Send size={32} className="text-blue-600" />
                        </div>
                        <h3 className="text-xl font-bold text-slate-900">Confirmer l'envoi ?</h3>
                        <p className="text-slate-600 mt-2 text-sm">
                            Vous êtes sur le point d'envoyer une offre de <strong className="text-slate-900 text-lg">{Number(offerPrice).toLocaleString()} € HT</strong> à <span className="font-bold">{selectedQuote.clientName}</span>.
                        </p>
                    </div>
                    
                    <div className="bg-slate-50 p-3 rounded-lg mb-6 text-xs text-slate-500 border border-slate-100">
                        <p className="flex gap-2 mb-1">
                            <span className="font-bold uppercase">Départ:</span> {selectedQuote.origin}
                        </p>
                        <p className="flex gap-2">
                            <span className="font-bold uppercase">Arrivée:</span> {selectedQuote.destination}
                        </p>
                    </div>

                    <div className="flex gap-3">
                        <button 
                            onClick={() => setIsConfirmModalOpen(false)} 
                            className="flex-1 py-3 bg-slate-100 text-slate-700 rounded-xl font-bold hover:bg-slate-200 transition-colors"
                        >
                            Annuler
                        </button>
                        <button 
                            onClick={handleConfirmSend} 
                            className="flex-1 py-3 text-white bg-blue-600 hover:bg-blue-700 rounded-xl font-bold shadow-lg transition-colors"
                        >
                            Confirmer
                        </button>
                    </div>
                </>
            )}
        </Modal>

        {/* ÉTIQUETTE D'EXPÉDITION */}
        {labelData && (
          <ShippingLabel
            data={labelData}
            onClose={() => setLabelData(null)}
          />
        )}
    </div>
  );
};

export default QuoteManager;