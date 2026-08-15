import React, { useMemo, useState } from 'react';
import { Send, Loader2, Sparkles } from 'lucide-react';
import { runQuery, SUGGESTED_QUESTIONS, type QueryResult } from '../../services/aiAnalytics';
import {
  KpiTile,
  TrendChart,
  BarByDimension,
  DonutStatuses,
  TopList,
} from './AnalyticsWidgets';
import type { Package } from '../../types';

interface AskDataProps {
  packages: Package[];
}

type AnswerState = QueryResult | { error: string } | null;

const hasError = (a: AnswerState): a is { error: string } =>
  a !== null && 'error' in a;

const AskData: React.FC<AskDataProps> = ({ packages }) => {
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState<AnswerState>(null);

  // Contexte dérivé des colis : pharmacies (destinataires) et zones distinctes
  const context = useMemo(() => {
    const pharmacies = Array.from(
      new Set(
        packages
          .map((p) => p.contactName)
          .filter((n): n is string => !!n && n.trim().length > 0),
      ),
    );
    const zones = Array.from(
      new Set(
        packages
          .map((p) => (p.zone != null ? String(p.zone) : ''))
          .filter((z) => z.length > 0),
      ),
    );
    return { pharmacies, zones };
  }, [packages]);

  const submit = async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed || loading) return;
    setLoading(true);
    try {
      const result = await runQuery(packages, trimmed, context);
      setAnswer(result);
    } catch {
      setAnswer({ error: "Une erreur est survenue pendant le calcul. Réessayez." });
    } finally {
      setLoading(false);
    }
  };

  const handleChip = (q: string) => {
    setQuestion(q);
    void submit(q);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void submit(question);
    }
  };

  const renderChart = (result: QueryResult) => {
    switch (result.chart) {
      case 'kpi':
        return (
          <KpiTile
            label={result.kpi?.label ?? result.title}
            value={result.kpi?.value ?? '—'}
            suffix={result.kpi?.suffix}
          />
        );
      case 'line':
        return (
          <TrendChart
            label={result.title}
            data={(result.series ?? []).map((s) => ({ date: s.name, value: s.value }))}
          />
        );
      case 'bar':
        return <BarByDimension label={result.title} data={result.series ?? []} />;
      case 'donut':
        return <DonutStatuses label={result.title} data={result.series ?? []} />;
      case 'table':
        return (
          <TopList
            label={result.title}
            rows={(result.series ?? []).map((s) => ({ name: s.name, value: s.value }))}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4">
      {/* En-tête */}
      <div className="flex items-start gap-2">
        <Sparkles className="mt-0.5 h-5 w-5 flex-shrink-0 text-indigo-500" />
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-slate-900">
            🔮 Demander à mes données
          </h3>
          <p className="text-sm text-slate-500">
            Posez une question, on calcule la réponse (chiffres garantis exacts).
          </p>
        </div>
      </div>

      {/* Barre de saisie */}
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ex : Quelle est ma ponctualité par zone ce mois-ci ?"
          className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
        />
        <button
          type="button"
          onClick={() => void submit(question)}
          disabled={loading || question.trim().length === 0}
          className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          Demander
        </button>
      </div>

      {/* Suggestions */}
      <div className="mt-3 flex flex-wrap gap-2">
        {SUGGESTED_QUESTIONS.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => handleChip(q)}
            disabled={loading}
            className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {q}
          </button>
        ))}
      </div>

      {/* Zone de résultat */}
      {loading && (
        <div className="mt-4 flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin text-indigo-500" />
          Je calcule…
        </div>
      )}

      {!loading && hasError(answer) && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {answer.error}
        </div>
      )}

      {!loading && answer !== null && !hasError(answer) && (
        <div className="mt-4 space-y-3">
          <h4 className="text-sm font-semibold text-slate-900">{answer.title}</h4>
          {renderChart(answer)}
          <p className="text-sm text-slate-700">{answer.narrative}</p>
          <p className="text-xs text-slate-400">{answer.explain}</p>
          <button
            type="button"
            disabled
            className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-400"
          >
            📌 Épingler (bientôt)
          </button>
        </div>
      )}
    </div>
  );
};

export default AskData;
