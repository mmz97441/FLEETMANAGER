# Test terrain — Flux scan (enlèvement · dispatch · livraison)

Version cible : **v4.6.0** (visible en bas de l'écran / dans l'en-tête).
À faire par un chauffeur sur un **vrai téléphone**, avec de **vraies étiquettes**.
Coche le résultat attendu à chaque étape. Note tout écart (capture d'écran).

---

## Préparation
- [ ] L'en-tête affiche bien `v4.6.0`.
- [ ] Préparer 4 colis pour **une même pharmacie** (même adresse), dont :
  - au moins 2 avec une étiquette **BR… distincte** (code DELIVREX / DataMatrix),
  - si possible 1 dont l'étiquette ne porte **que le n° de commande** (partagé),
  - si possible 1 **sans aucun code** lisible.

---

## 1) Enlèvement (PICKUP)
- [ ] Arriver à l'enlèvement → « Je suis arrivé ».
- [ ] **Scanner les colis un par un.** Chaque colis passe à `SCANNÉ` (vert). Le compteur monte `1/4 → 4/4`.
- [ ] **Colis « sans code »** : il affiche le badge amber **« SANS CODE »** et ne passe jamais au vert. ✅ attendu.
- [ ] **1 seul colis, étiquette abîmée qui ne scanne pas** : le bouton **« Valider (0/1…) »** reste **cliquable** → il ouvre le garde-fou → **« Forcer l'enlèvement »**. ✅ (avant : bouton bloqué).
- [ ] **Code de commande partagé** scanné une fois : il ne valide **qu'UN** colis (le compteur monte de +1, pas de +N). ✅
- [ ] Signer → « Valider l'enlèvement ».

## 2) Dispatch / réception au hub (si applicable)
- [ ] En réception, scanner un colis : il est reconnu (message ✅), même s'il a été **importé un jour précédent** ou s'il y a **beaucoup de colis** dans le système.
- [ ] Scanner un **DataMatrix** / un code avec **rang -002** : reconnu (le n° BR est extrait).

## 3) Livraison (DELIVERY)
- [ ] Ouvrir l'arrêt de la pharmacie. L'écran affiche **« Colis à remettre »** avec le **bon nombre** (ex. **4**), PAS « 0 » ni « Aucun colis ». ✅ (point corrigé le plus important)
- [ ] Étape 1 · Vérifier les colis : `Colis scannés 0/4`.
- [ ] Scanner les 4 → chaque puce passe `✓` verte, compteur `4/4`.
- [ ] **Colis sans code** : puce amber **« sans code »** → ne passe pas au vert → à la validation, le garde-fou s'affiche → **« Forcer la livraison »** possible. ✅
- [ ] **Code de commande partagé** : un scan ne valide **qu'un** colis (il faut scanner chaque carton distinct). ✅
- [ ] Aller au bout : état marchandise → réception → **signature** → **Valider**.
- [ ] **GPS** : si la localisation est coupée, une modale bloque la validation (« Localisation obligatoire »). ✅ **voulu** — réactiver le GPS puis « Réessayer ».
- [ ] Après validation : le stop passe **Terminé**, le compteur de la tournée avance.

---

## Points de vigilance (ce qui DOIT être vrai)
- Le **nombre de colis à l'arrêt** est toujours **complet** (jamais 0 si l'arrêt a des colis).
- **1 scan = 1 colis** (jamais « tout scanné » d'un seul scan sur un n° partagé).
- On peut **toujours forcer** (livraison ET enlèvement) si un colis ne scanne pas.
- Un colis **sans code** est signalé et se valide en **Forcer**.

## Si ça coince — à noter
Pour chaque blocage : quel écran, combien de colis, quel type de code (BR / DataMatrix / n° commande / sans code), le message affiché, et une capture. → me le remonter pour correction.
