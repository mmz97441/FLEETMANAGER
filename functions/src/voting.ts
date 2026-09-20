import type { Firestore, Transaction } from "firebase-admin/firestore";
import * as functions from "firebase-functions/v1";
import { createHash, randomUUID } from "crypto";

interface Dependencies {
  db: Firestore;
  requireActiveCaller: (
    context: functions.https.CallableContext,
  ) => Promise<any>;
  now?: () => Date;
  fileMetadata?: (
    path: string,
  ) => Promise<{ size: number; contentType: string; generation: string }>;
  downloadFile?: (path: string, generation: string) => Promise<Buffer>;
}
const COLLECTION = "voting_polls";
const internal = new Set([
  "admin",
  "administrateur",
  "administratrice",
  "president",
  "presidente",
  "directeur",
  "directrice",
  "direction",
  "directeur exploitation",
  "directrice exploitation",
  "secretariat",
  "secretaire",
  "chauffeur",
  "chauffeuse",
  "mecanicien",
  "mecanicienne",
  "stagiaire",
]);
const direction = new Set([
  "admin",
  "administrateur",
  "administratrice",
  "president",
  "presidente",
  "directeur",
  "directrice",
  "direction",
  "directeur exploitation",
  "directrice exploitation",
]);
const organizers = new Set([...direction, "secretariat", "secretaire"]);
const normalize = (v: unknown) =>
  String(v || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
const fail = (
  code: functions.https.FunctionsErrorCode,
  message: string,
): never => {
  throw new functions.https.HttpsError(code, message);
};
const id = (v: unknown): v is string =>
  typeof v === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(v);
const operationId = (v: unknown): v is string =>
  typeof v === "string" && /^[a-zA-Z0-9-]{16,80}$/.test(v);
const text = (v: unknown, limit: number, required = false): string => {
  if (
    typeof v !== "string" ||
    v.trim().length > limit ||
    (required && !v.trim()) ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v)
  )
    fail(
      "invalid-argument",
      "Un champ est manquant, trop long ou contient des caractères invalides.",
    );
  return (v as string).trim();
};
const ids = (v: unknown, required = true): string[] => {
  if (
    !Array.isArray(v) ||
    v.length > 500 ||
    (required && !v.length) ||
    v.some((x) => !id(x)) ||
    new Set(v).size !== v.length
  )
    fail(
      "invalid-argument",
      "Sélection de salariés invalide (500 maximum, sans doublon).",
    );
  return [...(v as string[])].sort();
};
const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
const person = (uid: string, value: any) => ({
  id: uid,
  name: `${value.firstName || ""} ${value.lastName || ""}`.trim() || "Salarié",
  role: String(value.role),
});
const eligibleProfile = (profile: any) =>
  !!profile &&
  !profile.isDisabled &&
  internal.has(normalize(profile.role)) &&
  !(profile.customPermissions?.revoked || []).includes("votes.view");
export const canManageVotes = (caller: any): boolean =>
  organizers.has(normalize(caller.role)) &&
  !(caller.customPermissions?.revoked || []).includes("votes.manage");
const types = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/png",
  "image/jpeg",
]);

