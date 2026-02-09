# AUDIT 306 -- FleetGenius Pro (FLEETMANAGER)

**Date :** 2026-02-09
**Version auditee :** 3.1.0
**Stack :** React 18 + TypeScript 5 / Firebase (Firestore, Auth, Functions, Storage) / Vite / Vercel

---

## Resume executif

Cet audit couvre 4 axes : **securite**, **qualite du code**, **performance/architecture** et **configuration/dependances**. L'application est une plateforme SaaS de gestion de flotte et de livraison avec portail client, IA embarquee (Gemini), et optimisation de tournees (Google Route Optimization API).

### Bilan global

| Axe | Critique | Haute | Moyenne | Basse | Total |
|-----|----------|-------|---------|-------|-------|
| Securite | 4 | 8 | 11 | 5 | **28** |
| Qualite du code | 3 | 5 | 6 | 6 | **20** |
| Performance / Architecture | 5 | 5 | 10 | 7 | **27** |
| Configuration / Dependances | 3 | 5 | 8 | 7 | **23** |
| **Total** | **15** | **23** | **35** | **25** | **98** |

**Score global : 38/100** -- L'application necessite des corrections urgentes avant toute mise en production a grande echelle.

---

## 1. AUDIT SECURITE (OWASP Top 10)

### 1.1 Vulnerabilites CRITIQUES

#### VULN-01 : Escalade de privileges via auto-modification du role

- **Fichier :** `firestore.rules:77-83`
- **OWASP :** A01 -- Broken Access Control
- **Description :** Les regles Firestore permettent a tout utilisateur authentifie de modifier son propre document utilisateur sans restriction sur les champs. Un utilisateur peut changer son champ `role` en `"Admin"` via le SDK Firestore ou l'API REST.
- **Impact :** Prise de controle complete de l'application.
- **Correction :** Ajouter une validation au niveau des champs :
  ```
  allow update: if isAdminRole() || (request.auth.uid == userId &&
    !request.resource.data.diff(resource.data).affectedKeys().hasAny(['role', 'isDisabled']));
  ```

#### VULN-02 : Modification non restreinte des invitations

- **Fichier :** `firestore.rules:95`
- **OWASP :** A01 -- Broken Access Control
- **Description :** `allow update: if isAuthenticated()` permet a tout utilisateur connecte de modifier le token, l'email, le role ou le statut de n'importe quelle invitation.
- **Impact :** Contournement complet du systeme d'invitation, creation de comptes admin.
- **Correction :** Restreindre les updates aux seuls champs `used` et `usedAt`.

#### VULN-03 : Cle API Gemini exposee dans le bundle client

- **Fichier :** `vite.config.ts:10`, `src/services/geminiService.ts:7`
- **OWASP :** A02 -- Sensitive Data Exposure
- **Description :** La cle Gemini est injectee dans le JavaScript client via `define: { 'process.env.API_KEY': JSON.stringify(env.VITE_GEMINI_API_KEY) }`. Toute personne ouvrant les DevTools peut extraire cette cle.
- **Impact :** Abus financier illimite sur le compte Google Cloud.
- **Correction :** Deplacer l'appel Gemini derriere une Cloud Function proxy.

#### VULN-04 : Absence de controle de role sur optimizeTours

- **Fichier :** `functions/src/index.ts:37-44`
- **OWASP :** A01 -- Broken Access Control
- **Description :** La Cloud Function `optimizeTours` verifie uniquement l'authentification, pas le role. Un compte `Client` ou `Stagiaire` peut declencher des appels couteux a l'API Google Route Optimization.
- **Impact :** Abus de facturation, denial of service.
- **Correction :** Ajouter une verification du role admin/directeur.

### 1.2 Vulnerabilites HAUTES

| ID | Localisation | Description |
|----|-------------|-------------|
| VULN-05 | `permissions.ts` (tout) | Systeme de permissions 100% client-side, contournable par appel direct Firestore |
| VULN-06 | `firestore.rules:202-207` | IDOR savedAddresses : tout Client peut acceder aux adresses d'autres clients |
| VULN-07 | `firestore.rules:368` | Spoofing de notifications : creation sans validation du destinataire |
| VULN-08 | `geminiService.ts:33-48` | Injection de prompt : donnees sensibles dans le contexte, input non sanitise |
| VULN-09 | `emailService.ts:209` | Injection HTML dans les emails (XSS stocke) |
| VULN-10 | `firestore.rules:158-180` | IDOR conges/absences : creation sans validation userId == auth.uid |
| VULN-11 | `storage.rules:106-110` | Pas de validation content-type sur le chemin `absences/` |
| VULN-12 | `firestore.rules:23` | Regex trop large pour la detection des roles admin (`direct.*`, `pr.*sid.*`) |

