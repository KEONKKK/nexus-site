// NEXUS - src/lib/api-client.mjs - client for the round-3 public proxy
// (engine/public/, spec: design/plans/round-3-proxy-spec.md, written by window C).
//
// NOT WIRED TO ANY PAGE YET (A3.3, 2026-11-08) - B has not built the proxy, there is no
// `engine/public/` process running anywhere, and dist-allowlist.json has no entry for it.
// This file sits in src/lib unreferenced by any <script src>, which is exactly why it does
// NOT end up in dist/ (product-07/09 only require that what a page DOES reference is on the
// list - an unreferenced file is simply never looked at). Connecting it to find-pro/kits and
// adding the allowlist entry is explicitly future work, left to whichever round decides the
// "ערכה" question in the spec (open decision #2 there) and picks the proxy's port.
//
// Dual-mode file (no import/export) - see the header of src/lib/lead-schema.mjs. The one
// difference from every other lib here: this is the first genuinely ASYNC code in the
// project (sha256.mjs deliberately stayed synchronous - see STATE-product.md item 4 - because
// nothing before this needed a real network round trip).
//
// Design contract, the same shape as every other lib's {ok, ...} return value:
//   EVERY call RESOLVES, never rejects, for every outcome the spec documents - including
//   failure. A page can `.then()` the result with no `.catch()` and never crash. The only
//   things that throw are PROGRAMMER errors: a missing baseUrl/fetchImpl at construction
//   time, or a missing token argument. That split matters for the one behaviour the task
//   explicitly asked for: when the proxy is unreachable, the page must be able to fall back
//   to wa.me-only silently - "unavailable" is just another value in the result, not an
//   exception a caller has to remember to catch.
//
// Status -> result mapping (spec statuses in the left column; the two extra rows are this
// file's own additions, explained where they are implemented below):
//   201              -> {ok:true, ...server body}              (POST /leads, POST /kits)
//   200              -> {ok:true, ...server body}              (GET .../status, GET /health)
//   400 / 422        -> {ok:false, errors:[...]} or {ok:false, error:"..."} (server body, passed through)
//   404              -> {ok:false, error:"not_found"}           (GET .../status only - not in
//                        the task's literal status list, but required by the spec for this
//                        endpoint and exercised by proxy-requests.json#p-15; omitting it would
//                        leave that corpus case unhandled)
//   413              -> {ok:false, error:"payload_too_large"}
//   429              -> {ok:false, error:"too_many_requests"}
//   503 / any 5xx /
//   timeout / no
//   network at all   -> {ok:false, error:"unavailable", reason:"http_503"|"timeout"|"network"}
//                        (broadened from exactly-503 to any 5xx on purpose: a reverse proxy
//                        having a bad day returns 502/504 just as often as the app itself
//                        returning 503, and both mean the same thing to a caller deciding
//                        whether to fall back to wa.me - "the engine is not answering")
//   anything else    -> {ok:false, error:"unexpected_response", status:<number>}
//                        (a status the spec never promised - surfaced distinctly so a future
//                        caller can log it, instead of it being silently misread as either a
//                        validation failure or an availability problem)

