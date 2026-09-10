import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createModel } from "../local/app/model.mjs";
import { start } from "../local/app/server.mjs";
function decisions(s, owner = "aoi") {
  return [
    [
      "plan",
      {
        teams: Math.ceil(s.participants / 4),
        computers: s.participants + s.spares,
        owner,
      },
    ],
    ["rehearsal", { decision: "hold", check: "scoring" }],
    [
      "incident",
      { order: s.order, action: "reconcile", recipient: "technical" },
    ],
    [
      "closeout",
      {
        status: "pending",
        owner: "technical",
        next: "check-deletion-and-cost",
      },
    ],
  ];
}
test("plans across changing attendance accept available owners and preserve stage-specific receipts", () => {
  for (let i = 0; i < 25; i++) {
    const m = createModel(`test-event-${i}`),
      s = m.scenario;
    assert.equal(m.submit("closeout", decisions(s)[3][1]), null);
    assert.equal(
      m.submit("plan", { ...decisions(s)[0][1], computers: s.participants }),
      null,
    );
    assert.equal(
      m.submit("plan", { ...decisions(s)[0][1], owner: "ren" }),
      null,
    );
    for (const [id, answer] of decisions(s, i % 2 ? "mei" : "aoi")) {
      const receipt = m.submit(id, answer);
      assert.match(receipt, /^TC\{/);
      assert.equal(m.verify(id, receipt), true);
      assert.equal(m.verify(id, receipt + "extra"), false);
      assert.equal(createModel(`other-event-${i}`).verify(id, receipt), false);
      assert.equal(m.submit(id, answer), receipt);
    }
    assert.equal(m.progress().length, 4);
    assert.equal(m.report().simulation, true);
  }
});
test("start and teardown decisions use evidence rather than requested actions", () => {
  const m = createModel("decision-test");
  m.submit(...decisions(m.scenario)[0]);
  assert.equal(
    m.submit("rehearsal", { decision: "start", check: "scoring" }),
    null,
  );
  m.submit(...decisions(m.scenario)[1]);
  assert.equal(
    m.submit("incident", { ...decisions(m.scenario)[2][1], action: "add" }),
    null,
  );
  m.submit(...decisions(m.scenario)[2]);
  assert.equal(
    m.submit("closeout", { ...decisions(m.scenario)[3][1], status: "done" }),
    null,
  );
});
test("real HTTP surface and platform submission contract work end to end", async (t) => {
  const { web, verifier } = start({
    seed: "http-test",
    webPort: 0,
    verifyPort: 0,
    host: "127.0.0.1",
  });
  t.after(() => {
    web.closeAllConnections();
    verifier.closeAllConnections();
    web.close();
    verifier.close();
  });
  await Promise.all([once(web, "listening"), once(verifier, "listening")]);
  const base = `http://127.0.0.1:${web.address().port}`,
    url = `http://127.0.0.1:${verifier.address().port}/verify`;
  const s = await (await fetch(base + "/scenario")).json();
  assert.equal((await fetch(base + "/")).status, 200);
  const post = (u, b) =>
    fetch(u, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(b),
    }).then((r) => r.json());
  for (const [stage, answer] of decisions(s)) {
    const result = await post(base + "/submit", { stage, answer });
    assert.equal(result.accepted, true);
    assert.deepEqual(
      await post(url, { checkpointId: stage, submission: result.receipt }),
      { checkpointId: stage, correct: true },
    );
    assert.equal(
      (await post(url, { checkpointId: stage, submission: "not-a-receipt" }))
        .correct,
      false,
    );
  }
  assert.equal((await fetch(base + "/report")).status, 200);
});
