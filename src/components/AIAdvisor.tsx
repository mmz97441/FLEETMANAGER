import React, { useState } from 'react';
import { askFleetGenius } from '../services/geminiService';
import { Send, Bot, Loader2, Sparkles } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { Vehicle, User, FuelLog, MaintenanceLog } from '../types';

interface AIAdvisorProps {
  vehicles: Vehicle[];
  users: User[];
  logs: FuelLog[];
  maintenanceLogs: MaintenanceLog[];
}

const AIAdvisor: React.FC<AIAdvisorProps> = ({ vehicles, users, logs, maintenanceLogs }) => {
  const [prompt, setPrompt] = useState('');
  const [response, setResponse] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleAsk = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    setResponse(null);
    try {
      const answer = await askFleetGenius(prompt, { vehicles, users, logs, maintenanceLogs });
      setResponse(answer);
    } catch (e) {
      setResponse("Erreur lors de la communication avec l'IA.");
    } finally {
      setLoading(false);
    }
  };

  const suggestions = [
    "Quels véhicules ont le plus de kilomètres ?",
    "Analyse mes coûts de carburant récents.",
    "Quels sont les véhicules en maintenance ?",
    "Donne-moi un résumé de l'état de la flotte."
  ];

  return (
    <div className="max-w-4xl mx-auto h-full flex flex-col">
      <div className="bg-gradient-to-r from-brand-600 to-indigo-700 rounded-2xl p-8 mb-6 text-white shadow-lg relative overflow-hidden">
        <div className="relative z-10">
            <h2 className="text-3xl font-bold mb-2 flex items-center gap-3">
                <Sparkles className="text-yellow-300" />
                FleetGenius Intelligence
            </h2>
            <p className="text-brand-100 max-w-xl">
                Analysez votre flotte en temps réel. Posez des questions complexes sur la maintenance, les coûts ou la sécurité, et obtenez des réponses basées sur vos données.
            </p>
        </div>
        <div className="absolute right-0 bottom-0 opacity-10">
            <Bot size={200} />
        </div>
      </div>

      <div className="flex-1 bg-white rounded-2xl shadow-sm border border-slate-100 flex flex-col overflow-hidden h-[600px]">
        <div className="flex-1 p-6 overflow-y-auto custom-scrollbar">
            {!response && !loading && (
                <div className="h-full flex flex-col items-center justify-center text-slate-400">
                    <Bot size={64} className="mb-4 text-slate-200" />
                    <p className="mb-6">Sélectionnez une question ou posez la vôtre :</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full max-w-2xl">
                        {suggestions.map((s, i) => (
                            <button 
                                key={i}
                                onClick={() => setPrompt(s)}
                                className="text-left p-4 rounded-xl border border-slate-200 hover:border-brand-500 hover:bg-brand-50 transition-all text-sm text-slate-600 hover:text-brand-700"
                            >
                                {s}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {loading && (
                <div className="flex items-center justify-center h-full">
                    <div className="flex flex-col items-center">
                        <Loader2 className="animate-spin text-brand-500 mb-2" size={48} />
                        <p className="text-slate-500 animate-pulse">Analyse des données en cours...</p>
                    </div>
                </div>
            )}

            {response && (
                <div className="prose prose-slate max-w-none">
                    <div className="bg-brand-50 p-6 rounded-xl border border-brand-100">
                        <ReactMarkdown>{response}</ReactMarkdown>
                    </div>
                </div>
            )}
        </div>

        <div className="p-4 bg-slate-50 border-t border-slate-100">
            <div className="flex gap-2">
                <input
                    type="text"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAsk()}
                    placeholder="Posez une question sur votre flotte..."
                    className="flex-1 px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent bg-white shadow-sm"
                />
                <button 
                    onClick={handleAsk}
                    disabled={loading || !prompt}
                    className="bg-brand-600 hover:bg-brand-700 text-white p-3 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <Send size={24} />
                </button>
            </div>
        </div>
      </div>
    </div>
  );
};

export default AIAdvisor;
