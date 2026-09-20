import { getFunctions, httpsCallable } from "firebase/functions";
import { ref, uploadBytes } from "firebase/storage";
import app, { storage } from "../firebaseConfig";
import type {
  VoteDetail,
  VoteDocument,
  VoteDraft,
  VoteList,
  VotePerson,
  VotePoll,
} from "../types/voting";

const endpoint = httpsCallable(
  getFunctions(app, "europe-west1"),
  "employeeVoting",
  { timeout: 120000 },
);
const reminderEndpoint = httpsCallable(
  getFunctions(app, "europe-west1"),
  "employeeVoting",
  { timeout: 15000 },
);
async function call<T>(data: Record<string, unknown>): Promise<T> {
  const invoke = ["pending", "dismiss"].includes(String(data.action))
    ? reminderEndpoint
    : endpoint;
  const result = (await invoke(data)).data as T;
  if (
    ["cast", "dismiss", "publish", "close", "cancel"].includes(
      String(data.action),
    )
  )
    window.dispatchEvent(new Event("fleet-votes-changed"));
  return result;
}
export const getPendingVote = () =>
  call<{ poll: VotePoll | null }>({ action: "pending" });
export const dismissVoteReminder = (pollId: string) =>
  call<{ dismissed: boolean; alreadyVoted: boolean }>({
    action: "dismiss",
    pollId,
  });
export const listVotes = (cursor?: string) =>
  call<VoteList>({ action: "list", ...(cursor ? { cursor } : {}) });
export const getVote = (pollId: string) =>
  call<VoteDetail>({ action: "get", pollId });
export const getVotingEmployees = () =>
  call<{ employees: VotePerson[] }>({ action: "employees" });
export const saveVote = (
  pollId: string,
  revision: number,
  draft: VoteDraft,
  requestId: string,
) => call<VoteDetail>({ action: "save", pollId, revision, draft, requestId });
export const manageVote = (
  pollId: string,
  action:
    | "publish"
    | "close"
    | "cancel"
    | "finalize_minutes"
    | "remove_document",
  extra: Record<string, unknown> = {},
) => call<VoteDetail>({ action, pollId, ...extra });
export const castVote = (
  pollId: string,
  choices: string[],
  requestId: string,
) =>
  call<{
    recorded: boolean;
    alreadyVoted: boolean;
    receipt: { code: string; castAt: string };
  }>({ action: "cast", pollId, choices, requestId });
const mimeTypes: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
};
export async function attachVoteDocument(
  pollId: string,
  file: File,
  visibility: VoteDocument["visibility"],
  kind: VoteDocument["kind"],
) {
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  const contentType = mimeTypes[extension];
  if (!contentType || file.size === 0 || file.size > 5 * 1024 * 1024)
    throw new Error("Choisissez un PDF, Word, JPEG ou PNG de 5 Mo maximum.");
  const id = crypto.randomUUID();
  await uploadBytes(ref(storage, `votes/${pollId}/${id}/file`), file, {
    contentType,
  });
  return call<VoteDetail>({
    action: "attach_document",
    pollId,
    document: { id, name: file.name.slice(0, 180), visibility, kind },
  });
}
export async function downloadVoteDocument(pollId: string, documentId: string) {
  const result = await call<{
    name: string;
    contentType: string;
    base64: string;
  }>({ action: "download_document", pollId, documentId });
  const bytes = Uint8Array.from(atob(result.base64), (char) =>
    char.charCodeAt(0),
  );
  return {
    blob: new Blob([bytes], { type: result.contentType }),
    name: result.name,
  };
}
