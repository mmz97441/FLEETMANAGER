import React, { useState } from "react";
import type { VoteDetail } from "../../types/voting";
import { voteDate } from "../../utils/voting";

export default function VoteResultsPanel({
  detail,
  busy,
  onCsv,
  onPdf,
  onFinalize,
}: {
  detail: VoteDetail;
  busy: boolean;
  onCsv: () => void;
  onPdf: () => void;
  onFinalize: (minutes: {
    chair: string;
    secretary: string;
    place: string;
    observations: string;
  }) => void;
}) {
  const { poll, participation = [] } = detail;
  const [minutes, setMinutes] = useState({
    chair: "",
    secretary: "",
    place: "",
    observations: "",
  });
  if (!poll.results || !poll.canViewResults) return null;
  const r = poll.results;
  return (
    <section className="space-y-5" aria-labelledby="vote-results-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="vote-results-heading" className="text-xl font-bold">
          Résultats et procès-verbal
        </h2>
        <button
          type="button"
          className="ui-button ui-button-secondary"
          disabled={busy}
          onClick={onCsv}
        >
          Exporter le tableau CSV
        </button>
      </div>
      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          ["Inscrits", r.eligible],
          ["Votants", `${r.cast} (${r.turnout} %)`],
          ["Votes blancs", r.blank],
          ["Abstentions", r.abstentions],
        ].map(([label, value]) => (
          <div
            key={label}
            className="rounded-xl border border-slate-200 bg-white p-3"
          >
            <dt className="text-sm text-slate-600">{label}</dt>
            <dd className="text-xl font-bold mt-1">{value}</dd>
          </div>
        ))}
      </dl>
      <p
        className={`rounded-xl p-3 ${r.quorumMet ? "bg-green-50 text-green-900" : "bg-amber-50 text-amber-900"}`}
      >
        {poll.quorumPercent === 0
          ? "Aucun quorum demandé."
          : `Quorum ${r.quorumMet ? "atteint" : "non atteint"} : ${r.cast} votants sur ${r.quorumRequired} requis.`}
      </p>
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full text-sm text-left">
          <caption className="p-3 text-left text-slate-600">
            {r.expressed} bulletins exprimés ·{" "}
            {poll.maxChoices > 1
              ? "Plusieurs choix possibles : le total des pourcentages peut dépasser 100 %."
              : "Un choix par bulletin."}
          </caption>
          <thead className="bg-slate-100">
            <tr>
              <th scope="col" className="p-3">
                {poll.kind === "election" ? "Candidat" : "Choix"}
              </th>
              <th scope="col" className="p-3 text-right">
                Voix
              </th>
              <th scope="col" className="p-3 text-right">
                % exprimés
              </th>
            </tr>
          </thead>
          <tbody>
            {r.rows.map((row) => (
              <tr key={row.id} className="border-t border-slate-200">
                <th scope="row" className="p-3 break-words">
                  {row.label}
                </th>
                <td className="p-3 text-right tabular-nums">{row.votes}</td>
                <td className="p-3 text-right tabular-nums">{row.percent} %</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {r.tied && (
        <p className="rounded-xl bg-amber-50 p-3 text-amber-900">
          Égalité en tête entre {r.leaders.join(", ")}. Aucun départage
          automatique.
        </p>
      )}
      {!r.expressed && (
        <p className="text-slate-700">Aucun bulletin exprimé.</p>
      )}
      <details className="rounded-xl border border-slate-200 p-3">
        <summary className="min-h-11 cursor-pointer font-bold">
          Registre de participation · {participation.length} électeurs
        </summary>
        <p className="text-sm text-slate-600 my-2">
          {poll.privacy === "secret"
            ? "Ce registre indique qui a voté. Il ne contient aucun choix individuel."
            : "Scrutin nominatif : les choix sont visibles pour la direction, comme annoncé aux électeurs."}
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead>
              <tr>
                <th className="p-2">Salarié</th>
                <th className="p-2">Participation</th>
                {poll.privacy === "nominal" && <th className="p-2">Choix</th>}
              </tr>
            </thead>
            <tbody>
              {participation.map((p) => (
                <tr key={p.id} className="border-t border-slate-100">
                  <th scope="row" className="p-2 font-medium">
                    {p.name}
                  </th>
                  <td className="p-2">
                    {p.voted
                      ? `A voté · ${voteDate(p.castAt!)}`
                      : "N’a pas voté"}
                  </td>
                  {poll.privacy === "nominal" && (
                    <td className="p-2">
                      {p.voted
                        ? p.blank
                          ? "Blanc"
                          : (p.choices || [])
                              .map(
                                (id) =>
                                  poll.options.find((o) => o.id === id)?.label,
                              )
                              .join(", ")
                        : "—"}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      {poll.minutes ? (
        <div className="rounded-xl border border-green-200 bg-green-50 p-4 space-y-3">
          <h3 className="font-bold">Procès-verbal finalisé</h3>
          <p className="text-sm">
            Le {voteDate(poll.minutes.finalizedAt)}, par{" "}
            {poll.minutes.finalizedBy}. Le document est figé et prêt à être
            signé.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={onPdf}
            className="ui-button ui-button-primary"
          >
            Télécharger le PV PDF
          </button>
        </div>
      ) : (
        <form
          className="rounded-xl border border-slate-200 p-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            onFinalize(minutes);
          }}
        >
          <h3 className="font-bold text-lg">Préparer le procès-verbal</h3>
          <div className="grid sm:grid-cols-2 gap-3">
            {(["chair", "secretary", "place"] as const).map((key) => (
              <label key={key} className="block text-sm font-semibold">
                {
                  {
                    chair: "Présidence du scrutin *",
                    secretary: "Secrétaire du scrutin",
                    place: "Lieu",
                  }[key]
                }
                <input
                  className="ui-input w-full mt-1"
                  required={key === "chair"}
                  maxLength={key === "place" ? 250 : 160}
                  value={minutes[key]}
                  disabled={busy}
                  onChange={(e) =>
                    setMinutes((p) => ({ ...p, [key]: e.target.value }))
                  }
                />
              </label>
            ))}
          </div>
          <label className="block text-sm font-semibold">
            Observations et décision du bureau
            <textarea
              rows={4}
              maxLength={5000}
              className="ui-input w-full mt-1"
              value={minutes.observations}
              disabled={busy}
              onChange={(e) =>
                setMinutes((p) => ({ ...p, observations: e.target.value }))
              }
              placeholder="Consignez les observations, le traitement d’une éventuelle égalité et la décision retenue."
            />
          </label>
          <p className="text-sm text-slate-600">
            La finalisation fige ces informations avec les résultats. Les
            signatures restent à apposer sur le PDF ; le PV signé pourra ensuite
            être joint.
          </p>
          <button
            type="submit"
            disabled={busy}
            className="ui-button ui-button-primary"
          >
            Finaliser le procès-verbal
          </button>
        </form>
      )}
    </section>
  );
}
