# FleetGenius v2.46.0 — Guide Déploiement Vercel

## 🚀 Changements v2.46.0

### Performance — Code Splitting
- **37 chunks JS** au lieu d'1 seul fichier monolithique de 2.4 MB
- Shell initial : **23 KB gzip** (vs 635 KB avant) → chargement ~5x plus rapide
- Chaque page est chargée à la demande (React.lazy + Suspense)
- Vendors séparés : Firebase, Recharts, Leaflet, XLSX, Lucide — cachés indépendamment
- Spinner de chargement professionnel entre les transitions de page

### Dashboard — Bloc Livraisons du Jour
- KPIs temps réel : colis total, livrés, en cours, échecs
- Barre de progression taux de livraison (vert/orange/rouge selon performance)
- Widget missions actives avec progression par chauffeur
- Stats par zone géographique (Nord/Sud/Est/Ouest)
- Lien rapide vers module Missions si aucune tournée du jour

### Vercel Ready
- `vercel.json` avec headers de cache optimaux (assets immutables, HTML no-cache)
- Variables d'environnement documentées dans `.env.example`
- Build vérifié et fonctionnel

---

## 📋 Déploiement Vercel — Step by Step

### Prérequis
- Compte Vercel (gratuit suffit)
- Repo Git (GitHub, GitLab ou Bitbucket)
- Variables Firebase (console Firebase > Settings > Your apps)

### Étape 1 : Pousser sur Git

```bash
cd fleetgenius
git add .
git commit -m "v2.46.0 - Code splitting + Dashboard missions + Vercel ready"
git push origin main
```

### Étape 2 : Connecter à Vercel

1. Aller sur [vercel.com/new](https://vercel.com/new)
2. **Import Git Repository** → sélectionner le repo FleetGenius
3. **Framework Preset** : Vite (devrait être auto-détecté)
4. **Root Directory** : `.` (racine)
5. **Build Command** : `npm run build` (auto)
6. **Output Directory** : `dist` (auto)

### Étape 3 : Variables d'environnement

Dans Vercel > Settings > Environment Variables, ajouter :

| Variable | Description | Obligatoire |
|----------|-------------|-------------|
| `VITE_FIREBASE_API_KEY` | Clé API Firebase | ✅ |
| `VITE_FIREBASE_AUTH_DOMAIN` | ex: `fleet-genius-app.firebaseapp.com` | ✅ |
| `VITE_FIREBASE_PROJECT_ID` | ex: `fleet-genius-app-485611` | ✅ |
| `VITE_FIREBASE_STORAGE_BUCKET` | ex: `fleet-genius-app.appspot.com` | ✅ |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Sender ID Firebase | ✅ |
| `VITE_FIREBASE_APP_ID` | App ID Firebase | ✅ |
| `VITE_GOOGLE_MAPS_API_KEY` | Clé API Google Maps | ✅ |
| `VITE_GEMINI_API_KEY` | Clé Gemini (Conseiller IA) | Optionnel |

> ⚠️ Sélectionner **tous les environnements** (Production, Preview, Development) pour chaque variable.

### Étape 4 : Déployer

Cliquer **Deploy**. Vercel va :
1. Installer les dépendances (`npm install`)
2. Builder (`npm run build` → Vite)
3. Déployer le dossier `dist/`
4. Fournir une URL : `https://fleetgenius-xxx.vercel.app`

### Étape 5 : Domaine personnalisé (optionnel)

1. Vercel > Settings > Domains
2. Ajouter votre domaine (ex: `app.fleetgenius.re`)
3. Configurer DNS :
   - CNAME `app` → `cname.vercel-dns.com`
   - Ou A record → `76.76.21.21`

### Étape 6 : Firebase — Autoriser le domaine

1. Console Firebase > Authentication > Settings > Authorized domains
2. Ajouter : `fleetgenius-xxx.vercel.app` ET votre domaine personnalisé
3. Sans ça, l'authentification Firebase sera bloquée par CORS

---

## ⚠️ Points Importants

### Cloud Functions = Firebase (pas Vercel)
Les Cloud Functions (proxy GMPRO OAuth2) restent sur Firebase Functions.
Elles sont dans `/functions/` et se déploient séparément :

```bash
cd functions
firebase deploy --only functions
```

Vercel héberge uniquement le **frontend** (SPA React).

### Firebase Auth Domain
Si vous utilisez un domaine personnalisé, mettez à jour `VITE_FIREBASE_AUTH_DOMAIN` pour pointer vers votre domaine au lieu de `.firebaseapp.com` (ou gardez l'original — les deux fonctionnent).

### Preview Deployments
Chaque push sur une branche Git crée automatiquement une preview deployment sur Vercel. Utile pour tester avant de merger en production.

### Rollback
Vercel garde l'historique de tous les déploiements. En cas de problème :
Vercel > Deployments > cliquer sur un déploiement antérieur > "Promote to Production"

---

## 📊 Structure des Chunks (après build)

| Chunk | Taille (gzip) | Chargement |
|-------|---------------|------------|
| `index.js` (shell) | 23 KB | Immédiat |
| `Dashboard.js` | 12 KB | À la demande |
| `MissionManager.js` | 18 KB | À la demande |
| `vendor-firebase` | 117 KB | Caché longue durée |
| `vendor-charts` | 158 KB | Quand graphiques affichés |
| `vendor-maps` | 43 KB | Quand carte affichée |
| `vendor-xlsx` | 114 KB | Quand import Excel |
| Autres composants | 3-12 KB chacun | À la demande |

Premier chargement : ~**150 KB gzip** (shell + Firebase)
Avec Dashboard : ~**170 KB gzip**
Avant v2.46.0 : **635 KB gzip** en un seul bloc
