process.env.GCLOUD_PROJECT = "demo-fleet-production-audit";
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8189";
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { createRequire } = require("node:module");
const req = createRequire(process.cwd() + "/functions/package.json");
const service = require("../functions/lib/index.js");
const { votingHandler } = require("../functions/lib/voting.js");
const db = req("firebase-admin/firestore").getFirestore();
const uid = (name) => `voting-test-${name}`;
const context = (name) =>
  name
    ? {
        auth: {
          uid: uid(name),
          token: {
            auth_time: Math.floor(Date.now() / 1000),
            email_verified: true,
          },
        },
      }
    : {};
const invoke = (action, pollId, extra = {}, who = "manager") =>
  service.employeeVoting.run({ action, pollId, ...extra }, context(who));
const denied = (operation, code = "permission-denied") =>
  assert.rejects(operation, (e) => e.code === code);
let passed = 0;
async function check(name, task) {
  await task();
  passed++;
  console.log("PASS", name);
}
async function fixture(patch = {}, publish = true) {
  const pollId = `vote-${randomUUID()}`;
  const draft = {
    title: "Vote fictif de test",
    purpose: "Choisir un créneau de réunion interne.",
    question: "Quel créneau préférez-vous ?",
    kind: "consultation",
    privacy: "secret",
    opensAt: new Date(Date.now() - 60000).toISOString(),
    closesAt: new Date(Date.now() + 3600000).toISOString(),
    participantIds: ["a", "b", "observer"].map(uid),
    voterIds: ["a", "b"].map(uid),
    options: [
      { id: "morning", label: "Matin" },
      { id: "afternoon", label: "Après-midi" },
    ],
    maxChoices: 1,
    allowBlank: true,
    quorumPercent: 50,
    ...patch,
  };
  const requestId = randomUUID();
  let result = await invoke("save", pollId, { draft, revision: 0, requestId });
  if (publish)
    result = await invoke("publish", pollId, {
      revision: result.poll.revision,
    });
  return {
    pollId,
    draft,
    requestId,
    result,
    ref: db.collection("voting_polls").doc(pollId),
    cast: (choices, who = "a", requestId = randomUUID()) =>
      invoke("cast", pollId, { choices, requestId }, who),
    close: (reason = "Fin du test") => invoke("close", pollId, { reason }),
  };
}
(async () => {
  for (const [name, role] of [
    ["manager", "Directeur Exploitation"],
    ["a", "Chauffeur"],
    ["b", "Mécanicien"],
    ["observer", "Stagiaire"],
    ["outside", "Chauffeur"],
    ["secretary", "Secrétariat"],
    ["client", "Client"],
    ["fake", "client-admin"],
    ["disabled", "Admin"],
  ]) {
    await db
      .collection("users")
      .doc(uid(name))
      .set({
        id: uid(name),
        firstName: `Fictif ${name}`,
        lastName: "Test",
        role,
        isDisabled: name === "disabled",
      });
  }
  await check("unauthenticated users cannot access voting", () =>
    denied(invoke("list", undefined, {}, null), "unauthenticated"),
  );
  await check("clients and invented admin roles are excluded", async () => {
    await denied(invoke("list", undefined, {}, "client"));
    await denied(invoke("list", undefined, {}, "fake"));
  });
  await check("disabled accounts are excluded", () =>
    denied(invoke("list", undefined, {}, "disabled")),
  );
  await check("secretariat cannot manage votes or list employees", () =>
    denied(invoke("employees", undefined, {}, "secretary")),
  );
  await check("directory excludes disabled and client accounts", async () => {
    const r = await invoke("employees");
    assert(
      !r.employees.some((p) =>
        [uid("client"), uid("disabled"), uid("fake")].includes(p.id),
      ),
    );
  });
  await check(
    "drafts and private configuration are not visible to employees",
    async () => {
      const f = await fixture({}, false);
      await denied(invoke("get", f.pollId, {}, "a"));
      const r = await invoke("list", undefined, {}, "a");
      assert(!r.polls.some((p) => p.id === f.pollId));
    },
  );
  await check(
    "employee pagination can cross a hidden draft cursor without exposing drafts",
    async () => {
      const f = await fixture({}, false),
        raw = (await f.ref.get()).data(),
        batch = db.batch(),
        prefix = randomUUID();
      for (let i = 0; i < 31; i++)
        batch.set(db.collection("voting_polls").doc(`${prefix}-${i}`), {
          ...raw,
          createdAt: new Date(Date.UTC(2099, 0, 31 - i)).toISOString(),
          status: i === 30 ? "published" : "draft",
        });
      await batch.commit();
      const first = await invoke("list", undefined, {}, "a");
      assert.equal(first.polls.length, 0);
      assert.equal(first.nextCursor, `${prefix}-29`);
      const next = await invoke(
        "list",
        undefined,
        { cursor: first.nextCursor },
        "a",
      );
      assert(next.polls.some((p) => p.id === `${prefix}-30`));
      assert(next.polls.every((p) => p.status !== "draft"));
      await denied(
        invoke("list", undefined, { cursor: first.nextCursor }, "outside"),
      );
    },
  );
  await check(
    "an election accepts a sole candidate and blank ballots",
    async () => {
      const f = await fixture({
        kind: "election",
        options: [{ id: "candidate", label: "Fictif", employeeId: uid("a") }],
      });
      await f.cast(["candidate"]);
      await f.cast([], "b");
      const result = await f.close();
      assert.equal(result.poll.results.rows[0].votes, 1);
      assert.equal(result.poll.results.blank, 1);
    },
  );
  await check(
    "draft save is idempotent without a duplicate audit",
    async () => {
      const f = await fixture({}, false);
      const r = await invoke("save", f.pollId, {
        draft: f.draft,
        revision: 0,
        requestId: f.requestId,
      });
      assert.equal(r.poll.revision, 1);
      assert.equal(
        (
          await db
            .collection("activity_logs")
            .where("targetId", "==", f.pollId)
            .get()
        ).size,
        1,
      );
    },
  );
  await check(
    "concurrent editor changes do not overwrite each other",
    async () => {
      const f = await fixture({}, false);
      const attempts = await Promise.allSettled(
        ["Version A", "Version B"].map((title) =>
          invoke("save", f.pollId, {
            draft: { ...f.draft, title },
            revision: 1,
            requestId: randomUUID(),
          }),
        ),
      );
      assert.equal(attempts.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal(
        attempts.filter(
          (r) => r.status === "rejected" && r.reason.code === "aborted",
        ).length,
        1,
      );
    },
  );
  await check(
    "voters must be participants and clients cannot be selected",
    async () => {
      await denied(
        fixture({ voterIds: [uid("outside")] }, false),
        "invalid-argument",
      );
      await denied(
        fixture(
          { participantIds: [uid("client")], voterIds: [uid("client")] },
          false,
        ),
        "failed-precondition",
      );
    },
  );
  await check(
    "candidates must be selected employees, with unique identities",
    async () => {
      await denied(
        fixture(
          {
            kind: "election",
            options: [
              { id: "x", label: "A", employeeId: uid("outside") },
              { id: "y", label: "B", employeeId: uid("a") },
            ],
          },
          false,
        ),
        "invalid-argument",
      );
    },
  );
  await check(
    "candidate names are authoritative profile snapshots",
    async () => {
      const f = await fixture({
        kind: "election",
        options: [
          { id: "x", label: "Forged name", employeeId: uid("a") },
          { id: "y", label: "Other forged name", employeeId: uid("b") },
        ],
      });
      assert.equal(f.result.poll.options[0].label, "Fictif a Test");
    },
  );
  await check(
    "publication locks electorate, dates, privacy and question",
    async () => {
      const f = await fixture();
      await denied(
        invoke("save", f.pollId, {
          draft: { ...f.draft, privacy: "nominal" },
          revision: 2,
          requestId: randomUUID(),
        }),
        "failed-precondition",
      );
    },
  );
  await check("publication rechecks disabled participants", async () => {
    const f = await fixture({}, false);
    await db.collection("users").doc(uid("b")).update({ isDisabled: true });
    await denied(
      invoke("publish", f.pollId, { revision: 1 }),
      "failed-precondition",
    );
    await db.collection("users").doc(uid("b")).update({ isDisabled: false });
  });
  await check(
    "outsiders cannot read a poll, observers can read but not vote",
    async () => {
      const f = await fixture();
      await denied(invoke("get", f.pollId, {}, "outside"));
      const r = await invoke("get", f.pollId, {}, "observer");
      assert.equal(r.poll.canVote, false);
      await denied(f.cast(["morning"], "observer"));
      assert.equal(r.poll.voterIds, undefined);
      assert.equal(r.poll.participants, undefined);
    },
  );
  await check(
    "secret ballots store no individual choices or choice fingerprint",
    async () => {
      const f = await fixture();
      await f.cast(["morning"]);
      const stored = (
        await f.ref.collection("participation").doc(uid("a")).get()
      ).data();
      assert.deepEqual(Object.keys(stored).sort(), [
        "castAt",
        "receipt",
        "requestId",
      ]);
      const r = await invoke("get", f.pollId, {}, "a");
      assert.equal(r.poll.hasVoted, true);
      assert.equal(r.poll.canVote, false);
      assert.equal(r.poll.results, undefined);
    },
  );
  await check("double tap and concurrent tabs count one ballot", async () => {
    const f = await fixture();
    const r = await Promise.all(
      Array.from({ length: 6 }, () => f.cast(["morning"])),
    );
    assert.equal(new Set(r.map((x) => x.receipt.code)).size, 1);
    const closed = await f.close();
    assert.equal(closed.poll.results.cast, 1);
    assert.equal(closed.poll.results.rows[0].votes, 1);
  });
  await check("concurrent different voters preserve both ballots", async () => {
    const f = await fixture();
    await Promise.all([f.cast(["morning"], "a"), f.cast(["afternoon"], "b")]);
    const r = await f.close();
    assert.equal(r.poll.results.cast, 2);
    assert.equal(r.poll.results.tied, true);
    assert.equal(r.poll.results.leaders.length, 2);
  });
  await check(
    "unknown choices, duplicate choices, excessive choices and forbidden blank are rejected",
    async () => {
      const f = await fixture({ allowBlank: false });
      for (const choices of [
        ["unknown"],
        ["morning", "morning"],
        ["morning", "afternoon"],
        [],
      ])
        await denied(f.cast(choices), "invalid-argument");
      assert.equal((await f.ref.collection("participation").get()).size, 0);
    },
  );
  await check(
    "before opening and after deadline no ballot can be written",
    async () => {
      const f = await fixture({
        opensAt: new Date(Date.now() + 600000).toISOString(),
      });
      const view = await invoke("get", f.pollId, {}, "a");
      assert.equal(view.poll.isElector, true);
      assert.equal(view.poll.canVote, false);
      await denied(f.cast(["morning"]), "failed-precondition");
      await f.ref.update({
        opensAt: new Date(Date.now() - 120000).toISOString(),
        closesAt: new Date(Date.now() - 1).toISOString(),
      });
      await denied(f.cast(["morning"]), "failed-precondition");
    },
  );
  await check(
    "revoked sessions and revoked voting access cannot vote",
    async () => {
      const f = await fixture();
      await db
        .collection("users")
        .doc(uid("a"))
        .update({ sessionsRevokedAt: Math.floor(Date.now() / 1000) + 5 });
      await denied(f.cast(["morning"]));
      await db
        .collection("users")
        .doc(uid("a"))
        .update({
          sessionsRevokedAt: 0,
          customPermissions: { revoked: ["votes.view"] },
        });
      await denied(f.cast(["morning"]));
      await db
        .collection("users")
        .doc(uid("a"))
        .update({ customPermissions: { revoked: [] } });
    },
  );
  await check(
    "direction cannot obtain live results or participation",
    async () => {
      const f = await fixture();
      await f.cast(["morning"]);
      const r = await invoke("get", f.pollId);
      assert.equal(r.poll.results, undefined);
      assert.equal(r.participation, undefined);
    },
  );
  await check("early closure requires a reason", async () => {
    const f = await fixture();
    await denied(f.close(""), "invalid-argument");
  });
  await check(
    "blank votes count toward turnout, not expressed votes",
    async () => {
      const f = await fixture({ quorumPercent: 100 });
      await f.cast([]);
      await f.cast(["morning"], "b");
      const r = await f.close();
      assert.deepEqual(
        [
          r.poll.results.cast,
          r.poll.results.blank,
          r.poll.results.expressed,
          r.poll.results.abstentions,
          r.poll.results.turnout,
          r.poll.results.quorumMet,
        ],
        [2, 1, 1, 0, 100, true],
      );
      assert.equal(r.poll.results.rows[0].percent, 100);
    },
  );
  await check(
    "empty poll closes without NaN and quorum is not met",
    async () => {
      const f = await fixture();
      const r = await f.close();
      assert.equal(r.poll.results.cast, 0);
      assert.equal(r.poll.results.quorumMet, false);
      assert.deepEqual(r.poll.results.leaders, []);
      assert.equal(r.poll.results.rows[0].percent, 0);
    },
  );
  await check("multiple choices are tallied per expressed ballot", async () => {
    const f = await fixture({ maxChoices: 2 });
    await f.cast(["morning", "afternoon"]);
    const r = await f.close();
    assert.equal(r.poll.results.expressed, 1);
    assert.deepEqual(
      r.poll.results.rows.map((r) => r.percent),
      [100, 100],
    );
  });
  await check(
    "secret results never expose choices in participation or employee views",
    async () => {
      const f = await fixture();
      await f.cast(["afternoon"]);
      const closed = await f.close();
      assert.equal(
        closed.participation.find((p) => p.id === uid("a")).choices,
        undefined,
      );
      const r = await invoke("get", f.pollId, {}, "a");
      assert.equal(r.poll.results, undefined);
      assert.equal(r.participation, undefined);
    },
  );
  await check(
    "nominal choices are visible to direction only after closure",
    async () => {
      const f = await fixture({ privacy: "nominal" });
      await f.cast(["afternoon"]);
      const closed = await f.close();
      assert.deepEqual(
        closed.participation.find((p) => p.id === uid("a")).choices,
        ["afternoon"],
      );
      await denied(invoke("close", f.pollId, { reason: "test" }, "a"));
    },
  );
  await check(
    "lost vote response can be recovered after closure, without replacing choice",
    async () => {
      const f = await fixture();
      const first = await f.cast(["morning"]);
      await f.close();
      const replay = await f.cast(["afternoon"]);
      assert.equal(first.receipt.code, replay.receipt.code);
      assert.equal(replay.alreadyVoted, true);
      const r = await invoke("get", f.pollId);
      assert.equal(
        r.poll.results.rows.find((x) => x.id === "afternoon").votes,
        0,
      );
    },
  );
  await check(
    "closure is stable, prevents new votes and cannot be cancelled",
    async () => {
      const f = await fixture();
      await f.cast(["morning"]);
      const first = await f.close();
      const again = await f.close();
      assert.deepEqual(first.poll.results, again.poll.results);
      await denied(f.cast(["afternoon"], "b"), "failed-precondition");
      await denied(
        invoke("cancel", f.pollId, { reason: "test" }),
        "failed-precondition",
      );
    },
  );
  await check(
    "cancellation preserves poll and refuses later ballots",
    async () => {
      const f = await fixture();
      await invoke("cancel", f.pollId, { reason: "Erreur de calendrier" });
      await denied(f.cast(["morning"]), "failed-precondition");
      assert.equal((await f.ref.get()).data().status, "cancelled");
    },
  );
  await check(
    "inconsistent counters prevent publication of results",
    async () => {
      const f = await fixture();
      await f.ref.collection("private").doc("tally").update({ votes: 1 });
      await denied(f.close(), "data-loss");
      assert.equal((await f.ref.get()).data().results, undefined);
    },
  );
  await check(
    "minutes require closure, responsible person and become immutable",
    async () => {
      const f = await fixture();
      const minutes = {
        chair: "Président fictif",
        secretary: "",
        place: "La Réunion",
        observations: "Essai de procès-verbal.",
      };
      await denied(
        invoke("finalize_minutes", f.pollId, { minutes }),
        "failed-precondition",
      );
      await f.close();
      await denied(
        invoke("finalize_minutes", f.pollId, {
          minutes: { ...minutes, chair: "" },
        }),
        "invalid-argument",
      );
      const r = await invoke("finalize_minutes", f.pollId, { minutes });
      assert.match(r.poll.minutes.digest, /^[a-f0-9]{64}$/);
      const retry = await invoke("finalize_minutes", f.pollId, {
        minutes: { ...minutes, observations: "Modification refusée" },
      });
      assert.equal(retry.poll.minutes.observations, minutes.observations);
    },
  );
  await check(
    "document registration checks membership, immutable stage and generation",
    async () => {
      const f = await fixture({}, false);
      const deps = {
        db,
        requireActiveCaller: async (c) => ({
          ...(await db.collection("users").doc(c.auth.uid).get()).data(),
          id: c.auth.uid,
        }),
        fileMetadata: async () => ({
          size: 123,
          contentType: "application/pdf",
          generation: "42",
        }),
        downloadFile: async () => Buffer.from("%PDF-test"),
      };
      const document = {
        id: "document-test",
        name: "Objet.pdf",
        kind: "attachment",
        visibility: "direction",
      };
      const attach = () =>
        votingHandler(
          { action: "attach_document", pollId: f.pollId, document },
          context("manager"),
          deps,
        );
      const r = await attach();
      assert.equal(r.poll.documents[0].generation, undefined);
      assert.equal(r.poll.documents[0].path, undefined);
      await invoke("publish", f.pollId, { revision: r.poll.revision });
      const employee = await invoke("get", f.pollId, {}, "a");
      assert.equal(employee.poll.documents.length, 0);
      await denied(
        votingHandler(
          {
            action: "download_document",
            pollId: f.pollId,
            documentId: document.id,
          },
          context("a"),
          deps,
        ),
        "not-found",
      );
      await denied(
        votingHandler(
          {
            action: "attach_document",
            pollId: f.pollId,
            document: { ...document, id: "another" },
          },
          context("manager"),
          deps,
        ),
        "failed-precondition",
      );
      await denied(
        invoke("remove_document", f.pollId, { documentId: document.id }),
        "failed-precondition",
      );
      const file = await votingHandler(
        {
          action: "download_document",
          pollId: f.pollId,
          documentId: document.id,
        },
        context("manager"),
        deps,
      );
      assert.equal(Buffer.from(file.base64, "base64").toString(), "%PDF-test");
    },
  );
  await check(
    "ten attachments leave room for signed minutes after finalization",
    async () => {
      const f = await fixture({}, false);
      const deps = {
        db,
        requireActiveCaller: async () => ({
          ...(await db.collection("users").doc(uid("manager")).get()).data(),
          id: uid("manager"),
        }),
        fileMetadata: async () => ({
          size: 123,
          contentType: "application/pdf",
          generation: "42",
        }),
      };
      const add = (id, kind = "attachment") =>
        votingHandler(
          {
            action: "attach_document",
            pollId: f.pollId,
            document: {
              id,
              name: "Document fictif.pdf",
              kind,
              visibility: "participants",
            },
          },
          context("manager"),
          deps,
        );
      let result;
      for (let i = 0; i < 10; i++) result = await add(`attachment-${i}`);
      await denied(add("overflow"), "resource-exhausted");
      await invoke("publish", f.pollId, { revision: result.poll.revision });
      await f.close();
      await denied(
        add("signed-before-finalization", "signed_minutes"),
        "failed-precondition",
      );
      await invoke("finalize_minutes", f.pollId, {
        minutes: { chair: "Direction fictive" },
      });
      for (let i = 0; i < 3; i++)
        result = await add(`signed-${i}`, "signed_minutes");
      assert.equal(result.poll.documents.length, 13);
      await denied(
        add("signed-overflow", "signed_minutes"),
        "resource-exhausted",
      );
    },
  );
  console.log("VOTING SERVER TESTS PASSED", passed);
  await db.terminate();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
