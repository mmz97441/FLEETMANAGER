# Composants et conventions d’interface

Ce document décrit les composants présents dans le dépôt et les règles à suivre lors de l’ajout d’un écran. Les contrôles d’interface complètent les vérifications des services et du serveur ; ils ne constituent pas une autorisation métier.

## Contrats visuels 4.27.0

`src/index.css` définit les variantes explicites appliquées aux écrans du [périmètre VIS-01 à VIS-18](./UI18_SCOPE.json). `npm run audit:ui` inventorie commandes, tableaux et fenêtres et bloque les petits textes non justifiés, les commandes non natives privées de clavier, les boutons à dégradé et les préfixes responsive dupliqués. Ce contrôle lit les attributs JSX ; les styles calculés, les textes construits indirectement et les états métier nécessitent encore les essais navigateur. La CI exécute ce contrôle à chaque PR.

- `PageHeader` : titre, description utile, action principale. Le titre prend toute la largeur sur téléphone. Les modules partagent la palette de marque ; le rôle change les informations et les commandes.
- `Button` ou `ui-button ui-button-primary` : prochaine action du parcours, bleu de marque. `ui-button-secondary` : alternative ; `ui-button-ghost` : commande discrète ; `ui-button-danger` : opération destructive. `ui-button-icon` garde une cible de 44 px. Un bouton doit posséder un nom accessible, être désactivé pendant sa mutation et exposer son état occupé. Le style n’installe pas de verrou métier à lui seul. Les liens de navigation et cartes natives peuvent conserver leur géométrie adaptée au contenu.
- `ui-filter` avec `aria-pressed` / `aria-current` : sélection explicite, indépendante d’un indicateur de synthèse. Sur téléphone, plusieurs filtres de statut peuvent être regroupés dans un `select` nommé. Une sélection masquée dans un panneau conserve un résumé visible.
- `ui-panel` : une surface blanche et une bordure discrète par groupe. Employer des séparateurs pour les sous-parties ; les styles de cette classe priment sur les couleurs de surface Tailwind.
- `ui-table` : en-têtes 14 px, nombres tabulaires, espacements et sélection communs. Garder une commande de ligne native quand des boutons coexistent. Le défilement doit rester dans le conteneur du tableau. Prévoir cartes mobiles ou détails accessibles pour les données longues.
- `ui-notice ui-notice-info|success|warning|danger` : résultat et niveau d’attention. Utiliser la variante complète ; ajouter seulement `text-red-*` au conteneur ne remplace pas ce contrat. Distinguer réussite de l’opération principale et erreur du carnet, de l’invitation ou de l’impression.
- `CountBadge` : quantité neutre et immobile, valeur complète accessible même en affichage `99+`. Un total de tâches n’implique pas une urgence. Une notification de priorité haute se distingue d’une urgence réelle.
- `Trend` : direction et période de comparaison explicites, couleur neutre par défaut. N’utiliser `lower-is-better` / `higher-is-better` que lorsque l’indicateur porte ce sens. Les kilomètres et les litres ne sont pas automatiquement des succès ou des échecs. Zéro est « Stable » ; une valeur non finie annonce l’absence de comparaison.
- Icônes de commande Lucide, libellés français en casse de phrase, pluriels réels et fonctions de `utils/format.ts`. Les références métier exactes servent à la recherche, à la copie et au partage ; une version visuelle abrégée est toujours annoncée et dépliable.

Les exceptions de petite typographie sont les versions techniques de la connexion et du pied de navigation, justifiées dans le périmètre. Elles ne s’appliquent pas aux destinataires, adresses, statuts ou montants.

## Fenêtres : `Modal`

Importer `Modal` depuis `src/components/shared/Modal.tsx`. Fournir un `title` visible ; pour une interface sans en-tête, fournir `ariaLabel`. Le composant attribue des identifiants de titre uniques et utilise `useDialogLayer` pour le focus initial, Tab/Shift+Tab, le fond inerte, les fenêtres imbriquées et la restauration du focus.

- `busy={busy}` empêche les fermetures pendant une opération et expose `aria-busy`. Désactiver également les actions internes concernées. `preventClose` sert aussi aux étapes obligatoires : fournir alors `busy={false}` si aucune opération ne tourne, pour ne pas annoncer une attente fictive. Sans `busy` explicite, le comportement historique de `preventClose` est conservé.
- `dirty={dirty}` protège les fermetures assurées par le cadre : croix, fond et Échap. Les boutons internes qui appellent directement `onClose` doivent utiliser la même protection ; voir l’exemple ci-dessous.
- `role="alertdialog"` convient à une confirmation exigeant une décision. Le rôle normal est `dialog`.
- `footer` conserve les actions hors de la zone défilante. Préférer cet emplacement lorsqu’un formulaire est long.
- `mobileFullscreen` utilise la hauteur dynamique du viewport sous 640 px, avec marges de zone sûre et actions finales fixes. Vérifier la zone défilante et les fenêtres imbriquées à hauteur réduite ; les tests de viewport ne remplacent pas l’essai du clavier système.
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

`operationalLabels.ts` porte les libellés visibles sans migration des enums stockés. `ShipmentReference` signale l’abréviation des codes longs, expose leur valeur complète au dépliage et restitue toujours la valeur exacte à la copie et au partage. Une estimation reste une estimation ; une correction du parcours retire les anciennes prévisions.

`startUxTask` mesure une opération précise avec tâche/rôle/résultat et compteurs numériques autorisés. Aucun nom, adresse, code colis, photo, signature ou coordonnée ne doit entrer dans les métriques. La collecte est locale à la session, désactivable et exportable volontairement. Son temps technique ne constitue pas une durée de tâche utilisateur ni une preuve de gain avant/après.

La couverture vérifiée pour la version 4.26.0 est détaillée dans [UX28_COVERAGE.md](./UX28_COVERAGE.md). La présence du composant commun ne suffit pas à déclarer un écran entier validé.
