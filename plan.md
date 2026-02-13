# Plan d'implémentation — Solution A : Une ligne = un destinataire + colonne Quantité

## Vue d'ensemble

Quand un client met `Quantity > 1` dans l'Excel, le système génère N colis consécutifs à partir du `Order_Number` fourni. Tous les colis partagent un `packageGroupId` et le chauffeur ne peut valider la livraison qu'après avoir scanné TOUS les colis du groupe.

---

## Étape 1 : Mise à jour des types (`src/types.ts`)

**Modifications :**
- Ajouter `Quantity` (optionnel, défaut 1) à `ClientFileRow`
- Ajouter à `Package` :
  - `packageGroupId?: string` — identifiant commun pour les colis issus d'une même ligne
  - `packageIndex?: number` — position dans le groupe (1, 2, 3...)
  - `packageTotal?: number` — total de colis dans le groupe
- Ajouter à `ReviewRow` : champ `quantity` pour l'affichage dans la review

---

## Étape 2 : Mise à jour de l'import Excel (`src/services/importService.ts`)

**2a — Parsing (`parseExcelFile` & `parseExcelForReview`) :**
- Lire la colonne `Quantity` (défaut = 1 si absente ou vide)
- Valider que `Quantity` est un entier ≥ 1 (sinon warning/erreur)
- Afficher la quantité dans la ReviewRow

**2b — Confirmation (`confirmReviewedImport`) :**
- Pour chaque ligne avec `quantity > 1` :
  - Générer un `packageGroupId` unique (UUID ou basé sur orderNumber)
  - Créer N packages avec :
    - `orderNumber` incrémenté : si Order_Number = "15087911" et qty = 3 → "15087911", "15087912", "15087913"
    - `packageIndex` : 1, 2, 3
    - `packageTotal` : 3
    - `packageGroupId` identique pour les 3
    - `barcode` : généré individuellement pour chaque colis (GFL-YYMMDD-XXXXX)
  - Mettre à jour le compteur total de colis dans `ImportBatch`

---

## Étape 3 : Mise à jour des étiquettes (`src/components/ShippingLabel.tsx`)

- Afficher **"Colis X / Y"** en gros quand `packageTotal > 1`
- L'info apparaît dans la section "Détails" de l'étiquette (à côté de Poids/Volume)
- Chaque colis a son propre code-barres unique

---

## Étape 4 : Mise à jour de la vue chauffeur (`src/components/DriverMissionView.tsx`)

**4a — Affichage du stop :**
- Si un stop a des colis avec `packageTotal > 1`, afficher un badge d'alerte : "⚠ 3 COLIS"
- Lister chaque colis avec son statut de scan (scanné / non scanné)

**4b — Validation bloquante :**
- Compter les colis attendus dans le stop (via `packageIds` du `MissionStop`)
- Le bouton "Valider livraison" est **grisé/désactivé** tant que TOUS les colis ne sont pas scannés
- Afficher un compteur de progression : "2/3 colis scannés"
- Si un colis est introuvable, le chauffeur peut le déclarer "manquant" avec motif obligatoire

---

## Étape 5 : Mise à jour de la review d'import (UI dans `MissionManager.tsx`)

- Afficher la colonne "Quantité" dans le tableau de review
- Badge visuel quand quantité > 1
- Montrer le range de numéros qui seront générés (ex: "15087911 → 15087913")

---

## Étape 6 : Mise à jour du service de mission (`src/services/missionService.ts`)

- `getPackageByBarcode()` : pas de changement nécessaire (chaque colis a son propre barcode)
- S'assurer que les packages groupés restent ensemble dans le même stop lors de la création de mission

---

## Résumé des fichiers impactés

| Fichier | Changement |
|---------|-----------|
| `src/types.ts` | Nouveaux champs Package + ClientFileRow |
| `src/services/importService.ts` | Parsing Quantity + génération multi-colis |
| `src/components/ShippingLabel.tsx` | Affichage "Colis X/Y" |
| `src/components/DriverMissionView.tsx` | Scan obligatoire + blocage validation |
| `src/components/MissionManager.tsx` | Review UI avec quantité |
| `src/services/missionService.ts` | Vérification groupement stops |
