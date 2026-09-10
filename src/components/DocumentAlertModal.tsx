import React from 'react';
import Modal from './shared/Modal';
import { FileWarning, AlertTriangle, FileSignature, Clock, ChevronRight, X } from 'lucide-react';
import { CompanyDocument, DocumentAcknowledgment, DocumentPriority, User, UserRole } from '../types';

interface DocumentAlertModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGoToDocuments: () => void;
  onHelp?: () => void;
  pendingDocuments: CompanyDocument[];
  currentUser: User;
  /** true = obligatoire : pas de « Plus tard », l'utilisateur DOIT lire/signer. */
  blocking?: boolean;
}

const DocumentAlertModal: React.FC<DocumentAlertModalProps> = ({
  isOpen,
  onClose,
  onGoToDocuments,
  onHelp,
  pendingDocuments,
  currentUser,
  blocking = false
}) => {
  if (!isOpen || pendingDocuments.length === 0) return null;

  // Trier par priorité (URGENT d'abord)
  const sortedDocs = [...pendingDocuments].sort((a, b) => {
    const priorityOrder: Record<DocumentPriority, number> = {
      [DocumentPriority.URGENT]: 0,
      [DocumentPriority.IMPORTANT]: 1,
      [DocumentPriority.NORMAL]: 2,
    };
    return priorityOrder[a.priority] - priorityOrder[b.priority];
  });

  const urgentCount = pendingDocuments.filter(d => d.priority === DocumentPriority.URGENT || d.priority === DocumentPriority.IMPORTANT).length;
  const hasUrgent = urgentCount > 0;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={blocking ? "Documents obligatoires à consulter" : "Documents en attente"} size="lg" preventClose={blocking} showCloseButton={!blocking} closeOnOverlay={!blocking} closeOnEscape={!blocking} bodyClassName="!p-0">
      <div className={`bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden transform transition-all ${
        hasUrgent ? 'ring-4 ring-red-500/50' : 'ring-4 ring-amber-500/50'
      }`}>

        {/* Header avec icône animée */}
        <div className={`p-6 ${hasUrgent ? 'bg-red-700' : 'bg-amber-800'}`}>
          <div className="flex items-start gap-4">
            <div className={`p-3 rounded-xl ${hasUrgent ? 'bg-red-400/30' : 'bg-amber-400/30'} animate-pulse`}>
              <FileWarning size={32} className="text-white" />
            </div>
            <div className="flex-1">
              <h2 className="text-xl font-bold text-white">
                {hasUrgent ? '⚠️ Documents urgents à consulter' : '📋 Documents en attente'}
              </h2>
              <p className="text-white/90 mt-1">
                Bonjour <span className="font-semibold">{currentUser.firstName}</span>, vous avez{' '}
                <span className="font-bold text-white">{pendingDocuments.length} document{pendingDocuments.length > 1 ? 's' : ''}</span>{' '}
                à lire ou à signer selon les instructions.
              </p>
            </div>
          </div>
        </div>

        {/* Liste des documents */}
        <div className="p-4 max-h-[300px] overflow-y-auto">
          <p className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-3">
            Documents à traiter
          </p>

          <div className="space-y-2">
            {sortedDocs.slice(0, 5).map((doc) => (
              <div
                key={doc.id}
                className={`flex items-center gap-3 p-3 rounded-xl border transition-colors ${
                  doc.priority === DocumentPriority.URGENT
                    ? 'bg-red-50 border-red-200'
                    : doc.priority === DocumentPriority.IMPORTANT
                      ? 'bg-orange-50 border-orange-200'
                      : 'bg-slate-50 border-slate-200'
                }`}
              >
                <div className={`p-2 rounded-lg ${
                  doc.priority === DocumentPriority.URGENT
                    ? 'bg-red-100'
                    : doc.priority === DocumentPriority.IMPORTANT
                      ? 'bg-orange-100'
                      : 'bg-slate-200'
                }`}>
                  {doc.requiresSignature ? (
                    <FileSignature size={18} className={
                      doc.priority === DocumentPriority.URGENT
                        ? 'text-red-600'
                        : doc.priority === DocumentPriority.IMPORTANT
                          ? 'text-orange-600'
                          : 'text-slate-600'
                    } />
                  ) : (
                    <FileWarning size={18} className="text-slate-600" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-slate-800 break-words">{doc.title}</p>
                  <div className="flex flex-wrap items-center gap-2 mt-0.5">
                    {doc.priority === DocumentPriority.URGENT && (
                      <span className="inline-flex items-center gap-1 text-sm font-bold text-red-600 bg-red-100 px-2 py-0.5 rounded-full">
                        <AlertTriangle size={10} /> URGENT
                      </span>
                    )}
                    {doc.priority === DocumentPriority.IMPORTANT && (
                      <span className="inline-flex items-center gap-1 text-sm font-bold text-orange-600 bg-orange-100 px-2 py-0.5 rounded-full">
                        PRIORITAIRE
                      </span>
                    )}
                    {doc.requiresSignature && (
                      <span className="text-sm text-slate-500">
                        Signature requise
                      </span>
                    )}
                  </div>
                </div>

                <ChevronRight size={18} className="text-slate-600" />
              </div>
            ))}

            {pendingDocuments.length > 5 && (
              <p className="text-center text-sm text-slate-500 py-2">
                + {pendingDocuments.length - 5} autre(s) document(s)
              </p>
            )}
          </div>
        </div>

        {/* Avertissement légal */}
        <div className="px-4 pb-4">
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
            <p className="text-sm text-amber-800">
              <strong>⚠️ Important :</strong> Consultez chaque document et signez ceux qui demandent une signature.
              En signant, vous attestez avoir lu et compris le contenu du document.
            </p>
          </div>
        </div>

        {onHelp && <div className="px-4 pb-4"><button type="button" onClick={onHelp} className="min-h-11 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm font-bold text-slate-800">Besoin d’aide pour consulter ou signer ?</button></div>}
        {/* Actions */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex gap-3">
          {!blocking && (
            <button
              onClick={onClose}
              className="min-h-11 flex-1 py-3 px-4 border border-slate-300 rounded-xl text-slate-600 font-medium hover:bg-slate-100 transition-colors"
            >
              Plus tard
            </button>
          )}
          <button
            onClick={onGoToDocuments}
            className={`flex-1 py-3 px-4 rounded-xl text-white font-bold flex items-center justify-center gap-2 transition-colors ${
              hasUrgent
                ? 'bg-red-700 hover:bg-red-800'
                : 'bg-amber-800 hover:bg-amber-900'
            }`}
          >
            <FileSignature size={18} />
            Consulter les documents
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default DocumentAlertModal;
