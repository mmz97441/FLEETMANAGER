# Analyse 360° - FleetGenius Pro v3.1.0

## Optimisation de Tournées, Missions & Logique Métier

---

## 1. ARCHITECTURE GLOBALE

### Stack technique
| Couche | Technologie |
|--------|-------------|
| Frontend | React 18 + TypeScript + Vite |
| Styling | Tailwind CSS (dark mode) |
| Base de données | Cloud Firestore (NoSQL) |
| Authentification | Firebase Auth |
| Stockage | Firebase Storage |
| Backend | Firebase Cloud Functions (Node.js 20) |
| Cartographie | Leaflet + react-leaflet |
| Optimisation | Google Route Optimization API (GMPRO) |
| IA | Google Gemini |
| Déploiement | Vercel (frontend) + Firebase (backend) |

### Structure du code
- **46+ composants** React (lazy-loaded)
- **13 services** métier (~6200 LOC)
- **1200+ lignes** de types TypeScript
- **140+ permissions** granulaires
- **15+ collections** Firestore
- **Bundle optimisé** : 23 KB gzip initial (37 chunks)

---

## 2. OPTIMISATION DE TOURNÉES — Analyse approfondie

### 2.1 Architecture du flux d'optimisation

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────────┐
│   DISPATCH UI   │───▶│  gmproService.ts │───▶│  Cloud Function     │
│ (DispatchManager)│    │  (Frontend)      │    │  optimizeTours      │
└─────────────────┘    └──────────────────┘    └─────────────────────┘
                              │                         │
                              │ geocodeAddress()        │ OAuth2 (ADC)
                              ▼                         ▼
                       ┌──────────────┐         ┌──────────────────┐
                       │ Google Maps  │         │ GMPRO API        │
                       │ Geocoding    │         │ (Route Optim.)   │
                       └──────────────┘         └──────────────────┘
