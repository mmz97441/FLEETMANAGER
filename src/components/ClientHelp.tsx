import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  HelpCircle,
  X,
  Search,
  Home,
  PlusCircle,
  Package,
  Contact,
  BarChart3,
  UserCircle,
  FileText,
  ChevronDown,
} from 'lucide-react';

// ============================================================================
// ClientHelp — Centre d'aide de l'espace CLIENT (expéditeur)
// 100% présentationnel : aucune donnée, aucun service. Uniquement onClose.
// ============================================================================

interface ClientHelpProps {
  onClose: () => void;
}

type TabId = 'guide' | 'faq';

interface GuideSection {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  emoji: string;
  title: string;
  intro: string;
  steps: string[];
}

interface FaqItem {
  id: string;
  question: string;
  answer: string;
}

// --- Normalisation pour recherche insensible à la casse ET aux accents ---
const normalize = (value: string): string =>
  value
    .toLowerCase()
    .normalize('NFD')
    // Supprime les diacritiques (accents)
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

// --- Contenu du GUIDE ---
const GUIDE_SECTIONS: GuideSection[] = [
  {
    id: 'accueil',
    icon: Home,
    emoji: '🏠',
    title: 'Accueil',
    intro: 'La question « Que voulez-vous faire ? » et de grandes tuiles pour aller partout en un clic.',
    steps: [
      'Ouvrez l\'application : la page d\'accueil s\'affiche en premier.',
      'Choisissez une grande tuile (Créer, Mes Colis, Destinataires…).',
      'Chaque tuile vous emmène directement au bon endroit.',
    ],
  },
  {
    id: 'creer',
    icon: PlusCircle,
    emoji: '➕',
    title: 'Créer une expédition',
    intro: 'Préparez un envoi vers une pharmacie en quelques secondes.',
    steps: [
      'Choisissez un destinataire dans votre carnet, ou saisissez-le à la main.',
      'Indiquez le nombre de colis à envoyer.',
      'Imprimez l\'étiquette au format A4, A5 ou A6.',
      'Un code de suivi est généré automatiquement pour cet envoi.',
    ],
  },
  {
    id: 'colis',
    icon: Package,
    emoji: '📦',
    title: 'Mes Colis',
    intro: 'Le suivi de tous vos envois, regroupés par pharmacie.',
    steps: [
      'Repérez le statut grâce au code couleur : gris = en attente, bleu = collecté, orange = en livraison, vert = livré, rouge = échec.',
      'Consultez l\'heure de livraison prévue pour chaque point.',
      'Cliquez sur un colis pour voir la traçabilité complète.',
      'Accédez à la preuve de livraison (signature, photo, GPS) et téléchargez le Bon de Livraison.',
    ],
  },
  {
    id: 'destinataires',
    icon: Contact,
    emoji: '📇',
    title: 'Mes Destinataires',
    intro: 'Le carnet d\'adresses de toutes vos pharmacies.',
    steps: [
      'Ajoutez, modifiez ou supprimez une pharmacie quand vous voulez.',
      'Importez votre liste complète depuis un fichier Excel ou CSV.',
      'Téléchargez le fichier modèle pour remplir votre liste sans erreur.',
    ],
  },
  {
    id: 'stats',
    icon: BarChart3,
    emoji: '📊',
    title: 'Statistiques',
    intro: 'Vos indicateurs clés, avec des objectifs et des réponses claires.',
    steps: [
      'Suivez vos chiffres : nombre de colis, taux de livraison, ponctualité, délai moyen.',
      'Comparez chaque indicateur à son objectif.',
      'Consultez « Ce qui compte » : des alertes automatiques sur les points à surveiller.',
      'Utilisez « Demander à mes données » : posez une question en français, la réponse est calculée et garantie exacte.',
    ],
  },
  {
    id: 'compte',
    icon: UserCircle,
    emoji: '👤',
    title: 'Mon compte',
    intro: 'Vos informations personnelles et celles de votre entreprise.',
    steps: [
      'Consultez et mettez à jour votre profil.',
      'Changez votre mot de passe en toute sécurité.',
      'Renseignez vos informations d\'entreprise (elles figurent sur les étiquettes et les BL).',
      'Gérez votre équipe et les accès.',
    ],
  },
  {
    id: 'bl',
    icon: FileText,
    emoji: '🧾',
    title: 'Bon de livraison (BL)',
    intro: 'Un document officiel par pharmacie livrée.',
    steps: [
      'Un Bon de Livraison est créé pour chaque pharmacie.',
      'Téléchargez-le ou imprimez-le quand vous en avez besoin.',
      'Il inclut la preuve de livraison (signature, photo, GPS).',
    ],
  },
];

