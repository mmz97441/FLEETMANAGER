# Composants et conventions d’interface

Ce document décrit les composants présents dans le dépôt et les règles à suivre lors de l’ajout d’un écran. Les contrôles d’interface complètent les vérifications des services et du serveur ; ils ne constituent pas une autorisation métier.

## Fenêtres : `Modal`

Importer `Modal` depuis `src/components/shared/Modal.tsx`. Fournir un `title` visible ; pour une interface sans en-tête, fournir `ariaLabel`. Le composant attribue des identifiants de titre uniques et utilise `useDialogLayer` pour le focus initial, Tab/Shift+Tab, le fond inerte, les fenêtres imbriquées et la restauration du focus.

- `busy={busy}` empêche les fermetures pendant une opération et expose `aria-busy`. Désactiver également les actions internes concernées. `preventClose` sert aussi aux étapes obligatoires : fournir alors `busy={false}` si aucune opération ne tourne, pour ne pas annoncer une attente fictive. Sans `busy` explicite, le comportement historique de `preventClose` est conservé.
- `dirty={dirty}` protège les fermetures assurées par le cadre : croix, fond et Échap. Les boutons internes qui appellent directement `onClose` doivent utiliser la même protection ; voir l’exemple ci-dessous.
- `role="alertdialog"` convient à une confirmation exigeant une décision. Le rôle normal est `dialog`.
- `footer` conserve les actions hors de la zone défilante. Préférer cet emplacement lorsqu’un formulaire est long.
- `size` accepte `sm`, `md`, `lg`, `xl`, `2xl`, `3xl` et `full`. Vérifier les fenêtres longues avec le clavier mobile ouvert.

Ne pas réintroduire une fenêtre par un simple `div fixed` avec un nouveau z-index. Utiliser le composant partagé ; `ModalPortal` et `useDialogLayer` servent aux présentations particulières qui nécessitent le même comportement de focus. Ne pas ajouter un second gestionnaire global d’Échap.

## Champs : `FormInput` et variantes

Les composants sont des exports nommés de `src/components/shared/FormInput.tsx` : `FormInput`, `FormTextarea`, `FormSelect`, `FormCheckbox` et `Button`. L’export par défaut est un objet de composants, pas un champ utilisable directement comme `<FormInput />`.

```tsx
import { FormInput } from './shared/FormInput';

<FormInput
  label="Téléphone du destinataire"
  type="tel"
  autoComplete="tel"
  value={phone}
  onChange={event => setPhone(event.target.value)}
  hint="Numéro auquel joindre le destinataire."
  error={phoneError}
/>
```

Le libellé reste visible et relié au champ ; `error` et `hint` sont reliés par `aria-describedby`, avec `aria-invalid` en cas d’erreur. Fournir un `id` explicite seulement lorsqu’une autre commande doit cibler le champ. Le placeholder donne un exemple : il ne remplace pas le libellé. Utiliser `type="email"`, `type="tel"`, `inputMode="numeric"`, `autoComplete="username"` ou `autoComplete="current-password"` selon la saisie attendue.

## Saisie non enregistrée : `useUnsavedChanges`

`useUnsavedChanges(dirty, busy)` renvoie une fonction asynchrone qui exécute la fermeture après confirmation, ou la refuse pendant `busy`. Il ajoute aussi un avertissement `beforeunload` lorsque nécessaire et inscrit le formulaire dans le registre global des brouillons. `ConfirmationHost`, monté une seule fois par l’application, présente la confirmation accessible ; les aperçus de composants doivent aussi le monter pour tester ce comportement.

Pour protéger à la fois le cadre et un bouton Annuler, utiliser un seul chemin de fermeture :

```tsx
const requestClose = useUnsavedChanges(dirty, busy);
const close = () => { void requestClose(onClose); };

<Modal isOpen={open} onClose={close} preventClose={busy} title="Modifier le destinataire">
  {/* Champs du formulaire */}
  <button type="button" onClick={close} disabled={busy}>Annuler</button>
</Modal>
```

Dans cet exemple, ne pas ajouter aussi `dirty` au `Modal` : cela demanderait deux confirmations. Après un enregistrement effectivement réussi, la fermeture peut appeler directement `onClose`. Calculer `dirty` par comparaison avec les valeurs initiales, pas avec la seule présence d’une fenêtre ouverte.

Le hook ne sauvegarde pas le contenu à lui seul. `App` installe `installNavigationGuard` une fois et passe les changements de vue, la déconnexion et les sorties du passage obligatoire Documents par `requestNavigation`. Le registre protège également Retour/Avancer dans la SPA, en restaurant l’entrée courante avant la confirmation ; son marquage survit au rechargement. Une navigation locale qui démonte un formulaire doit encore appeler `requestClose` ou `requestNavigation`. Ne pas multiplier les confirmations entre parent et enfant. Tester aussi les fenêtres imbriquées, Retour après rechargement et les changements de paramètres URL qui détruisent une saisie.

## Messages : `ToastHost` et `logService`

`ToastHost`, monté une fois dans `src/main.tsx`, reçoit `notifySuccess`, `notifyError`, `notifyWarning` et `notifyInfo` depuis `src/services/logService.ts`. `reportError` permet de journaliser un échec et de lui associer un `userMessage` compréhensible.