```

### 2.2 Fichiers clés

| Fichier | Rôle | LOC |
|---------|------|-----|
| `src/services/gmproService.ts` | Moteur d'optimisation frontend | 582 |
| `functions/src/index.ts:34-185` | Proxy GMPRO (OAuth2) | 150 |
| `src/services/cloudFunctions.ts` | Interface Cloud Functions | ~100 |
| `src/components/DispatchManager.tsx` | UI de dispatch | 300+ |
| `src/components/MissionManager.tsx` | Gestion des missions | 3500+ |

### 2.3 Algorithme d'optimisation — Étapes détaillées

**Fonction principale : `optimizeMultiVehicle()`** (`gmproService.ts:173-438`)

#### Étape 1 — Géocodage (`geocodePackages()`, lignes 76-102)
- Filtre les colis sans coordonnées GPS
- Déduplique par adresse (clé : `address|postalCode|city`)
- Appel séquentiel à Google Geocoding API
- **Problème identifié** : Géocodage séquentiel (pas de parallélisation), potentiellement lent pour de gros volumes

#### Étape 2 — Groupement par stop (`groupPackagesByStop()`, lignes 115-145)
- Regroupe les colis ayant la même adresse en un seul arrêt
- Vérifie la cohérence : `totalPackagesInStops === packages.length`
- Log une erreur si perte de colis durant le groupement

#### Étape 3 — Validation du hub
- Vérifie les coordonnées du hub (centre de tri)
- Si absentes : géocode l'adresse du hub
- Si échec : fallback géographique automatique

#### Étape 4 — Filtrage des stops sans coordonnées
- Sépare les stops avec/sans coords valides
- Si tous sans coords → fallback
- Si partiellement → optimise uniquement ceux avec coords (les autres sont ignorés)
- **Risque** : les stops sans coords sont silencieusement exclus de l'optimisation

#### Étape 5 — Construction du modèle GMPRO
```typescript
model = {
  shipments: [{                           // Livraisons
    deliveries: [{
      arrivalLocation: { lat, lng },
      duration: "300s",                   // serviceTime = max(5, nb_colis × 5) minutes
      timeWindows?: [{ startTime, endTime }]  // Créneau client (optionnel)
    }],
    label: "Stop 1: Dupont (3 colis)",
    penaltyCost: 10000                    // Pénalité si skip
  }],
  vehicles: [{                            // Chauffeurs/Véhicules
    startLocation: hubCoords,             // Départ = Hub
    endLocation: hubCoords,               // Retour = Hub
    label: "Jean Martin (AB-123-CD)"
  }],
  globalStartTime: "2025-01-15T08:00:00+04:00",  // Heure de départ
  globalEndTime: "2025-01-15T20:00:00+04:00",     // Heure max (fermeture hub)
  searchMode: 2                           // CONSUME_ALL_AVAILABLE_TIME
}
```

**Points clés du modèle :**
- `penaltyCost: 10000` côté frontend, transformé en `100000` côté Cloud Function → quasi-obligatoire de livrer chaque stop
- `costPerKilometer: 1` ajouté côté Cloud Function
- `globalDurationCostPerHour: 10` pour équilibrer temps/distance
- `considerRoadTraffic: true` → prise en compte du trafic routier
- `searchMode: 2` (CONSUME_ALL_AVAILABLE_TIME) → optimisation maximale

#### Étape 6 — Appel GMPRO via Cloud Function
- Proxy OAuth2 (Application Default Credentials)
- Timeout : 120 secondes, 256 MB mémoire
- Région : `europe-west1`
- **Pas de retry** en cas d'erreur → l'erreur remonte directement

#### Étape 7 — Parsing des résultats
- Itère sur les routes retournées
- Pour chaque `visit` : reconstruit le `MissionStop` avec séquence, packages, ETA
- Calcule la distance/durée via les métriques GMPRO (ou estime via Haversine si absent)
- Identifie les stops skippés par GMPRO

### 2.4 Algorithme de fallback

**Fonction : `createFallbackOptimization()`** (`gmproService.ts:444-519`)

Utilisé quand GMPRO est indisponible :
1. Tri des stops par latitude (nord → sud)
2. Distribution uniforme entre les chauffeurs (`stopsPerDriver = ceil(total / n)`)
3. Estimation de distance via Haversine × 1.4 (facteur route)
4. Estimation de durée : `(distance / 30 km/h) × 60 + Σ serviceTime`

**Limitations du fallback :**
- Pas de prise en compte des time windows
- Distribution purement géographique (latitude uniquement)
- Pas de retour au hub optimisé
- Facteur de correction routier fixe (1.4)

### 2.5 Calculs de distance et durée

| Fonction | Méthode | Détail |
|----------|---------|--------|
| `haversineDistance()` | Great-circle | R=6371 km, formule standard |
| `estimateDistanceForStops()` | Haversine × 1.4 | Hub → stops → Hub, facteur routier |
| `estimateDurationForStops()` | distance/30 + serviceTime | Vitesse moyenne 30 km/h |

### 2.6 Gestion des créneaux horaires (time windows)

```
- Si le créneau démarre avant le départ global → recalé au départ
- Si le créneau finit après la fermeture → limité à la fermeture
- Si le créneau ajusté < 15 min → pas de contrainte horaire (libre)
- Si pas de créneau → libre (pas de contrainte temporelle)
```

---

## 3. CYCLE DE VIE DES MISSIONS

### 3.1 Workflow des statuts

```
                  ┌──────────┐
                  │  DRAFT   │  Création manuelle ou import
                  └────┬─────┘
                       │ Optimisation GMPRO
                  ┌────▼─────┐
                  │OPTIMIZED │  Tournées calculées
                  └────┬─────┘
                       │ Dispatch aux chauffeurs
                  ┌────▼─────┐
                  │DISPATCHED│  Assignée, en attente
                  └────┬─────┘
                       │ Chauffeur démarre
                  ┌────▼──────┐
                  │IN_PROGRESS│  En cours de livraison
                  └────┬──────┘
                       │
              ┌────────┴────────┐
         ┌────▼─────┐    ┌─────▼────┐
         │COMPLETED │    │CANCELLED │
         └──────────┘    └──────────┘
```

### 3.2 Workflow des stops

```
  PENDING → ARRIVED → COMPLETED (avec POD)
                    → FAILED (avec motif)
                    → SKIPPED
```

### 3.3 Workflow des colis (Package)

```
  PENDING → COLLECTED → AT_HUB → SORTED → LOADED → IN_DELIVERY → DELIVERED
                                                                 → FAILED → RETURN_REQUESTED → RETURNED
