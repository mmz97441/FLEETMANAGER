import { describe, expect, it } from "vitest";
import { csvCell, voteMinutesPdf, voteResultsCsv } from "./votingExport";
import { fromReunionInput, toReunionInput, votePhase } from "./voting";
import type { VoteDetail } from "../types/voting";

export const example: VoteDetail = {
  poll: {
    id: "vote-fictif",
    title: "Consultation de l’équipe",
    purpose: "Choisir les horaires.",
    question: "Quel créneau ?",
    kind: "consultation",
    privacy: "secret",
    status: "closed",
    revision: 4,
    opensAt: "2026-09-20T04:00:00.000Z",
    closesAt: "2026-09-21T04:00:00.000Z",
    closedAt: "2026-09-21T04:00:00.000Z",
    createdAt: "2026-09-19T04:00:00.000Z",
    updatedAt: "2026-09-21T04:00:00.000Z",
    participantCount: 2,
    voterCount: 2,
    options: [
      { id: "a", label: "Matin" },
      { id: "b", label: "Après-midi" },
    ],
    maxChoices: 1,
    allowBlank: true,
    quorumPercent: 50,
    documents: [],
    canManage: true,
    canViewResults: true,
    isElector: false,
    canVote: false,
    hasVoted: false,
    results: {
      eligible: 2,
      cast: 1,
      expressed: 1,
      blank: 0,
      abstentions: 1,
      turnout: 50,
      quorumRequired: 1,
      quorumMet: true,
      rows: [
        { id: "a", label: "Matin", votes: 1, percent: 100 },
        { id: "b", label: "Après-midi", votes: 0, percent: 0 },
      ],
      leaders: ["Matin"],
      tied: false,
    },
    minutes: {
      chair: "Élodie Fictive",
      secretary: "Salarié Fictif",
      place: "La Réunion",
      observations: "Résultats constatés.",
      finalizedAt: "2026-09-21T04:01:00.000Z",
      finalizedBy: "Direction fictive",
      digest: "a".repeat(64),
    },
  },
  participation: [
    {
      id: "p",
      name: '=HYPERLINK("http://invalid")',
      role: "Chauffeur",
      voted: true,
      castAt: "2026-09-20T05:00:00.000Z",
      choices: ["a"],
    },
  ],
};

describe("voting presentation and exports", () => {
  it("uses Reunion time independently of the browser timezone", () => {
    expect(fromReunionInput("2026-09-20T08:00")).toBe(
      "2026-09-20T04:00:00.000Z",
    );
    expect(toReunionInput("2026-09-19T22:00:00.000Z")).toBe("2026-09-20T02:00");
  });
  it("does not silently accept an empty date", () =>
    expect(fromReunionInput("")).toBe(""));
  it("closes the voting UI at the exact deadline", () => {
    const p = { ...example.poll, status: "published" as const };
    expect(votePhase(p, Date.parse(p.opensAt) - 1)).toBe("scheduled");
    expect(votePhase(p, Date.parse(p.opensAt))).toBe("open");
    expect(votePhase(p, Date.parse(p.closesAt))).toBe("ended");
    expect(votePhase(example.poll)).toBe("closed");
  });
  it.each([
    "=CMD()",
    "+SUM(A1)",
    "-1+1",
    "@HYPERLINK()",
    "\t=CMD()",
    "  =CMD()",
  ])("neutralizes spreadsheet formulas: %j", (value) =>
    expect(csvCell(value)).toMatch(/^"'/),
  );
  it("escapes quotes, delimiters and keeps Unicode CSV readable", () => {
    expect(csvCell('Équipe; "A"')).toBe('"Équipe; ""A"""');
    expect(voteResultsCsv(example)).toContain("Consultation de l’équipe");
    expect(voteResultsCsv(example)).toMatch(/^\uFEFF/);
  });
  it("secret exports exclude individual choices even with accidental input data", () => {
    const csv = voteResultsCsv(example);
    expect(csv).not.toContain("Choix déclarés");
    expect(csv).toContain("Participation nominative");
    expect(csv).toContain("'=HYPERLINK");
  });
  it("nominal exports explicitly include choices", () =>
    expect(
      voteResultsCsv({
        ...example,
        poll: { ...example.poll, privacy: "nominal" },
      }),
    ).toContain("Choix déclarés"));
  it("refuses exports for employees or open votes", () => {
    expect(() =>
      voteResultsCsv({
        ...example,
        poll: { ...example.poll, canManage: false },
      }),
    ).toThrow();
    expect(() =>
      voteResultsCsv({
        ...example,
        poll: { ...example.poll, status: "published" },
      }),
    ).toThrow();
  });
  it("generates a real downloadable PDF after finalization", async () => {
    const pdf = await voteMinutesPdf(example);
    expect(pdf.type).toBe("application/pdf");
    const bytes = new Uint8Array(await pdf.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(pdf.size).toBeGreaterThan(1000);
  });
  it("organizers without results access cannot export CSV or PDF", async () => {
    const secretaryView = {
      ...example,
      poll: { ...example.poll, canManage: true, canViewResults: false },
    };
    expect(() => voteResultsCsv(secretaryView)).toThrow();
    await expect(voteMinutesPdf(secretaryView)).rejects.toThrow();
  });
  it("does not manufacture minutes before their finalization", async () => {
    await expect(
      voteMinutesPdf({
        ...example,
        poll: { ...example.poll, minutes: undefined },
      }),
    ).rejects.toThrow();
  });
});
