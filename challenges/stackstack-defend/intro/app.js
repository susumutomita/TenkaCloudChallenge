const $ = (id) => document.getElementById(id);
let running = false,
  busy = false,
  expires = 0,
  epoch = 0,
  stopping = false;
const requests = new Set();
function controls() {
  for (const id of ["start", "self", "other", "save", "verify", "retry"])
    $(id).disabled = busy;
  $("start").hidden = running;
  $("stop").hidden = !running;
  $("stop").disabled = stopping;
  $("exercise").hidden = !running;
}
async function api(path, method = "GET", body) {
  const controller = new AbortController();
  requests.add(controller);
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const res = await fetch(path, {
      method,
      headers:
        method === "GET"
          ? {}
          : { "x-intro": "1", "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    });
    const data = await res.json();
    if (!res.ok) {
      if (res.status === 401) {
        running = false;
        expires = 0;
        controls();
      }
      throw Error(data.error);
    }
    if (data.expires) expires = data.expires;
    return data;
  } finally {
    clearTimeout(timer);
    requests.delete(controller);
  }
}
function observed(data) {
  $("scope").value = data.scope;
  $("observation").textContent =
    data.sawOwn && data.sawLeak
      ? "修正前の観測：自分も他人も読めました。ログインだけでは、他人の閲覧を防げていませんでした。"
      : data.sawOwn
        ? "次は同じ利用者で他人の情報を開きましょう。"
        : "まず自分の情報を読みましょう。";
}
async function action(fn) {
  if (busy) return;
  busy = true;
  controls();
  const current = epoch;
  try {
    await fn(current);
  } catch (e) {
    if (current === epoch) {
      $("learning").hidden = true;
      $("message").textContent =
        e.message || "通信できませんでした。再試行してください。";
    }
  } finally {
    if (current === epoch) {
      busy = false;
      controls();
    }
  }
}
async function begin() {
  await action(async () => {
    const data = await api("/api/start", "POST");
    running = true;
    expires = data.expires;
    $("response").textContent = "自分と他人を順番に開いてみましょう。";
    $("checks").replaceChildren();
    $("learning").hidden = true;
    $("saved").textContent = "";
    $("message").textContent = "専用の演習枠を開始しました。";
    observed(await api("/api/state"));
  });
}
$("start").onclick = begin;
for (const target of ["self", "other"])
  $(target).onclick = () =>
    action(async (current) => {
      const data = await api("/api/read", "POST", { target });
      if (current !== epoch) return;
      $("response").textContent =
        `ブラウザ → POST /api/read {"target":"${target}"}\n専用サーバ内 → ${data.request}\n会員Aとして要求 → HTTP ${data.status}\n${JSON.stringify(data.body, null, 2)}`;
      const state = await api("/api/state");
      if (current !== epoch) return;
      observed(state);
      $("message").textContent =
        data.status === 200
          ? "情報が返りました。誰の情報か比べてください。"
          : "サーバが要求を拒否しました。";
    });
$("save").onclick = () =>
  action(async (current) => {
    await api("/api/policy", "POST", { scope: $("scope").value });
    if (current !== epoch) return;
    $("saved").textContent =
      "専用サーバの認可設定を変更しました。次の要求から適用されます。";
    $("learning").hidden = true;
    $("checks").replaceChildren();
    $("message").textContent = "次はHTTPで確認してください。";
  });
$("verify").onclick = () =>
  action(async (current) => {
    $("learning").hidden = true;
    $("checks").replaceChildren();
    const data = await api("/api/verify", "POST");
    if (current !== epoch) return;
    $("checks").replaceChildren();
    for (const c of data.checks) {
      const p = document.createElement("p");
      p.className = "check";
      p.textContent = `${c.ok ? "✓" : "×"} 会員${c.actor.toUpperCase()} → ${c.owner.toUpperCase()}の情報${c.fresh ? "（新規ID）" : ""}: HTTP ${c.status}`;
      $("checks").append(p);
    }
    $("learning").hidden = !data.passed;
    $("message").textContent = data.passed
      ? "確認できました。本人は読めて、他人は拒否されています。"
      : !data.observed
        ? "まず自分と他人の情報を読み比べてください。先に修正した場合はルールを戻すか、やり直せます。"
        : "まだ条件を満たしていません。結果を見てルールを変え、再確認してください。";
  });
async function stop() {
  if (stopping) return;
  stopping = true;
  epoch++;
  for (const request of requests) request.abort();
  busy = true;
  controls();
  try {
    await api("/api/session", "DELETE");
    running = false;
    expires = 0;
    $("clock").textContent = "";
    $("message").textContent =
      "終了しました。古い資格情報は無効です。「開始」で新しい体験を始められます。";
  } catch (e) {
    $("message").textContent = e.message;
  }
  stopping = false;
  busy = false;
  controls();
}
$("stop").onclick = stop;
$("retry").onclick = async () => {
  await stop();
  if (!running) await begin();
};
setInterval(() => {
  if (!running) return;
  const seconds = Math.max(0, Math.ceil((expires - Date.now()) / 1000));
  $("clock").textContent = `残り ${seconds} 秒`;
  if (seconds === 0) {
    epoch++;
    busy = false;
    running = false;
    controls();
    $("message").textContent = "期限切れです。「開始」で新しく始めてください。";
  }
}, 1000);
action(async () => {
  try {
    const data = await api("/api/state");
    running = true;
    observed(data);
    $("message").textContent =
      "進行中の体験を再開しました。HTTP確認は何度でもできます。";
  } catch (e) {
    $("message").textContent = e.message;
  }
});
