import React, { useState } from 'react';
import { Mail, Copy } from 'lucide-react';
import { FormInput, FormTextarea } from './shared/FormInput';
import { buildContextualSupportDraft, captureSupportContext, contextualSupportMailto } from '../utils/supportContext';

export default function SupportRequest() {
  const [subject, setSubject] = useState('Problème dans l’application');
  const [message, setMessage] = useState('');
  const [context, setContext] = useState(captureSupportContext);
  const [includeContext, setIncludeContext] = useState(true);
  const [preview, setPreview] = useState(false);
  const [status, setStatus] = useState('');
  const body = buildContextualSupportDraft(message, includeContext ? context : undefined);

  return (
    <section
      className="ui-panel p-4 space-y-3"
      aria-label="Contacter l’exploitation"
    >
      <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
        <Mail size={20} />
        Contacter l’exploitation
      </h3>
      <p className="text-sm text-slate-700">
        Décrivez l’action bloquée. Relisez le brouillon avant de l’ouvrir dans
        votre messagerie.
      </p>
      <FormInput label="Sujet" value={subject} onChange={event => { setSubject(event.target.value); setPreview(false); }} />
      <FormTextarea label="Votre demande" value={message} onChange={event => { setMessage(event.target.value); setPreview(false); }} rows={4} hint="N’ajoutez que les informations nécessaires pour comprendre le problème." />
      <label className="flex min-h-11 items-center gap-3 text-sm text-slate-700">
        <input type="checkbox" checked={includeContext} onChange={event => { setIncludeContext(event.target.checked); setPreview(false); }} className="h-5 w-5 shrink-0" />
        Joindre la version, l’écran, l’heure et la référence de la dernière
        erreur de cette session.
      </label>
      <p className="text-sm text-slate-600">
        Aucune photo, signature, adresse de destinataire ou position GPS n’est
        jointe automatiquement.
      </p>
      {!preview ? (
        <button
          type="button"
          disabled={!message.trim() || !subject.trim()}
          onClick={() => { setContext(captureSupportContext()); setPreview(true); setStatus(''); }}
          className="ui-button ui-button-primary w-full"
        >
          Relire le brouillon
        </button>
      ) : (
        <>
          <div className="rounded-xl border border-slate-300 bg-slate-50 p-3">
            <h4 className="font-bold text-slate-900">Aperçu — {subject}</h4>
            <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-sm text-slate-700">
              {body}
            </pre>
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              href={contextualSupportMailto(subject, body)}
              onClick={() => setStatus('Finalisez l’envoi dans votre messagerie. Si elle ne s’ouvre pas, copiez le brouillon et écrivez à direction@delivrex.io.')}
              className="ui-button ui-button-primary"
            >
              Ouvrir mon application email
            </a>
            <button
              type="button"
              onClick={async () => { try { await navigator.clipboard.writeText(body); setStatus('Brouillon copié.'); } catch { setStatus('Copie indisponible. Sélectionnez le texte dans l’aperçu pour le copier.'); } }}
              className="ui-button ui-button-secondary gap-2"
            >
              <Copy size={16} />
              Copier
            </button>
          </div>
        </>
      )}
      {status && (
        <p role="status" className="text-sm text-brand-900">
          {status}
        </p>
      )}
    </section>
  );
}