(function (root) {
  "use strict";
  var NEXUS = (root.NEXUS = root.NEXUS || {});

  var DEFAULT_TIMEOUT_MS = 8000;

  // ---------------------------------------------------------------- timeout plumbing

  // Races the real fetch against a timer. Uses AbortController when the environment has one
  // (every real browser and modern Node) so the underlying request is actually cancelled, not
  // just ignored.
  //
  // Subtlety this has to get right: once the timer wins, the real fetch is only ABORTED, not
  // instantly gone - it still settles (as an AbortError rejection) a tick later. If nothing is
  // listening for that by then, it becomes an unhandled promise rejection, not a bug anyone
  // would see until it showed up as a console warning in production. `fetchPromise.catch()` is
  // attached unconditionally, immediately, specifically to make sure that late rejection always
  // has a handler - independent of which side of the race below actually wins.
  function withTimeout(fetchImpl, url, init, timeoutMs) {
    var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    var finalInit = init;
    if (controller) {
      finalInit = {};
      for (var k in init) if (Object.prototype.hasOwnProperty.call(init, k)) finalInit[k] = init[k];
      finalInit.signal = controller.signal;
    }

    var fetchPromise = fetchImpl(url, finalInit);
    fetchPromise.catch(function () {}); // see note above - keeps a late abort-rejection handled

    return new Promise(function (resolve, reject) {
      var settled = false;
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        if (controller) controller.abort();
        var err = new Error("api-client: request timed out after " + timeoutMs + "ms");
        err.isTimeout = true;
        reject(err);
      }, timeoutMs);

      fetchPromise.then(
        function (response) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(response);
        },
        function (err) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(err);
        }
      );
    });
  }

  // Never throws: a body that is not valid JSON becomes `null`, not a crashed promise chain.
  function parseJsonSafely(response) {
    if (!response || typeof response.json !== "function") return Promise.resolve(null);
    return response.json().then(
      function (data) { return data; },
      function () { return null; }
    );
  }

  // One request -> one envelope, whatever happened. Every branch below reads only this shape.
  function request(fetchImpl, timeoutMs, baseUrl, method, path, body) {
    var url = baseUrl + path;
    var init = { method: method, headers: { Accept: "application/json" } };
    if (body !== null && body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    return withTimeout(fetchImpl, url, init, timeoutMs).then(
      function (response) {
        return parseJsonSafely(response).then(function (data) {
          return { networkError: false, timedOut: false, status: response.status, data: data };
        });
      },
      function (err) {
        if (err && err.isTimeout) {
          return { networkError: false, timedOut: true, status: null, data: null };
        }
        return { networkError: true, timedOut: false, status: null, data: null };
      }
    );
  }

  // ---------------------------------------------------------------- envelope -> result

  function reasonFor(envelope) {
    if (envelope.timedOut) return "timeout";
    if (envelope.networkError || envelope.status === null || envelope.status === undefined) return "network";
    return "http_" + envelope.status;
  }

  // Broadened to any 5xx and to "no response at all" - see the status-mapping table above.
  function isUnavailable(envelope) {
    return (
      envelope.networkError ||
      envelope.timedOut ||
      envelope.status === null ||
      envelope.status === undefined ||
      envelope.status >= 500
    );
  }

  function unavailableResult(envelope) {
    return { ok: false, error: "unavailable", reason: reasonFor(envelope) };
  }

  // 2xx: trust the server's own envelope when it looks sane, otherwise still report success -
  // the HTTP status is the source of truth, a thin/missing body should not turn a 201 into a
  // reported failure.
  function passthroughOk(data) {
    if (data && data.ok === true) return data;
    return { ok: true };
  }

  // 400 and 422 both mean "validation failed" here (422 is not in the spec yet, but the task
  // asked for it explicitly - treating it exactly like 400 costs nothing and covers the proxy
  // choosing either convention without this file needing to change).
  function validationResult(envelope) {
    var data = envelope.data;
    if (data && Array.isArray(data.errors)) return { ok: false, errors: data.errors };
    if (data && typeof data.error === "string") return { ok: false, error: data.error };
    return { ok: false, error: "bad_request" };
  }

  function notFoundResult() {
    return { ok: false, error: "not_found" };
  }

  function payloadTooLargeResult() {
    return { ok: false, error: "payload_too_large" };
  }

  function tooManyRequestsResult() {
    return { ok: false, error: "too_many_requests" };
  }

  function unexpectedResult(envelope) {
    return { ok: false, error: "unexpected_response", status: envelope.status };
  }

  // ---------------------------------------------------------------- the client

  // deps: { baseUrl, fetchImpl, timeoutMs }. baseUrl must already include the "/public" prefix
  // the allowlist spec describes (e.g. "https://proxy.example.com/public") - each method below
  // appends only its own suffix, never a full URL, so a typo here cannot silently reach the
  // administrative api.py origin by accident.
  function createApiClient(deps) {
    deps = deps || {};
    if (!deps.baseUrl) throw new Error("api-client: createApiClient requires deps.baseUrl");
    var fetchImpl = deps.fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
    if (!fetchImpl) throw new Error("api-client: no fetch available - pass deps.fetchImpl");
    var baseUrl = deps.baseUrl.replace(/\/+$/, "");
    var timeoutMs = deps.timeoutMs || DEFAULT_TIMEOUT_MS;

    function call(method, path, body) {
      return request(fetchImpl, timeoutMs, baseUrl, method, path, body);
    }

    // POST /public/leads - spec section 1.
    //
    // 200 added in round 4 (design/reviews/2026-11-08-client-vs-proxy.md, finding 1): when the
    // free-text IS a STOP message, leads.add_lead creates no lead at all and the server answers
    // 200 {ok:true, opted_out:true} - a real success, not an error. Before this branch existed
    // that case fell through to unexpectedResult() and a genuine success looked like a failure.
    // passthroughOk already does the right thing for it unchanged (data.ok === true).
    function submitLead(lead) {
      return call("POST", "/leads", lead).then(function (envelope) {
        if (isUnavailable(envelope)) return unavailableResult(envelope);
        if (envelope.status === 201 || envelope.status === 200) return passthroughOk(envelope.data);
        if (envelope.status === 400 || envelope.status === 422) return validationResult(envelope);
        if (envelope.status === 413) return payloadTooLargeResult();
        if (envelope.status === 429) return tooManyRequestsResult();
        return unexpectedResult(envelope);
      });
    }

    // GET /public/leads/<token>/status - spec section 2. Deliberately gross: per the spec the
    // server itself returns nothing but {ok, status} - this client does not add anything to it.
    function getLeadStatus(token) {
      if (!token) throw new Error("api-client: getLeadStatus requires a token");
      return call("GET", "/leads/" + encodeURIComponent(token) + "/status", null).then(function (envelope) {
        if (isUnavailable(envelope)) return unavailableResult(envelope);
        if (envelope.status === 200) return passthroughOk(envelope.data);
        if (envelope.status === 404) return notFoundResult();
        if (envelope.status === 429) return tooManyRequestsResult();
        return unexpectedResult(envelope);
      });
    }

    // POST /public/kits - spec section 3. Still registers the engine's kind/industry shape,
    // NOT the kit-build.mjs ZIP (open decision #2 in the spec) - callers must not reuse this
    // for the ZIP flow until that question is decided.
    function submitKit(kit) {
      return call("POST", "/kits", kit).then(function (envelope) {
        if (isUnavailable(envelope)) return unavailableResult(envelope);
        if (envelope.status === 201) return passthroughOk(envelope.data);
        if (envelope.status === 400 || envelope.status === 422) return validationResult(envelope);
        if (envelope.status === 413) return payloadTooLargeResult();
        if (envelope.status === 429) return tooManyRequestsResult();
        return unexpectedResult(envelope);
      });
    }

    // GET /public/health - spec section 4. Collapses EVERY non-200 outcome to "unavailable",
    // even ones with no documented error shape (the spec gives health no error body at all) -
    // a caller only ever needs the binary signal this endpoint exists for: show "track status"
    // UI, or fall back to wa.me-only quietly.
    function checkHealth() {
      return call("GET", "/health", null).then(function (envelope) {
        if (envelope.status === 200) return passthroughOk(envelope.data);
        return unavailableResult(envelope);
      });
    }

    // POST /public/partners - round 4, src/pages/partners/index.html. Not in round-3-proxy-
    // spec.md (no corpus entry either) when this was first written, but the status-handling
    // branches below (and the body shape in partners-app.js's proxyBody) are now CONFIRMED
    // against the real backend: engine/public/public_api.py's App._create_partner/
    // _validate_partner + nexus_master/partners.py (both read 2026-11-08, round 4). No
    // 200-opted-out branch here: that behavior is specific to leads.add_lead's STOP-message
    // handling (see submitLead above), and public_api.py's partner path never calls it.
    function submitPartner(partner) {
      return call("POST", "/partners", partner).then(function (envelope) {
        if (isUnavailable(envelope)) return unavailableResult(envelope);
        if (envelope.status === 201) return passthroughOk(envelope.data);
        if (envelope.status === 400 || envelope.status === 422) return validationResult(envelope);
        if (envelope.status === 413) return payloadTooLargeResult();
        if (envelope.status === 429) return tooManyRequestsResult();
        return unexpectedResult(envelope);
      });
    }

    // GET /public/config - round 5 (2026-11-09, urgent): the ONLY source for the business's
    // real WhatsApp number from now on - engine/public/public_api.py always answers 200
    // {ok:true, business_whatsapp: <string>|null} (never gated by a key or a rate limit; see
    // guardian.business_number - null until an admin configures one, no hardcoded fallback).
    // This method always resolves {ok:true, business_whatsapp}, collapsing EVERY failure
    // (network/timeout/5xx/an unexpected body) into business_whatsapp:null rather than a
    // distinct error shape: a caller deciding whether to show a wa.me link only ever needs
    // "do we have a real number right now or not" - whether that "not" is because the setting
    // is genuinely unset or because the request itself failed makes no difference to it.
    function getConfig() {
      return call("GET", "/config", null).then(function (envelope) {
        if (envelope.status === 200 && envelope.data && envelope.data.ok === true) {
          return { ok: true, business_whatsapp: envelope.data.business_whatsapp || null };
        }
        return { ok: true, business_whatsapp: null };
      });
    }

    return {
      baseUrl: baseUrl,
      timeoutMs: timeoutMs,
      submitLead: submitLead,
      getLeadStatus: getLeadStatus,
      submitKit: submitKit,
      submitPartner: submitPartner,
      checkHealth: checkHealth,
      getConfig: getConfig,
    };
  }

  NEXUS.apiClient = {
    DEFAULT_TIMEOUT_MS: DEFAULT_TIMEOUT_MS,
    createApiClient: createApiClient,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
