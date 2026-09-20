# Votes des salariés — 4.30.0

Le menu **Votes des salariés** ouvre `/votes`. Il est disponible dans les démarches des chauffeurs et dans **Équipe & RH** pour les autres salariés. Les clients sont exclus. Le GPS et les documents opérationnels en attente ne conditionnent pas l'accès au vote ; des liens vers le module sont présents sur ces écrans de blocage.

## Organiser un scrutin

1. La direction ou le secrétariat choisit **Préparer un vote** et renseigne un titre, l'objet de la décision et la question posée.
2. Elle sélectionne les **participants** qui pourront consulter le scrutin et les documents, puis les **électeurs**, nécessairement parmi ces participants. Pour une élection, elle choisit les **candidats** parmi les participants. Un candidat unique est accepté. Les comptes désactivés, les clients et les comptes privés du droit de vote ne sont pas proposés.
3. Elle définit les choix, leur nombre maximum par bulletin, le vote blanc, le quorum et le calendrier. Les nouveaux scrutins sont obligatoirement secrets, y compris pour un appel direct à l’API. Les dates sont saisies et affichées à l'heure de La Réunion.
4. Elle enregistre le brouillon, joint les documents et vérifie le récapitulatif. Le secrétariat joint les documents destinés aux participants. La direction peut également ajouter des documents qui lui sont réservés.
5. **Publier le scrutin** fige son objet, ses choix, les personnes sélectionnées, ses règles, ses dates et ses pièces jointes. Un vote programmé s'ouvre à l'heure prévue ; le serveur refuse tout bulletin reçu après l'heure limite. La direction ou le secrétariat clôture explicitement pour dépouiller. Une clôture anticipée impose un motif.
6. Après clôture, la direction consulte le tableau de résultats et le registre de participation, puis utilise **Exporter le tableau CSV** pour Excel ou LibreOffice.
7. Elle renseigne la présidence du scrutin, éventuellement le secrétariat, le lieu et les observations/décisions, puis **Finaliser le procès-verbal**. Le bouton **Télécharger le PV PDF** devient disponible. La finalisation fige ces informations ; les signatures sont à apposer sur le PDF. Les exemplaires signés peuvent ensuite être joints au scrutin.

Le CSV contient l'objet, les règles, la participation, les résultats et le registre de participation. Le PDF contient l'objet, la question, les dates, les règles, les responsables, les résultats, le quorum, les observations, les noms des annexes, les espaces de signature et une empreinte du contenu enregistré. Il gère plusieurs pages. Le moteur PDF n'est chargé qu'au téléchargement.

## Droits d’organisation

| Action | Direction, président, administrateur | Secrétariat | Autres salariés |
| --- | --- | --- | --- |
| Préparer, modifier un brouillon, choisir électeurs/candidats | Oui | Oui | Non |
| Publier, clôturer, annuler avec motif | Oui | Oui | Non |
| Joindre les documents des participants avant publication | Oui | Oui | Non |
| Consulter les résultats, le registre et exporter | Après clôture | Non | Non |
| Finaliser/télécharger le PV généré, joindre un PV signé | Oui | Non | Non |
| Déposer un bulletin | Si sélectionné comme électeur | Si sélectionné comme électeur | Si sélectionné comme électeur |

Les révocations individuelles de `votes.manage` et `votes.view` restent respectées. Un PV signé partagé explicitement par la direction avec les participants reste téléchargeable par les personnes sélectionnées, y compris un membre du secrétariat invité. L’organisation seule ne donne pas accès à ce document partagé ni aux pièces réservées à la direction.

## Parcours du salarié

Lorsqu’un scrutin est ouvert et que le salarié est électeur sans avoir encore voté, une fenêtre **Un vote vous attend** passe devant les autres vues, y compris les alertes GPS et documents. Elle rappelle l’objet du vote, sa date limite et la confidentialité. La recherche a lieu à l’ouverture de l’application, au retour dans un onglet visible, au rétablissement du réseau et toutes les 30 secondes lorsque l’onglet est visible et connecté. Les scrutins sont proposés par date de clôture croissante, sans masquer ceux placés après une page de rappels déjà fermés.

**Passer au vote** ouvre le scrutin concerné. Une saisie non enregistrée reste protégée par sa confirmation habituelle ; une opération en cours doit se terminer avant de changer de page. La fenêtre n’interrompt pas le salarié déjà dans le scrutin proposé. Après confirmation du bulletin, elle ne revient plus pour ce scrutin.

La croix ou **Continuer sans voter** affiche d’abord un avertissement. **Confirmer : continuer sans voter** mémorise la fermeture sur le serveur, pour ce salarié et ce scrutin, sans déposer de bulletin, sans vote blanc et sans toucher au résultat. La même invitation ne revient plus sur les autres appareils. Le salarié peut cependant revenir volontairement voter jusqu’à la clôture. Si aucun bulletin n’a été déposé à la clôture, il est compté en abstention dans le tableau et le PV. La fermeture du rappel n’est pas un renoncement irréversible au droit de vote. S’il existe plusieurs scrutins concernés, le suivant est proposé.

En cas d’échec réseau de cette confirmation, aucun succès n’est annoncé : le salarié peut réessayer ou fermer les rappels pour la session courante afin de continuer son travail. Cette exception locale ne vaut pas enregistrement serveur et prend fin au rechargement, à une nouvelle connexion ou au rétablissement du réseau. Une indisponibilité du service de rappels ne bloque pas les opérations métier.