### 1.3 Vulnerabilites MOYENNES

| ID | Localisation | Description |
|----|-------------|-------------|
| VULN-13 | `firestore.rules:190` | Clients lisent les devis d'autres clients |
| VULN-14 | `firestore.rules:241` | Tout utilisateur peut envoyer des emails via la collection `mail` |
| VULN-15 | `ActivateAccount.tsx:84` | Mot de passe minimum 6 caracteres, pas de complexite |
| VULN-16 | `invitationService.ts:67` | Biais modulo dans la generation de tokens + fallback Math.random() |
| VULN-17 | `firestore.rules:354-358` | Activity logs falsifiables (pas de validation userId) |
| VULN-18 | `functions/src/index.ts:111` | Project ID GCP code en dur |
| VULN-19 | `functions/src/index.ts:669-983` | Pas de rate limiting sur les Cloud Functions publiques |
| VULN-20 | `emailService.ts:44` | Fallback APP_URL casse (`'${APP_URL}'` literal) |
| VULN-21 | `firestore.rules:278,290` | Packages/missions lisibles par tous les clients (cross-tenant) |
| VULN-22 | `firestore.rules:230` | Document acknowledgments sans validation d'identite |
| VULN-23 | `functions/src/index.ts:104` | Messages d'erreur internes exposes aux clients |

### 1.4 Points positifs securite

- Default-deny dans les Firestore rules (`allow read, write: if false`)
- Collections immutables pour POD, pickups, audit_logs, acknowledgments
- Prevention de l'auto-suppression dans les Cloud Functions
- Limites de taille fichiers (10 MB) sur tous les chemins Storage
- Tokens d'invitation avec expiration 7 jours
- Pas de secrets codes en dur dans le code source

---

## 2. AUDIT QUALITE DU CODE

### 2.1 Problemes CRITIQUES

#### QC-01 : App.tsx monolithique (1 182 lignes)

- 13+ hooks useState pour l'etat global
- 10 abonnements Firestore simultanes
- 30+ fonctions handler
- Switch de routage de 326 lignes
- Prop drilling massif vers tous les composants enfants

#### QC-02 : Composants surdimensionnes

| Composant | Lignes |
|-----------|--------|
| MissionManager.tsx | **3 233** |
| AbsenceManager.tsx | **2 253** |
| Dashboard.tsx | **2 037** |
| ClientPortal.tsx | **1 934** |
| DriverMissionView.tsx | **1 866** |
| IssueManager.tsx | **1 524** |
| FuelManager.tsx | **1 396** |

MissionManager.tsx contient **34 hooks useState** et represente effectivement 6-8 composants fusionnes en un seul fichier.

#### QC-03 : Duplication massive de `normalizeRole`

La fonction `normalizeRole` est copiee-collee dans **12 fichiers** avec des variantes subtiles. Chaque copie a un comportement legerement different, ce qui signifie qu'un meme utilisateur peut etre classifie differemment selon la page visitee.

Fichiers affectes : `App.tsx` (x2), `usePermissions.tsx`, `Dashboard.tsx`, `AbsenceManager.tsx`, `IssueManager.tsx`, `UserManager.tsx`, `Sidebar.tsx`, `DocumentManager.tsx`, `HelpCenter.tsx`, `hooks/useVehicles.ts`, `hooks/index.ts`, `firestore.ts`

### 2.2 Problemes HAUTS

| ID | Description | Localisation |
|----|-------------|-------------|
| QC-04 | 100+ usages de `any` dont `'' as any` (x10 dans FuelManager) | Codebase entier |
| QC-05 | 20+ usages de `alert()` pour feedback utilisateur | App.tsx, ClientPortal, MissionManager, AbsenceManager, etc. |
| QC-06 | Handlers sans try/catch (30+ dans App.tsx) | `App.tsx:395-703` |
| QC-07 | 5 blocs catch silencieux dans DriverMissionView | `DriverMissionView.tsx:398,489,498,662,749` |
| QC-08 | Handler `handleAddMaintenance` est un stub silencieux | `App.tsx:465-467` |

### 2.3 Problemes MOYENS

| ID | Description |
|----|-------------|
| QC-09 | `formatDate` dupliquee dans 5+ fichiers |
| QC-10 | `getEffectiveStatus` dupliquee (Dashboard vs useVehicles) |
| QC-11 | `cleanFirestoreData` / `cleanUndefined` dupliquees (3 versions) |
| QC-12 | 7 directives `@ts-ignore` |
| QC-13 | 20+ listes avec `key={index}` au lieu d'IDs uniques |
| QC-14 | `setIsLoading(false)` appele avant l'arrivee des donnees (MissionManager:156) |

