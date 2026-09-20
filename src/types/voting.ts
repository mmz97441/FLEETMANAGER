export type VoteKind = "consultation" | "election";
export type VotePrivacy = "secret" | "nominal";
export type VoteStatus = "draft" | "published" | "closed" | "cancelled";
export interface VotePerson {
  id: string;
  name: string;
  role: string;
}
export interface VoteOption {
  id: string;
  label: string;
  employeeId?: string;
}
export interface VoteDocument {
  id: string;
  name: string;
  contentType: string;
  size: number;
  visibility: "participants" | "direction";
  kind: "attachment" | "signed_minutes";
  addedAt: string;
}
export interface VoteDraft {
  title: string;
  purpose: string;
  question: string;
  kind: VoteKind;
  privacy: VotePrivacy;
  opensAt: string;
  closesAt: string;
  participantIds: string[];
  voterIds: string[];
  options: VoteOption[];
  maxChoices: number;
  allowBlank: boolean;
  quorumPercent: number;
}
export interface VoteMinutes {
  chair: string;
  secretary: string;
  place: string;
  observations: string;
  finalizedAt: string;
  finalizedBy: string;
  digest: string;
}
export interface VoteResults {
  eligible: number;
  cast: number;
  blank: number;
  expressed: number;
  abstentions: number;
  turnout: number;
  quorumRequired: number;
  quorumMet: boolean;
  rows: { id: string; label: string; votes: number; percent: number }[];
  leaders: string[];
  tied: boolean;
}
export interface VotePoll extends Omit<
  VoteDraft,
  "participantIds" | "voterIds"
> {
  id: string;
  revision: number;
  status: VoteStatus;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  closedAt?: string;
  closureReason?: string;
  cancellationReason?: string;
  participantCount: number;
  voterCount: number;
  participantIds?: string[];
  voterIds?: string[];
  participants?: VotePerson[];
  voters?: VotePerson[];
  documents: VoteDocument[];
  canManage: boolean;
  canViewResults: boolean;
  isElector: boolean;
  canVote: boolean;
  hasVoted: boolean;
  receipt?: { code: string; castAt: string };
  results?: VoteResults;
  minutes?: VoteMinutes;
}
export interface VoteParticipation extends VotePerson {
  voted: boolean;
  castAt?: string;
  choices?: string[];
  blank?: boolean;
}
export interface VoteDetail {
  poll: VotePoll;
  participation?: VoteParticipation[];
}
export interface VoteList {
  polls: VotePoll[];
  nextCursor: string | null;
  canManage: boolean;
}
