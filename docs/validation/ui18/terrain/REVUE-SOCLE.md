# Relecture indépendante du socle UI18

Lecture seule des composants shared/Modal, FormInput, StatCard, Trend, CountBadge, du CSS commun et des hooks de dialogue. Aucune régression bloquante identifiée sur le périmètre lu.

- Modal conserve le portail, la pile de focus, la restauration au déclencheur, l’inertie du fond, le blocage de fermeture pendant opération et la protection des saisies. Le plein écran est volontaire, limité au mobile et conserve un corps flex min-height0 avec footer non rétractable. Les scénarios terrain confirment les comportements occupés et les footers390×420. La validation du clavier système physique reste distincte.
- FormInput conserve les IDs stables, labels, aria-invalid/aria-describedby, ref et transmission des propriétés natives. Les champs mobiles restent16px. Les boutons désactivés ne déclenchent pas une deuxième action.
- StatCard utilise une commande native de détail, une valeur neutre et Trend ; les anciennes variantes colorées ne dictent plus un jugement de performance.
- Trend distingue direction et appréciation métier. Zéro, absence de valeur finie et sens neutre ne deviennent pas une réussite/erreur.
- CountBadge utilise des quantités statiques ; le libellé accessible conserve la quantité exacte même si l’affichage compact indique99+.

Deux finitions signalées à l’orchestrateur puis corrigées par lui : singulier«1 élément» du CountBadge ; classes explicites ui-button-sm/lg afin que le CSS commun n’annule pas silencieusement la taille lg. L’orchestrateur a ajouté une sonde48px/16px pour cette variante. Les tests globaux de son lot restent sous sa responsabilité.

Aucune assertion de conformité exhaustive WCAG ou de validation matérielle n’est déduite de cette relecture.
