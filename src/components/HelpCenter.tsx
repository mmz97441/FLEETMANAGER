/**
 * HelpCenter - Centre d'aide et guide utilisateur complet
 * 
 * ADAPTÉ PAR RÔLE:
 * - Président/Directeur : Guide complet
 * - Secrétariat : Admin, documents, absences
 * - Chauffeur : Son véhicule, carburant, incidents, absences
 * - Mécanicien : Maintenance, incidents
 * - Stagiaire : Consultation
 */

import React, { useState, useMemo } from 'react';
import {
  HelpCircle, Book, MessageSquare, Mail, Phone,
  ChevronDown, ChevronRight, Search, Truck, Fuel, Wrench,
  AlertTriangle, Users, Calendar, FileText, BarChart3,
  CheckCircle, Send,
  XOctagon, Building2, UserCircle, Shield
} from 'lucide-react';
import { User, UserRole } from '../types';

interface HelpCenterProps {
  currentUser: User;
}

interface GuideSection {
  id: string;
  title: string;
  icon: React.ElementType;
  color: string;
  roles: string[]; // Rôles autorisés à voir cette section
  content: GuideItem[];
}

interface GuideItem {
  title: string;
  description: string;
  steps?: string[];
  tips?: string[];
  new?: boolean;
  roles?: string[]; // Si spécifique à certains rôles dans la section
}

// Helper pour normaliser les rôles
const normalizeRole = (role: string): string => {
  if (!role) return '';
  return role.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z]/g, '');
};

