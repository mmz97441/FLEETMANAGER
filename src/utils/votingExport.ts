import type { VoteDetail } from "../types/voting";
import { voteDate } from "./voting";

// Spreadsheet applications must treat user-controlled labels as text, not formulas.
export function csvCell(value: unknown): string {
  let text = String(value ?? "");
  if (/^[\s\uFEFF]*[=+@-]|^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
export function voteResultsCsv({
  poll,
  participation = [],
}: VoteDetail): string {
  if (!poll.canManage || !poll.results || poll.status !== "closed")
    throw new Error(
      "Les résultats sont disponibles pour la direction après clôture.",
    );
  const r = poll.results;
  const rows: unknown[][] = [
    ["Scrutin", poll.title],
    ["Objet", poll.purpose],
    ["Question", poll.question],
    ["Confidentialité", poll.privacy === "secret" ? "Secret" : "Nominatif"],
    ["Début (La Réunion)", voteDate(poll.opensAt)],
    ["Fin prévue (La Réunion)", voteDate(poll.closesAt)],
    ["Clôture effective", voteDate(poll.closedAt!)],
    ["Électeurs inscrits", r.eligible],
    ["Votants", r.cast],
    ["Abstentions", r.abstentions],
    ["Votes blancs", r.blank],
    ["Bulletins exprimés", r.expressed],
    ["Participation (%)", r.turnout],
    ["Quorum requis", r.quorumRequired],
    ["Quorum atteint", r.quorumMet ? "Oui" : "Non"],
    [],
    ["Choix / candidat", "Voix", "% des bulletins exprimés"],
    ...r.rows.map((row) => [row.label, row.votes, row.percent]),
    [],
    [
      poll.maxChoices > 1
        ? "Plusieurs choix possibles : les pourcentages peuvent dépasser 100 % au total."
        : "Un seul choix par bulletin.",
    ],
    [
      r.tied
        ? "Égalité en tête : aucune désignation automatique."
        : "Les chiffres ne constituent pas une proclamation automatique.",
    ],
    [],
    ["Participation nominative — séparée des choix secrets"],
    [
      "Salarié",
      "Rôle",
      "A voté",
      "Date du vote (La Réunion)",
      ...(poll.privacy === "nominal" ? ["Choix déclarés"] : []),
    ],
    ...participation.map((p) => [
      p.name,
      p.role,
      p.voted ? "Oui" : "Non",
      p.castAt ? voteDate(p.castAt) : "",
      ...(poll.privacy === "nominal"
        ? [
            p.voted
              ? p.blank
                ? "Vote blanc"
                : (p.choices || [])
                    .map(
                      (id) =>
                        poll.options.find((o) => o.id === id)?.label || id,
                    )
                    .join(" | ")
              : "",
          ]
        : []),
    ]),
  ];
  return "\uFEFF" + rows.map((row) => row.map(csvCell).join(";")).join("\r\n");
}

export async function voteMinutesPdf({ poll }: VoteDetail): Promise<Blob> {
  if (
    !poll.canManage ||
    !poll.results ||
    !poll.minutes ||
    poll.status !== "closed"
  )
    throw new Error(
      "Finalisez le procès-verbal après clôture pour le télécharger.",
    );
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({
    unit: "mm",
    format: "a4",
    compress: true,
    putOnlyUsedFonts: true,
  });
  const r = poll.results,
    m = poll.minutes;
  pdf.setProperties({
    title: `Procès-verbal — ${poll.title}`,
    subject: "Scrutin interne",
    creator: "Delivrex",
  });
  pdf.setCreationDate(new Date(m.finalizedAt));
  let y = 22;
  const line = (value: string, size = 10, bold = false) => {
    pdf.setFont("helvetica", bold ? "bold" : "normal");
    pdf.setFontSize(size);
    const lines: string[] = pdf.splitTextToSize(
      value.replace(/[\u0000-\u0008]/g, ""),
      174,
    );
    for (const text of lines) {
      if (y > 273) {
        pdf.addPage();
        y = 22;
      }
      pdf.text(text, 18, y);
      y += size * 0.46 + 1;
    }
    y += 1.3;
  };
  line("PROCÈS-VERBAL DE SCRUTIN INTERNE", 17, true);
  line(poll.title, 14, true);
  line(`Référence : ${poll.id}`);
  line(
    `Nature : ${poll.kind === "election" ? "Élection interne simple" : "Consultation interne"} — Vote ${poll.privacy === "secret" ? "secret" : "nominatif"}`,
  );
  line("Objet du vote", 12, true);
  line(poll.purpose);
  line("Question soumise aux électeurs", 12, true);
  line(poll.question);
  line("Organisation et règles", 12, true);
  line(
    `Ouverture : ${voteDate(poll.opensAt)} — Fin prévue : ${voteDate(poll.closesAt)} (La Réunion)`,
  );
  line(`Clôture effective : ${voteDate(poll.closedAt!)} (La Réunion)`);
  if (poll.closureReason) line(`Motif de clôture : ${poll.closureReason}`);
  line(
    `Électeurs : ${r.eligible} — Maximum de choix : ${poll.maxChoices} — Vote blanc ${poll.allowBlank ? "autorisé" : "non autorisé"}`,
  );
  line(`Présidence du scrutin : ${m.chair}`);
  if (m.secretary) line(`Secrétaire : ${m.secretary}`);
  if (m.place) line(`Lieu : ${m.place}`);
  line("Participation et dépouillement", 12, true);
  line(`Votants : ${r.cast} (${r.turnout} %) — Abstentions : ${r.abstentions}`);
  line(`Votes blancs : ${r.blank} — Bulletins exprimés : ${r.expressed}`);
  line(
    `Quorum : ${poll.quorumPercent} %, soit ${r.quorumRequired} votant(s) — ${r.quorumMet ? "atteint" : "non atteint"}`,
  );
  for (const row of r.rows)
    line(
      `${row.label} : ${row.votes} voix — ${row.percent} % des bulletins exprimés`,
    );
  if (poll.maxChoices > 1)
    line(
      "Plusieurs choix étaient possibles ; la somme des pourcentages peut dépasser 100 %.",
    );
  if (!r.expressed) line("Aucun bulletin exprimé.");
  else if (r.tied)
    line(
      `Égalité en tête : ${r.leaders.join(", ")}. Aucun départage automatique.`,
    );
  else line(`Choix arrivé en tête : ${r.leaders[0]}.`);
  line("Observations et décision du bureau", 12, true);
  line(m.observations || "Aucune observation ajoutée.");
  line("Documents joints", 12, true);
  const attachments = poll.documents.filter((d) => d.kind === "attachment");
  line(
    attachments.length
      ? attachments.map((d) => d.name).join("\n")
      : "Aucun document joint au scrutin.",
  );
  const signatureBlock: [string, number, boolean][] = [
    ["Signatures", 12, true],
    [`Présidence : ${m.chair} — Signature : ____________________`, 10, false],
    [
      `Secrétariat : ${m.secretary || "____________________"} — Signature : ____________________`,
      10,
      false,
    ],
    [
      `PV finalisé le ${voteDate(m.finalizedAt)} par ${m.finalizedBy}.`,
      10,
      false,
    ],
    [
      "La finalisation fige le document ; les signatures ci-dessus restent à apposer.",
      9,
      false,
    ],
    [`Empreinte du contenu enregistré : ${m.digest}`, 8, false],
  ];
  const signatureHeight = signatureBlock.reduce(
    (height, [value, size, bold]) => {
      pdf.setFont("helvetica", bold ? "bold" : "normal");
      pdf.setFontSize(size);
      return (
        height +
        pdf.splitTextToSize(value, 174).length * (size * 0.46 + 1) +
        1.3
      );
    },
    0,
  );
  if (y + signatureHeight > 273) {
    pdf.addPage();
    y = 22;
  }
  signatureBlock.forEach(([value, size, bold]) => line(value, size, bold));
  const pages = pdf.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    pdf.setPage(page);
    pdf.setFontSize(8);
    pdf.setTextColor(80);
    pdf.text(`Delivrex — Scrutin interne — ${page} / ${pages}`, 18, 289);
  }
  return pdf.output("blob");
}