Le salarié ouvre un scrutin, lit **Pourquoi vote-t-on ?**, consulte les règles et les documents, choisit son bulletin puis vérifie sa sélection dans la confirmation. L'application affiche une référence et la date après la confirmation effective du serveur. Un double clic, deux onglets concurrents ou une nouvelle tentative après une réponse perdue ne créent jamais un second vote. Un participant sans droit de vote peut lire le scrutin et ses annexes autorisées.

Les votes ne sont pas mis en file d'attente hors connexion. En cas de connexion incertaine, **Vérifier le scrutin** permet de retrouver la confirmation déjà enregistrée ; une nouvelle tentative reste protégée contre les doublons.

## Décisions retenues

- **Périmètre : consultations internes et élections simples.** Ce module n'implémente pas un dispositif d'élection CSE certifié, les collèges électoraux, les listes syndicales, plusieurs tours ou une répartition de sièges. Aucun document modèle n'ayant été joint à la demande, le PV est un modèle interne générique ; un modèle existant peut être importé comme pièce jointe, sans extraction automatique de ses champs.
- **Secret obligatoire pour les nouveaux scrutins.** Aucun choix individuel ni empreinte de choix n'est conservé dans le registre d'un vote secret. L'urne contient seulement les compteurs agrégés. Le registre séparé permet de savoir qui a voté et quand. Un ancien brouillon nominatif doit être enregistré en secret avant publication. Les scrutins nominatifs déjà publiés conservent leurs règles initiales et affichent explicitement que les choix seront visibles par la direction : leur confidentialité n’est jamais réécrite rétroactivement.
- **Priorité et liberté de participer.** Seuls les électeurs concernés voient l’invitation bloquante. Fermer après avertissement ne constitue ni un vote ni une exclusion définitive. Le serveur protège les fermetures concurrentes avec le vote, et les marqueurs de rappel ne sont jamais exposés aux clients Firestore directs, aux exports ou au journal public.
- **Résultats après clôture.** La direction n'accède ni aux compteurs ni au registre de participation pendant le vote. Après clôture, les résultats et le registre sont réservés aux rôles direction, président et administrateur. Le secrétariat peut préparer, modifier, publier, clôturer et annuler les scrutins, sans accéder aux résultats, au registre de participation, aux exports ou à la finalisation du PV. Un droit personnalisé ne permet pas de transformer un rôle client, chauffeur, mécanicien ou stagiaire en organisateur ; la restriction de rôle est également appliquée au serveur.
- **Règles figées à la publication.** Pour corriger un scrutin publié, il faut l'annuler avec un motif et en créer un nouveau, éventuellement en le copiant. Le scrutin annulé et sa trace restent conservés. Un scrutin clôturé ne peut être ni rouvert ni annulé. Les modifications concurrentes de brouillon sont détectées.
- **Pas de proclamation automatique.** Les votes blancs participent au quorum mais pas aux bulletins exprimés. Le tableau signale un quorum non atteint ou une égalité. Avec plusieurs choix possibles, chaque pourcentage est rapporté aux bulletins exprimés. La décision et un éventuel départage restent à consigner par le bureau dans le PV.
- **Pièces jointes :** PDF, DOC, DOCX, JPEG ou PNG, 5 Mo par fichier, dix annexes et trois exemplaires signés. Les exemplaires signés disposent d'une capacité distincte pour ne pas être bloqués par les annexes. Les fichiers ne sont pas écrasables. Les téléchargements passent par une vérification serveur des destinataires et utilisent la génération exacte du fichier enregistré.
- **Limites explicites :** 500 participants et 50 choix/candidats par scrutin. Les scrutins sont chargés par pages de 30. La suppression d'une annexe de brouillon la retire du scrutin et de ses téléchargements ; elle ne supprime pas physiquement l'objet de stockage. Aucune purge automatique ni suppression de scrutin n'est disponible.
- **Traçabilité :** création, modification, publication, clôture, annulation, documents et finalisation du PV produisent des événements réservés au serveur dans le journal existant. Aucun choix secret n'est ajouté au journal.

## Garanties et limites techniques

Firestore refuse l'accès direct aux scrutins, compteurs et participations, y compris depuis un compte direction. La fonction `employeeVoting` contrôle les sessions actives, les rôles, les droits, l'appartenance au scrutin et le calendrier. L'enregistrement du bulletin, du reçu et des compteurs est atomique. La clôture contrôle la cohérence entre compteurs et participations. Le CSV neutralise les formules dans les valeurs textuelles.

Le secret décrit ici concerne l'application et les données individuelles qu'elle expose. Il ne constitue pas une urne cryptographique indépendante de l'administrateur de l'infrastructure. Le stockage agrégé ne permet pas un recomptage bulletin par bulletin d'un scrutin secret ; les résultats agrégés et le nombre de participations sont contrôlés à la clôture. Des petits effectifs ou des résultats unanimes peuvent permettre des déductions. L'empreinte SHA-256 du PV est une référence d'intégrité du contenu figé ; ce n'est pas une signature électronique certifiée ni une preuve indépendante de l'administrateur technique.

Aucun scrutin réel, aucun bulletin réel et aucune notification adressée aux salariés n'ont été créés pour valider cette livraison. Les élus, règles particulières et modèles de document restent sous le contrôle de la direction.

Voir la [recette et les exemples fictifs](../validation/voting/README.md).
