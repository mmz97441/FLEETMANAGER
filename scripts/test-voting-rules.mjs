import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing";
import { readFile } from "node:fs/promises";
import { doc, setDoc, getDoc } from "firebase/firestore";
import { ref, uploadBytes, getMetadata } from "firebase/storage";
const env = await initializeTestEnvironment({
  projectId: "demo-fleet-production-audit",
  firestore: {
    host: "127.0.0.1",
    port: 8189,
    rules: await readFile("firestore.rules", "utf8"),
  },
  storage: {
    host: "127.0.0.1",
    port: 9199,
    rules: await readFile("storage.rules", "utf8"),
  },
});
let passed = 0;
const check = async (name, expectation, operation) => {
  await expectation(operation());
  passed++;
  console.log("PASS", name);
};
const prefix = `vr-${Date.now()}`;
try {
  await env.withSecurityRulesDisabled(async (ctx) => {
    for (const [who, role] of [
      ["manager", "Directeur Exploitation"],
      ["driver", "Chauffeur"],
      ["client", "Client"],
      ["secretary", "Secrétariat"],
      ["revoked", "Admin"],
    ]) {
      await setDoc(doc(ctx.firestore(), "users", `${prefix}-${who}`), {
        role,
        isDisabled: false,
        customPermissions: {
          revoked: who === "revoked" ? ["votes.manage"] : [],
        },
      });
    }
    for (const status of ["draft", "published", "closed"])
      await setDoc(
        doc(ctx.firestore(), "voting_polls", `${prefix}-${status}`),
        { status, participantIds: [`${prefix}-driver`] },
      );
    await setDoc(
      doc(
        ctx.firestore(),
        "voting_polls",
        `${prefix}-closed`,
        "private",
        "tally",
      ),
      { votes: 1, counts: { choice: 1 } },
    );
  });
  const context = (who) =>
    who
      ? env.authenticatedContext(`${prefix}-${who}`)
      : env.unauthenticatedContext();
  const put = (
    who,
    status = "draft",
    name = `${who}-file`,
    contentType = "application/pdf",
    size = 3,
  ) =>
    uploadBytes(
      ref(context(who).storage(), `votes/${prefix}-${status}/${name}/file`),
      new Uint8Array(size),
      { contentType },
    );
  await check("direction uploads a draft document", assertSucceeds, () =>
    put("manager"),
  );
  await check("document cannot be overwritten", assertFails, () =>
    put("manager"),
  );
  await check("published attachments are immutable", assertFails, () =>
    put("manager", "published"),
  );
  await check(
    "direction can upload a signed document after closure",
    assertSucceeds,
    () => put("manager", "closed"),
  );
  await check(
    "secretariat can upload briefing documents to drafts",
    assertSucceeds,
    () => put("secretary"),
  );
  await check(
    "secretariat cannot overwrite a briefing document",
    assertFails,
    () => put("secretary"),
  );
  await check(
    "secretariat cannot alter documents after publication",
    assertFails,
    () => put("secretary", "published"),
  );
  await check(
    "secretariat cannot upload a signed PV after closure",
    assertFails,
    () => put("secretary", "closed"),
  );
  await check("HTML is refused", assertFails, () =>
    put("manager", "draft", "html", "text/html"),
  );
  await check("empty file is refused", assertFails, () =>
    put("manager", "draft", "empty", "application/pdf", 0),
  );
  await check("oversized file is refused", assertFails, () =>
    put("manager", "draft", "large", "application/pdf", 5 * 1024 * 1024 + 1),
  );
  for (const who of ["driver", "client", "revoked", null])
    await check(
      `${who || "anonymous"} cannot upload voting documents`,
      assertFails,
      () => put(who),
    );
  await check(
    "direct Storage read cannot issue a public download token",
    assertFails,
    () =>
      getMetadata(
        ref(
          context("manager").storage(),
          `votes/${prefix}-draft/manager-file/file`,
        ),
      ),
  );
  for (const who of ["manager", "secretary", "driver", "client", null]) {
    await check(
      `${who || "anonymous"} cannot forge or read reminder dismissals`,
      assertFails,
      () =>
        setDoc(
          doc(
            context(who).firestore(),
            "voting_polls",
            `${prefix}-closed`,
            "reminders",
            "forged",
          ),
          { dismissedAt: new Date().toISOString() },
        ),
    );
    await check(
      `${who || "anonymous"} cannot read reminder dismissals`,
      assertFails,
      () =>
        getDoc(
          doc(
            context(who).firestore(),
            "voting_polls",
            `${prefix}-closed`,
            "reminders",
            "forged",
          ),
        ),
    );
    await check(
      `${who || "anonymous"} cannot read raw voting data`,
      assertFails,
      () =>
        getDoc(
          doc(context(who).firestore(), "voting_polls", `${prefix}-closed`),
        ),
    );
    await check(
      `${who || "anonymous"} cannot read the private tally`,
      assertFails,
      () =>
        getDoc(
          doc(
            context(who).firestore(),
            "voting_polls",
            `${prefix}-closed`,
            "private",
            "tally",
          ),
        ),
    );
    await check(
      `${who || "anonymous"} cannot inject participation`,
      assertFails,
      () =>
        setDoc(
          doc(
            context(who).firestore(),
            "voting_polls",
            `${prefix}-closed`,
            "participation",
            "forged",
          ),
          { choices: ["x"] },
        ),
    );
  }
  await check(
    "a client cannot forge server voting audit events",
    assertFails,
    () =>
      setDoc(
        doc(
          context("manager").firestore(),
          "activity_logs",
          `${prefix}-forged`,
        ),
        { userId: `${prefix}-manager`, action: "VOTE_PUBLISHED" },
      ),
  );
  console.log("VOTING RULES TESTS PASSED", passed);
} finally {
  await env.cleanup();
}
