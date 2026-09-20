/**
 * VERROU GPS CHAUFFEUR
 * ====================
 * Pour les CHAUFFEURS uniquement : l'application n'est utilisable qu'avec la
 * localisation activée et une position obtenue. Tant que ce n'est pas le cas,
 * un écran bloquant plein écran s'affiche (bouton d'activation + instructions
 * personnalisées selon la cause). Dès qu'une position est obtenue, le verrou
 * disparaît. On ne bloque PAS en continu ensuite (pas de coupure en pleine
 * livraison sur une perte de signal passagère) — les moments critiques
 * (livraison, départ de tournée) restent protégés par leurs propres contrôles.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import Modal from './shared/Modal';
import { MapPin, Loader2, RefreshCw } from 'lucide-react';
import { User } from '../types';
import { getPositionRobust, isInAppBrowser } from '../utils/geo';

type GpsState = 'checking' | 'ok' | 'need_permission' | 'denied' | 'unavailable' | 'timeout';

interface DriverGpsGateProps {
  currentUser: User | null;
  onHelp?: () => void;
  onVotes?: () => void;
}

const DriverGpsGate: React.FC<DriverGpsGateProps> = ({ currentUser, onHelp, onVotes }) => {
  const [state, setState] = useState<GpsState>('checking');
  const [failCount, setFailCount] = useState(0); // échecs de localisation → porte de sortie après 2
  const passedRef = useRef(false); // une fois débloqué, on ne re-bloque plus la session
  const inApp = isInAppBrowser();

  const isDriver = (() => {
    const r = String(currentUser?.role || '').toLowerCase();
    return !!currentUser && (r.includes('chauff') || r.includes('driver'));
  })();

  const tryGetPosition = useCallback(() => {
    if (!('geolocation' in navigator)) { setState('unavailable'); return; }
    setState('checking');
    // getPositionRobust : haute précision PUIS repli basse précision (réseau) —
    // évite le faux « GPS coupé » quand le satellite met trop longtemps à accrocher.
    getPositionRobust()
      .then(() => { passedRef.current = true; setState('ok'); })
      .catch((err: any) => {
        setFailCount(n => n + 1);
        if (err && typeof err.code === 'number' && err.code === 1 /* PERMISSION_DENIED */) {
          setState('denied');
        } else if (err && typeof err.code === 'number' && err.code === 3 /* TIMEOUT */) {
          setState('timeout'); // GPS actif mais signal qui n'accroche pas (≠ GPS coupé)
        } else {
          setState('unavailable'); // position indisponible → GPS OS coupé / pas de signal
        }
      });
  }, []);

  // Porte de sortie : après 2 échecs, le chauffeur peut entrer quand même. La
  // livraison et le départ de tournée restent protégés par leurs propres contrôles GPS.
  const forceContinue = useCallback(() => { passedRef.current = true; setState('ok'); }, []);

  const check = useCallback(() => {
    if (passedRef.current) { setState('ok'); return; }
    if (!('geolocation' in navigator)) { setState('unavailable'); return; }
    const anyNav = navigator as any;
    if (anyNav.permissions?.query) {
      anyNav.permissions.query({ name: 'geolocation' })
        .then((res: any) => {
          if (res.state === 'denied') setState('denied');
          else if (res.state === 'granted') tryGetPosition();
          else setState('need_permission');
        })
        .catch(() => tryGetPosition());
    } else {
      tryGetPosition();
    }
  }, [tryGetPosition]);

  useEffect(() => {
    if (!isDriver) return;
    check();
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDriver, currentUser?.id]);

  if (!isDriver || state === 'ok' || passedRef.current) return null;

  const firstName = currentUser?.firstName || '';
  const hi = firstName ? `${firstName}, ` : '';

  return (
    <Modal isOpen onClose={() => {}} ariaLabel="Localisation requise" size="full" showCloseButton={false} preventClose busy={false} closeOnEscape={false} closeOnOverlay={false} bodyClassName="!p-0 bg-slate-900">
    <div className="bg-slate-900 text-white flex items-center justify-center p-6 min-h-[70dvh]">
      <div className="max-w-sm w-full text-center">
        <div className="w-20 h-20 rounded-full bg-white/10 flex items-center justify-center mx-auto mb-5">
          <MapPin size={40} className="text-amber-300" />
        </div>
        <h1 className="text-2xl font-extrabold mb-2">Localisation requise</h1>

        {state === 'checking' && (
          <p className="text-white/70 flex items-center justify-center gap-2 mt-4">
            <Loader2 size={18} className="animate-spin" /> Vérification de la position…
          </p>
        )}

        {state === 'need_permission' && (
          <>
            <p className="text-white/80 mb-6">
              {hi}pour utiliser l'application, activez votre localisation. Appuyez sur le bouton et
              acceptez la demande du navigateur.
            </p>
            <button onClick={tryGetPosition}
              className="min-h-11 w-full py-4 bg-amber-300 text-slate-950 hover:bg-amber-200 rounded-2xl font-bold text-lg">
              Activer ma localisation
            </button>
          </>
        )}

        {state === 'denied' && (
          <>
            <p className="text-white/80 mb-4">
              {hi}la localisation est <b>bloquée</b> pour ce site. Autorisez-la dans les réglages du
              navigateur (icône 🔒 ou ⓘ dans la barre d'adresse → Localisation → Autoriser), puis
              réessayez.
            </p>
            <button onClick={check}
              className="min-h-11 w-full py-4 bg-white/15 hover:bg-white/25 rounded-2xl font-bold text-lg flex items-center justify-center gap-2">
              <RefreshCw size={18} /> J'ai autorisé — réessayer
            </button>
          </>
        )}

        {state === 'timeout' && (
          <>
            <p className="text-white/80 mb-4">
              {hi}le GPS est activé mais le <b>signal met du temps à accrocher</b>. Placez-vous près
              d'une fenêtre ou à l'air libre quelques secondes, puis réessayez.
            </p>
            <button onClick={tryGetPosition}
              className="min-h-11 w-full py-4 bg-amber-300 text-slate-950 hover:bg-amber-200 rounded-2xl font-bold text-lg flex items-center justify-center gap-2">
              <RefreshCw size={18} /> Réessayer
            </button>
          </>
        )}

        {state === 'unavailable' && (
          <>
            <p className="text-white/80 mb-4">
              {hi}activez le <b>GPS de votre téléphone</b> (et placez-vous à l'air libre si besoin),
              puis réessayez.
            </p>
            <button onClick={tryGetPosition}
              className="min-h-11 w-full py-4 bg-amber-300 text-slate-950 hover:bg-amber-200 rounded-2xl font-bold text-lg flex items-center justify-center gap-2">
              <RefreshCw size={18} /> Réessayer
            </button>
          </>
        )}

        {/* Navigateur intégré (WhatsApp/Gmail/Facebook…) : la géoloc y est souvent
            bloquée → on conseille d'ouvrir dans le vrai navigateur. */}
        {inApp && state !== 'checking' && (
          <p className="text-amber-200/90 text-sm mt-4 bg-amber-500/10 border border-amber-400/20 rounded-xl p-3">
            Vous avez ouvert le lien depuis une messagerie. Ouvrez l’application dans <b>Chrome</b> (Android)
            ou <b>Safari</b> (iPhone) : « ⋯ → Ouvrir dans le navigateur ».
          </p>
        )}

        {/* Porte de sortie après 2 échecs : ne jamais bloquer totalement un chauffeur
            à cause d'un 1er fix capricieux. Les moments critiques (livraison, départ
            de tournée) revérifient le GPS de leur côté. */}
        {failCount >= 2 && (state === 'timeout' || state === 'unavailable') && (
          <button onClick={forceContinue}
            className="min-h-11 w-full py-3 mt-3 bg-white/10 hover:bg-white/20 rounded-2xl font-semibold text-sm text-white/80">
            Accéder à l’application sans position pour le moment
          </button>
        )}

        <details className="text-left mt-5 rounded-xl border border-white/30 p-3 text-sm text-white/90">
          <summary className="min-h-11 cursor-pointer font-bold">Aide pour activer la localisation</summary>
          <p className="mt-2"><b>iPhone :</b> Réglages → Confidentialité et sécurité → Service de localisation. Autorisez ensuite la localisation pour Safari ou Chrome.</p>
          <p className="mt-2"><b>Android :</b> Réglages → Localisation. Dans Chrome, ouvrez les informations du site → Autorisations → Localisation.</p>
          <p className="mt-2">Revenez dans l’application et appuyez sur Réessayer. La livraison et le départ conservent leurs contrôles de position.</p>
        </details>
        {onHelp && <button type="button" onClick={onHelp} className="mt-3 min-h-12 w-full rounded-xl border border-white/50 px-3 py-3 font-bold">Ouvrir l’aide et contacter le bureau</button>}
        {onVotes && <button type="button" onClick={onVotes} className="mt-3 min-h-12 w-full rounded-xl border border-white/50 px-3 py-3 font-bold">Accéder aux votes des salariés</button>}
        <p className="text-white/80 text-sm mt-6">
          Votre position sert au suivi des tournées et à la preuve de livraison.
        </p>
      </div>
    </div>
    </Modal>
  );
};

export default DriverGpsGate;
