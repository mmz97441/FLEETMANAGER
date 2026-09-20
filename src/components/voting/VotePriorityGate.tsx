import { useCallback, useEffect, useRef, useState } from "react";
import { Vote } from "lucide-react";
import { Permission, usePermissions } from "../../usePermissions";
import { useUrlParam } from "../../hooks/useUrlState";
import {
  dismissVoteReminder,
  getPendingVote,
} from "../../services/votingService";
import type { VotePoll } from "../../types/voting";
import { voteDate, votePhase, votingError } from "../../utils/voting";
import Modal from "../shared/Modal";
import VotePrivacyNotice from "./VotePrivacyNotice";

interface Props {
  currentView: string;
  onVote: (id: string) => Promise<boolean>;
}

function Invitation({
  poll,
  onVote,
  onDismiss,
  onPause,
}: {
  poll: VotePoll;
  onVote: Props["onVote"];
  onDismiss: () => void;
  onPause: () => void;
}) {
  const [warning, setWarning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [navigating, setNavigating] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const go = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setNavigating(true);
    setError("");
    try {
      await onVote(poll.id);
    } catch (e) {
      setError(votingError(e));
    } finally {
      inFlight.current = false;
      setNavigating(false);
    }
  };
  const dismiss = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setError("");
    try {
      await dismissVoteReminder(poll.id);
      onDismiss();
    } catch (e) {
      setError(votingError(e));
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };
  return (
    <Modal
      isOpen
      priority={100}
      role="alertdialog"
      size="lg"
      title={warning ? "Continuer sans voter ?" : "Un vote vous attend"}
      onClose={() => {
        if (!inFlight.current) setWarning(true);
      }}
      showCloseButton={!warning}
      closeOnOverlay={false}
      busy={saving}
      headerIcon={<Vote size={24} />}
    >
      <div className="space-y-4">
        <h2 className="text-lg font-bold break-words">{poll.title}</h2>
        {warning ? (
          <div className="rounded-xl bg-amber-50 p-4 text-amber-950 space-y-2">
            <p>
              Vous allez continuer sans participer pour le moment. Aucun
              bulletin, y compris blanc, ne sera déposé.
            </p>
            <p>
              Vous pourrez revenir dans « Votes des salariés » jusqu’au{" "}
              {voteDate(poll.closesAt)}. Sans vote à la clôture, vous serez
              compté parmi les non-participants (abstention).
            </p>
          </div>
        ) : (
          <>
            <p className="whitespace-pre-line break-words text-slate-700">
              {poll.purpose}
            </p>
            <p className="font-semibold">
              Vous pouvez voter jusqu’au {voteDate(poll.closesAt)}.
            </p>
            <VotePrivacyNotice privacy={poll.privacy} />
          </>
        )}
        {error && (
          <div role="alert" className="rounded-xl bg-red-50 p-3 text-red-900">
            <p>{error}</p>
            <p className="mt-2">
              La fermeture n’a pas été confirmée. Aucun bulletin n’a été déposé
              par cette action.
            </p>
            {warning && (
              <button
                type="button"
                className="ui-button ui-button-secondary mt-3"
                onClick={onPause}
              >
                Fermer le rappel pour cette session
              </button>
            )}
          </div>
        )}
        <div className="flex flex-col gap-3">
          <button
            type="button"
            className="ui-button ui-button-primary w-full"
            disabled={saving || navigating}
            onClick={() => void go()}
          >
            {navigating ? "Ouverture du vote…" : "Passer au vote"}
          </button>
          <button
            type="button"
            className="ui-button ui-button-secondary w-full"
            disabled={saving || navigating}
            onClick={() => (warning ? void dismiss() : setWarning(true))}
          >
            {saving
              ? "Enregistrement…"
              : warning
                ? "Confirmer : continuer sans voter"
                : "Continuer sans voter"}
          </button>
          {warning && (
            <button
              type="button"
              className="ui-button ui-button-ghost"
              disabled={saving || navigating}
              onClick={() => setWarning(false)}
            >
              Revenir aux explications
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

/** One reminder per eligible open vote, across every application view. */
export default function VotePriorityGate({ currentView, onVote }: Props) {
  const { hasPermission, isLoading } = usePermissions();
  const allowed = !isLoading && hasPermission(Permission.VOTES_VIEW);
  const [selected] = useUrlParam<string>("vote", "");
  const [poll, setPoll] = useState<VotePoll | null>(null);
  const [paused, setPaused] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const refreshRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (!allowed) {
      setPoll(null);
      return;
    }
    let alive = true,
      running = false,
      again = false;
    const refresh = async () => {
      if (!alive || document.visibilityState === "hidden" || !navigator.onLine)
        return;
      if (running) {
        again = true;
        return;
      }
      running = true;
      try {
        const result = await getPendingVote();
        if (alive) {
          setPoll(result.poll);
          setClock(Date.now());
        }
      } catch {
        // A failed reminder lookup must never lock the operational application.
        if (alive) setPoll(null);
      } finally {
        running = false;
        if (alive && again) {
          again = false;
          void refresh();
        }
      }
    };
    const wake = () => {
      setPaused(false);
      void refresh();
    };
    refreshRef.current = () => {
      void refresh();
    };
    void refresh();
    const timer = window.setInterval(() => {
      setClock(Date.now());
      void refresh();
    }, 30000);
    window.addEventListener("online", wake);
    window.addEventListener("fleet-votes-changed", refreshRef.current);
    document.addEventListener("visibilitychange", refreshRef.current);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener("online", wake);
      window.removeEventListener("fleet-votes-changed", refreshRef.current);
      document.removeEventListener("visibilitychange", refreshRef.current);
    };
  }, [allowed]);
  const dismissed = useCallback(() => {
    setPoll(null);
    refreshRef.current();
  }, []);
  if (
    !allowed ||
    paused ||
    !poll ||
    !poll.canVote ||
    votePhase(poll, clock) !== "open" ||
    (currentView === "votes" && selected === poll.id)
  )
    return null;
  return (
    <Invitation
      key={poll.id}
      poll={poll}
      onVote={onVote}
      onDismiss={dismissed}
      onPause={() => setPaused(true)}
    />
  );
}
