import React, { useEffect, useState, type ComponentType } from 'react';
import { withDeadline } from '../utils/asyncDeadline';
import { reloadApplication } from '../utils/reloadApplication';
import { reportError } from '../services/logService';

/** A failed import belongs to this opening, not permanently to a React.lazy object.
 * The surrounding navigation stays mounted and drafts in other dialogs survive. */
export function resilientLazy<T extends ComponentType<any>>(load: () => Promise<{ default: T }>): T {
  let cached: T | undefined;
  const Page = (props: React.ComponentProps<T>) => {
    const [Loaded, setLoaded] = useState<T | undefined>(() => cached);
    const [attempt, setAttempt] = useState(0), [failed, setFailed] = useState(false);
    useEffect(() => {
      if (Loaded) return;
      let active = true;
      setFailed(false);
      void withDeadline(load(), 15000, new Error('Chargement de cet écran trop long.')).then(module => {
        cached = module.default;
        if (active) setLoaded(() => module.default);
      }).catch(error => {
        if (!active) return;
        setFailed(true);
        reportError('page.module.load', error, { silent: true, extra: { attempt: attempt + 1 } });
      });
      return () => { active = false; };
    }, [attempt, Loaded]);
    if (Loaded) return React.createElement(Loaded, props);
    return <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3" role={failed ? 'alert' : 'status'}>
      <p className="font-semibold">{failed ? 'Cet écran n’a pas pu se charger' : 'Chargement de votre écran…'}</p>
      {failed && <><p>Vérifiez la connexion et réessayez. Si une mise à jour vient d’être publiée, rechargez l’application après avoir enregistré vos saisies.</p>
        <div className="flex flex-wrap gap-3"><button type="button" onClick={() => setAttempt(value => value + 1)} className="ui-button ui-button-primary">Réessayer cet écran</button><button type="button" onClick={() => void reloadApplication()} className="ui-button ui-button-secondary">Recharger l’application</button></div></>}
    </div>;
  };
  return Page as T;
}
