// Vela Meet — captured clone of the fake meeting page (velameet-07.example).
//
// SAFETY: this is a SANITIZED clone for an isolated IR exercise. Every network
// call targets the in-tenant mock (same-origin) or a *.tenka.local host — there
// is NO external egress, NO real binary, NO real payload. The custom-protocol
// launch and the "desktop helper" download are reproduced faithfully in shape
// so they can be read and reasoned about, but the download only ever yields an
// in-tenant benign marker file.
//
// Read this file top to bottom: it is the evidence for OBJ-3 (the fake meeting
// funnel). Nothing here is minified on purpose.

"use strict";

// The room id is placed in the page by index.html (data-room), not hardcoded in
// a fetchable URL. The original lure was https://velameet-07.example/room/<room>.
const ROOM_ID = document.body.dataset.room || "qrt-mkbd-zol";

// --- (1) Periodic beacon -----------------------------------------------------
// A "presence" heartbeat fires on a timer while the page is open. On the live
// attacker infra this told the operator a target had the room open; here it
// hits the in-tenant mock only.
function startHeartbeat() {
  const beat = () => {
    fetch("/api/heartbeat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ room: ROOM_ID, t: Date.now() }),
      keepalive: true,
    }).catch(() => {});
  };
  beat();
  setInterval(beat, 15000); // every 15s
}

// --- (2) Custom-protocol launch ---------------------------------------------
// The page first tries to open a native handler via a custom URL scheme. If a
// "Vela Meet" client were installed, the OS would hand off to it. This is the
// primary funnel toward a locally-installed app; the browser view is the
// fallback pitch that nudges the "desktop helper" download.
function tryLaunchNativeClient() {
  const deepLink = "velameet-join://join?room=" + encodeURIComponent(ROOM_ID);
  try {
    // Assigning location to a custom scheme asks the OS to launch the handler.
    window.location.href = deepLink;
  } catch (_e) {
    // No handler registered → stay in the browser and offer the "helper".
  }
}

// --- (3) OS-differentiated dynamic download ---------------------------------
// The download URL is NEVER written into this JS. The page asks the server for
// it at click time, passing a coarse OS guess so the server can decide what to
// hand back per platform (OS-based differentiation). The response carries the
// artifact URL to fetch — so a static reader sees the REQUEST shape, not the
// artifact.
function detectOs() {
  const ua = navigator.userAgent || "";
  if (/Windows/i.test(ua)) return "windows";
  if (/Mac OS X|Macintosh/i.test(ua)) return "macos";
  if (/Linux/i.test(ua)) return "linux";
  return "other";
}

async function requestDesktopHelper() {
  // Dynamic issuance: POST /meetings/<id>/download → { artifactUrl, payload }.
  const res = await fetch("/meetings/" + encodeURIComponent(ROOM_ID) + "/download", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ os: detectOs(), room: ROOM_ID }),
  });
  const data = await res.json();
  // The server returns the artifact URL dynamically; the client just follows it.
  // (In this isolated clone the artifact is an in-tenant benign marker.)
  if (data && data.artifactUrl) {
    const a = document.createElement("a");
    a.href = data.artifactUrl;
    a.download = "";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  return data;
}

function wireUi() {
  const joinBtn = document.getElementById("join");
  const helperBtn = document.getElementById("helper");
  if (joinBtn) joinBtn.addEventListener("click", tryLaunchNativeClient);
  if (helperBtn) {
    helperBtn.addEventListener("click", async () => {
      const status = document.getElementById("status");
      const data = await requestDesktopHelper();
      if (status) {
        status.textContent =
          "Preparing helper… (build served: " + (data && data.payload) + ")";
      }
    });
  }
}

window.addEventListener("DOMContentLoaded", () => {
  wireUi();
  tryLaunchNativeClient();
  startHeartbeat();
});
