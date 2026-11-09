// NEXUS - src/assets/partners-app.js - controller for src/pages/partners/index.html. Round 4.
//
// Deliberately NOT part of app.js's createApp()/PAGES table: a partner signup is not a lead.
// createApp()'s whole pipeline (buildLead -> NEXUS.leadSchema.validate -> leadScore.scoreLead)
// is built around the frozen lead schema (category: pro|realestate|kit) and does not have a
// shape for "a professional registering to receive leads" at all - trying to bend it through
// that schema would mean inventing fields the schema was never meant to carry. This file
// reuses phone.mjs / consent.mjs / wa-link.mjs / api-client.mjs exactly as app.js does, just
// with its own small validate/collect/submit flow instead of app.js's lead-shaped one.
//
// Same submit order and the same "never show the user our plumbing" rule as app.js (see its
// header): validate -> build the WhatsApp message -> try the proxy -> open WhatsApp either
// way. No local save/download step here: unlike a lead, nothing today reads a saved partner
// record back out of localStorage, so there is nothing to build that would not be dead code.
//
// Dual-mode file (no import/export) - see the header of src/lib/lead-schema.mjs.

(function (root) {
  "use strict";
  var NEXUS = (root.NEXUS = root.NEXUS || {});

  var NAME_MIN = 2;
  var NAME_MAX = 80;
  var FREE_TEXT_MAX = 200;
  var REQUIRED_LIBS = ["trades", "regions", "phone", "sha256", "leadSchema", "consent", "waLink"];

  function text(value) {
    return typeof value === "string" ? value : "";
  }
  function trimmed(value) {
    return text(value).trim();
  }
  function orNull(value) {
    var t = trimmed(value);
    return t === "" ? null : t;
  }

  // Same helper as app.js's refFromHash (duplicated, not shared - see that file's comment
  // for the full rationale): the campaign ref from the URL fragment, null if absent.
  function refFromHash(win) {
    var h = (win && win.location && typeof win.location.hash === "string") ? win.location.hash : "";
    if (h.charAt(0) === "#") h = h.slice(1);
    h = h.trim();
    return h === "" ? null : h;
  }

  function two(n) {
    return (n < 10 ? "0" : "") + n;
  }
  function isoWithOffset(date) {
    var offset = -date.getTimezoneOffset();
    var sign = offset >= 0 ? "+" : "-";
    var abs = Math.abs(offset);
    return (
      date.getFullYear() + "-" + two(date.getMonth() + 1) + "-" + two(date.getDate()) +
      "T" + two(date.getHours()) + ":" + two(date.getMinutes()) + ":" + two(date.getSeconds()) +
      sign + two(Math.floor(abs / 60)) + ":" + two(abs % 60)
    );
  }

  // Builds the HTML for one checkbox group from a plain string array - the same "list comes
  // from the lib, not written into the HTML" principle app.js's fillSelect follows for <select>,
  // extended here to <input type="checkbox"> (see tests/product-dom-stub.mjs for why this needs
  // each box to carry its own id, not just a shared name).
  function checkboxGroupHtml(idPrefix, values) {
    var html = "";
    for (var i = 0; i < values.length; i += 1) {
      html +=
        '<label class="check-item"><input type="checkbox" id="' + idPrefix + i + '" value="' +
        escapeAttr(values[i]) + '">' + "<span>" + escapeHtml(values[i]) + "</span></label>";
    }
    return html;
  }
  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function escapeAttr(s) {
    return escapeHtml(s).replace(/"/g, "&quot;");
  }

  function createPartnersApp(deps) {
    var doc = deps.doc;
    var win = deps.win;
    var nowFn = deps.now || function () { return new Date(); };
    var openFn = deps.open || function (url, target, features) { return win.open(url, target, features); };
    var apiClient = deps.apiClient || null;

    var errors = [];

    function logError(code, err) {
      errors.push({ code: code, message: String((err && err.message) || err) });
      if (win && win.console && typeof win.console.warn === "function") {
        win.console.warn("[nexus] " + code + ": " + String((err && err.message) || err));
      }
    }

    function el(id) {
      return doc.getElementById(id);
    }

    function missingLibs() {
      var missing = [];
      for (var i = 0; i < REQUIRED_LIBS.length; i += 1) {
        if (!NEXUS[REQUIRED_LIBS[i]]) missing.push(REQUIRED_LIBS[i]);
      }
      return missing;
    }

    function populate() {
      var svc = el("services-group");
      if (svc) svc.innerHTML = checkboxGroupHtml("svc-", NEXUS.trades.TRADES_HE);
      var reg = el("regions-group");
      if (reg) reg.innerHTML = checkboxGroupHtml("reg-", NEXUS.regions.REGIONS_HE);
      var box = el("consent-text");
      if (box) box.textContent = NEXUS.consent.TEXT_HE;
    }

    function collect() {
      var services = [];
      for (var i = 0; i < NEXUS.trades.TRADES_HE.length; i += 1) {
        var sbox = el("svc-" + i);
        if (sbox && sbox.checked === true) services.push(NEXUS.trades.TRADES_HE[i]);
      }
      var regionsOut = [];
      for (var j = 0; j < NEXUS.regions.REGIONS_HE.length; j += 1) {
        var rbox = el("reg-" + j);
        if (rbox && rbox.checked === true) regionsOut.push(NEXUS.regions.REGIONS_HE[j]);
      }
      var buyerBox = el("f-role-buyer");
      var supplierBox = el("f-role-supplier");
      var role = buyerBox && buyerBox.checked === true ? "buyer"
        : supplierBox && supplierBox.checked === true ? "supplier" : "";
      var nameEl = el("f-name");
      var phoneEl = el("f-phone");
      var textEl = el("f-text");
      var consentEl = el("f-consent");
      return {
        role: role,
        name: nameEl ? text(nameEl.value) : "",
        phone: phoneEl ? text(phoneEl.value) : "",
        free_text: textEl ? text(textEl.value) : "",
        services: services,
        regions: regionsOut,
        consent: consentEl ? consentEl.checked === true : false
      };
    }

    function validate(values) {
      var problems = [];
      function bad(focusId, errId, field, message) {
        problems.push({ focusId: focusId, errId: errId, field: field, message: message });
      }
      if (values.role !== "buyer" && values.role !== "supplier") {
        bad("f-role-supplier", "e-role", "role", "בחרו מה מתאים לך.");
      }
      if (trimmed(values.name).length < NAME_MIN) bad("f-name", "e-name", "name", "צריך לכתוב שם.");
      else if (trimmed(values.name).length > NAME_MAX) bad("f-name", "e-name", "name", "השם ארוך מדי.");
      if (!NEXUS.phone.toE164(text(values.phone)).ok) {
        bad("f-phone", "e-phone", "phone", "מספר הטלפון לא תקין. לדוגמה: 050-0000000.");
      }
      if (!values.services || values.services.length === 0) {
        bad("services-group", "e-services", "services", "בחרו לפחות שירות אחד.");
      }
      if (!values.regions || values.regions.length === 0) {
        bad("regions-group", "e-regions", "regions", "בחרו לפחות אזור אחד.");
      }
      if (text(values.free_text).length > FREE_TEXT_MAX) {
        bad("f-text", "e-text", "free_text", "הטקסט ארוך מ-" + FREE_TEXT_MAX + " תווים.");
      }
      if (values.consent !== true) bad("f-consent", "e-consent", "consent", "צריך לאשר את ההסכמה כדי לשלוח.");
      return problems;
    }

    function clearErrors() {
      var ids = ["e-role", "e-name", "e-phone", "e-services", "e-regions", "e-text", "e-consent"];
      for (var i = 0; i < ids.length; i += 1) {
        var box = el(ids[i]);
        if (box) {
          box.textContent = "";
          box.hidden = true;
        }
      }
      var summary = el("form-error");
      if (summary) {
        summary.textContent = "";
        summary.hidden = true;
      }
    }

    function showErrors(list) {
      for (var i = 0; i < list.length; i += 1) {
        var box = el(list[i].errId);
        if (box) {
          box.textContent = list[i].message;
          box.hidden = false;
        }
      }
      var summary = el("form-error");
      if (summary) {
        summary.textContent = list.length === 1
          ? "יש שדה אחד לתקן: " + list[0].message
          : "יש " + list.length + " שדות לתקן. הראשון: " + list[0].message;
        summary.hidden = false;
      }
      var first = el(list[0].focusId);
      if (first && typeof first.focus === "function") first.focus();
    }

    function buildPartner(values, at) {
      return {
        created_at: at,
        role: values.role,
        name: trimmed(values.name),
        phone_e164: NEXUS.phone.toE164(values.phone).e164,
        services: values.services.slice(),
        regions: values.regions.slice(),
        free_text: orNull(values.free_text)
      };
    }

    function waForm(values, partner) {
      return {
        category: "partner",
        role: partner.role,
        services: partner.services.join(", "),
        regions: partner.regions.join(", "),
        name: partner.name
      };
    }

    // Body for POST /public/partners - confirmed (not guessed) against the real backend,
    // engine/public/public_api.py's _validate_partner/_create_partner + nexus_master/partners.py
    // (both read 2026-11-08, round 4): field is `type` (buyer|supplier), not `role`; `services`
    // and `areas` are comma-separated STRINGS (partners.register's own defaults are `services=""`/
    // `areas=""`), not arrays - areas, not "regions" (this page's own user-facing concept; the
    // backend's column is areas, same name brokerage.py/buyers.py already use for suppliers/
    // buyers). No tracking_token in the real response ({ok:true, partner_id, status:"pending"}),
    // so the universal tracking-number line in wa-link.mjs never fires for this category - that
    // is correct, not a gap: there is no /public/partners/<id>/status endpoint to point it at.
    function proxyBody(values, partner) {
      var servicesStr = partner.services.join(", ");
      var areasStr = partner.regions.join(", ");
      return {
        type: partner.role,
        name: partner.name,
        phone: partner.phone_e164,
        services: servicesStr,
        areas: areasStr,
        text: partner.free_text || ("שירותים: " + servicesStr + ". אזורים: " + areasStr + "."),
        consent: values.consent === true
      };
    }

    function navigateHandle(handle, url) {
      if (!handle) return;
      try {
        handle.location = url;
      } catch (err) {
        logError("wa.redirect.failed", err);
      }
    }

    // Self-caught while writing tests/product-12-partners.mjs (see design/STATE-product.md):
    // api-client.mjs's own submitLead/submitPartner only ever RESOLVE, never reject - but a
    // caller here has no way to enforce that on whatever object deps.apiClient actually holds.
    // A client that throws SYNCHRONOUSLY (not even a rejected promise) would otherwise crash
    // onSubmit before WhatsApp ever opens - exactly the "secondary system blocks the real flow"
    // failure every other fallback in this file and in app.js exists to prevent. fn() is called
    // inside the try, not outside it, so a synchronous throw is caught the same way a rejection
    // is handled downstream.
    function safeCall(fn) {
      try {
        return Promise.resolve(fn());
      } catch (err) {
        return Promise.reject(err);
      }
    }

    function onSubmit(event) {
      if (event && typeof event.preventDefault === "function") event.preventDefault();

      clearErrors();
      var values = collect();
      var problems = validate(values);
      if (problems.length > 0) {
        showErrors(problems);
        return { ok: false, errors: problems, opened: 0, reason: "invalid" };
      }

      var at = isoWithOffset(nowFn());
      var partner = buildPartner(values, at);

      // Round 5 (2026-11-09, urgent): same change as app.js's onSubmit, and for the same
      // reason - see wa-link.mjs's header comment. There is no hardcoded business number left
      // to open wa.me with synchronously; a blank tab is still reserved inside the click
      // handler (popup blockers only allow window.open() during the original gesture), and is
      // either redirected to a real wa.me link or closed again, depending on what the async
      // GET /public/config answers.
      var handle = openFn("", "_blank", "noopener");

      var leadPromise;
      var configPromise;
      if (!apiClient) {
        leadPromise = Promise.resolve({ ok: false, error: "no_client" });
        configPromise = Promise.resolve({ ok: true, business_whatsapp: null });
      } else {
        // design/research/launch-posts-he.md: post #3 (fb_pro) links here with a campaign
        // ref in the URL fragment. Sent even though nexus_master/partners.py's register()
        // has no source/campaign column today (see design/STATE-product.md) - harmless and
        // forward-compatible: the proxy already ignores unknown body keys, and this is one
        // line to delete if that never changes, instead of a missing one to add later.
        var body = proxyBody(values, partner);
        var ref = refFromHash(win);
        if (ref) body.source = ref;
        leadPromise = safeCall(function () { return apiClient.submitPartner(body); });
        configPromise = safeCall(function () { return apiClient.getConfig(); });
      }

      function finish(leadResult, configResult) {
        var token = leadResult && leadResult.ok && leadResult.tracking_token ? leadResult.tracking_token : null;
        var waNumber = (configResult && configResult.business_whatsapp) ? configResult.business_whatsapp : null;

        if (!leadResult || !leadResult.ok) {
          if (apiClient) logError("partner.proxy.unavailable", new Error((leadResult && leadResult.error) || "unknown"));
          closeHandle(handle);
          showNote("חזרו אלינו בקרוב.");
          return { outcome: "no_api", final_url: null, final_text: null, tracking_token: null, proxy: leadResult };
        }

        if (waNumber) {
          var withToken = waForm(values, partner);
          if (token) withToken.tracking_token = token;
          var wa = NEXUS.waLink.buildWaLink(withToken, waNumber);
          if (wa.ok) {
            navigateHandle(handle, wa.url);
            showNote("נפתח וואטסאפ עם הפרטים. אם לא נפתח - בדקו חוסם חלונות קופצים ולחצו שוב.");
            return { outcome: "wa_opened", final_url: wa.url, final_text: wa.text, tracking_token: token, proxy: leadResult };
          }
          logError("wa.link.too_long", new Error(wa.reason));
        }

        closeHandle(handle);
        // partners.py's real response never carries a tracking_token (see proxyBody's own
        // comment above) - token here is always null in practice, so this is "קיבלנו את
        // הפנייה." every time, not dead code for a case that could still happen.
        showNote(token
          ? "קיבלנו, מספר פנייה: " + token + ". אפשר לעקוב בדף הסטטוס: " + NEXUS.waLink.statusLinkFor(token)
          : "קיבלנו את הפנייה.");
        return { outcome: "received", final_url: null, final_text: null, tracking_token: token, proxy: leadResult };
      }

      var pending = Promise.all([leadPromise, configPromise]).then(
        function (results) { return finish(results[0], results[1]); },
        function (err) {
          logError("partner.proxy.threw", err);
          closeHandle(handle);
          showNote("חזרו אלינו בקרוב.");
          return { outcome: "no_api", final_url: null, final_text: null, tracking_token: null, proxy: null };
        }
      );

      return { ok: true, partner: partner, opened: 1, handle: handle, pending: pending, errors: [] };
    }

    function showNote(message) {
      var note = el("saved-note");
      if (note) {
        note.textContent = message;
        note.hidden = false;
        if (note.classList && note.classList.add) note.classList.add("ok");
      }
    }

    function closeHandle(handle) {
      if (!handle) return;
      try {
        if (typeof handle.close === "function") handle.close();
      } catch (err) {
        logError("wa.close.failed", err);
      }
    }

    function syncConsentGate() {
      var box = el("f-consent");
      var btn = el("btn-submit");
      if (!btn) return false;
      var checked = !!(box && box.checked === true);
      btn.disabled = !checked;
      return checked;
    }

    function init() {
      var missing = missingLibs();
      if (missing.length > 0) throw new Error("partners-app: missing libs: " + missing.join(", "));
      populate();
      syncConsentGate();
      var box = el("f-consent");
      if (box && typeof box.addEventListener === "function") {
        box.addEventListener("change", syncConsentGate);
        box.addEventListener("input", syncConsentGate);
      }
      var form = el("form-partners");
      if (form && typeof form.addEventListener === "function") {
        form.addEventListener("submit", onSubmit);
      }
      return this;
    }

    return {
      errors: errors,
      init: init,
      collect: collect,
      validate: function () { return validate(collect()); },
      onSubmit: onSubmit,
      syncConsentGate: syncConsentGate,
      clearErrors: clearErrors,
      showErrors: showErrors
    };
  }

  function boot(extra) {
    var deps = { doc: root.document, win: root };
    if (extra) {
      for (var k in extra) {
        if (Object.prototype.hasOwnProperty.call(extra, k)) deps[k] = extra[k];
      }
    }
    var app = createPartnersApp(deps);
    app.init();
    NEXUS.partnersAppInstance = app;
    return app;
  }

  NEXUS.partnersApp = {
    NAME_MIN: NAME_MIN,
    NAME_MAX: NAME_MAX,
    FREE_TEXT_MAX: FREE_TEXT_MAX,
    REQUIRED_LIBS: REQUIRED_LIBS,
    isoWithOffset: isoWithOffset,
    checkboxGroupHtml: checkboxGroupHtml,
    createPartnersApp: createPartnersApp,
    boot: boot
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
