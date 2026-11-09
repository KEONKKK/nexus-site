// NEXUS - src/lib/status-view.mjs - controller for src/pages/status/index.html, "what's
// happening with my inquiry". Separated from the page the same way app.js separates logic
// from find-pro/kits: createStatusView(deps) takes doc/win/client as parameters, so the whole
// flow runs in node against a DOM stub and a mocked api-client, with no browser and no network.
//
// A3.4 (2026-11-08): this page is NOT wired up or allowlisted yet - see the header of
// src/pages/status/index.html and design/STATE-product.md. It needs src/lib/api-client.mjs
// (A3.3), which is itself not connected to anything yet either.
//
// Dual-mode file (no import/export) - see the header of src/lib/lead-schema.mjs.
//
// The flow, in one paragraph: the token travels in the URL FRAGMENT ("#t=<token>"), not a
// query string, so it is never sent to a server or logged anywhere by the mere act of loading
// the page - only this page's own JS ever reads it, and only to hand it straight to
// api-client.mjs. No token -> the wa.me fallback, immediately, no network call attempted. A
// token -> exactly one call to getLeadStatus(token), whose own result decides everything else:
// ok -> a status label; "not_found" -> a distinct "we don't recognize this link" message
// (deliberately NOT the same copy as "the service is unreachable" - they are different facts);
// anything else (unavailable, unexpected_response, or no client/libraries at all) -> the same
// wa.me fallback as "no token". Every branch ends with a working way forward for the visitor.