// --- Contenu de la FAQ ---
const FAQ_ITEMS: FaqItem[] = [
  {
    id: 'faq-creer',
    question: 'Comment créer une expédition ?',
    answer:
      'Ouvrez « Créer une expédition ». Choisissez un destinataire dans votre carnet ou saisissez-le à la main, indiquez le nombre de colis, puis imprimez l\'étiquette. Un code de suivi est généré automatiquement : il vous permettra ensuite de suivre l\'envoi dans « Mes Colis ».',
  },
  {
    id: 'faq-etiquette',
    question: 'Comment imprimer une étiquette et quels formats ?',
    answer:
      'Au moment de créer l\'expédition, l\'étiquette est prête à imprimer. Vous choisissez le format qui vous convient : A4, A5 ou A6. Collez ensuite l\'étiquette sur le colis avant la collecte.',
  },
  {
    id: 'faq-preuve',
    question: 'Où voir la preuve de livraison (signature, photo) ?',
    answer:
      'Allez dans « Mes Colis » et cliquez sur le colis concerné. Vous y trouverez la traçabilité complète ainsi que la preuve de livraison : signature, photo et position GPS du dépôt.',
  },
  {
    id: 'faq-bl',
    question: 'Comment télécharger le bon de livraison ?',
    answer:
      'Un Bon de Livraison (BL) est généré pour chaque pharmacie. Ouvrez le colis dans « Mes Colis » : vous pouvez télécharger ou imprimer le BL, qui contient aussi la preuve de livraison.',
  },
  {
    id: 'faq-import',
    question: 'Comment importer ma liste de destinataires ?',
    answer:
      'Dans « Mes Destinataires », téléchargez d\'abord le fichier modèle. Remplissez-le avec vos pharmacies, puis importez-le au format Excel ou CSV. Vos destinataires apparaissent alors dans votre carnet, prêts à l\'emploi.',
  },
  {
    id: 'faq-couleurs',
    question: 'Que signifient les codes couleurs des colis ?',
    answer:
      'Chaque couleur indique un statut : gris = en attente, bleu = collecté, orange = en livraison, vert = livré, rouge = échec. C\'est le moyen le plus rapide de voir où en est chacun de vos envois d\'un simple coup d\'œil.',
  },
  {
    id: 'faq-mdp',
    question: 'Comment changer mon mot de passe ?',
    answer:
      'Ouvrez « Mon compte », rubrique profil et sécurité. Saisissez votre mot de passe actuel, puis votre nouveau mot de passe et sa confirmation. Validez : votre mot de passe est mis à jour immédiatement.',
  },
  {
    id: 'faq-entreprise',
    question: 'À quoi servent les infos « Mon entreprise » ?',
    answer:
      'Les informations de votre entreprise (nom, adresse, téléphone, SIRET) apparaissent sur vos étiquettes et sur vos Bons de Livraison. Les tenir à jour garantit des documents corrects et professionnels pour vos pharmacies.',
  },
  {
    id: 'faq-question-donnees',
    question: 'Comment poser une question à mes données ?',
    answer:
      'Dans « Statistiques », utilisez « Demander à mes données ». Écrivez votre question en français (par exemple « Combien de colis livrés cette semaine ? ») : la réponse est calculée directement à partir de vos données et affichée aussitôt.',
  },
  {
    id: 'faq-fiabilite',
    question: 'Les chiffres des statistiques sont-ils fiables ?',
    answer:
      'Oui. Tous les chiffres sont calculés par le système à partir de vos données réelles : ils ne sont jamais inventés ni estimés. Vous pouvez vous y fier pour vos décisions et vos comptes rendus.',
  },
];