function draft(value: any) {
  if (
    !value ||
    !["consultation", "election"].includes(value.kind) ||
    !["secret", "nominal"].includes(value.privacy)
  )
    fail("invalid-argument", "Type de scrutin invalide.");
  const participantIds = ids(value.participantIds),
    voterIds = ids(value.voterIds);
  if (voterIds.some((x) => !participantIds.includes(x)))
    fail(
      "invalid-argument",
      "Chaque électeur doit faire partie des participants.",
    );
  if (
    !Array.isArray(value.options) ||
    value.options.length < (value.kind === "election" ? 1 : 2) ||
    value.options.length > 50
  )
    fail(
      "invalid-argument",
      "Prévoyez au moins deux choix ou un candidat, et 50 maximum.",
    );
  const options = value.options.map((option: any) => {
    if (!id(option?.id))
      fail("invalid-argument", "Identifiant de choix invalide.");
    if (
      value.kind === "election" &&
      (!id(option.employeeId) || !participantIds.includes(option.employeeId))
    )
      fail(
        "invalid-argument",
        "Les candidats doivent être des participants sélectionnés.",
      );
    return {
      id: option.id,
      label: text(option.label, 160, true),
      ...(value.kind === "election" ? { employeeId: option.employeeId } : {}),
    };
  });
  if (
    new Set(options.map((o: any) => o.id)).size !== options.length ||
    (value.kind === "consultation" &&
      new Set(options.map((o: any) => normalize(o.label))).size !==
        options.length) ||
    (value.kind === "election" &&
      new Set(options.map((o: any) => o.employeeId)).size !== options.length)
  )
    fail("invalid-argument", "Les choix et candidats doivent être distincts.");
  const opensAt = text(value.opensAt, 40, true),
    closesAt = text(value.closesAt, 40, true);
  if (
    !Number.isFinite(Date.parse(opensAt)) ||
    !Number.isFinite(Date.parse(closesAt)) ||
    Date.parse(closesAt) <= Date.parse(opensAt)
  )
    fail("invalid-argument", "La fin du vote doit être postérieure au début.");
  if (
    !Number.isInteger(value.maxChoices) ||
    value.maxChoices < 1 ||
    value.maxChoices > options.length ||
    typeof value.allowBlank !== "boolean" ||
    !Number.isInteger(value.quorumPercent) ||
    value.quorumPercent < 0 ||
    value.quorumPercent > 100
  )
    fail("invalid-argument", "Règles du vote invalides.");
  return {
    title: text(value.title, 160, true),
    purpose: text(value.purpose, 5000, true),
    question: text(value.question, 1000, true),
    kind: value.kind,
    privacy: value.privacy,
    opensAt: new Date(opensAt).toISOString(),
    closesAt: new Date(closesAt).toISOString(),
    participantIds,
    voterIds,
    options,
    maxChoices: value.maxChoices,
    allowBlank: value.allowBlank,
    quorumPercent: value.quorumPercent,
  };
}

