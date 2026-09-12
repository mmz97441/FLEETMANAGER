
import React, { useState, useRef, useEffect } from 'react';
import Modal from './shared/Modal';
import PageHeader from './shared/PageHeader';
import { FormInput } from './shared/FormInput';
import { useUnsavedChanges } from '../hooks/useUnsavedChanges';
import { QuoteRequest, QuoteStatus } from '../types';
import { Package, MapPin, Search, CheckCircle, Clock, XCircle, Euro, Send, Filter, ArrowRight, User, Phone, Box, Calendar, AlertTriangle, FileText, ChevronRight, Calculator, StickyNote, Printer, ArrowLeft } from 'lucide-react';
import ShippingLabel, { quoteToLabelData, ShippingLabelData } from './ShippingLabel';
import { formatEuro, formatWeight, formatNumberFr } from '../utils/format';

interface QuoteManagerProps {
  quotes: QuoteRequest[];
  onUpdateQuote: (quote: QuoteRequest) => void | Promise<void>;
}

const QuoteManager: React.FC<QuoteManagerProps> = ({ quotes, onUpdateQuote }) => {
  const [filter, setFilter] = useState<'all' | 'pending' | 'sent' | 'done'>('all');
  const [selectedQuote, setSelectedQuote] = useState<QuoteRequest | null>(null);

  const opener = useRef<HTMLButtonElement | null>(null);
  const detailHeading = useRef<HTMLHeadingElement | null>(null);
  const listHeading = useRef<HTMLDivElement | null>(null);
  const [priceError, setPriceError] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const sendLock = useRef(false);
  // Form State
  const [offerPrice, setOfferPrice] = useState<string>('');
  const [offerNote, setOfferNote] = useState<string>('');

  const dirty = !!selectedQuote && (offerPrice !== (selectedQuote.priceOffer?.toString() || '') || offerNote !== (selectedQuote.adminNotes || ''));
  const requestLeave = useUnsavedChanges(dirty, sending);
  const restoreListFocus = useRef(false);
  useEffect(() => {
      if (selectedQuote) detailHeading.current?.focus();
      else if (restoreListFocus.current) { restoreListFocus.current = false; (opener.current?.isConnected ? opener.current : listHeading.current)?.focus(); }
  }, [selectedQuote?.id]);
  const returnToList = () => {
      restoreListFocus.current = true;
      setSelectedQuote(null);
  };
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
      setPriceError(''); setSendError('');
      setSelectedQuote(quote);
      setOfferPrice(quote.priceOffer != null ? quote.priceOffer.toString() : '');
      setOfferNote(quote.adminNotes || '');
  };

  const handlePreSubmit = () => {
      if (!selectedQuote) return;
      if (!offerPrice.trim() || !Number.isFinite(Number(offerPrice)) || Number(offerPrice) < 0) { setPriceError('Saisissez un prix positif ou nul.'); document.getElementById('quote-offer-price')?.focus(); return; }
      setPriceError('');
      setIsConfirmModalOpen(true);
  };

  const handleConfirmSend = async () => {
      if (!selectedQuote || sendLock.current) return;

      const updatedQuote: QuoteRequest = {
          ...selectedQuote,
          priceOffer: Number(offerPrice),
          adminNotes: offerNote,
          status: QuoteStatus.OFFER_SENT
      };

      sendLock.current = true; setSending(true); setSendError('');
      try {
          await onUpdateQuote(updatedQuote);
          setIsConfirmModalOpen(false);
          returnToList();
      } catch (error) { setSendError(`L’offre n’a pas été enregistrée. Votre saisie est conservée. ${error instanceof Error ? error.message : ''}`); }
      finally { sendLock.current = false; setSending(false); }
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
    <div className="min-w-0 space-y-4 pb-10 relative [overflow-wrap:anywhere]">
        <PageHeader title="Gestion des devis" description="Traitez les demandes et suivez les offres." />
        <div className={`flex flex-wrap gap-2 ${selectedQuote ? 'hidden lg:flex' : ''}`} aria-label="Filtrer les devis">
          {([['all', 'Tous'], ['pending', 'À traiter'], ['sent', 'Offres en cours'], ['done', 'Décisions reçues']] as const).map(([value, label]) =>
            <button type="button" key={value} className="ui-filter" aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}
        </div>

        <div className="grid min-w-0 grid-cols-1 lg:grid-cols-12 gap-4">
            {/* Colonne Liste (Gauche) */}
            <div ref={listHeading} tabIndex={-1} aria-label="Liste des devis" className={`lg:col-span-4 min-w-0 space-y-3 ${selectedQuote ? 'hidden lg:block' : ''}`}>
                {filteredQuotes.map(quote => (
                  <button type="button" key={quote.id}
                    aria-label={`Ouvrir le devis de ${quote.clientName}, du ${new Date(quote.date).toLocaleDateString('fr-FR')}, référence ${quote.id}`}
                    aria-pressed={selectedQuote?.id === quote.id} aria-controls="quote-detail"
                    onClick={event => { const button = event.currentTarget; void requestLeave(() => { opener.current = button; handleOpenOffer(quote); }); }}
                    className={`ui-panel block w-full min-w-0 p-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 ${selectedQuote?.id === quote.id ? 'ring-2 ring-blue-700' : 'hover:border-slate-400'}`}>
                    <span className="flex flex-wrap items-start justify-between gap-2">
                      <span className="min-w-0 flex-1 basis-40 break-words text-base font-bold text-slate-900">{quote.clientName}</span>
                      <span className="rounded-md bg-slate-100 px-2 py-1 text-sm font-medium text-slate-700">{quote.status === QuoteStatus.REQUESTED ? 'À traiter' : quote.status}</span>
                    </span>
                    {quote.requesterName && <span className="mt-1 block break-words text-sm text-slate-600">Contact : {quote.requesterName}</span>}
                    <span className="mt-1 block text-sm text-slate-600">{new Date(quote.date).toLocaleDateString('fr-FR')}</span>
                    <span className="mt-3 grid min-w-0 gap-1 text-sm text-slate-800">
                      <span className="break-words"><span className="font-semibold">Départ : </span>{quote.origin}</span>
                      <span className="break-words"><span className="font-semibold">Arrivée : </span>{quote.destination}</span>
                    </span>
                    <span className="mt-3 block break-words text-sm text-slate-600">{quote.goodsDescription}</span>
                    {quote.priceOffer != null && <span className="mt-2 block text-base font-semibold tabular-nums">{formatEuro(quote.priceOffer)} HT</span>}
                    <span className="mt-3 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-blue-800">Consulter le devis <ChevronRight size={18} aria-hidden="true" /></span>
                  </button>
                ))}
                {filteredQuotes.length === 0 && (
                    <div className="text-center py-12 bg-slate-50 rounded-xl border border-dashed border-slate-300 text-slate-500">
                        <Search size={32} className="mx-auto mb-2 opacity-50"/>
                        <p className="font-medium text-sm">Aucun dossier trouvé.</p>
                    </div>
                )}
            </div>

            {/* Colonne Détail / Action (Droite) */}
            <div id="quote-detail" className={`lg:col-span-8 min-w-0 ${selectedQuote ? '' : 'hidden lg:block'}`}>
                {selectedQuote ? (
                    <div className="ui-panel min-w-0 flex flex-col overflow-hidden">

                        <div className="border-b border-slate-200 px-3 py-2"><button type="button" className="ui-button ui-button-ghost" onClick={() => void requestLeave(returnToList)}><ArrowLeft size={18} />Revenir aux devis</button></div>
                        {/* Header Detail */}
                        <div className="p-4 sm:p-6 border-b border-slate-200 flex flex-wrap justify-between items-start gap-4">
                            <div>
                                <h3 ref={detailHeading} tabIndex={-1} className="text-xl font-bold text-slate-900 flex items-center gap-2 outline-none">
                                    <FileText size={20} className="text-blue-600" />
                                    Détail du devis
                                </h3>
                                <p className="mt-2 break-all text-sm text-slate-600">Référence : {selectedQuote.id}</p>
                                <p className="text-sm text-slate-600 font-medium mt-1 break-words">
                                    Client : <span className="text-slate-900 font-bold">{selectedQuote.clientName}</span>
                                    {selectedQuote.requesterName && (
                                        <span className="ml-2 bg-slate-200 px-2 py-0.5 rounded text-sm text-slate-700 font-semibold">
                                            Contact: {selectedQuote.requesterName}
                                        </span>
                                    )}
                                </p>
                            </div>

                            {/* STATUS TIMELINE */}
                            <div className="hidden xl:flex flex-wrap items-center gap-2">
                                <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-sm font-bold ${getStepStatus(1, selectedQuote.status) === 'active' ? 'bg-orange-600 text-white' : 'bg-slate-200 text-slate-500'}`}>
                                    1. Demande
                                </div>
                                <div className="h-0.5 w-4 bg-slate-300"></div>
                                <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-sm font-bold ${getStepStatus(2, selectedQuote.status) === 'active' ? 'bg-blue-600 text-white' : getStepStatus(2, selectedQuote.status) === 'completed' ? 'bg-blue-100 text-blue-800' : 'bg-slate-200 text-slate-500'}`}>
                                    2. Offre
                                </div>
                                <div className="h-0.5 w-4 bg-slate-300"></div>
                                <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-sm font-bold ${selectedQuote.status === QuoteStatus.ACCEPTED ? 'bg-green-600 text-white' : selectedQuote.status === QuoteStatus.REJECTED ? 'bg-red-600 text-white' : 'bg-slate-200 text-slate-500'}`}>
                                    3. Décision
                                </div>
                            </div>
                        </div>

                        <div className="min-w-0 p-4 sm:p-6">

                            {/* --- ALERTE NOTES CLIENT (SI EXISTE) --- */}
                            {selectedQuote.clientNotes && (
                                <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 rounded-r-xl mb-6 shadow-sm">
                                    <h4 className="text-sm font-bold text-yellow-800 flex items-center gap-2 uppercase tracking-wide mb-1">
                                        <StickyNote size={16} /> Remarques du client
                                    </h4>
                                    <p className="text-slate-800 font-medium text-sm">
                                        "{selectedQuote.clientNotes}"
                                    </p>
                                </div>
                            )}

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {/* INFO MARCHANDISE */}
                                <div className="min-w-0 border-b border-slate-200 pb-5">
                                    <h4 className="text-sm font-bold text-slate-500 uppercase mb-3 flex items-center gap-2">
                                        <Package size={14} /> Marchandise
                                    </h4>
                                    <div className="space-y-3">
                                        <div className="bg-slate-50 p-3 rounded-lg text-sm text-slate-900 font-medium border border-slate-100">
                                            {selectedQuote.goodsDescription}
                                        </div>
                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <span className="text-sm text-slate-500 block">Poids</span>
                                                <span className="text-sm font-bold text-slate-900">{formatWeight(selectedQuote.weight) || '-'}</span>
                                            </div>
                                            <div>
                                                <span className="text-sm text-slate-500 block">Volume</span>
                                                <span className="text-sm font-bold text-slate-900">{selectedQuote.volume ? `${formatNumberFr(selectedQuote.volume, 3)} m³` : '-'}</span>
                                            </div>
                                            {selectedQuote.dimensions && (
                                                <div className="md:col-span-2">
                                                    <span className="text-sm text-slate-500 block">Dimensions</span>
                                                    <span className="text-sm font-bold text-slate-900">{selectedQuote.dimensions.length}x{selectedQuote.dimensions.width}x{selectedQuote.dimensions.height} cm</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* INFO TEMPORELLE */}
                                <div className="min-w-0 border-b border-slate-200 pb-5">
                                    <h4 className="text-sm font-bold text-slate-500 uppercase mb-3 flex items-center gap-2">
                                        <Calendar size={14} /> Dates souhaitées
                                    </h4>
                                    <div className="space-y-4">
                                        <div className="flex items-start gap-3">
                                            <div className="mt-1 w-2 h-2 rounded-full bg-slate-400"></div>
                                            <div>
                                                <span className="text-sm text-slate-500 font-bold uppercase block">Enlèvement</span>
                                                <span className="text-sm font-bold text-slate-900">{new Date(selectedQuote.pickupDate).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</span>
                                            </div>
                                        </div>
                                        <div className="h-4 border-l border-dashed border-slate-300 ml-1"></div>
                                        <div className="flex items-start gap-3">
                                            <div className="mt-1 w-2 h-2 rounded-full bg-blue-500"></div>
                                            <div>
                                                <span className="text-sm text-blue-600 font-bold uppercase block">Livraison</span>
                                                <span className="text-sm font-bold text-slate-900">{new Date(selectedQuote.deliveryDate).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* ITINÉRAIRE & CONTACTS */}
                                <div className="col-span-1 md:md:col-span-2 bg-slate-50 p-5 rounded-xl border border-slate-200">
                                    <h4 className="text-sm font-bold text-slate-500 uppercase mb-4 flex items-center gap-2">
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
                                            <div className="min-w-0 flex-1">
                                                <p className="text-sm text-slate-500 uppercase font-bold mb-1">Départ</p>
                                                <p className="text-lg font-bold text-slate-900 leading-tight">{selectedQuote.origin}</p>
                                                <p className="text-sm text-slate-600 mt-1">{selectedQuote.originAddress}</p>

                                                {selectedQuote.originContact && (
                                                    <div className="mt-3 flex flex-wrap items-center gap-2 text-sm bg-white p-2 rounded border border-slate-200 shadow-sm w-fit">
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
                                            <div className="min-w-0 flex-1">
                                                <p className="text-sm text-blue-600 uppercase font-bold mb-1">Arrivée</p>
                                                <p className="text-lg font-bold text-slate-900 leading-tight">{selectedQuote.destination}</p>
                                                <p className="text-sm text-slate-600 mt-1">{selectedQuote.destinationAddress}</p>

                                                {selectedQuote.destinationContact && (
                                                    <div className="mt-3 flex flex-wrap items-center gap-2 text-sm bg-white p-2 rounded border border-slate-200 shadow-sm w-fit">
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
                        <div className="p-4 sm:p-6 border-t border-slate-200 bg-white">
                            {selectedQuote.status === QuoteStatus.REQUESTED || selectedQuote.status === QuoteStatus.OFFER_SENT ? (
                                <div className="space-y-4">
                                    <div className="flex flex-col md:flex-row gap-4">
                                        <div className="min-w-0 flex-1"><FormInput id="quote-offer-price" label="Prix de l’offre (HT)" icon={Euro} type="number" min="0" step="0.01" value={offerPrice} onChange={event => setOfferPrice(event.target.value)} error={priceError} placeholder="0,00" /></div>
                                        <div className="min-w-0 flex-[2]"><FormInput label="Message ou conditions de l’offre" value={offerNote} onChange={event => setOfferNote(event.target.value)} placeholder="Frais inclus, durée de validité…" /></div>
                                    </div>

                                    <div className="flex justify-end">
                                        <button
                                            onClick={handlePreSubmit}
                                            className="ui-button ui-button-primary flex items-center gap-2"
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
                                            className="ui-button ui-button-primary mt-2 flex items-center gap-2 text-sm"
                                        >
                                            <Printer size={14} />
                                            Imprimer l'étiquette
                                        </button>
                                    )}
                                    {selectedQuote.convertedToPackageId && (
                                        <p className="break-all text-sm text-green-800 mt-1">
                                            Colis #{selectedQuote.convertedToPackageId} créé automatiquement
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
      mobileFullscreen
            isOpen={isConfirmModalOpen && !!selectedQuote}
            onClose={() => setIsConfirmModalOpen(false)} busy={sending} preventClose={sending}
            size="sm"
            title="Confirmer l’envoi de l’offre"
            footer={<div className="flex gap-3">
                        <button
                            disabled={sending} onClick={() => setIsConfirmModalOpen(false)}
                            className="ui-button ui-button-secondary flex-1"
                        >
                            Annuler
                        </button>
                        <button
                            disabled={sending} aria-busy={sending} onClick={handleConfirmSend}
                            className="ui-button ui-button-primary flex-1"
                        >
                            {sending ? 'Envoi…' : 'Confirmer'}
                        </button>
                    </div>}
        >
            {selectedQuote && (
                <>
                    {sendError && <p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-900">{sendError}</p>}
                    <div className="flex flex-col items-center text-center mb-6">


                        <p className="text-slate-600 mt-2 text-sm">
                            Vous êtes sur le point d'envoyer une offre de <strong className="text-slate-900 text-lg">{formatEuro(Number(offerPrice))} HT</strong> à <span className="font-bold">{selectedQuote.clientName}</span>.
                        </p>
                    </div>

                    <div className="bg-slate-50 p-3 rounded-lg mb-6 text-sm text-slate-500 border border-slate-100">
                        <p className="flex gap-2 mb-1">
                            <span className="font-bold uppercase">Départ:</span> {selectedQuote.origin}
                        </p>
                        <p className="flex gap-2">
                            <span className="font-bold uppercase">Arrivée:</span> {selectedQuote.destination}
                        </p>
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