const ClientHelp: React.FC<ClientHelpProps> = ({ onClose }) => {
  const [activeTab, setActiveTab] = useState<TabId>('guide');
  const [query, setQuery] = useState('');
  const [openFaqId, setOpenFaqId] = useState<string | null>(null);

  const nq = normalize(query);

  // --- Filtrage du guide (titre + intro + étapes) ---
  const filteredGuide = useMemo<GuideSection[]>(() => {
    if (!nq) return GUIDE_SECTIONS;
    return GUIDE_SECTIONS.filter((section) => {
      const haystack = normalize(
        [section.title, section.intro, ...section.steps].join(' '),
      );
      return haystack.includes(nq);
    });
  }, [nq]);

  // --- Filtrage de la FAQ (question + réponse) ---
  const filteredFaq = useMemo<FaqItem[]>(() => {
    if (!nq) return FAQ_ITEMS;
    return FAQ_ITEMS.filter((item) => {
      const haystack = normalize(`${item.question} ${item.answer}`);
      return haystack.includes(nq);
    });
  }, [nq]);

  const toggleFaq = (id: string) => {
    setOpenFaqId((prev) => (prev === id ? null : id));
  };

  const tabs: { id: TabId; label: string; count: number }[] = [
    { id: 'guide', label: "Guide d'utilisation", count: filteredGuide.length },
    { id: 'faq', label: 'FAQ', count: filteredFaq.length },
  ];

  return createPortal(
    <div
      className="fixed inset-0 z-[130] bg-black/50 flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Aide et guide"
    >
      <div
        className="max-w-3xl w-full max-h-[90vh] rounded-2xl bg-white flex flex-col overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-200 bg-gradient-to-r from-indigo-50 to-white">
          <div className="flex items-center justify-center w-11 h-11 rounded-xl bg-indigo-100 text-indigo-600 shrink-0">
            <HelpCircle className="w-6 h-6" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold text-slate-900 leading-tight">Aide &amp; Guide</h2>
            <p className="text-sm text-slate-500 truncate">
              Tout savoir sur votre espace expéditeur
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer l'aide"
            className="flex items-center justify-center w-10 h-10 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Recherche */}
        <div className="px-5 pt-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher dans l'aide…"
              aria-label="Rechercher dans l'aide"
              className="w-full pl-11 pr-10 py-3 border border-slate-300 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Effacer la recherche"
                className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center justify-center w-8 h-8 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Onglets */}
        <div className="px-5 pt-3">
          <div className="flex gap-2 border-b border-slate-200">
            {tabs.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  aria-current={isActive ? 'page' : undefined}
                  className={`relative px-4 py-2.5 text-sm font-semibold rounded-t-lg transition-colors -mb-px border-b-2 ${
                    isActive
                      ? 'text-indigo-600 border-indigo-600'
                      : 'text-slate-500 border-transparent hover:text-slate-800 hover:bg-slate-50'
                  }`}
                >
                  {tab.label}
                  {query && (
                    <span
                      className={`ml-2 inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full text-xs font-bold ${
                        isActive ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {tab.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Contenu défilant */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {activeTab === 'guide' ? (
            filteredGuide.length === 0 ? (
              <EmptyState query={query} />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {filteredGuide.map((section) => {
                  const Icon = section.icon;
                  return (
                    <div
                      key={section.id}
                      className="rounded-2xl border border-slate-200 bg-white p-4 hover:border-indigo-200 hover:shadow-sm transition-all"
                    >
                      <div className="flex items-center gap-3 mb-3">
                        <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 shrink-0">
                          <Icon className="w-5 h-5" />
                        </div>
                        <h3 className="font-bold text-slate-900 leading-tight">
                          <span className="mr-1" aria-hidden="true">
                            {section.emoji}
                          </span>
                          {section.title}
                        </h3>
                      </div>
                      <p className="text-sm text-slate-500 mb-3">{section.intro}</p>
                      <ul className="space-y-2">
                        {section.steps.map((step, index) => (
                          <li key={index} className="flex items-start gap-2 text-sm text-slate-700">
                            <span className="flex items-center justify-center w-5 h-5 mt-0.5 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold shrink-0">
                              {index + 1}
                            </span>
                            <span>{step}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            )
          ) : filteredFaq.length === 0 ? (
            <EmptyState query={query} />
          ) : (
            <div className="space-y-2.5">
              {filteredFaq.map((item) => {
                const isOpen = openFaqId === item.id;
                return (
                  <div
                    key={item.id}
                    className="rounded-2xl border border-slate-200 bg-white overflow-hidden"
                  >
                    <button
                      type="button"
                      onClick={() => toggleFaq(item.id)}
                      aria-expanded={isOpen}
                      className="w-full flex items-center gap-3 text-left px-4 py-3.5 hover:bg-slate-50 transition-colors"
                    >
                      <span className="flex-1 font-semibold text-slate-900 text-sm">
                        {item.question}
                      </span>
                      <ChevronDown
                        className={`w-5 h-5 text-slate-400 shrink-0 transition-transform ${
                          isOpen ? 'rotate-180' : ''
                        }`}
                      />
                    </button>
                    {isOpen && (
                      <div className="px-4 pb-4 -mt-1">
                        <p className="text-sm text-slate-600 leading-relaxed">{item.answer}</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};

// --- État vide (aucun résultat de recherche) ---
const EmptyState: React.FC<{ query: string }> = ({ query }) => (
  <div className="flex flex-col items-center justify-center text-center py-12 px-4">
    <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-slate-100 text-slate-400 mb-4">
      <Search className="w-7 h-7" />
    </div>
    <p className="font-semibold text-slate-700">Aucun résultat</p>
    <p className="text-sm text-slate-500 mt-1">
      {query
        ? `Rien ne correspond à « ${query} ». Essayez d'autres mots.`
        : 'Aucun contenu disponible.'}
    </p>
  </div>
);

export default ClientHelp;
