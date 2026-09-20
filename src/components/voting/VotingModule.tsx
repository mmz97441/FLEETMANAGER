import React, { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  CheckCircle,
  FileText,
  Loader2,
  Plus,
  RefreshCw,
  Vote,
} from "lucide-react";
import type { User } from "../../types";
import type {
  VoteDetail,
  VoteDraft,
  VoteList,
  VotePerson,
  VotePoll,
} from "../../types/voting";
import { Permission, usePermissions } from "../../usePermissions";
import {
  attachVoteDocument,
  castVote,
  downloadVoteDocument,
  getVote,
  getVotingEmployees,
  listVotes,
  manageVote,
  saveVote,
} from "../../services/votingService";
import {
  downloadBlob,
  voteDate,
  votePhase,
  votePhaseLabels,
  votingError,
} from "../../utils/voting";
import { voteMinutesPdf, voteResultsCsv } from "../../utils/votingExport";
import PageHeader from "../shared/PageHeader";
import Modal from "../shared/Modal";
import VoteEditor from "./VoteEditor";
import VoteResultsPanel from "./VoteResultsPanel";

type Confirmation = {
  action:
    | "publish"
    | "close"
    | "cancel"
    | "cast"
    | "minutes"
    | "remove_document";
  title: string;
  message: string;
  extra?: Record<string, unknown>;
};
export default function VotingModule({ currentUser }: { currentUser: User }) {
  const { hasPermission, isLoading: permissionsLoading } = usePermissions();
  const [params, setParams] = useSearchParams();
  const selected = params.get("vote") || "";
  const [list, setList] = useState<VoteList>({
    polls: [],
    nextCursor: null,
    canManage: false,
  });
  const [detail, setDetail] = useState<VoteDetail | null>(null);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [employees, setEmployees] = useState<VotePerson[]>([]);
  const [editor, setEditor] = useState<{
    id: string;
    initial?: VotePoll;
    requestId: string;
  } | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null),
    [reason, setReason] = useState("");
  const [choices, setChoices] = useState<string[]>([]),
    [blank, setBlank] = useState(false);
  const [file, setFile] = useState<File | null>(null),
    [fileVisibility, setFileVisibility] = useState<
      "participants" | "direction"
    >("participants");
  const [clock, setClock] = useState(Date.now()),
    [online, setOnline] = useState(navigator.onLine);
  const [filter, setFilter] = useState("all");
  const inFlight = useRef(false),
    generation = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const castRequestId = useRef(crypto.randomUUID());
  const allowed = hasPermission(Permission.VOTES_VIEW);
  const poll = detail?.poll;
  const phase = poll ? votePhase(poll, clock) : null;
  const manager = poll?.canManage ?? list.canManage;

  useEffect(() => {
    const tick = () => {
      setClock(Date.now());
      setOnline(navigator.onLine);
    };
    const timer = setInterval(tick, 15000);
    window.addEventListener("online", tick);
    window.addEventListener("offline", tick);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", tick);
      window.removeEventListener("offline", tick);
    };
  }, []);
  const refresh = useCallback(async () => {
    const version = ++generation.current;
    setLoading(true);
    setError("");
    try {
      if (selected) {
        const value = await getVote(selected);
        if (version === generation.current) setDetail(value);
      } else {
        const value = await listVotes();
        if (version === generation.current) setList(value);
      }
    } catch (e) {
      if (version === generation.current) setError(votingError(e));
    } finally {
      if (version === generation.current) setLoading(false);
    }
  }, [selected, currentUser.id]);
  useEffect(() => {
    setDetail(null);
    setChoices([]);
    setBlank(false);
    setFile(null);
    setNotice("");
    castRequestId.current = crypto.randomUUID();
    if (!permissionsLoading && allowed) void refresh();
    return () => {
      generation.current++;
    };
  }, [refresh, allowed, permissionsLoading]);

  const run = async (operation: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await operation();
    } catch (e) {
      setError(votingError(e));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const open = (id?: string) => {
    if (!busy) {
      setConfirmation(null);
      setParams(id ? { vote: id } : {});
    }
  };
  const edit = (initial?: VotePoll, copy = false) =>
    void run(async () => {
      const { employees } = await getVotingEmployees();
      setEmployees(employees);
      setEditor({
        id: copy || !initial ? crypto.randomUUID() : initial.id,
        initial:
          copy && initial
            ? {
                ...initial,
                id: "",
                revision: 0,
                title: `${initial.title} (copie)`.slice(0, 160),
                opensAt: new Date().toISOString(),
                closesAt: new Date(Date.now() + 7 * 86400000).toISOString(),
              }
            : initial,
        requestId: crypto.randomUUID(),
      });
    });
  const save = (draft: VoteDraft) =>
    void run(async () => {
      if (!editor) return;
      const result = await saveVote(
        editor.id,
        editor.initial?.revision || 0,
        draft,
        editor.requestId,
      );
      setEditor(null);
      setDetail(result);
      setNotice(
        "Brouillon enregistré. Vérifiez le récapitulatif et ajoutez les documents avant publication.",
      );
      setParams({ vote: result.poll.id });
    });
  const confirm = (value: Confirmation) => {
    setReason("");
    setError("");
    setConfirmation(value);
  };
  const performConfirmation = () =>
    void run(async () => {
      if (!poll || !confirmation) return;
      if (confirmation.action === "cast") {
        const result = await castVote(
          poll.id,
          blank ? [] : choices,
          castRequestId.current,
        );
        setDetail((previous) =>
          previous
            ? {
                ...previous,
                poll: {
                  ...previous.poll,
                  hasVoted: true,
                  canVote: false,
                  receipt: result.receipt,
                },
              }
            : previous,
        );
        setNotice(
          result.alreadyVoted
            ? "Votre vote était déjà enregistré. Il n’a pas été compté une seconde fois."
            : "Votre vote est enregistré. Merci pour votre participation.",
        );
      } else {
        const result = await manageVote(
          poll.id,
          confirmation.action === "minutes"
            ? "finalize_minutes"
            : confirmation.action,
          { revision: poll.revision, reason, ...confirmation.extra },
        );
        setDetail(result);
        setNotice(
          confirmation.action === "minutes"
            ? "Procès-verbal finalisé. Vous pouvez télécharger le PDF."
            : "Scrutin mis à jour.",
        );
      }
      setConfirmation(null);
    });
  if (permissionsLoading)
    return (
      <p role="status" className="p-4">
        Chargement de vos droits…
      </p>
    );
  if (!allowed)
    return (
      <p role="alert" className="p-4">
        Votre compte n’a pas accès au module de vote.
      </p>
    );
  const needsReason =
    confirmation?.action === "cancel" ||
    (confirmation?.action === "close" && phase !== "ended");
  // Eligibility is frozen; the local clock can open the ballot without making
  // an elector look like an observer when a scheduled vote starts. The server
  // rechecks its own clock and the user's rights before recording anything.
  const canCast =
    !!poll && phase === "open" && poll.isElector && !poll.hasVoted;
  return (
    <div className="space-y-5 pb-24">
      <PageHeader
        title={poll?.title || "Votes des salariés"}
        description={
          poll
            ? `${votePhaseLabels[phase!]} · ${poll.kind === "election" ? "Élection interne simple" : "Consultation interne"}`
            : "Comprendre la décision, participer au vote et suivre les scrutins."
        }
        actions={
          <>
            <button
              type="button"
              className="ui-button ui-button-secondary"
              disabled={busy || loading}
              onClick={() => void refresh()}
            >
              <RefreshCw size={18} />
              Actualiser
            </button>
            {!selected && list.canManage && (
              <button
                type="button"
                className="ui-button ui-button-primary"
                disabled={busy || loading}
                onClick={() => edit()}
              >
                <Plus size={18} />
                Préparer un vote
              </button>
            )}
          </>
        }
      />
      {selected && (
        <button
          type="button"
          className="ui-button ui-button-ghost"
          disabled={busy}
          onClick={() => open()}
        >
          <ArrowLeft size={18} />
          Tous les scrutins
        </button>
      )}
      {!online && (
        <p role="status" className="rounded-xl bg-amber-50 p-3 text-amber-900">
          Vous êtes hors connexion. Une connexion est nécessaire pour
          enregistrer un vote et vérifier sa confirmation.
        </p>
      )}
      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-3 text-red-900"
        >
          <p>{error}</p>
          <button
            type="button"
            disabled={busy}
            className="ui-button ui-button-secondary mt-2"
            onClick={() => void refresh()}
          >
            Vérifier le scrutin
          </button>
        </div>
      )}
      {notice && (
        <p role="status" className="rounded-xl bg-green-50 p-3 text-green-900">
          {notice}
        </p>
      )}
      {loading && (
        <p role="status" className="flex items-center gap-2 p-4">
          <Loader2 className="animate-spin" size={20} />
          Chargement des scrutins…
        </p>
      )}
      {!loading && !selected && !error && (
        <>
          <div
            className="flex flex-wrap gap-2"
            aria-label="Filtrer les scrutins"
          >
            {[
              ["all", "Tous"],
              ["open", "Votes ouverts"],
              ["scheduled", "À venir"],
              ...(manager ? [["draft", "Brouillons"]] : []),
              ["closed", "Clôturés"],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-pressed={filter === id}
                className={`ui-button ${filter === id ? "ui-button-primary" : "ui-button-secondary"}`}
                onClick={() => setFilter(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {list.polls
              .filter((p) => filter === "all" || votePhase(p, clock) === filter)
              .map((p) => (
                <article
                  key={p.id}
                  className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3"
                >
                  <div className="flex gap-2 items-center text-sm font-semibold text-slate-700">
                    <Vote size={18} />
                    <span>{votePhaseLabels[votePhase(p, clock)]}</span>
                    {p.hasVoted && (
                      <span className="ml-auto text-green-800">A voté</span>
                    )}
                  </div>
                  <h2 className="text-lg font-bold break-words">{p.title}</h2>
                  <p className="text-sm text-slate-600 line-clamp-3 whitespace-pre-line break-words">
                    {p.purpose}
                  </p>
                  <p className="text-sm">
                    Du {voteDate(p.opensAt)} au {voteDate(p.closesAt)}
                  </p>
                  <p className="text-sm text-slate-600">
                    Vote {p.privacy === "secret" ? "secret" : "nominatif"} ·{" "}
                    {p.voterCount} électeurs
                  </p>
                  <button
                    type="button"
                    className="ui-button ui-button-primary w-full"
                    onClick={() => open(p.id)}
                  >
                    {p.isElector &&
                    !p.hasVoted &&
                    votePhase(p, clock) === "open"
                      ? "Comprendre et voter"
                      : "Consulter le scrutin"}
                  </button>
                </article>
              ))}
          </div>
          {!list.polls.filter(
            (p) => filter === "all" || votePhase(p, clock) === filter,
          ).length && (
            <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center">
              <Vote size={30} className="mx-auto mb-3 text-slate-500" />
              <p className="font-bold">Aucun scrutin dans cette vue</p>
              <p className="text-sm text-slate-600 mt-2">
                {manager
                  ? "Préparez un vote pour choisir son objet, les salariés concernés et ses règles."
                  : "Les scrutins auxquels vous êtes invité apparaîtront ici après publication."}
              </p>
            </div>
          )}
          {list.nextCursor && (
            <button
              type="button"
              className="ui-button ui-button-secondary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const next = await listVotes(list.nextCursor!);
                  setList((previous) => ({
                    ...next,
                    polls: [
                      ...previous.polls,
                      ...next.polls.filter(
                        (p) => !previous.polls.some((old) => old.id === p.id),
                      ),
                    ],
                  }));
                })
              }
            >
              Charger les scrutins suivants
            </button>
          )}
        </>
      )}
      {!loading && poll && (
        <>
          <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6 space-y-4">
            <h2 className="text-xl font-bold">Pourquoi vote-t-on ?</h2>
            <p className="whitespace-pre-wrap break-words text-slate-700">
              {poll.purpose}
            </p>
            <p className="text-lg font-semibold whitespace-pre-wrap break-words">
              {poll.question}
            </p>
            <dl className="grid gap-3 sm:grid-cols-2 text-sm">
              <div>
                <dt className="text-slate-500">Ouverture · La Réunion</dt>
                <dd className="font-semibold">{voteDate(poll.opensAt)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Fin du vote · La Réunion</dt>
                <dd className="font-semibold">{voteDate(poll.closesAt)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Électeurs sélectionnés</dt>
                <dd className="font-semibold">
                  {poll.voterCount} sur {poll.participantCount} participants
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Règle</dt>
                <dd className="font-semibold">
                  {poll.maxChoices} choix maximum · vote blanc{" "}
                  {poll.allowBlank ? "autorisé" : "non autorisé"}
                </dd>
              </div>
            </dl>
            <p
              className={`rounded-xl p-3 text-sm ${poll.privacy === "secret" ? "bg-blue-50 text-blue-900" : "bg-amber-50 text-amber-900"}`}
            >
              {poll.privacy === "secret"
                ? "Vote secret : la direction verra les résultats globaux et qui a participé, sans afficher votre choix individuel."
                : "Vote nominatif : après clôture, votre choix sera visible par la direction."}{" "}
              Un bulletin confirmé ne peut plus être modifié.
            </p>
            {poll.canManage && (
              <details className="rounded-xl border border-slate-200 p-3">
                <summary className="font-semibold min-h-11 cursor-pointer">
                  Vérifier les participants et les électeurs
                </summary>
                <ul className="space-y-2 text-sm">
                  {poll.participants?.map((p) => (
                    <li
                      key={p.id}
                      className="flex flex-wrap justify-between gap-2 border-t border-slate-100 pt-2"
                    >
                      <span>
                        {p.name} · {p.role}
                      </span>
                      <span className="font-semibold">
                        {poll.voterIds?.includes(p.id)
                          ? "Électeur"
                          : "Consultation uniquement"}
                        {poll.options.some((o) => o.employeeId === p.id)
                          ? " · Candidat"
                          : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>
          {poll.canManage && (
            <section className="rounded-xl bg-slate-100 p-4 space-y-3">
              <h2 className="font-bold">Gestion du scrutin</h2>
              <div className="flex flex-wrap gap-2">
                {poll.status === "draft" && (
                  <>
                    <button
                      type="button"
                      disabled={busy}
                      className="ui-button ui-button-secondary"
                      onClick={() => edit(poll)}
                    >
                      Modifier le brouillon
                    </button>
                    <button
                      type="button"
                      disabled={busy || !online}
                      className="ui-button ui-button-primary"
                      onClick={() =>
                        confirm({
                          action: "publish",
                          title: "Publier ce scrutin ?",
                          message: `Les ${poll.voterCount} électeurs et les ${poll.options.length} choix seront figés. Le vote sera accessible selon les dates prévues. Vérifiez les documents avant de publier.`,
                        })
                      }
                    >
                      Publier le scrutin
                    </button>
                  </>
                )}
                {poll.status === "published" && (
                  <button
                    type="button"
                    disabled={busy || !online}
                    className="ui-button ui-button-primary"
                    onClick={() =>
                      confirm({
                        action: "close",
                        title: "Clôturer et dépouiller ?",
                        message:
                          "La clôture arrête définitivement le vote et fige les résultats. Les choix individuels restent masqués pour un scrutin secret.",
                      })
                    }
                  >
                    Clôturer et voir les résultats
                  </button>
                )}
                {["draft", "published"].includes(poll.status) && (
                  <button
                    type="button"
                    disabled={busy}
                    className="ui-button ui-button-secondary"
                    onClick={() =>
                      confirm({
                        action: "cancel",
                        title: "Annuler ce scrutin ?",
                        message:
                          "Le scrutin sera conservé avec le motif d’annulation. Les salariés ne pourront plus voter.",
                      })
                    }
                  >
                    Annuler le scrutin
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy}
                  className="ui-button ui-button-ghost"
                  onClick={() => edit(poll, true)}
                >
                  Créer un nouveau vote à partir de celui-ci
                </button>
              </div>
              {poll.status === "published" && (
                <p className="text-sm text-slate-600">
                  Les résultats et le registre de participation seront
                  accessibles après clôture.
                </p>
              )}
            </section>
          )}
          <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
            <h2 className="font-bold text-lg">Documents du scrutin</h2>
            {!poll.documents.length && (
              <p className="text-sm text-slate-600">Aucun document joint.</p>
            )}
            <ul className="space-y-2">
              {poll.documents.map((document) => (
                <li
                  key={document.id}
                  className="rounded-lg border border-slate-100 p-3 flex flex-wrap items-center gap-2"
                >
                  <FileText size={18} />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium break-words">{document.name}</p>
                    <p className="text-sm text-slate-600">
                      {document.kind === "signed_minutes"
                        ? "PV signé"
                        : "Document du vote"}{" "}
                      · {Math.ceil(document.size / 1024)} Ko
                      {manager
                        ? ` · ${document.visibility === "direction" ? "Direction uniquement" : "Participants"}`
                        : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    className="ui-button ui-button-secondary"
                    onClick={() =>
                      void run(async () => {
                        const result = await downloadVoteDocument(
                          poll.id,
                          document.id,
                        );
                        downloadBlob(result.blob, result.name);
                      })
                    }
                  >
                    Télécharger
                  </button>
                  {manager && poll.status === "draft" && (
                    <button
                      type="button"
                      disabled={busy}
                      className="ui-button ui-button-ghost"
                      onClick={() =>
                        confirm({
                          action: "remove_document",
                          title: "Retirer ce document ?",
                          message: document.name,
                          extra: { documentId: document.id },
                        })
                      }
                    >
                      Retirer
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {manager &&
              (poll.status === "draft" ||
                (poll.status === "closed" && poll.minutes)) && (
                <form
                  className="space-y-3 border-t border-slate-200 pt-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (file)
                      void run(async () => {
                        const result = await attachVoteDocument(
                          poll.id,
                          file,
                          fileVisibility,
                          poll.status === "closed"
                            ? "signed_minutes"
                            : "attachment",
                        );
                        setDetail(result);
                        setFile(null);
                        if (fileInput.current) fileInput.current.value = "";
                        setNotice("Document ajouté.");
                      });
                  }}
                >
                  <label className="block text-sm font-semibold">
                    {poll.status === "closed"
                      ? "Ajouter le procès-verbal signé"
                      : "Joindre un document explicatif ou un modèle"}
                    <input
                      ref={fileInput}
                      type="file"
                      required
                      disabled={busy}
                      accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                      className="block w-full text-sm mt-2"
                      onChange={(e) => setFile(e.target.files?.[0] || null)}
                    />
                  </label>
                  <p className="text-sm text-slate-600">
                    PDF, Word, JPEG ou PNG · 5 Mo par fichier · 10 pièces
                    jointes et 3 exemplaires signés maximum.
                  </p>
                  <label className="block text-sm font-semibold">
                    Visible par
                    <select
                      className="ui-input w-full sm:max-w-xs mt-1"
                      disabled={busy}
                      value={fileVisibility}
                      onChange={(e) =>
                        setFileVisibility(
                          e.target.value as typeof fileVisibility,
                        )
                      }
                    >
                      <option value="participants">
                        Les participants au scrutin
                      </option>
                      <option value="direction">La direction uniquement</option>
                    </select>
                  </label>
                  <button
                    type="submit"
                    disabled={
                      !file ||
                      busy ||
                      !online ||
                      poll.documents.filter(
                        (d) =>
                          d.kind ===
                          (poll.status === "closed"
                            ? "signed_minutes"
                            : "attachment"),
                      ).length >= (poll.status === "closed" ? 3 : 10)
                    }
                    className="ui-button ui-button-secondary"
                  >
                    {busy ? "Envoi…" : "Ajouter le document"}
                  </button>
                </form>
              )}
          </section>
          {poll.hasVoted ? (
            <section
              role="status"
              className="rounded-xl bg-green-50 border border-green-200 p-5 space-y-2"
            >
              <h2 className="flex items-center gap-2 text-lg font-bold text-green-900">
                <CheckCircle size={22} />
                Votre vote est enregistré
              </h2>
              <p>Le {voteDate(poll.receipt!.castAt)}.</p>
              <p className="text-sm break-all">
                Référence de confirmation : {poll.receipt!.code}
              </p>
            </section>
          ) : canCast ? (
            <form
              className="rounded-2xl border-2 border-blue-200 bg-white p-4 sm:p-6 space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                confirm({
                  action: "cast",
                  title: "Confirmer votre vote ?",
                  message: `${blank ? "Vous déposez un vote blanc." : `Votre choix : ${choices.map((id) => poll.options.find((o) => o.id === id)?.label).join(", ")}.`} ${poll.privacy === "secret" ? "Votre choix reste secret." : "Votre choix sera visible par la direction."} Vous ne pourrez plus le modifier après confirmation.`,
                });
              }}
            >
              <fieldset disabled={busy || !online}>
                <legend className="text-xl font-bold mb-3">
                  Votre bulletin
                </legend>
                <p className="text-sm text-slate-600 mb-3">
                  {poll.maxChoices === 1
                    ? "Choisissez une seule réponse."
                    : `Choisissez de 1 à ${poll.maxChoices} réponses.`}
                </p>
                <div className="space-y-2">
                  {poll.options.map((option) => (
                    <label
                      key={option.id}
                      className={`flex gap-3 items-start rounded-xl border p-4 cursor-pointer ${choices.includes(option.id) ? "border-blue-600 bg-blue-50" : "border-slate-200"}`}
                    >
                      <input
                        type={poll.maxChoices === 1 ? "radio" : "checkbox"}
                        name="ballot"
                        className="h-5 w-5 shrink-0"
                        checked={choices.includes(option.id)}
                        onChange={(e) => {
                          setBlank(false);
                          setChoices((previous) =>
                            poll.maxChoices === 1
                              ? [option.id]
                              : e.target.checked
                                ? [...previous, option.id]
                                : previous.filter((id) => id !== option.id),
                          );
                        }}
                      />
                      <span className="font-semibold break-words">
                        {option.label}
                      </span>
                    </label>
                  ))}
                  {poll.allowBlank && (
                    <label className="flex gap-3 items-center rounded-xl border border-slate-200 p-4 cursor-pointer">
                      <input
                        type={poll.maxChoices === 1 ? "radio" : "checkbox"}
                        name="ballot"
                        className="h-5 w-5"
                        checked={blank}
                        onChange={(e) => {
                          setBlank(e.target.checked);
                          setChoices([]);
                        }}
                      />
                      Vote blanc — aucun des choix proposés
                    </label>
                  )}
                </div>
              </fieldset>
              {choices.length > poll.maxChoices && (
                <p role="alert" className="text-red-800">
                  Sélectionnez au maximum {poll.maxChoices} réponses.
                </p>
              )}
              <button
                type="submit"
                disabled={
                  busy ||
                  !online ||
                  (!blank && !choices.length) ||
                  choices.length > poll.maxChoices
                }
                className="ui-button ui-button-primary w-full sm:w-auto"
              >
                Vérifier puis confirmer mon vote
              </button>
            </form>
          ) : (
            <section className="rounded-xl border border-slate-200 p-4">
              <h2 className="font-bold mb-2">
                {phase === "scheduled"
                  ? "Le vote n’a pas encore commencé"
                  : phase === "open"
                    ? "Vous participez en consultation"
                    : "Bulletin"}
              </h2>
              <p className="text-sm text-slate-600">
                {phase === "scheduled"
                  ? `Ouverture le ${voteDate(poll.opensAt)}.`
                  : phase === "open"
                    ? "Vous pouvez consulter ce scrutin et ses documents. Vous ne faites pas partie des électeurs sélectionnés."
                    : phase === "cancelled"
                      ? `Scrutin annulé : ${poll.cancellationReason}`
                      : phase === "draft"
                        ? "Le bulletin sera accessible aux électeurs après publication."
                        : "Le vote est terminé. Aucun nouveau bulletin ne peut être déposé."}
              </p>
              <ul className="list-disc pl-5 mt-3 space-y-1 text-sm">
                {poll.options.map((o) => (
                  <li key={o.id}>{o.label}</li>
                ))}
              </ul>
            </section>
          )}
          {detail && poll.status === "closed" && poll.canManage && (
            <VoteResultsPanel
              key={poll.id}
              detail={detail}
              busy={busy}
              onCsv={() =>
                void run(async () =>
                  downloadBlob(
                    new Blob([voteResultsCsv(detail)], {
                      type: "text/csv;charset=utf-8;",
                    }),
                    `resultats-vote-${poll.id}.csv`,
                  ),
                )
              }
              onPdf={() =>
                void run(async () =>
                  downloadBlob(
                    await voteMinutesPdf(detail),
                    `PV-vote-${poll.id}.pdf`,
                  ),
                )
              }
              onFinalize={(minutes) =>
                confirm({
                  action: "minutes",
                  title: "Finaliser le procès-verbal ?",
                  message:
                    "Les résultats et les observations seront figés. Le PDF restera téléchargeable et un exemplaire signé pourra être ajouté.",
                  extra: { minutes },
                })
              }
            />
          )}
        </>
      )}
      {editor && (
        <VoteEditor
          employees={employees}
          initial={editor.initial}
          busy={busy}
          error={error}
          onSave={save}
          onClose={() => {
            if (!busy) {
              setEditor(null);
              setError("");
            }
          }}
        />
      )}
      {confirmation && (
        <Modal
          isOpen
          title={confirmation.title}
          role="alertdialog"
          busy={busy}
          onClose={() => setConfirmation(null)}
        >
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              performConfirmation();
            }}
          >
            <p className="whitespace-pre-wrap break-words">
              {confirmation.message}
            </p>
            {needsReason && (
              <label className="block text-sm font-semibold">
                Motif obligatoire
                <textarea
                  required
                  maxLength={1000}
                  className="ui-input w-full mt-1"
                  value={reason}
                  disabled={busy}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
            )}
            {error && (
              <p role="alert" className="text-red-800">
                {error}
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={busy}
                className="ui-button ui-button-secondary"
                onClick={() => setConfirmation(null)}
              >
                Revenir
              </button>
              <button
                type="submit"
                disabled={busy || !online}
                className="ui-button ui-button-primary"
              >
                {busy
                  ? "Enregistrement…"
                  : confirmation.action === "cast"
                    ? "Confirmer mon vote"
                    : "Confirmer"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
