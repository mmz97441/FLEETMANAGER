import type { VotePoll } from "../types/voting";

export function votePhase(
  poll: Pick<VotePoll, "status" | "opensAt" | "closesAt">,
  now = Date.now(),
) {
  if (poll.status !== "published") return poll.status;
  if (now < Date.parse(poll.opensAt)) return "scheduled";
  return now >= Date.parse(poll.closesAt) ? "ended" : "open";
}
export const votePhaseLabels = {
  draft: "Brouillon",
  scheduled: "À venir",
  open: "Vote ouvert",
  ended: "Vote terminé",
  closed: "Clôturé",
  cancelled: "Annulé",
};
export const voteDate = (date: string) =>
  new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Indian/Reunion",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(date));
export function toReunionInput(iso: string) {
  return new Date(Date.parse(iso) + 4 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 16);
}
export function fromReunionInput(value: string) {
  const date = new Date(`${value}:00+04:00`);
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = name.replace(/[\/\\\u0000-\u001f]/g, "_");
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
export function votingError(error: unknown): string {
  const code = String((error as { code?: string })?.code || "");
  if (
    code === "functions/deadline-exceeded" ||
    code === "functions/unavailable" ||
    code === "functions/internal"
  )
    return "La réponse du serveur n’a pas été reçue. Actualisez le scrutin pour vérifier la dernière opération avant de réessayer.";
  return error instanceof Error
    ? error.message
    : "L’opération n’a pas abouti. Réessayez.";
}