### 2.4 Problemes BAS

- `JSON.stringify` pour comparaison d'etat (`App.tsx:191`)
- `Dashboard.tsx.backup` commite dans le repo
- `routes.ts` defini mais jamais utilise (code mort)
- Legacy types `Leave*` encore presents dans types.ts
- 141 appels `console.log/error/warn` en production
- Patterns d'export inconsistants (named vs default)

---

## 3. AUDIT PERFORMANCE ET ARCHITECTURE

### 3.1 Problemes CRITIQUES

#### PERF-01 : Aucune pagination sur les collections principales

9 subscriptions Firestore chargent **tous les documents** sans `limit()` :
- `subscribeToVehicles`, `subscribeToFuelLogs`, `subscribeToIssues`, `subscribeToMaintenance`, `subscribeToLeaves`, `subscribeToAbsences`, `subscribeToQuotes`, `subscribeToCompanyDocuments`, `subscribeToDocumentAcknowledgments`

**Projection apres 1 an (30 vehicules) :** ~34 000+ documents charges a chaque connexion.

#### PERF-02 : Toutes les donnees chargees pour tous les utilisateurs

Un chauffeur qui n'a besoin que de son vehicule et sa mission telecharge : TOUS les vehicules, TOUS les logs carburant, TOUS les logs maintenance, TOUS les incidents, TOUS les utilisateurs, TOUS les conges, TOUTES les absences, TOUS les devis, TOUS les documents.

#### PERF-03 : 13+ listeners temps reel simultanes par utilisateur

Avec 20 utilisateurs connectes, cela represente 260+ connexions listener actives minimum. Chaque changement dans une collection declenche un broadcast a tous les listeners de cette collection.

#### PERF-04 : `react-router-dom` installe mais non utilise

v7.13.0 est en dependance de production mais l'application utilise un `currentView` en memoire. Consequences : pas de navigation URL, pas d'historique navigateur, pas de deep linking, poids mort dans le bundle.

#### PERF-05 : Re-renders cascadants depuis App.tsx

Chaque changement d'etat (un log carburant ajoute, un incident mis a jour) re-rend l'ensemble du composant App, re-execute le switch de 326 lignes, et cree de nouvelles references de props pour tous les enfants.

### 3.2 Problemes HAUTS

| ID | Description |
|----|-------------|
| PERF-06 | Zero utilisation de `React.memo` sur 60+ composants |
| PERF-07 | Zero `useCallback` sur les 30+ handlers d'App.tsx |
| PERF-08 | Pas de persistence offline Firestore (banner "MODE HORS-LIGNE" trompeur) |
| PERF-09 | Pas de gestion d'etat centralisee (pas de Redux/Zustand/Jotai) |
| PERF-10 | Couplage fort : App.tsx melange etat UI, ecritures DB et logging sans rollback |

### 3.3 Problemes MOYENS

| ID | Description |
|----|-------------|
| PERF-11 | 7+ patterns de requetes sans index composite Firestore |
| PERF-12 | Filtrage client-side de 500 packages au lieu de queries server-side |
| PERF-13 | Pattern N+1 : IDs admin re-fetches a chaque update de colis |
| PERF-14 | Pas de compression d'images a l'upload (photos mobile 5-10 MB) |
| PERF-15 | Pas de gestion centralisee des erreurs |
| PERF-16 | Import direct du SDK Firestore dans les composants UI |
| PERF-17 | Dependance `xlsx` (~90 KB gzip) pour fonctionnalite non implementee |
| PERF-18 | Pas de service worker ni capacite offline |

---

## 4. AUDIT CONFIGURATION ET DEPENDANCES

### 4.1 Vulnerabilites dans les dependances

| Package | Version | Probleme | Severite |
|---------|---------|----------|----------|
| `firebase-admin` | ^11.11.0 | **4 CVE critiques** (Prototype Pollution via protobufjs) | **CRITIQUE** |
| `@google/genai` | ^0.2.0 | ~70 versions mineures de retard, API incompatible | **CRITIQUE** |
| `firebase` (frontend) | ^10.13.0 | 12 vulnerabilites moderees via undici | **HAUTE** |
| `firebase-functions` | ^4.5.0 | 3 versions majeures de retard | **HAUTE** |
| `fast-xml-parser` (transitive) | indirect | DoS vulnerability (CVSS 7.5) | **HAUTE** |

### 4.2 Infrastructure de tests

