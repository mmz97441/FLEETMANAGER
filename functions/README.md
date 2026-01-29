# Cloud Functions FleetGenius

Ce dossier contient les Cloud Functions Firebase pour les opérations serveur.

## Prérequis

- Node.js 18+
- Firebase CLI installé : `npm install -g firebase-tools`
- Plan Firebase Blaze (pay-as-you-go)

## Installation

```bash
# 1. Se placer dans le dossier functions
cd functions

# 2. Installer les dépendances
npm install

# 3. Compiler TypeScript
npm run build
```

## Configuration

1. **Modifiez `.firebaserc`** à la racine du projet :
   ```json
   {
     "projects": {
       "default": "votre-project-id-firebase"
     }
   }
   ```
   
   Trouvez votre Project ID dans la Firebase Console.

2. **Connectez-vous à Firebase** :
   ```bash
   firebase login
   ```

## Déploiement

```bash
# Depuis la racine du projet (pas le dossier functions)
cd ..
firebase deploy --only functions
```

## Fonctions disponibles

### `deleteUserCompletely`

Supprime complètement un utilisateur :
- Compte Firebase Auth
- Document Firestore (users)
- Invitations associées
- Log d'audit

**Sécurité** : Seuls les admins/présidents/directeurs peuvent appeler cette fonction.

### `cleanupExpiredInvitations`

Fonction planifiée (cron) qui s'exécute tous les jours à 3h du matin pour supprimer les invitations expirées non utilisées.

## Test local (optionnel)

```bash
# Lancer l'émulateur Firebase
npm run serve

# Dans cloudFunctions.ts, décommenter :
# connectFunctionsEmulator(functions, "localhost", 5001);
```

## Logs

```bash
# Voir les logs en temps réel
firebase functions:log
```

## Coûts

Avec le plan Blaze :
- 2 millions d'invocations gratuites par mois
- Au-delà : ~$0.40 / million d'invocations
- La fonction `cleanupExpiredInvitations` = 30 invocations/mois (gratuit)