```

**Mouvements trackés (13 types) :**
IMPORTED, COLLECTED, HUB_ARRIVAL, SORTED, LOADED, TRANSFERRED, OUT_FOR_DELIVERY, DELIVERED, FAILED, RETURN_REQUESTED, RETURNED, STOP_DELETED, MANUAL_STATUS_CHANGE

### 3.4 Motifs d'échec de livraison
- `ABSENT` — Destinataire absent
- `WRONG_ADDRESS` — Erreur d'adresse
- `REFUSED` — Refusé par le destinataire
- `DAMAGED` — Colis endommagé
- `ACCESS_DENIED` — Accès impossible
- `CLOSED` — Établissement fermé
- `OTHER` — Autre raison

---

## 4. PROCESSUS DE DISPATCH — Flux complet

### 4.1 Étapes du dispatch (DispatchManager.tsx)

1. **Sélection de zone** (Nord/Sud/Est/Ouest)
2. **Sélection des chauffeurs** disponibles pour la zone
3. **Filtrage des colis** :
   - Statut `AT_HUB` ou `SORTED` uniquement
   - Exclusion des colis déjà assignés (anti-double dispatch)
4. **Configuration** :
   - Heure de départ planifiée
   - Override des time windows possible (`ignoreTimeWindows`)
5. **Lancement de l'optimisation** → GMPRO
6. **Aperçu des résultats** : tournées, distances, stops par chauffeur
7. **Confirmation du dispatch** :
   - Crée une `Mission` par tournée
   - Met à jour le statut des colis → `IN_DELIVERY`
   - Assigne les stops avec numéros de séquence
   - Envoie les notifications aux chauffeurs
   - Logue l'activité

### 4.2 Statistiques par zone (affichées)
- Nombre de colis en attente
- Nombre de stops uniques
- Chauffeurs disponibles
- Hub assigné

---

## 5. OPÉRATIONS CHAUFFEUR (Mobile)

### 5.1 Vue chauffeur (DriverTourView.tsx + DriverMissionView.tsx)

**Fonctionnalités :**
- Liste des stops ordonnés par séquence
- ETA estimée par stop
- Distance/durée jusqu'au prochain stop
- Navigation intégrée (Google Maps / Waze)
- Appel du contact téléphonique
- Scan de code-barre (html5-qrcode)

**Flux de livraison :**
1. Scanner les colis au chargement
2. Confirmer le départ → Mission passe en `IN_PROGRESS`
3. Pour chaque stop :
   - Naviguer (Google Maps/Waze)
   - Marquer "Arrivé"
   - Livrer → Capturer POD (signature + photos)
   - Ou déclarer échec avec motif
4. Retour au hub → Mission `COMPLETED`

### 5.2 Proof of Delivery (POD)
- Signature digitale du destinataire
- Photos (compressées, max 1200px, JPEG 0.7)
- Watermark automatique (GPS + timestamp + nom chauffeur)
- Coordonnées GPS au moment de la livraison
- Upload vers Firebase Storage

---

## 6. GESTION DES HUBS

### 6.1 Structure

Chaque hub représente un centre de tri/dépôt :
- Zone assignée (Nord/Sud/Est/Ouest)
- Adresse + coordonnées GPS
- Codes postaux couverts
- Horaires d'ouverture/fermeture
- Statut actif/inactif

### 6.2 Mapping Codes Postaux → Zones

Le système couvre **La Réunion** (974xx) avec 4 zones :
- **NORD** : Saint-Denis (97400), Sainte-Clotilde (97490), La Possession (97419)...
- **SUD** : Saint-Pierre (97410), Le Tampon (97430), Saint-Joseph (97480)...
- **EST** : Saint-André (97440), Saint-Benoît (97470), Sainte-Marie (97438)...
- **OUEST** : Saint-Paul (97460), Saint-Gilles (97434), Saint-Leu (97436)...

Détection automatique de zone via regex `974\d{2}` dans l'adresse.

---

## 7. IMPORT & CRÉATION DE COLIS

### 7.1 Import Excel (importService.ts)

**Colonnes attendues :**
| Colonne | Obligatoire | Description |
|---------|-------------|-------------|
| Id | Non | Identifiant externe |
| Address | Oui | Adresse complète |
| Floor | Non | Étage |
| Elevator | Non | Ascenseur (oui/non) |
| Order_Number | Oui | Numéro de commande (code-barre) |
| Contact | Oui | Nom du destinataire |
| Telephone | Non | Téléphone |
| Comment | Non | Instructions |
| Start | Non | Début créneau (HH:MM) |
| End | Non | Fin créneau (HH:MM) |
| Volume | Non | Volume en m³ |
| Weight | Non | Poids en kg |
| Service_Time | Non | Temps sur place (min) |
| Tour | Non | Tournée pré-assignée |

**Workflow :**
1. Upload du fichier Excel (.xlsx/.csv)
2. Parsing avec validation par ligne
3. Auto-détection du code postal et de la zone
4. Revue des erreurs avant import
5. Création batch en Firestore

### 7.2 Conversion Devis → Colis (deliveryService.ts)

```
Devis (ACCEPTED) → extractPostalCode → detectZone → créer Package (PENDING) → notifier
```

---

## 8. GESTION DE FLOTTE

### 8.1 Véhicules
- **Statuts** : ACTIVE, MAINTENANCE, IDLE, ISSUE, IMMOBILIZED
- **Types de propriété** : OWNED, LEASED, REPLACEMENT
- **Suivi** : kilométrage, contrôle technique, maintenance, carburant, AdBlue
- **Véhicules de remplacement** : coût journalier, imputation au véhicule remplacé

### 8.2 Assignation Chauffeur ↔ Véhicule
- Relation 1-to-1 stricte
- Détection de conflits (véhicule déjà pris / chauffeur déjà assigné)
- Opérations atomiques via Firestore writeBatch

### 8.3 Carburant et maintenance
- Suivi par plein avec kilométrage
- Calcul automatique de consommation
- Historique de maintenance avec factures
- Alertes sur les échéances (CT, vidange, etc.)

---

## 9. CRÉNEAUX DE LIVRAISON (deliveryService.ts)

| Créneau | Horaires | Zones |
|---------|----------|-------|
| Matin | 07:00-12:00 | Toutes |
| Après-midi | 13:00-17:00 | Toutes |
| Express matin (avant 10h) | 07:00-10:00 | Nord/Ouest uniquement |
| Express après-midi (avant 15h) | 13:00-15:00 | Nord/Ouest uniquement |

**Règles :**
- Cutoff : 2h avant le début du créneau
- Same-day possible si commande avant 10h00
- Pas de livraison le week-end
- Blacklist de jours fériés

---

## 10. POINTS FORTS IDENTIFIÉS

1. **Optimisation GMPRO** : utilisation d'une API Google de qualité professionnelle pour le routage multi-véhicules
2. **Fallback robuste** : algorithme géographique quand GMPRO n'est pas disponible
3. **Traçabilité complète** : chaque colis a un historique de mouvements complet
4. **POD solide** : signature + photos + watermark GPS/timestamp
5. **Système de zones** : découpage géographique adapté à La Réunion
6. **Performance frontend** : code-splitting agressif (23 KB initial)
7. **Audit trail** : 40+ types d'actions loguées
8. **Permissions granulaires** : 140+ permissions, overrides par utilisateur
9. **Multi-canal mobile** : navigation Google Maps et Waze intégrées
10. **Import automatisé** : Excel → auto-détection zone → dispatch

---

## 11. POINTS D'AMÉLIORATION & RISQUES IDENTIFIÉS

### 11.1 Optimisation de tournées

| # | Problème | Sévérité | Détail |
|---|----------|----------|--------|
| 1 | **Géocodage séquentiel** | Moyenne | Les appels geocoding se font un par un. Pour 50 adresses, cela peut prendre 10-15s. Un batch ou une parallélisation (Promise.all avec throttle) serait bénéfique. |
| 2 | **Pas de cache de géocodage** | Moyenne | Les mêmes adresses sont re-géocodées à chaque dispatch. Un cache Firestore des coordonnées par adresse économiserait des appels API. |
| 3 | **Pas de retry GMPRO** | Haute | Si l'appel GMPRO échoue, l'erreur remonte directement. Pas de retry avec backoff exponentiel. |
| 4 | **Fallback trop simpliste** | Moyenne | Le tri par latitude seul ne produit pas des tournées efficaces. Un algorithme de clustering (k-means sur lat/lng) puis un TSP simplifié (nearest neighbor) serait meilleur. |
| 5 | **Stops sans coords silencieusement exclus** | Haute | Les colis dont l'adresse ne peut être géocodée sont ignorés sans alerte visible pour l'utilisateur dans le résultat final. |
| 6 | **Pas de capacité véhicule** | Moyenne | Le modèle GMPRO ne transmet pas de contrainte de capacité (poids, volume). Risque de surcharge d'un véhicule. |
| 7 | **searchMode fixe à 2** | Faible | CONSUME_ALL_AVAILABLE_TIME est optimal pour la qualité mais le plus lent. Pour des urgences, un mode plus rapide serait utile. |
| 8 | **Estimation de durée simpliste** | Faible | La vitesse moyenne fixe de 30 km/h est acceptable pour La Réunion mais ne tient pas compte du relief montagneux. |
| 9 | **Pas de re-optimisation en cours de tournée** | Moyenne | Si un chauffeur a un échec, les stops suivants ne sont pas re-routés dynamiquement. |
| 10 | **penaltyCost incohérent** | Faible | 10,000 côté frontend vs 100,000 côté Cloud Function. La valeur CF écrase celle du frontend de toute façon, mais c'est source de confusion. |

### 11.2 Gestion des missions

| # | Problème | Sévérité | Détail |
|---|----------|----------|--------|
| 1 | **Filtrage Firestore côté client** | Haute | `subscribeToPackages` et `subscribeToMissions` récupèrent jusqu'à 500/100 docs puis filtrent en JS. Avec le volume croissant, cela causera des problèmes de performance et de coût Firestore. |
| 2 | **Pas de machine à états formelle** | Moyenne | Les transitions de statut ne sont pas validées (rien n'empêche de passer de DRAFT à COMPLETED). |
| 3 | **Limite de 500 packages** | Haute | Le `limit(500)` dans `subscribeToPackages` signifie que les colis au-delà de 500 ne sont pas visibles. |
| 4 | **Pas de locking optimiste** | Moyenne | Deux dispatchers pourraient optimiser/dispatcher les mêmes colis simultanément. Le filtre anti-double-dispatch est côté UI uniquement. |
| 5 | **Pas de gestion de la charge des chauffeurs** | Moyenne | Aucune notion de nombre max de stops ou d'heures de conduite par chauffeur. |

### 11.3 Architecture générale

| # | Problème | Sévérité | Détail |
|---|----------|----------|--------|
| 1 | **Logique métier dans les composants** | Moyenne | Beaucoup de logique (filtrage, calcul, workflow) est dans les composants React plutôt que dans les services. |
| 2 | **Pas de tests** | Haute | Aucun test unitaire ou d'intégration identifié dans le projet. L'algorithme d'optimisation et les transitions de statut sont critiques et devraient être testés. |
| 3 | **Clé API Maps côté client** | Faible | La clé Google Maps est exposée côté frontend (nécessaire pour Geocoding). Des restrictions de clé (referrer, quota) sont indispensables. |
| 4 | **Pas de queue/worker** | Moyenne | Les notifications et logs sont en fire-and-forget. En cas d'échec, aucune garantie de livraison. |

---

## 12. RECOMMANDATIONS PRIORITAIRES

### Court terme (quick wins)
1. **Ajouter un cache de géocodage** dans Firestore : stocker les coordonnées par adresse normalisée
2. **Paralléliser le géocodage** avec un throttle (5 appels simultanés max)
3. **Ajouter une validation de transition de statut** (state machine) pour missions et colis
4. **Alerter sur les stops non routés** de manière visible dans l'UI post-optimisation
5. **Ajouter un retry** avec backoff sur l'appel GMPRO

### Moyen terme
6. **Ajouter les contraintes de capacité** (poids/volume) au modèle GMPRO
7. **Remplacer le fallback latitude** par un clustering k-means + nearest neighbor
8. **Migrer les filtres** Firestore vers des index composites serveur-side
9. **Ajouter des tests unitaires** pour gmproService, missionService, et les transitions de statut
10. **Implémenter le locking optimiste** pour le dispatch concurrent

### Long terme
11. **Re-optimisation dynamique** : permettre de recalculer la suite d'une tournée après un échec
12. **Modèle de capacité véhicule** complet (poids, volume, nombre de colis max)
13. **Planification multi-jour** : optimisation sur une semaine de livraisons
14. **Historique et analytics** : tableaux de bord sur la performance des tournées (distance réelle vs estimée, respect des créneaux)