| Element | Statut |
|---------|--------|
| Framework de test | **Absent** |
| Fichiers de test | **Zero** |
| Scripts de test | **Aucun** |
| Tests E2E | **Absents** |
| Mocks/utilitaires | **Aucun** |

**L'application entiere (frontend + backend) n'a aucun test automatise.**

### 4.3 CI/CD et DevOps

| Element | Statut |
|---------|--------|
| GitHub Actions | **Absent** |
| ESLint | **Non installe** |
| Prettier config | Installe mais **non configure** |
| Pre-commit hooks | **Absents** |
| Firebase Emulators | **Non configures** |

### 4.4 Headers de securite manquants (Vercel)

Les headers suivants sont absents de `vercel.json` :
- `X-Frame-Options` (protection clickjacking)
- `Content-Security-Policy`
- `Strict-Transport-Security` (HSTS)
- `X-Content-Type-Options`
- `Referrer-Policy`
- `Permissions-Policy`

---

## 5. PLAN DE REMEDIATION PRIORITISE

### Semaine 1 -- CRITIQUE (a faire immediatement)

| # | Action | Fichier(s) concerne(s) |
|---|--------|----------------------|
| 1 | Ajouter validation champs sur auto-update user | `firestore.rules` |
| 2 | Restreindre update invitations (champs `used`/`usedAt` uniquement) | `firestore.rules` |
| 3 | Deplacer cle Gemini derriere Cloud Function proxy | `vite.config.ts`, `geminiService.ts`, `functions/` |
| 4 | Ajouter controle de role sur `optimizeTours` | `functions/src/index.ts` |
| 5 | Mettre a jour `firebase-admin` vers v13+ | `functions/package.json` |
| 6 | Installer framework de test (Vitest) | `package.json` |

### Semaines 2-3 -- HAUTE

| # | Action |
|---|--------|
| 7 | Corriger tous les IDOR (savedAddresses, quotes, packages, missions) dans les Firestore rules |
| 8 | HTML-encoder les donnees utilisateur dans les templates email |
| 9 | Ajouter validation `userId == auth.uid` sur creation conges/absences |
| 10 | Ajouter content-type validation sur storage `absences/` |
| 11 | Mettre a jour `firebase` frontend SDK (v12+), `firebase-functions` (v7+), `@google/genai` (v1+) |
| 12 | Installer et configurer ESLint |
| 13 | Ajouter headers de securite dans `vercel.json` |
| 14 | Mettre en place CI/CD basique (GitHub Actions : typecheck + build + lint) |
| 15 | Extraire `normalizeRole` dans un utilitaire unique partage |
| 16 | Remplacer les `alert()` par un systeme de toasts |

### Mois 1-2 -- MOYENNE

| # | Action |
|---|--------|
| 17 | Ajouter pagination (`limit()`) sur les 9 subscriptions Firestore principales |
| 18 | Implementer le routage URL avec React Router (deja installe) |
| 19 | Extraire l'etat de App.tsx vers des Context providers par domaine |
| 20 | Decouper MissionManager.tsx (3 233 lignes) en 6-8 sous-composants |
| 21 | Ajouter `React.memo` et `useCallback` sur les composants/handlers principaux |
| 22 | Activer la persistence offline Firestore |
| 23 | Implementer la compression d'images a l'upload |
| 24 | Ajouter try/catch avec rollback sur les updates optimistes |
| 25 | Remplacer les `as any` par des types corrects |
| 26 | Configurer les Firebase Emulators |

### Backlog

| # | Action |
|---|--------|
| 27 | Scinder `types.ts` en fichiers par domaine |
| 28 | Supprimer code mort (routes.ts, Dashboard.tsx.backup, types Leave legacy) |
| 29 | Ajouter Error Boundaries granulaires par section |
| 30 | Standardiser la gestion d'erreurs dans les services (Result type) |
| 31 | Ajouter rate limiting sur les Cloud Functions publiques |
| 32 | Evaluer la licence SheetJS (xlsx) |

---

## Points forts de l'application

Malgre les problemes identifies, l'application presente plusieurs bonnes pratiques :

1. **Default-deny** dans les Firestore rules
2. **Collections immutables** pour les POD, pickups et audit logs
3. **Lazy loading** de tous les composants lourds avec `React.lazy()` et `Suspense`
4. **Code splitting** Vite bien configure (8 chunks vendor)
5. **Systeme de permissions** bien concu (templates par role + overrides par utilisateur)
6. **Cleanup systematique** des subscriptions Firestore dans les `useEffect`
7. **Limites de taille fichiers** (10 MB) sur tous les chemins Storage
8. **Cache des codes postaux** cote client
9. **Audit trail** complet avec activity logs
10. **Headers de cache Vercel** correctement configures pour les assets statiques