const HelpCenter: React.FC<HelpCenterProps> = ({ currentUser }) => {
  const [activeTab, setActiveTab] = useState<'guide' | 'faq' | 'contact'>('guide');
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null);

  // Déterminer le profil utilisateur
  const userRoleNorm = normalizeRole(String(currentUser.role || ''));
  
  const isPresident = userRoleNorm.includes('president') || userRoleNorm.includes('gerant');
  const isDirector = userRoleNorm.includes('directeur') || userRoleNorm.includes('director');
  const isAdmin = userRoleNorm.includes('admin') || userRoleNorm.includes('secretar') || userRoleNorm.includes('administrat');
  const isDriver = userRoleNorm.includes('chauffeur') || userRoleNorm.includes('driver') || userRoleNorm.includes('livreur');
  const isMechanic = userRoleNorm.includes('mecanic') || userRoleNorm.includes('technic') || userRoleNorm.includes('atelier');
  const isIntern = userRoleNorm.includes('stagiai') || userRoleNorm.includes('intern');
  const isManager = isPresident || isDirector;
  
  // Définir les tags de rôle pour le filtrage
  const userRoleTags: string[] = [];
  if (isPresident) userRoleTags.push('president', 'manager', 'all');
  if (isDirector) userRoleTags.push('director', 'manager', 'all');
  if (isAdmin) userRoleTags.push('admin', 'all');
  if (isDriver) userRoleTags.push('driver', 'all');
  if (isMechanic) userRoleTags.push('mechanic', 'all');
  if (isIntern) userRoleTags.push('intern', 'all');
  if (userRoleTags.length === 0) userRoleTags.push('all'); // Par défaut

  // Nom du profil pour l'affichage
  const getProfileName = () => {
    if (isPresident) return '👑 Président / Gérant';
    if (isDirector) return '📊 Directeur';
    if (isAdmin) return '📝 Secrétariat / Admin';
    if (isDriver) return '🚚 Chauffeur';
    if (isMechanic) return '🔧 Mécanicien';
    if (isIntern) return '🎓 Stagiaire';
    return '👤 Utilisateur';
  };

  // ============================================
  // GUIDE SECTIONS - ADAPTÉES PAR RÔLE
  // ============================================
  const allGuideSections: GuideSection[] = [
    // === SECTION DASHBOARD ===
    {
      id: 'dashboard',
      title: 'Tableau de bord',
      icon: BarChart3,
      color: 'text-blue-600 bg-blue-100',
      roles: ['manager', 'admin', 'intern'],
      content: [
        {
          title: 'Vue d\'ensemble de la flotte',
          description: 'Le tableau de bord affiche les indicateurs clés en temps réel.',
          steps: [
            'Consultez le nombre de véhicules par statut',
            'Visualisez les alertes urgentes (échéances, incidents)',
            'Suivez la consommation de carburant mensuelle',
            'Accédez rapidement aux incidents en cours'
          ],
          tips: [
            'Cliquez sur un KPI pour filtrer les véhicules concernés',
            'Les alertes rouges nécessitent une action immédiate'
          ]
        }
      ]
    },
    
    // === SECTION VÉHICULES (MANAGERS) ===
    {
      id: 'vehicles-manager',
      title: 'Gestion du parc véhicules',
      icon: Truck,
      color: 'text-emerald-600 bg-emerald-100',
      roles: ['manager', 'admin'],
      content: [
        {
          title: 'Ajouter un véhicule',
          description: 'Enregistrez un nouveau véhicule dans votre parc.',
          steps: [
            'Cliquez sur "Ajouter" en haut de la liste véhicules',
            'Renseignez l\'immatriculation et le modèle',
            'Sélectionnez le type (Utilitaire, Poids Lourd)',
            'Ajoutez les échéances (CT, extincteur, chronotachygraphe)',
            'Validez avec "Enregistrer"'
          ]
        },
        {
          title: 'Comprendre les statuts',
          description: 'Les différents états d\'un véhicule.',
          steps: [
            '🟢 En service : Véhicule opérationnel en circulation',
            '🟠 Maintenance : Au garage pour entretien planifié',
            '🔴 Immobilisé : En panne, ne peut pas rouler',
            '⚪ Disponible : Prêt mais non assigné',
            '🟡 Remplacement : Véhicule temporaire (location/prêt)'
          ]
        },
        {
          title: 'Affecter un véhicule de remplacement',
          description: 'Quand un véhicule est immobilisé, affectez un remplacement.',
          steps: [
            'Sur un véhicule immobilisé, cliquez "Affecter remplacement"',
            'Choisissez : véhicule du parc OU location externe',
            'Pour une location : renseignez immat, fournisseur, coût/jour',
            'Assignez le chauffeur au véhicule de remplacement',
            'Les coûts seront imputés au véhicule d\'origine'
          ],
          tips: [
            'Le badge orange identifie les véhicules de remplacement',
            'Filtrez par "Remplacements" pour les voir tous'
          ],
          new: true
        },
        {
          title: 'Assigner un chauffeur',
          description: 'Affecter un chauffeur à un véhicule.',
          steps: [
            'Ouvrez la fiche du véhicule',
            'Cliquez sur "Assigner chauffeur"',
            'Sélectionnez le chauffeur dans la liste',
            'Confirmez l\'assignation'
          ]
        }
      ]
    },

    // === SECTION MON VÉHICULE (CHAUFFEUR) ===
    {
      id: 'my-vehicle',
      title: 'Mon véhicule',
      icon: Truck,
      color: 'text-emerald-600 bg-emerald-100',
      roles: ['driver'],
      content: [
        {
          title: 'Consulter mon véhicule',
          description: 'Accédez aux informations de votre véhicule assigné.',
          steps: [
            'Votre véhicule s\'affiche sur le tableau de bord',
            'Cliquez dessus pour voir le détail complet',
            'Consultez le kilométrage, les échéances, l\'historique'
          ],
          tips: [
            'Vérifiez régulièrement les dates d\'échéance (CT, extincteur)',
            'Signalez tout problème immédiatement'
          ]
        },
        {
          title: 'Que faire en cas de panne ?',
          description: 'Procédure en cas d\'immobilisation sur route.',
          steps: [
            '1. Mettez-vous en sécurité (gilet, triangle)',
            '2. Signalez l\'incident dans l\'appli (voir section Incidents)',
            '3. Cochez "Véhicule immobilisé" et indiquez votre position',
            '4. Cochez si vous avez besoin d\'un dépannage',
            '5. Appelez votre responsable si urgent'
          ],
          tips: [
            'Prenez des photos du problème',
            'Notez le kilométrage exact'
          ]
        }
      ]
    },

    // === SECTION CARBURANT (CHAUFFEUR) ===
    {
      id: 'fuel-driver',
      title: 'Mes pleins de carburant',
      icon: Fuel,
      color: 'text-amber-600 bg-amber-100',
      roles: ['driver'],
      content: [
        {
          title: 'Enregistrer un plein',
          description: 'Saisissez chaque plein de carburant.',
          steps: [
            'Accédez à "Carburant" dans le menu',
            'Cliquez sur "Ajouter un plein"',
            'Votre véhicule est pré-sélectionné',
            'Renseignez : date, litres, montant, kilométrage',
            'Cochez "Plein complet" si vous avez fait le plein jusqu\'en haut',
            'Prenez en photo le ticket et ajoutez-le'
          ],
          tips: [
            '⚠️ Le ticket est OBLIGATOIRE pour justifier la dépense',
            'Faites vos pleins complets pour un meilleur suivi conso',
            'Renseignez l\'AdBlue si votre véhicule en utilise'
          ]
        },
        {
          title: 'Consulter mon historique',
          description: 'Voir tous vos pleins passés.',
          steps: [
            'Dans "Carburant", vos pleins sont listés par date',
            'La consommation moyenne est calculée automatiquement',
            'Vous pouvez filtrer par période'
          ]
        }
      ]
    },

    // === SECTION CARBURANT (MANAGER) ===
    {
      id: 'fuel-manager',
      title: 'Suivi carburant flotte',
      icon: Fuel,
      color: 'text-amber-600 bg-amber-100',
      roles: ['manager', 'admin'],
      content: [
        {
          title: 'Analyser la consommation',
          description: 'Suivez les performances de consommation de la flotte.',
          steps: [
            'Accédez à "Carburant" pour la vue globale',
            'Consultez la consommation moyenne par véhicule',
            'Identifiez les véhicules surconsommateurs (rouge)',
            'Comparez les évolutions mois par mois'
          ],
          tips: [
            'Une surconsommation peut indiquer un problème mécanique',
            'Comparez les chauffeurs sur le même véhicule'
          ]
        },
        {
          title: 'Exporter pour la comptabilité',
          description: 'Générez des rapports pour votre comptable.',
          steps: [
            'Utilisez le bouton "Exporter"',
            'Choisissez la période souhaitée',
            'Téléchargez au format Excel'
          ]
        }
      ]
    },

    // === SECTION MAINTENANCE (MÉCANICIEN) ===
    {
      id: 'maintenance-mechanic',
      title: 'Interventions atelier',
      icon: Wrench,
      color: 'text-orange-600 bg-orange-100',
      roles: ['mechanic'],
      content: [
        {
          title: 'Réceptionner un véhicule',
          description: 'Enregistrer l\'entrée d\'un véhicule à l\'atelier.',
          steps: [
            'Accédez à "Maintenance"',
            'Cliquez sur "Nouvelle intervention"',
            'Sélectionnez le véhicule et le type de travaux',
            'Le véhicule passe en statut "Maintenance"',
            'Notez les travaux à effectuer'
          ]
        },
        {
          title: 'Clôturer une intervention',
          description: 'Enregistrer la fin des travaux.',
          steps: [
            'Ouvrez l\'intervention en cours',
            'Listez les travaux effectués',
            'Renseignez les pièces utilisées et le coût',
            'Ajoutez la photo de la facture',
            'Mettez à jour le kilométrage',
            'Cliquez sur "Clôturer"'
          ],
          tips: [
            'La facture/bon de sortie est obligatoire',
            'Le véhicule repasse automatiquement en service'
          ]
        },
        {
          title: 'Consulter les incidents signalés',
          description: 'Voir les problèmes remontés par les chauffeurs.',
          steps: [
            'Dans "Incidents", consultez les signalements',
            'Filtrez par véhicule ou priorité',
            'Passez l\'incident en "Pris en compte" quand vous commencez',
            'Passez en "Résolu" une fois réparé'
          ]
        }
      ]
    },

    // === SECTION MAINTENANCE (MANAGER) ===
    {
      id: 'maintenance-manager',
      title: 'Gestion maintenance',
      icon: Wrench,
      color: 'text-orange-600 bg-orange-100',
      roles: ['manager'],
      content: [
        {
          title: 'Planifier les entretiens',
          description: 'Anticipez les maintenances préventives.',
          steps: [
            'Consultez les échéances à venir sur le dashboard',
            'Planifiez les RDV garage à l\'avance',
            'Créez l\'intervention pour bloquer le véhicule'
          ],
          tips: [
            'Groupez les interventions pour optimiser les coûts',
            'Anticipez les remplacements si l\'immobilisation est longue'
          ]
        },
        {
          title: 'Suivre les coûts',
          description: 'Analysez les dépenses de maintenance.',
          steps: [
            'Chaque intervention enregistre son coût',
            'Consultez l\'historique par véhicule',
            'Identifiez les véhicules les plus coûteux',
            'Exportez pour votre comptabilité'
          ]
        }
      ]
    },

    // === SECTION INCIDENTS (CHAUFFEUR) ===
    {
      id: 'incidents-driver',
      title: 'Signaler un problème',
      icon: AlertTriangle,
      color: 'text-red-600 bg-red-100',
      roles: ['driver'],
      content: [
        {
          title: 'Signaler un incident',
          description: 'Déclarez tout problème sur votre véhicule.',
          steps: [
            'Accédez à "Incidents" dans le menu',
            'Cliquez sur "Signaler un incident"',
            'Votre véhicule est pré-sélectionné',
            'Décrivez le problème précisément',
            'Choisissez la priorité :',
            '   🟢 Faible : peut attendre (voyant, bruit léger)',
            '   🟠 Moyenne : à traiter rapidement (freins mous, fuite)',
            '   🔴 Critique : danger immédiat (panne totale, accident)',
            'Ajoutez des photos du problème'
          ],
          tips: [
            '📷 Les photos accélèrent la prise en charge',
            '🔴 Un incident critique alerte immédiatement le bureau'
          ]
        },
        {
          title: 'Déclarer une immobilisation',
          description: 'Si votre véhicule ne peut plus rouler.',
          steps: [
            'Lors du signalement, cochez "Véhicule immobilisé"',
            'Indiquez PRÉCISÉMENT où vous êtes (adresse, repère)',
            'Cochez si vous avez besoin d\'un dépannage/remorquage',
            'Validez - votre véhicule passe en statut "Immobilisé"',
            'Attendez les instructions de votre responsable'
          ],
          tips: [
            'Restez joignable par téléphone',
            'Ne quittez pas le véhicule sans accord'
          ],
          new: true
        },
        {
          title: 'Suivre mes signalements',
          description: 'Voir l\'avancement de vos incidents.',
          steps: [
            'Vos incidents sont listés avec leur statut :',
            '📝 Nouveau : Vient d\'être signalé',
            '👀 Pris en compte : L\'atelier a vu',
            '🔧 En réparation : Travaux en cours',
            '✅ Résolu : Problème réglé'
          ]
        }
      ]
    },

    // === SECTION INCIDENTS (MANAGER/MECHANIC) ===
    {
      id: 'incidents-manager',
      title: 'Gestion des incidents',
      icon: AlertTriangle,
      color: 'text-red-600 bg-red-100',
      roles: ['manager', 'mechanic'],
      content: [
        {
          title: 'Traiter les incidents',
          description: 'Gérez les signalements des chauffeurs.',
          steps: [
            'Les nouveaux incidents apparaissent en haut',
            'Triez par priorité (Critique d\'abord)',
            'Passez en "Pris en compte" pour accuser réception',
            'Créez une intervention maintenance si nécessaire',
            'Passez en "Résolu" une fois terminé'
          ]
        },
        {
          title: 'Gérer une immobilisation',
          description: 'Procédure pour un véhicule immobilisé.',
          steps: [
            'Le véhicule apparaît en rouge dans la liste',
            'Vérifiez la localisation indiquée',
            'Organisez le dépannage si demandé',
            'Affectez un véhicule de remplacement au chauffeur',
            'Planifiez la réparation'
          ],
          tips: [
            'Le coût du remplacement sera imputé au véhicule d\'origine',
            'Documentez bien la durée d\'immobilisation'
          ],
          new: true
        }
      ]
    },

    // === SECTION ABSENCES (TOUS) ===
    {
      id: 'absences',
      title: 'Mes absences',
      icon: Calendar,
      color: 'text-purple-600 bg-purple-100',
      roles: ['driver', 'mechanic', 'admin', 'intern'],
      content: [
        {
          title: 'Demander un congé',
          description: 'Soumettez une demande d\'absence.',
          steps: [
            'Accédez à "Absences" dans le menu',
            'Cliquez sur "Nouvelle demande"',
            'Sélectionnez le type (CP, RTT, Maladie, Autre)',
            'Choisissez les dates de début et fin',
            'Ajoutez un commentaire si nécessaire',
            'Soumettez la demande'
          ],
          tips: [
            'Votre solde de congés est affiché en haut',
            'Les arrêts maladie nécessitent un justificatif sous 48h'
          ]
        },
        {
          title: 'Suivre mes demandes',
          description: 'Voir le statut de vos demandes.',
          steps: [
            'Vos demandes sont listées avec leur statut :',
            '⏳ En attente : En cours de validation',
            '✅ Approuvée : Congé accordé',
            '❌ Refusée : Non accordé (voir le motif)'
          ]
        }
      ]
    },

    // === SECTION ABSENCES (MANAGER) ===
    {
      id: 'absences-manager',
      title: 'Validation des absences',
      icon: Calendar,
      color: 'text-purple-600 bg-purple-100',
      roles: ['manager'],
      content: [
        {
          title: 'Valider les demandes',
          description: 'Approuvez ou refusez les congés de votre équipe.',
          steps: [
            'Consultez les demandes en attente',
            'Vérifiez la disponibilité de l\'équipe sur la période',
            'Cliquez sur Approuver ou Refuser',
            'Ajoutez un commentaire si refus',
            'Le collaborateur est notifié automatiquement'
          ],
          tips: [
            'Consultez le planning avant de valider',
            'Anticipez les remplacements si nécessaire'
          ]
        }
      ]
    },

    // === SECTION DOCUMENTS ===
    {
      id: 'documents',
      title: 'Documents',
      icon: FileText,
      color: 'text-indigo-600 bg-indigo-100',
      roles: ['all'],
      content: [
        {
          title: 'Consulter les documents',
          description: 'Accédez aux documents partagés.',
          steps: [
            'Accédez à "Documents" dans le menu',
            'Parcourez les catégories (RH, Sécurité, Procédures...)',
            'Cliquez sur un document pour le lire',
            'Téléchargez si nécessaire'
          ]
        },
        {
          title: 'Accuser réception',
          description: 'Confirmez la lecture des documents obligatoires.',
          steps: [
            'Les documents marqués "Accusé requis" doivent être lus',
            'Lisez le document en entier',
            'Cliquez sur "J\'ai lu et compris"',
            'Votre accusé est enregistré avec date et heure'
          ],
          tips: [
            'Certains documents doivent être lus avant une date limite',
            'Votre responsable peut voir qui a lu ou non'
          ]
        }
      ]
    },

    // === SECTION UTILISATEURS (ADMIN) ===
    {
      id: 'users',
      title: 'Gestion des utilisateurs',
      icon: Users,
      color: 'text-cyan-600 bg-cyan-100',
      roles: ['manager', 'admin'],
      content: [
        {
          title: 'Inviter un collaborateur',
          description: 'Ajoutez un nouvel utilisateur.',
          steps: [
            'Accédez à "Utilisateurs"',
            'Cliquez sur "Inviter"',
            'Renseignez : email, nom, prénom',
            'Sélectionnez le rôle approprié',
            'L\'utilisateur reçoit un email d\'activation'
          ]
        },
        {
          title: 'Comprendre les rôles',
          description: 'Chaque rôle a des permissions différentes.',
          steps: [
            '👑 Président : Accès complet à tout',
            '📊 Directeur : Gestion opérationnelle complète',
            '📝 Secrétariat : Admin, documents, absences',
            '🚗 Chauffeur : Son véhicule, carburant, incidents',
            '🔧 Mécanicien : Maintenance, incidents',
            '🎓 Stagiaire : Consultation limitée'
          ]
        }
      ]
    },

    // === SECTION MON COMPTE ===
    {
      id: 'account',
      title: 'Mon compte',
      icon: UserCircle,
      color: 'text-slate-600 bg-slate-100',
      roles: ['all'],
      content: [
        {
          title: 'Modifier mon profil',
          description: 'Mettez à jour vos informations.',
          steps: [
            'Cliquez sur votre nom en bas du menu',
            'Ou allez dans "Paramètres"',
            'Modifiez : photo, téléphone, etc.',
            'Enregistrez les modifications'
          ]
        },
        {
          title: 'Changer mon mot de passe',
          description: 'Sécurisez votre compte.',
          steps: [
            'Allez dans "Paramètres"',
            'Section "Sécurité"',
            'Entrez l\'ancien mot de passe',
            'Entrez le nouveau (2 fois)',
            'Validez'
          ],
          tips: [
            'Utilisez au moins 8 caractères',
            'Mélangez lettres, chiffres et symboles'
          ]
        }
      ]
    }
  ];

  // Filtrer les sections selon le rôle de l'utilisateur
  const guideSections = useMemo(() => {
    return allGuideSections.filter(section => {
      return section.roles.some(role => userRoleTags.includes(role));
    }).map(section => ({
      ...section,
      content: section.content.filter(item => {
        if (!item.roles) return true;
        return item.roles.some(role => userRoleTags.includes(role));
      })
    }));
  }, [userRoleTags]);

  // Ouvrir la première section par défaut
  React.useEffect(() => {
    if (guideSections.length > 0 && !expandedSection) {
      setExpandedSection(guideSections[0].id);
    }
  }, [guideSections]);

  // ============================================
  // FAQ - ADAPTÉE PAR RÔLE
  // ============================================
  const allFaqItems = [
    {
      question: 'Comment réinitialiser mon mot de passe ?',
      answer: 'Sur la page de connexion, cliquez sur "Mot de passe oublié". Entrez votre email et suivez les instructions reçues par mail.',
      roles: ['all']
    },
    {
      question: 'Je ne vois pas mon véhicule, que faire ?',
      answer: 'Votre véhicule apparaît uniquement s\'il vous est assigné. Contactez votre responsable pour vérifier l\'assignation.',
      roles: ['driver']
    },
    {
      question: 'Pourquoi je ne vois pas tous les véhicules ?',
      answer: 'L\'accès dépend de votre rôle. Les chauffeurs ne voient que leur véhicule. Contactez votre admin pour modifier vos permissions.',
      roles: ['manager', 'admin', 'mechanic']
    },
    {
      question: 'Comment ajouter un véhicule de location temporaire ?',
      answer: 'Depuis un véhicule immobilisé, cliquez "Affecter remplacement" puis "Location/Prêt". Renseignez l\'immat, le fournisseur et le coût/jour.',
      roles: ['manager', 'admin']
    },
    {
      question: 'Mon plein n\'apparaît pas, pourquoi ?',
      answer: 'Vérifiez que vous avez bien validé le formulaire et ajouté le ticket. Si le problème persiste, signalez-le au secrétariat.',
      roles: ['driver']
    },
    {
      question: 'Les photos sont-elles obligatoires ?',
      answer: 'Oui pour les pleins (ticket) et les incidents. Elles servent de justificatif et accélèrent le traitement.',
      roles: ['driver', 'mechanic']
    },
    {
      question: 'Comment fonctionne le calcul de consommation ?',
      answer: 'La consommation est calculée entre deux pleins complets. Cochez "Plein complet" et notez le kilométrage exact.',
      roles: ['driver', 'manager']
    },
    {
      question: 'Que faire en cas de panne sur la route ?',
      answer: 'Mettez-vous en sécurité, signalez l\'incident dans l\'appli avec "Véhicule immobilisé" coché, indiquez votre position et appelez votre responsable.',
      roles: ['driver']
    },
    {
      question: 'Comment exporter les données pour la comptabilité ?',
      answer: 'Dans chaque module (Carburant, Maintenance), utilisez le bouton "Exporter" pour télécharger en Excel.',
      roles: ['manager', 'admin']
    },
    {
      question: 'Puis-je utiliser l\'appli sur mon téléphone ?',
      answer: 'Oui, FleetGenius fonctionne sur smartphone. Vous pouvez l\'ajouter à votre écran d\'accueil pour un accès rapide.',
      roles: ['all']
    },
    {
      question: 'Comment contacter le support ?',
      answer: 'Utilisez l\'onglet "Contact" de cette page ou appelez le numéro indiqué pendant les heures de bureau.',
      roles: ['all']
    }
  ];

  const faqItems = useMemo(() => {
    return allFaqItems.filter(item => {
      return item.roles.some(role => userRoleTags.includes(role));
    });
  }, [userRoleTags]);

  // Filtrer selon la recherche
  const filteredSections = guideSections.filter(section => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return section.title.toLowerCase().includes(term) ||
      section.content.some(item => 
        item.title.toLowerCase().includes(term) ||
        item.description.toLowerCase().includes(term)
      );
  });

  const filteredFaq = faqItems.filter(item => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return item.question.toLowerCase().includes(term) ||
      item.answer.toLowerCase().includes(term);
  });

  return (
    <div className="space-y-6 animate-fade-in pb-10">
      {/* Header */}
      <div className="bg-gradient-to-r from-indigo-600 to-purple-600 rounded-2xl p-8 text-white">
        <div className="flex items-center justify-between flex-wrap gap-4 mb-4">
          <div className="flex items-center gap-4">
            <div className="bg-white/20 p-3 rounded-xl">
              <HelpCircle size={32} />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Centre d'Aide</h1>
              <p className="text-indigo-100">Guide personnalisé pour votre profil</p>
            </div>
          </div>
          
          {/* Badge profil */}
          <div className="bg-white/20 px-4 py-2 rounded-xl flex items-center gap-2">
            <Shield size={18} />
            <span className="font-bold">{getProfileName()}</span>
          </div>
        </div>
        
        {/* Recherche */}
        <div className="relative max-w-xl">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-indigo-300" size={20} />
          <input
            type="text"
            placeholder="Rechercher dans l'aide..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-12 pr-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder-indigo-200 focus:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white/30"
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 bg-white p-2 rounded-xl shadow-sm border border-slate-200">
        <button
          onClick={() => setActiveTab('guide')}
          className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-lg font-bold transition-all ${
            activeTab === 'guide'
              ? 'bg-indigo-600 text-white'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Book size={18} />
          Guide
        </button>
        <button
          onClick={() => setActiveTab('faq')}
          className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-lg font-bold transition-all ${
            activeTab === 'faq'
              ? 'bg-indigo-600 text-white'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <MessageSquare size={18} />
          FAQ
        </button>
        <button
          onClick={() => setActiveTab('contact')}
          className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-lg font-bold transition-all ${
            activeTab === 'contact'
              ? 'bg-indigo-600 text-white'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Mail size={18} />
          Contact
        </button>
      </div>

      {/* Contenu Guide */}
      {activeTab === 'guide' && (
        <div className="space-y-4">
          {filteredSections.length === 0 ? (
            <div className="bg-white rounded-2xl p-12 text-center border border-slate-200">
              <Search size={48} className="mx-auto text-slate-300 mb-4" />
              <h3 className="text-lg font-bold text-slate-700">Aucun résultat</h3>
              <p className="text-slate-500">Essayez avec d'autres mots-clés</p>
            </div>
          ) : (
            filteredSections.map(section => (
              <div key={section.id} className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                {/* Section Header */}
                <button
                  onClick={() => setExpandedSection(expandedSection === section.id ? null : section.id)}
                  className="w-full flex items-center justify-between p-5 hover:bg-slate-50 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div className={`p-3 rounded-xl ${section.color}`}>
                      <section.icon size={24} />
                    </div>
                    <div className="text-left">
                      <h2 className="text-lg font-bold text-slate-800">{section.title}</h2>
                      <p className="text-sm text-slate-500">{section.content.length} article(s)</p>
                    </div>
                  </div>
                  {expandedSection === section.id ? (
                    <ChevronDown size={24} className="text-slate-400" />
                  ) : (
                    <ChevronRight size={24} className="text-slate-400" />
                  )}
                </button>
                
                {/* Section Content */}
                {expandedSection === section.id && (
                  <div className="border-t border-slate-100 divide-y divide-slate-100">
                    {section.content.map((item, idx) => (
                      <div key={idx} className="p-5 bg-slate-50/50">
                        <div className="flex items-start gap-3 mb-3">
                          <h3 className="font-bold text-slate-800">{item.title}</h3>
                          {item.new && (
                            <span className="bg-green-100 text-green-700 text-[10px] font-bold px-2 py-0.5 rounded-full">
                              NOUVEAU
                            </span>
                          )}
                        </div>
                        <p className="text-slate-600 mb-4">{item.description}</p>
                        
                        {item.steps && (
                          <div className="bg-white rounded-xl p-4 border border-slate-200 mb-3">
                            <ol className="space-y-2">
                              {item.steps.map((step, stepIdx) => (
                                <li key={stepIdx} className="flex items-start gap-3">
                                  {step.startsWith('   ') ? (
                                    <span className="text-slate-600 pl-9">{step.trim()}</span>
                                  ) : (
                                    <>
                                      <span className="flex-shrink-0 w-6 h-6 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center text-xs font-bold">
                                        {stepIdx + 1}
                                      </span>
                                      <span className="text-slate-700 pt-0.5">{step}</span>
                                    </>
                                  )}
                                </li>
                              ))}
                            </ol>
                          </div>
                        )}
                        
                        {item.tips && item.tips.length > 0 && (
                          <div className="bg-amber-50 rounded-xl p-4 border border-amber-200">
                            <p className="text-xs font-bold text-amber-700 uppercase mb-2">💡 Conseils</p>
                            <ul className="space-y-1">
                              {item.tips.map((tip, tipIdx) => (
                                <li key={tipIdx} className="text-amber-800 text-sm flex items-start gap-2">
                                  <CheckCircle size={14} className="flex-shrink-0 mt-0.5 text-amber-600" />
                                  {tip}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* Contenu FAQ */}
      {activeTab === 'faq' && (
        <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100">
          {filteredFaq.length === 0 ? (
            <div className="p-12 text-center">
              <Search size={48} className="mx-auto text-slate-300 mb-4" />
              <h3 className="text-lg font-bold text-slate-700">Aucun résultat</h3>
              <p className="text-slate-500">Essayez avec d'autres mots-clés</p>
            </div>
          ) : (
            filteredFaq.map((item, idx) => (
              <div key={idx}>
                <button
                  onClick={() => setExpandedFaq(expandedFaq === idx ? null : idx)}
                  className="w-full flex items-center justify-between p-5 hover:bg-slate-50 transition-colors text-left"
                >
                  <span className="font-bold text-slate-800 pr-4">{item.question}</span>
                  {expandedFaq === idx ? (
                    <ChevronDown size={20} className="flex-shrink-0 text-slate-400" />
                  ) : (
                    <ChevronRight size={20} className="flex-shrink-0 text-slate-400" />
                  )}
                </button>
                {expandedFaq === idx && (
                  <div className="px-5 pb-5">
                    <div className="bg-slate-50 rounded-xl p-4 text-slate-600">
                      {item.answer}
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* Contenu Contact */}
      {activeTab === 'contact' && (
        <div className="grid md:grid-cols-2 gap-6">
          {/* Formulaire de contact */}
          <div className="bg-white rounded-2xl p-6 border border-slate-200">
            <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
              <Mail className="text-indigo-600" size={20} />
              Nous contacter
            </h3>
            <form className="space-y-4">
              <div>
                <label className="block text-sm font-bold text-slate-600 mb-1">Sujet</label>
                <select className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent">
                  <option>Question sur l'application</option>
                  <option>Problème technique</option>
                  <option>Demande de fonctionnalité</option>
                  <option>Autre</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-600 mb-1">Message</label>
                <textarea
                  rows={5}
                  placeholder="Décrivez votre demande..."
                  className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
                />
              </div>
              <button
                type="button"
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-colors"
              >
                <Send size={18} />
                Envoyer
              </button>
            </form>
          </div>

          {/* Infos de contact */}
          <div className="space-y-4">
            <div className="bg-white rounded-2xl p-6 border border-slate-200">
              <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                <Phone className="text-emerald-600" size={20} />
                Par téléphone
              </h3>
              <p className="text-2xl font-bold text-slate-800 mb-2">0692 303 333</p>
              <p className="text-slate-500 text-sm">Lun-Ven : 8h-17h (Heure Réunion)</p>
            </div>

            <div className="bg-white rounded-2xl p-6 border border-slate-200">
              <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                <Mail className="text-blue-600" size={20} />
                Par email
              </h3>
              <a href="mailto:direction@delivrex.io" className="text-xl font-bold text-blue-600 hover:underline">
                direction@delivrex.io
              </a>
            </div>

            <div className="bg-gradient-to-r from-red-50 to-orange-50 rounded-2xl p-6 border border-red-100">
              <h3 className="text-lg font-bold text-red-800 mb-2">
                🚨 Urgence 24/7
              </h3>
              <p className="text-red-700 text-sm mb-4">
                Pour tout problème critique concernant un transport<br/>
                en cours hors horaires de bureau.
              </p>
              <div className="bg-white/80 rounded-xl p-4 text-center">
                <p className="text-xs text-slate-500 mb-1">Numéro d'urgence exploitation</p>
                <p className="text-2xl font-bold text-red-600">0692 826 551</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Version */}
      <div className="text-center text-sm text-slate-400">
        FleetGenius v2.37.0 • Guide adapté à votre profil {getProfileName()}
      </div>
    </div>
  );
};

export default HelpCenter;