(function (root) {
  "use strict";
  var NEXUS = (root.NEXUS = root.NEXUS || {});

  // The engine's six statuses (round-3-proxy-spec.md, section 2) collapse onto the four
  // Hebrew labels the task asked for. This mapping is a page-level product decision, not
  // part of the spec - documented in design/STATE-product.md, not just here:
  //   new, duplicate   -> "התקבל"            (received - a duplicate still means WE have it)
  //   contacted        -> "בטיפול"            (being handled)
  //   qualified        -> "הועבר לבעל מקצוע"  (forwarded to a professional)
  //   sold, rejected   -> "נסגר"              (closed - the endpoint is deliberately coarse,
  //                        see the spec: the visitor does not need to know WHY it closed)
  // Fixed in round 4 (design/reviews/2026-11-08-client-vs-proxy.md, finding 2): this used to
  // mirror round-3-proxy-spec.md's status enum, which the review found did NOT match the real
  // engine (leads.py:9 STATUSES = "new","contacted","sold","won","lost","spam","duplicate") -
  // "qualified"/"rejected" never existed in the code at all, and "won"/"lost"/"spam" were
  // missing here entirely (every one of those three would have silently fallen through to the
  // "unknown status" screen). Collapsed to 3 end-user-facing labels, not the original 4: nothing
  // in the real status list represents "matched to a specific professional, awaiting their
  // action" the way the fictional "qualified" implied - "contacted" is the closest the real
  // engine gets to "someone is on it". sold/won/lost/spam all collapse to "נסגר" ("closed") on
  // purpose: per the spec's own stated goal ("בכוונה גס... חושף הכי מעט מידע"), the honest
  // coarse fact common to all four is simply "no longer active" - WHY it closed is exactly the
  // extra detail the spec says this endpoint must not expose.
  var STATUS_LABELS_HE = {
    new: "התקבל",
    duplicate: "התקבל",
    contacted: "בטיפול",
    sold: "נסגר",
    won: "נסגר",
    lost: "נסגר",
    spam: "נסגר",
  };

  function labelFor(status) {
    return Object.prototype.hasOwnProperty.call(STATUS_LABELS_HE, status) ? STATUS_LABELS_HE[status] : null;
  }

  // Only the "t" key is ever read. Anything else in the fragment is ignored, not an error -
  // leaves room for this page to grow other fragment params later without a breaking change.
  function parseToken(hash) {
    var h = typeof hash === "string" ? hash : "";
    if (h.charAt(0) === "#") h = h.slice(1);
    if (h === "") return null;
    var parts = h.split("&");
    for (var i = 0; i < parts.length; i += 1) {
      var eq = parts[i].indexOf("=");
      var key = eq === -1 ? parts[i] : parts[i].slice(0, eq);
      var raw = eq === -1 ? "" : parts[i].slice(eq + 1);
      if (key === "t" && raw !== "") {
        try {
          return decodeURIComponent(raw);
        } catch (e) {
          return null; // malformed percent-encoding - treat exactly like "no token"
        }
      }
    }
    return null;
  }

  function createStatusView(deps) {
    deps = deps || {};
    var doc = deps.doc;
    var client = deps.client; // an already-constructed api-client instance, or null/undefined
    var hash = deps.hash !== undefined ? deps.hash : deps.win && deps.win.location ? deps.win.location.hash : "";
    if (!doc) throw new Error("status-view: createStatusView requires deps.doc");

    function el(id) {
      return doc.getElementById(id);
    }
    function show(id) {
      var node = el(id);
      if (node) node.hidden = false;
    }
    function hide(id) {
      var node = el(id);
      if (node) node.hidden = true;
    }
    function hideAll() {
      hide("loading");
      hide("status-box");
      hide("unknown-status");
      hide("not-found");
      hide("fallback");
    }

    function renderKnownStatus(status, label) {
      hideAll();
      var box = el("status-label");
      if (box) box.textContent = label;
      show("status-box");
    }

    // Round 5 (2026-11-09, urgent): the wa.me links inside these three blocks used to carry a
    // hardcoded business number (972559814818 - a fabricated demo number that shipped to the
    // live site; see wa-link.mjs's header and engine/nexus_master/guardian.py's
    // PLACEHOLDER_NUMBERS). There is no fallback number any more: the real one, if any, comes
    // from GET /public/config at runtime. applyWaFallback() shows the link with the real number
    // when one exists, or leaves the plain-text hint visible instead when it does not - never a
    // number nobody chose.
    var WA_FALLBACK_IDS = ["wa-unknown-status", "wa-not-found", "wa-fallback"];

    async function applyWaFallback() {
      var waNumber = null;
      if (client && typeof client.getConfig === "function") {
        try {
          var cfg = await client.getConfig();
          waNumber = cfg && cfg.business_whatsapp ? cfg.business_whatsapp : null;
        } catch (err) {
          waNumber = null; // belt-and-suspenders - getConfig's own contract says this never happens
        }
      }
      for (var i = 0; i < WA_FALLBACK_IDS.length; i += 1) {
        var a = el(WA_FALLBACK_IDS[i]);
        var hint = el(WA_FALLBACK_IDS[i] + "-fallback");
        if (a) {
          if (waNumber) a.setAttribute("href", "https://wa.me/" + waNumber);
          a.hidden = !waNumber;
        }
        if (hint) hint.hidden = !!waNumber;
      }
    }

    async function renderUnknownStatus(status) {
      hideAll();
      await applyWaFallback();
      var box = el("status-raw");
      if (box) box.textContent = String(status);
      show("unknown-status");
    }

    async function renderNotFound() {
      hideAll();
      await applyWaFallback();
      show("not-found");
    }

    async function renderFallback() {
      hideAll();
      await applyWaFallback();
      show("fallback");
    }

    // "no token at all" is not a failed lookup - there was nothing to look up. Skips the
    // GET /public/config call entirely (not just skips showing its result): a visitor who
    // landed here with no reference to anything gets the plain-text hint, and this page makes
    // 0 network requests either way - preserved from before this round, see the "no_token"
    // scenario in tests/product-11-status.mjs.
    function renderFallbackNoLookup() {
      hideAll();
      show("fallback");
    }

    // The one async entry point. Always resolves (api-client never rejects, and every DOM
    // write above is guarded with `if (node)`), and always returns a small, inspectable
    // summary of what it decided - this is what the tests assert against, instead of poking
    // at hidden/textContent directly from outside.
    async function init() {
      var token = parseToken(hash);
      if (!token) {
        renderFallbackNoLookup();
        return { shown: "fallback", reason: "no_token" };
      }
      if (!client) {
        await renderFallback();
        return { shown: "fallback", reason: "no_client" };
      }

      var result;
      try {
        result = await client.getLeadStatus(token);
      } catch (err) {
        // api-client.mjs's own contract says this never happens - caught anyway, because a
        // page that depends on a network call must never let one throw past it unguarded.
        await renderFallback();
        return { shown: "fallback", reason: "client_threw" };
      }

      if (result.ok) {
        var label = labelFor(result.status);
        if (label) {
          renderKnownStatus(result.status, label);
          return { shown: "status", status: result.status, label: label };
        }
        await renderUnknownStatus(result.status);
        return { shown: "unknown-status", status: result.status };
      }

      if (result.error === "not_found") {
        await renderNotFound();
        return { shown: "not-found" };
      }

      await renderFallback();
      return { shown: "fallback", reason: result.error };
    }

    return { init: init };
  }

  NEXUS.statusView = {
    STATUS_LABELS_HE: STATUS_LABELS_HE,
    labelFor: labelFor,
    parseToken: parseToken,
    createStatusView: createStatusView,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