export async function votingHandler(
  data: any,
  context: functions.https.CallableContext,
  deps: Dependencies,
): Promise<any> {
  const caller = await deps.requireActiveCaller(context);
  if (
    !internal.has(normalize(caller.role)) ||
    (caller.customPermissions?.revoked || []).includes("votes.view")
  )
    fail(
      "permission-denied",
      "Les votes sont réservés aux salariés autorisés.",
    );
  const manager = canManageVotes(caller),
    canViewResults = manager && direction.has(normalize(caller.role)),
    { db } = deps;
  const now = () => (deps.now || (() => new Date()))().toISOString();
  const requireManager = () => {
    if (!manager)
      fail(
        "permission-denied",
        "Gestion des scrutins réservée à la direction et au secrétariat.",
      );
  };
  const requireResultsAccess = () => {
    if (!canViewResults)
      fail(
        "permission-denied",
        "Résultats et procès-verbaux réservés à la direction.",
      );
  };
  const mayReadDocument = (p: any, d: any) =>
    canViewResults ||
    (d.visibility === "participants" &&
      (d.kind === "attachment" || p.participantIds.includes(caller.id)));
  const mayRead = (p: any) =>
    manager || (p.status !== "draft" && p.participantIds.includes(caller.id));
  const visible = (p: any, uid: string, participation?: any) => {
    const {
      participants,
      voters,
      participantIds,
      voterIds,
      lastMutationId,
      lastMutationHash,
      results,
      minutes,
      ...rest
    } = p;
    return {
      ...rest,
      id: uid,
      documents: (p.documents || [])
        .filter((d: any) => mayReadDocument(p, d))
        .map(({ path, generation, ...d }: any) => d),
      participantCount: participantIds.length,
      voterCount: voterIds.length,
      canManage: manager,
      canViewResults,
      isElector: voterIds.includes(caller.id),
      canVote:
        voterIds.includes(caller.id) &&
        p.status === "published" &&
        now() >= p.opensAt &&
        now() < p.closesAt &&
        !participation,
      hasVoted: !!participation,
      ...(participation
        ? {
            receipt: {
              code: participation.receipt,
              castAt: participation.castAt,
            },
          }
        : {}),
      ...(manager
        ? {
            participantIds,
            voterIds,
            participants,
            voters,
          }
        : {}),
      ...(canViewResults
        ? { ...(results ? { results } : {}), ...(minutes ? { minutes } : {}) }
        : {}),
    };
  };
  const audit = (
    tx: Transaction,
    pollId: string,
    action: string,
    description: string,
  ) =>
    tx.create(db.collection("activity_logs").doc(), {
      userId: caller.id,
      userName: person(caller.id, caller).name,
      userRole: caller.role,
      action,
      category: "Votes",
      targetType: "vote",
      targetId: pollId,
      description,
      outcome: "success",
      createdAt: now(),
    });
  if (data?.action === "employees") {
    requireManager();
    const users = await db.collection("users").get();
    return {
      employees: users.docs
        .filter((s) => eligibleProfile(s.data()))
        .map((s) => person(s.id, s.data()))
        .sort((a, b) => a.name.localeCompare(b.name, "fr")),
    };
  }
  if (data?.action === "list") {
    let query = manager
      ? db.collection(COLLECTION).orderBy("createdAt", "desc")
      : db
          .collection(COLLECTION)
          .where("participantIds", "array-contains", caller.id)
          .orderBy("createdAt", "desc");
    if (data.cursor) {
      if (!id(data.cursor)) fail("invalid-argument", "Page invalide.");
      const cursor = await db.collection(COLLECTION).doc(data.cursor).get();
      // A page can end on a hidden draft. Only membership is needed to use its
      // cursor; the following page still redacts every unpublished document.
      if (
        !cursor.exists ||
        (!manager && !cursor.data()!.participantIds.includes(caller.id))
      )
        fail("permission-denied", "Page indisponible.");
      query = query.startAfter(cursor);
    }
    const docs = await query.limit(31).get(),
      page = docs.docs.slice(0, 30);
    const polls = await Promise.all(
      page
        .filter((s) => mayRead(s.data()))
        .map(async (s) =>
          visible(
            s.data(),
            s.id,
            (
              await s.ref.collection("participation").doc(caller.id).get()
            ).data(),
          ),
        ),
    );
    return {
      polls,
      nextCursor: docs.size > 30 ? page[page.length - 1].id : null,
      canManage: manager,
    };
  }
  if (!id(data?.pollId)) fail("invalid-argument", "Scrutin invalide.");
  const ref = db.collection(COLLECTION).doc(data.pollId),
    tallyRef = ref.collection("private").doc("tally");
  if (data.action === "save") {
    requireManager();
    const value = draft(data.draft);
    if (!operationId(data.requestId) || !Number.isInteger(data.revision))
      fail("invalid-argument", "Référence d’enregistrement invalide.");
    await db.runTransaction(async (tx) => {
      const previous = await tx.get(ref),
        old = previous.data();
      if (old?.lastMutationId === data.requestId) {
        if (old!.lastMutationHash !== hash(value))
          fail(
            "invalid-argument",
            "Cette référence a déjà servi à un autre enregistrement.",
          );
        return;
      }
      if (old && old.status !== "draft")
        fail(
          "failed-precondition",
          "Les règles sont figées après publication.",
        );
      if ((old?.revision || 0) !== data.revision)
        fail(
          "aborted",
          "Ce scrutin a été modifié ailleurs. Rechargez-le avant de reprendre vos modifications.",
        );
      const users = await tx.getAll(
        ...value.participantIds.map((uid) => db.collection("users").doc(uid)),
      );
      if (users.some((s) => !eligibleProfile(s.data())))
        fail(
          "failed-precondition",
          "Un participant n’a plus accès au vote. Actualisez la sélection.",
        );
      const participants = users.map((s) => person(s.id, s.data()));
      const options = value.options.map((o: any) =>
        value.kind === "election"
          ? {
              ...o,
              label: participants.find((p) => p.id === o.employeeId)!.name,
            }
          : o,
      );
      tx.set(ref, {
        ...value,
        options,
        participants,
        voters: participants.filter((p) => value.voterIds.includes(p.id)),
        status: "draft",
        documents: old?.documents || [],
        revision: (old?.revision || 0) + 1,
        createdAt: old?.createdAt || now(),
        createdBy: old?.createdBy || caller.id,
        updatedAt: now(),
        lastMutationId: data.requestId,
        lastMutationHash: hash(value),
      });
      audit(
        tx,
        ref.id,
        previous.exists ? "VOTE_UPDATED" : "VOTE_CREATED",
        `Scrutin ${previous.exists ? "modifié" : "créé"} : ${value.title}`,
      );
    });
  } else if (data.action === "publish") {
    requireManager();
    await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref),
        p = snapshot.data();
      if (!p) fail("not-found", "Scrutin introuvable.");
      if (p!.status === "published") return;
      if (p!.status !== "draft" || p!.revision !== data.revision)
        fail(
          "failed-precondition",
          "Rechargez le brouillon avant publication.",
        );
      if (p!.closesAt <= now())
        fail(
          "failed-precondition",
          "La date de fin est passée. Modifiez le calendrier.",
        );
      const users = await tx.getAll(
        ...p!.participantIds.map((uid: string) =>
          db.collection("users").doc(uid),
        ),
      );
      if (users.some((s) => !eligibleProfile(s.data())))
        fail(
          "failed-precondition",
          "Actualisez les participants avant publication.",
        );
      tx.create(tallyRef, {
        votes: 0,
        blank: 0,
        counts: Object.fromEntries(p!.options.map((o: any) => [o.id, 0])),
      });
      tx.update(ref, {
        status: "published",
        publishedAt: now(),
        updatedAt: now(),
        revision: p!.revision + 1,
      });
      audit(
        tx,
        ref.id,
        "VOTE_PUBLISHED",
        `Scrutin ouvert aux participants : ${p!.title}`,
      );
    });
  } else if (data.action === "cast") {
    if (
      !operationId(data.requestId) ||
      !Array.isArray(data.choices) ||
      data.choices.some((x: any) => !id(x)) ||
      data.choices.length > 50 ||
      new Set(data.choices).size !== data.choices.length
    )
      fail("invalid-argument", "Bulletin invalide.");
    return db.runTransaction(async (tx) => {
      const [snapshot, participated, tally, profile] = await Promise.all([
        tx.get(ref),
        tx.get(ref.collection("participation").doc(caller.id)),
        tx.get(tallyRef),
        tx.get(db.collection("users").doc(caller.id)),
      ]);
      const p = snapshot.data(),
        fresh = profile.data();
      if (!p || !p.voterIds.includes(caller.id))
        fail(
          "permission-denied",
          "Vous ne faites pas partie des électeurs de ce scrutin.",
        );
      if (
        !eligibleProfile(fresh) ||
        (fresh?.sessionsRevokedAt &&
          Number(context.auth?.token.auth_time || 0) <= fresh.sessionsRevokedAt)
      )
        fail("permission-denied", "Votre compte ne peut plus voter.");
      // A lost response is recoverable even after closure. Never replace a recorded ballot.
      if (participated.exists)
        return {
          recorded: true,
          alreadyVoted: true,
          receipt: {
            code: participated.data()!.receipt,
            castAt: participated.data()!.castAt,
          },
        };
      const instant = now();
      if (
        p!.status !== "published" ||
        instant < p!.opensAt ||
        instant >= p!.closesAt
      )
        fail(
          "failed-precondition",
          "Le vote n’est pas ouvert. Aucun bulletin n’a été enregistré.",
        );
      if (
        (!data.choices.length && !p!.allowBlank) ||
        data.choices.length > p!.maxChoices ||
        data.choices.some(
          (x: string) => !p!.options.some((o: any) => o.id === x),
        )
      )
        fail(
          "invalid-argument",
          "Choisissez uniquement les réponses autorisées pour ce scrutin.",
        );
      if (!tally.exists)
        fail("internal", "Urne indisponible. Aucun vote enregistré.");
      const counts = { ...tally.data()!.counts };
      for (const choice of data.choices) counts[choice]++;
      const receipt = randomUUID();
      // Secret votes retain only aggregate counters. No ballot/identity link or choice hash is stored.
      tx.create(participated.ref, {
        receipt,
        castAt: instant,
        requestId: data.requestId,
        ...(p!.privacy === "nominal"
          ? { choices: data.choices, blank: data.choices.length === 0 }
          : {}),
      });
      tx.update(tallyRef, {
        counts,
        votes: tally.data()!.votes + 1,
        blank: tally.data()!.blank + (data.choices.length ? 0 : 1),
      });
      return {
        recorded: true,
        alreadyVoted: false,
        receipt: { code: receipt, castAt: instant },
      };
    });
  } else if (data.action === "close") {
    requireManager();
    await db.runTransaction(async (tx) => {
      const [snapshot, tally, participation] = await Promise.all([
        tx.get(ref),
        tx.get(tallyRef),
        tx.get(ref.collection("participation")),
      ]);
      const p = snapshot.data(),
        t = tally.data();
      if (!p) fail("not-found", "Scrutin introuvable.");
      if (p!.status === "closed") return;
      if (p!.status !== "published")
        fail(
          "failed-precondition",
          "Seul un scrutin publié peut être clôturé.",
        );
      const closureReason = text(data.reason || "", 1000, now() < p!.closesAt);
      if (!t || t.votes !== participation.size || t.votes > p!.voterIds.length)
        fail(
          "data-loss",
          "Le contrôle de cohérence de l’urne a échoué. Aucun résultat publié ; contactez le responsable technique.",
        );
      const expressed = t!.votes - t!.blank;
      const rows = p!.options
        .map((o: any) => ({
          id: o.id,
          label: o.label,
          votes: t!.counts[o.id],
          percent: expressed
            ? Math.round((t!.counts[o.id] / expressed) * 10000) / 100
            : 0,
        }))
        .sort(
          (a: any, b: any) =>
            b.votes - a.votes || a.label.localeCompare(b.label, "fr"),
        );
      const sum = rows.reduce((n: number, row: any) => n + row.votes, 0);
      if (
        t!.blank < 0 ||
        expressed < 0 ||
        rows.some(
          (r: any) =>
            !Number.isInteger(r.votes) || r.votes < 0 || r.votes > expressed,
        ) ||
        sum < expressed ||
        sum > expressed * p!.maxChoices
      )
        fail(
          "data-loss",
          "Comptage incohérent. Contactez votre responsable technique.",
        );
      const leaders = expressed
        ? rows
            .filter((row: any) => row.votes === rows[0].votes)
            .map((row: any) => row.label)
        : [];
      const eligible = p!.voterIds.length,
        quorumRequired = Math.ceil((eligible * p!.quorumPercent) / 100);
      const results = {
        eligible,
        cast: t!.votes,
        blank: t!.blank,
        expressed,
        abstentions: eligible - t!.votes,
        turnout: Math.round((t!.votes / eligible) * 10000) / 100,
        quorumRequired,
        quorumMet: t!.votes >= quorumRequired,
        rows,
        leaders,
        tied: leaders.length > 1,
      };
      tx.update(ref, {
        status: "closed",
        closedAt: now(),
        closureReason,
        results,
        updatedAt: now(),
        revision: p!.revision + 1,
      });
      audit(
        tx,
        ref.id,
        "VOTE_CLOSED",
        `Scrutin clôturé et résultats figés : ${p!.title}`,
      );
    });
  } else if (data.action === "cancel") {
    requireManager();
    const reason = text(data.reason, 1000, true);
    await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref),
        p = snapshot.data();
      if (!p) fail("not-found", "Scrutin introuvable.");
      if (p!.status === "cancelled") return;
      if (p!.status === "closed")
        fail(
          "failed-precondition",
          "Un résultat clôturé ne peut plus être annulé.",
        );
      tx.update(ref, {
        status: "cancelled",
        cancellationReason: reason,
        updatedAt: now(),
        revision: p!.revision + 1,
      });
      audit(
        tx,
        ref.id,
        "VOTE_CANCELLED",
        `Scrutin annulé : ${p!.title} — ${reason}`,
      );
    });
  } else if (data.action === "finalize_minutes") {
    requireResultsAccess();
    const value = {
      chair: text(data.minutes?.chair, 160, true),
      secretary: text(data.minutes?.secretary || "", 160),
      place: text(data.minutes?.place || "", 250),
      observations: text(data.minutes?.observations || "", 5000),
    };
    await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref),
        p = snapshot.data();
      if (!p || p.status !== "closed")
        fail(
          "failed-precondition",
          "Clôturez le scrutin avant de finaliser le procès-verbal.",
        );
      if (p!.minutes) return;
      const finalizedAt = now();
      const digest = hash({
        pollId: ref.id,
        title: p!.title,
        purpose: p!.purpose,
        question: p!.question,
        kind: p!.kind,
        privacy: p!.privacy,
        opensAt: p!.opensAt,
        closesAt: p!.closesAt,
        closedAt: p!.closedAt,
        closureReason: p!.closureReason,
        maxChoices: p!.maxChoices,
        allowBlank: p!.allowBlank,
        quorumPercent: p!.quorumPercent,
        voters: p!.voters,
        options: p!.options,
        documents: p!.documents.filter((d: any) => d.kind === "attachment"),
        results: p!.results,
        ...value,
        finalizedAt,
      });
      tx.update(ref, {
        minutes: {
          ...value,
          finalizedAt,
          finalizedBy: person(caller.id, caller).name,
          digest,
        },
        updatedAt: finalizedAt,
        revision: p!.revision + 1,
      });
      audit(
        tx,
        ref.id,
        "VOTE_MINUTES_FINALIZED",
        `Procès-verbal finalisé : ${p!.title}`,
      );
    });
  } else if (data.action === "attach_document") {
    requireManager();
    const d = data.document;
    if (
      !id(d?.id) ||
      !["attachment", "signed_minutes"].includes(d?.kind) ||
      !["participants", "direction"].includes(d?.visibility)
    )
      fail("invalid-argument", "Document invalide.");
    if (d.kind === "signed_minutes" || d.visibility === "direction")
      requireResultsAccess();
    const name = text(d.name, 180, true),
      path = `votes/${ref.id}/${d.id}/file`;
    if (!deps.fileMetadata) fail("internal", "Stockage indisponible.");
    const meta = await deps.fileMetadata!(path);
    if (
      !types.has(meta.contentType) ||
      meta.size <= 0 ||
      meta.size > 5 * 1024 * 1024
    )
      fail(
        "invalid-argument",
        "Document PDF, Word, JPEG ou PNG de 5 Mo maximum attendu.",
      );
    await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref),
        p = snapshot.data();
      if (!p) fail("not-found", "Scrutin introuvable.");
      const old = (p!.documents || []).find((x: any) => x.id === d.id);
      if (old) {
        if (old.generation !== meta.generation)
          fail("failed-precondition", "Le fichier a changé.");
        return;
      }
      if (
        !(
          (p!.status === "draft" && d.kind === "attachment") ||
          (p!.status === "closed" && d.kind === "signed_minutes" && p!.minutes)
        )
      )
        fail(
          "failed-precondition",
          "Les documents du scrutin sont figés à la publication. Le PV signé peut être ajouté après finalisation.",
        );
      if (
        (p!.documents || []).filter((x: any) => x.kind === d.kind).length >=
        (d.kind === "attachment" ? 10 : 3)
      )
        fail(
          "resource-exhausted",
          "Dix pièces jointes et trois exemplaires signés maximum par scrutin.",
        );
      tx.update(ref, {
        documents: [
          ...(p!.documents || []),
          {
            id: d.id,
            name,
            path,
            generation: meta.generation,
            size: meta.size,
            contentType: meta.contentType,
            kind: d.kind,
            visibility: d.visibility,
            addedAt: now(),
          },
        ],
        updatedAt: now(),
        revision: p!.revision + 1,
      });
      audit(
        tx,
        ref.id,
        "VOTE_DOCUMENT_ADDED",
        `Document ajouté au scrutin : ${p!.title}`,
      );
    });
  } else if (data.action === "remove_document") {
    requireManager();
    if (!id(data.documentId)) fail("invalid-argument", "Document invalide.");
    await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref),
        p = snapshot.data();
      if (!p || p.status !== "draft")
        fail(
          "failed-precondition",
          "Les documents sont figés après publication.",
        );
      const document = p!.documents.find((d: any) => d.id === data.documentId);
      if (!document) return;
      if (document.visibility === "direction") requireResultsAccess();
      tx.update(ref, {
        documents: p!.documents.filter((d: any) => d.id !== data.documentId),
        revision: p!.revision + 1,
        updatedAt: now(),
      });
      audit(
        tx,
        ref.id,
        "VOTE_DOCUMENT_REMOVED",
        `Document retiré du brouillon : ${p!.title}`,
      );
    });
  } else if (!["get", "download_document"].includes(data.action))
    fail("invalid-argument", "Action inconnue.");

  const snapshot = await ref.get(),
    p = snapshot.data();
  if (!p || !mayRead(p))
    fail("permission-denied", "Ce scrutin ne vous est pas accessible.");
  if (data.action === "download_document") {
    const document = (p!.documents || []).find(
      (d: any) => d.id === data.documentId && mayReadDocument(p, d),
    );
    if (!document) fail("not-found", "Document indisponible.");
    if (!deps.downloadFile) fail("internal", "Stockage indisponible.");
    const buffer = await deps.downloadFile!(document.path, document.generation);
    if (buffer.length > 5 * 1024 * 1024)
      fail("resource-exhausted", "Document trop volumineux.");
    return {
      name: document.name,
      contentType: document.contentType,
      base64: buffer.toString("base64"),
    };
  }
  const mine = (
    await ref.collection("participation").doc(caller.id).get()
  ).data();
  const response: any = { poll: visible(p, ref.id, mine) };
  // No live turnout or individual choices: small groups must not reveal votes incrementally.
  if (canViewResults && p!.status === "closed") {
    const participation = await ref.collection("participation").get(),
      byId = new Map(participation.docs.map((s) => [s.id, s.data()]));
    response.participation = p!.voters.map((v: any) => {
      const entry = byId.get(v.id);
      return {
        ...v,
        voted: !!entry,
        ...(entry
          ? {
              castAt: entry.castAt,
              ...(p!.privacy === "nominal"
                ? { choices: entry.choices, blank: entry.blank }
                : {}),
            }
          : {}),
      };
    });
  }
  return response;
}