```tsx
try {
  await saveRecipient();
  notifySuccess('Le destinataire a été enregistré.');
} catch (error) {
  reportError('recipient.save', error, {
    userMessage: 'Enregistrement impossible. Votre saisie est conservée ; réessayez.',
  });
}
```

Annoncer une réussite après confirmation de l’opération. Une donnée conservée localement doit être décrite comme telle, sans prétendre qu’elle est déjà reçue par le serveur. Les erreurs et avertissements ne disparaissent pas par minuterie ; les succès et informations peuvent être brefs. Les toasts sont limités à quatre visibles : une erreur indispensable à une action doit également rester dans l’écran ou le formulaire concerné. Éviter les bandes fixes concurrentes qui cachent le scanner, une signature ou un bouton.

## URL, filtres et liens directs

Utiliser `useUrlParam` et `updateUrlParams` depuis `src/hooks/useUrlState.ts`. Ils conservent les autres paramètres, écoutent `popstate` et émettent `fleet-url-change`. Prévoir les valeurs autorisées pour un onglet ou un statut.

```tsx
const [tab, setTab] = useUrlParam('tab', 'all', ['all', 'pending'] as const);
const [query, setQuery] = useUrlParam<string>('q', '');
// Remplacer l’entrée courante pour éviter une entrée d’historique par caractère.
const search = (text: string) => setQuery(text, true);
// Le changement de filtre remet la pagination au début.
const filter = (status: string) => updateUrlParams({ status, page: null });
```

Définir une politique explicite pour les paramètres `mission` et `package` lors du changement de date ou de périmètre : un ancien lien ne doit pas annuler le nouveau filtre au rafraîchissement. Un identifiant dans l’URL ne donne aucun droit supplémentaire. Vérifier l’autorisation avant de rendre un onglet protégé et conserver les contrôles serveur lors des lectures et mutations.

## Rôles, lisibilité et mouvement

- Respecter le rôle et les permissions pour la navigation et le contenu réellement rendu. Masquer un bouton d’onglet ne protège pas un accès direct par URL.
- Le contexte d’aperçu client ne change pas l’utilisateur Firebase authentifié. Ne pas annoncer « lecture seule » si des actions disponibles écrivent encore des données réelles.
- Viser **44 × 44 px** minimum pour les commandes terrain, avec un nom accessible pour chaque icône ; préférer des actions nommées lorsqu’une icône est ambiguë.
- Utiliser **16 px** pour les informations principales et les champs sur téléphone, **14 px** pour les informations secondaires utiles. Garder un contraste lisible pour le texte, les états actifs et le focus.
- Préserver le focus visible. Les styles partagés de `src/index.css` gèrent les champs mobiles et `prefers-reduced-motion`. Éviter les animations indispensables à la compréhension et respecter le choix de réduction des mouvements du système.
- Tester à 320 et 390 px. Comparer `scrollWidth` et `innerWidth` à la largeur attendue de l’appareil : un navigateur mobile peut élargir son viewport de mise en page pour cacher un débordement. Dans une ligne flex contenant un texte long, prévoir `min-w-0`, le retour à la ligne et une hauteur suffisante.

Le protocole d’usage sur appareils réels se trouve dans [UX_VALIDATION_TERRAIN.md](./UX_VALIDATION_TERRAIN.md).

## Consultation et intervention client

`ViewAsSwitcher` commence en lecture seule. Transmettre `readOnly` et le contexte d’intervention aux sous-formulaires ; masquer un bouton ne suffit pas : les handlers utilisent également `runClientMutation`. L’acteur authentifié et le client cible restent visibles dans l’en-tête fixe. L’audit d’intention doit être confirmé avant l’écriture ; un échec de l’audit final ne doit pas transformer une écriture réussie en invitation à la rejouer. Les règles et permissions serveur restent obligatoires.

## Chargement, reprise et mesures

Distinguer première lecture, liste vide confirmée, erreur et ancien résultat affiché. Une union de plusieurs requêtes attend toutes ses sources métier ; le GPS facultatif ne termine pas le chargement des colis. Une erreur de lecture conserve son message et une reprise explicite.

Avant une création susceptible d’être rejouée, conserver une référence stable et son payload. Réutiliser exactement cette référence après réponse perdue ou rechargement. Un échec du journal local empêche le premier envoi. Réserver et libérer le journal par référence, en tenant compte des autres onglets. Ne pas annoncer un succès après une simple écriture locale.

`operationalLabels.ts` porte les libellés visibles sans migration des enums stockés. `ShipmentReference` présente une référence complète et restitue sa valeur exacte à la copie. Une estimation reste une estimation ; une correction du parcours retire les anciennes prévisions.

`startUxTask` mesure une opération précise avec tâche/rôle/résultat et compteurs numériques autorisés. Aucun nom, adresse, code colis, photo, signature ou coordonnée ne doit entrer dans les métriques. La collecte est locale à la session, désactivable et exportable volontairement. Son temps technique ne constitue pas une durée de tâche utilisateur ni une preuve de gain avant/après.

La couverture vérifiée pour la version 4.26.0 est détaillée dans [UX28_COVERAGE.md](./UX28_COVERAGE.md). La présence du composant commun ne suffit pas à déclarer un écran entier validé.
