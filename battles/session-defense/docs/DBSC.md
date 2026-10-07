# Device binding and activity on the original device

Cookies are small data items that a browser stores and sends. Some services place login evidence in them. Device Bound Session Credentials (DBSC) use proof of a device-held private key when renewing short-lived cookies. A private key creates a proof and a public key checks it. Protected key storage resists moving the private key elsewhere; copying cookies alone does not let another device continue renewing them. [Chrome developer guide](https://developer.chrome.com/docs/web-platform/device-bound-session-credentials)

This is not a guarantee that every request is denied immediately when a cookie is copied. The unexpired cookie window, protected service scope, browser/key-storage support and enforced registration/refresh policy matter. This lab does not implement DBSC. Shortening a lifetime alone is not a DBSC implementation.

Activity on the original device differs from reuse elsewhere. DBSC does not prevent temporary browser-session access while the attacker is resident on that device. A protected key may still be usable for local signing, and an authenticated browser may still be operated. DBSC also does not guarantee the identity of a particular managed device or that it is healthy. [W3C non-goals](https://w3c.github.io/webappsec-dbsc/#non-goals)

Device admission policies, session key binding, sensitive-action confirmation/reviewer approval and defenses against local compromise have distinct scopes. None establish that the real incident occurred because device management was absent; its entry path is unknown. This game uses supplied lab evidence only and implements no actual device compromise, cookie reading or device signing.

Sources checked 2026-10-07. Browser/OS availability is deliberately not frozen in the lesson; verify current primary sources for real deployments.
