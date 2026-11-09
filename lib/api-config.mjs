// NEXUS - src/lib/api-config.mjs - the single address of the round-3 public proxy.
//
// One file, one value, on purpose (round 4): every page and lib that needs the proxy's base
// URL reads PUBLIC_API_BASE_URL from here, instead of each one hard-coding its own placeholder
// string. When engine/public/ has a real host and port, B (or whoever wires it) flips exactly
// this one line - nothing else in src/ needs to change.
//
// LIVE as of round 5 (2026-11-09): B confirmed GET /public/health answers 200 on the real
// PythonAnywhere host (design/STATE-infra.md). Flipped from the always-fails-fast ".invalid"
// placeholder this file carried until now - see this file's own git history / design/
// STATE-product.md for why that placeholder existed (a resolvable-but-not-yet-listening real
// host hangs a real browser's fetch() on a slow connection timeout instead of failing fast via
// DNS, which once broke tests/product-08-browser.mjs's real-browser checks).

(function (root) {
  "use strict";
  var NEXUS = (root.NEXUS = root.NEXUS || {});

  NEXUS.apiConfig = {
    PUBLIC_API_BASE_URL: "https://gaston22.pythonanywhere.com/public"
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
