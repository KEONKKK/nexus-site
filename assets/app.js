// NEXUS - src/assets/app.js - the page controller for both public pages. Items 5 and 6.
//
// Testable without a browser on purpose: createApp() takes its whole world as arguments
// (document, window, clock, randomness, storage, downloader, opener), so node can drive the
// exact same code with a stubbed DOM. Nothing here reaches for a global except through those
// arguments, and boot() is the only function that touches the real document.
//
// The submit order is fixed and is the whole point of the page (recon topic 8):
//   1. validate      - on failure: focus the first bad field, show a Hebrew message,
//                      and DO NOT open WhatsApp;
//   2. save          - localStorage + a downloaded JSON file; if this fails it is logged
//                      and ignored, because a lead lost in our system beats a lost customer;
//   3. open WhatsApp - window.open(url, "_blank", "noopener").
//
// Dual-mode file (no import/export) - see the header of src/lib/lead-schema.mjs.

(function (root) {
  "use strict";
  var NEXUS = (root.NEXUS = root.NEXUS || {});

  var STORAGE_KEY = "nexus.leads";
  var STORAGE_MAX = 100;        // the browser is a staging area, not the database
  var FREE_TEXT_MAX_PAGE = 200; // tighter than the schema's 1000, to keep the lead readable
  var NAME_MIN = 2;
  var NAME_MAX = 80;
  var CITY_MAX = 60;

  var REQUIRED_LIBS = ["leadSchema", "trades", "phone", "sha256", "scoreConfig", "leadScore", "consent", "waLink"];

  // ---------------------------------------------------------------- small helpers

  function two(n) {
    return (n < 10 ? "0" : "") + n;
  }

  // ISO 8601 with a real offset, from the device clock. A browser has no server time;
  // the offset is what makes the stamp unambiguous later.
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

  function defaultRandomBytes(win) {
    return function (n) {
      var out = new Uint8Array(n);
      var c = (win && win.crypto) || (root && root.crypto);
      if (!c || typeof c.getRandomValues !== "function") throw new Error("no crypto.getRandomValues");
      c.getRandomValues(out);
      return out;
    };
  }

  function browserDownload(doc, win) {
    return function (filename, body, mime) {
      // body is a string (the lead JSON) or a Uint8Array (the kit ZIP); Blob takes both
      var blob = new win.Blob([body], { type: mime || "application/json;charset=utf-8" });
      var url = win.URL.createObjectURL(blob);
      var a = doc.createElement("a");
      a.href = url;
      a.download = filename;
      a.rel = "noopener";
      if (doc.body && doc.body.appendChild) doc.body.appendChild(a);
      a.click();
      if (doc.body && doc.body.removeChild) doc.body.removeChild(a);
      if (win.setTimeout) win.setTimeout(function () { win.URL.revokeObjectURL(url); }, 0);
    };
  }

  // ---------------------------------------------------------------- page definitions

  var FIND_PRO_FIELDS = [
    { id: "f-trade", err: "e-trade", key: "trade", required: true },
    { id: "f-city", err: "e-city", key: "city", required: true },
    { id: "f-urgency", err: "e-urgency", key: "urgency", required: true },
    { id: "f-budget", err: "e-budget", key: "budget_max", required: false },
    { id: "f-text", err: "e-text", key: "free_text", required: false },
    { id: "f-name", err: "e-name", key: "name", required: true },
    { id: "f-phone", err: "e-phone", key: "phone", required: true },
    { id: "f-consent", err: "e-consent", key: "consent", required: true, kind: "checkbox" }
  ];

  var KIT_FIELDS = [
    { id: "f-name", err: "e-name", key: "name", required: true },
    { id: "f-business-type", err: "e-business-type", key: "business_type", required: true },
    { id: "f-city", err: "e-city", key: "city", required: true },
    { id: "f-size", err: "e-size", key: "business_size", required: true },
    { id: "f-pain", err: "e-pain", key: "pain", required: true },
    { id: "f-kit", err: "e-kit", key: "kit_requested", required: true },
    { id: "f-text", err: "e-text", key: "free_text", required: false },
    { id: "f-phone", err: "e-phone", key: "phone", required: true },
    { id: "f-consent", err: "e-consent", key: "consent", required: true, kind: "checkbox" }
  ];

  function fillSelect(doc, id, options, placeholder) {
    var el = doc.getElementById(id);
    if (!el) return 0;
    var html = '<option value="">' + placeholder + "</option>";
    for (var i = 0; i < options.length; i += 1) {
      html += '<option value="' + escapeAttr(options[i].value) + '">' + escapeHtml(options[i].label) + "</option>";
    }
    el.innerHTML = html;
    return options.length;
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function escapeAttr(s) {
    return escapeHtml(s).replace(/"/g, "&quot;");
  }

  var PAGES = {
    "find-pro": {
      name: "find-pro",
      page: "/find-pro",
      category: "pro",
      formId: "form-find-pro",
      fields: FIND_PRO_FIELDS,

      populate: function (doc) {
        var trades = NEXUS.trades.TRADES_HE.map(function (t) { return { value: t, label: t }; });
        fillSelect(doc, "f-trade", trades, "בחרו תחום");
        var urgencies = NEXUS.leadSchema.URGENCIES.map(function (u) {
          return { value: u, label: NEXUS.leadSchema.labelHe("urgency", u) };
        });
        fillSelect(doc, "f-urgency", urgencies, "בחרו דחיפות");
        var box = doc.getElementById("consent-text");
        if (box) box.textContent = NEXUS.consent.TEXT_HE;
      },

      validate: function (values) {
        var S = NEXUS.leadSchema;
        var errors = [];
        function bad(id, field, message) {
          errors.push({ id: id, field: field, message: message });
        }

        if (trimmed(values.trade) === "") bad("f-trade", "trade", "בחרו תחום מהרשימה.");
        else if (!NEXUS.trades.isKnownTrade(trimmed(values.trade))) bad("f-trade", "trade", "התחום הזה לא מהרשימה. בחרו מהרשימה.");

        if (trimmed(values.city) === "") bad("f-city", "city", "צריך לכתוב עיר.");
        else if (trimmed(values.city).length > CITY_MAX) bad("f-city", "city", "שם העיר ארוך מדי.");

        if (trimmed(values.urgency) === "") bad("f-urgency", "urgency", "בחרו כמה דחוף.");
        else if (S.URGENCIES.indexOf(trimmed(values.urgency)) === -1) bad("f-urgency", "urgency", "בחרו דחיפות מהרשימה.");

        if (trimmed(values.budget_max) !== "") {
          var budget = S.parseBudgetToAgorot(values.budget_max);
          if (!budget.ok) bad("f-budget", "budget_max", "התקציב צריך להיות מספר גדול מאפס, בשקלים. אפשר גם להשאיר ריק.");
        }

        if (text(values.free_text).length > FREE_TEXT_MAX_PAGE) {
          bad("f-text", "free_text", "התיאור ארוך מ-" + FREE_TEXT_MAX_PAGE + " תווים.");
        }

        if (trimmed(values.name).length < NAME_MIN) bad("f-name", "name", "צריך לכתוב שם מלא.");
        else if (trimmed(values.name).length > NAME_MAX) bad("f-name", "name", "השם ארוך מדי.");

        if (!NEXUS.phone.toE164(text(values.phone)).ok) {
          bad("f-phone", "phone", "מספר הטלפון לא תקין. לדוגמה: 050-0000000.");
        }

        if (values.consent !== true) bad("f-consent", "consent", "צריך לאשר את ההסכמה כדי לשלוח.");

        return errors;
      },

      buildLead: function (values, env) {
        var S = NEXUS.leadSchema;
        var budget = trimmed(values.budget_max) === "" ? null : S.parseBudgetToAgorot(values.budget_max).agorot;
        var lead = {
          id: S.makeLeadId(env.randomBytes(24)),
          created_at: env.at,
          category: "pro",
          name: trimmed(values.name),
          phone_e164: NEXUS.phone.toE164(values.phone).e164,
          city: trimmed(values.city),
          email: null,
          free_text: orNull(values.free_text),
          source: env.source,
          status: "new",
          consent: env.consent,
          optout: null,
          trade: trimmed(values.trade),
          urgency: trimmed(values.urgency),
          budget_max: budget
        };
        // the scores are computed from the finished lead and then attached to it.
        // providers is [] on the client by construction, so `fit` is honestly 0 here.
        lead.scores = NEXUS.leadScore.scoreLead(lead, { providers: [], now: env.nowMs });
        return lead;
      },

      waForm: function (values, lead) {
        return {
          category: "pro",
          trade: lead.trade,
          city: lead.city,
          urgency: lead.urgency,
          budget_max: lead.budget_max,
          name: lead.name
        };
      },

      okNote: function (wa) {
        return "נפתח וואטסאפ עם ההודעה. אם לא נפתח - בדקו חוסם חלונות קופצים ולחצו שוב.";
      }
    },

    // Same skeleton, different fields (recon topic 8): no urgency, and the lead carries the
    // kit answers. One extra step at the end: the kit ZIP is built in the browser.
    //
    // NOTE on `name`: on this page the schema's `name` field holds the BUSINESS name, and
    // `business_type` holds what kind of business it is. The schema is frozen and has one
    // name field; for a kit lead that field is the business. Written down here because it is
    // the one place the two pages read the same field differently.
    kits: {
      name: "kits",
      page: "/kits",
      category: "kit",
      formId: "form-kits",
      fields: KIT_FIELDS,
      extraLibs: ["zipStore", "kitTemplates", "kitBuild"],

      populate: function (doc) {
        var S = NEXUS.leadSchema;
        fillSelect(doc, "f-size", S.BUSINESS_SIZES.map(function (v) {
          return { value: v, label: S.labelHe("business_size", v) };
        }), "בחרו גודל");
        fillSelect(doc, "f-pain", S.KIT_PAINS.map(function (v) {
          return { value: v, label: S.labelHe("pain", v) };
        }), "בחרו");
        fillSelect(doc, "f-kit", S.KITS.map(function (v) {
          return { value: v, label: S.labelHe("kit_requested", v) };
        }), "בחרו ערכה");
        var box = doc.getElementById("consent-text");
        if (box) box.textContent = NEXUS.consent.TEXT_HE;
      },

      validate: function (values) {
        var S = NEXUS.leadSchema;
        var errors = [];
        function bad(id, field, message) {
          errors.push({ id: id, field: field, message: message });
        }

        if (trimmed(values.name).length < NAME_MIN) bad("f-name", "name", "צריך לכתוב את שם העסק.");
        else if (trimmed(values.name).length > NAME_MAX) bad("f-name", "name", "שם העסק ארוך מדי.");

        if (trimmed(values.business_type) === "") bad("f-business-type", "business_type", "צריך לכתוב מה סוג העסק.");
        else if (trimmed(values.business_type).length > 60) bad("f-business-type", "business_type", "סוג העסק ארוך מדי.");

        if (trimmed(values.city) === "") bad("f-city", "city", "צריך לכתוב עיר.");
        else if (trimmed(values.city).length > CITY_MAX) bad("f-city", "city", "שם העיר ארוך מדי.");

        if (S.BUSINESS_SIZES.indexOf(trimmed(values.business_size)) === -1) {
          bad("f-size", "business_size", "בחרו את גודל העסק.");
        }
        if (S.KIT_PAINS.indexOf(trimmed(values.pain)) === -1) {
          bad("f-pain", "pain", "בחרו מה הכי כואב כרגע.");
        }
        if (S.KITS.indexOf(trimmed(values.kit_requested)) === -1) {
          bad("f-kit", "kit_requested", "בחרו איזו ערכה אתם רוצים.");
        }

        if (text(values.free_text).length > FREE_TEXT_MAX_PAGE) {
          bad("f-text", "free_text", "הטקסט ארוך מ-" + FREE_TEXT_MAX_PAGE + " תווים.");
        }

        if (!NEXUS.phone.toE164(text(values.phone)).ok) {
          bad("f-phone", "phone", "מספר הטלפון לא תקין. לדוגמה: 050-0000000.");
        }

        if (values.consent !== true) bad("f-consent", "consent", "צריך לאשר את ההסכמה כדי לשלוח.");

        return errors;
      },

      buildLead: function (values, env) {
        var S = NEXUS.leadSchema;
        var lead = {
          id: S.makeLeadId(env.randomBytes(24)),
          created_at: env.at,
          category: "kit",
          name: trimmed(values.name),
          phone_e164: NEXUS.phone.toE164(values.phone).e164,
          city: trimmed(values.city),
          email: null,
          free_text: orNull(values.free_text),
          source: env.source,
          status: "new",
          consent: env.consent,
          optout: null,
          business_type: trimmed(values.business_type),
          pain: trimmed(values.pain),
          business_size: trimmed(values.business_size),
          kit_requested: trimmed(values.kit_requested)
        };
        lead.scores = NEXUS.leadScore.scoreLead(lead, { providers: [], now: env.nowMs });
        return lead;
      },

      waForm: function (values, lead) {
        return {
          category: "kit",
          kit_requested: lead.kit_requested,
          business_type: lead.business_type,
          city: lead.city,
          name: lead.name
        };
      },

      // The kit itself. Built from the lead, so the ZIP and the lead can never disagree.
      kitValues: function (lead) {
        return {
          business_name: lead.name,
          trade: lead.business_type,
          city: lead.city,
          phone_e164: lead.phone_e164,
          kit_requested: lead.kit_requested
        };
      },

      okNote: function (wa) {
        return "הערכה ירדה כקובץ ZIP, ונפתח וואטסאפ עם ההודעה. אם ההורדה לא התחילה - בדקו את תיקיית ההורדות.";
      }
    }
  };

  // ---------------------------------------------------------------- the controller

  function createApp(deps) {
    var doc = deps.doc;
    var win = deps.win;
    var spec = PAGES[deps.page || "find-pro"];
    if (!spec) throw new Error("app: unknown page " + deps.page);

    var nowFn = deps.now || function () { return new Date(); };
    var randomBytes = deps.randomBytes || defaultRandomBytes(win);
    var openFn = deps.open || function (url, target, features) { return win.open(url, target, features); };
    var download = deps.download || browserDownload(doc, win);
    var storage = deps.storage !== undefined ? deps.storage : (win && win.localStorage);

    var errors = [];      // the log scenario (יא) counts
    var firstSeenAt = null;

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
      var needed = REQUIRED_LIBS.concat(spec.extraLibs || []);
      var missing = [];
      for (var i = 0; i < needed.length; i += 1) {
        if (!NEXUS[needed[i]]) missing.push(needed[i]);
      }
      return missing;
    }

    function collect() {
      var values = {};
      for (var i = 0; i < spec.fields.length; i += 1) {
        var f = spec.fields[i];
        var node = el(f.id);
        if (!node) {
          values[f.key] = f.kind === "checkbox" ? false : "";
          continue;
        }
        values[f.key] = f.kind === "checkbox" ? node.checked === true : text(node.value);
      }
      return values;
    }

    function clearErrors() {
      for (var i = 0; i < spec.fields.length; i += 1) {
        var f = spec.fields[i];
        var box = el(f.err);
        if (box) {
          box.textContent = "";
          box.hidden = true;
        }
        var node = el(f.id);
        if (node && node.removeAttribute) node.removeAttribute("aria-invalid");
      }
      var summary = el("form-error");
      if (summary) {
        summary.textContent = "";
        summary.hidden = true;
      }
    }

    function showErrors(list) {
      for (var i = 0; i < list.length; i += 1) {
        var box = el(list[i].id.replace(/^f-/, "e-"));
        if (box) {
          box.textContent = list[i].message;
          box.hidden = false;
        }
        var node = el(list[i].id);
        if (node && node.setAttribute) node.setAttribute("aria-invalid", "true");
      }
      var summary = el("form-error");
      if (summary) {
        summary.textContent = list.length === 1
          ? "יש שדה אחד לתקן: " + list[0].message
          : "יש " + list.length + " שדות לתקן. הראשון: " + list[0].message;
        summary.hidden = false;
      }
      // focus the FIRST failing field, in form order
      var first = el(list[0].id);
      if (first && typeof first.focus === "function") first.focus();
    }

    function readSource() {
      var search = (win && win.location && text(win.location.search)) || "";
      function param(key) {
        var m = new RegExp("[?&]" + key + "=([^&#]*)").exec(search);
        return m ? decodeURIComponent(m[1].replace(/\+/g, " ")) : null;
      }
      return {
        page: spec.page,
        utm_source: param("utm_source"),
        utm_medium: param("utm_medium"),
        utm_campaign: param("utm_campaign"),
        referrer: (doc && typeof doc.referrer === "string" && doc.referrer !== "") ? doc.referrer : null,
        first_seen_at: firstSeenAt
      };
    }

    function saveToStorage(lead) {
      if (!storage) throw new Error("no localStorage");
      var raw = storage.getItem(STORAGE_KEY);
      var list = [];
      if (raw) {
        try {
          var parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) list = parsed;
        } catch (err) {
          logError("lead.store.unreadable", err);
        }
      }
      list.push(lead);
      if (list.length > STORAGE_MAX) list = list.slice(list.length - STORAGE_MAX);
      storage.setItem(STORAGE_KEY, JSON.stringify(list));
    }

    // Never throws. Each half has its own catch, so a storage failure does not stop the
    // download and neither of them can stop WhatsApp from opening.
    function trySave(lead) {
      var result = { stored: false, downloaded: false };
      try {
        saveToStorage(lead);
        result.stored = true;
      } catch (err) {
        logError("lead.store.failed", err);
      }
      try {
        download("lead-" + lead.id + ".json", JSON.stringify(lead, null, 2), "application/json;charset=utf-8");
        result.downloaded = true;
      } catch (err) {
        logError("lead.download.failed", err);
      }
      return result;
    }

    // The kit, for the kits page only. Like trySave: it never throws, and it can never stop
    // WhatsApp from opening.
    function tryBuildKit(leadLike) {
      var out = { built: false, downloaded: false, name: null, bytes: 0, reason: null };
      var built = null;
      try {
        built = NEXUS.kitBuild.buildKit(spec.kitValues(leadLike));
      } catch (err) {
        logError("kit.build.failed", err);
        return out;
      }
      out.name = built.zipName;
      out.reason = built.reason;
      if (!built.ok) {
        logError("kit.build.invalid", new Error(String(built.reason) + " " + built.remaining.join(",")));
        return out;
      }
      out.built = true;
      out.bytes = built.bytes;
      try {
        download(built.zipName, built.zip, "application/zip");
        out.downloaded = true;
      } catch (err) {
        logError("kit.download.failed", err);
      }
      return out;
    }

    // "download the kit only" - no lead, no message, nothing leaves the device, so the
    // consent box is not required for it. Everything else is validated exactly as usual.
    function onKitOnly(event) {
      if (event && typeof event.preventDefault === "function") event.preventDefault();
      if (!spec.kitValues) return { ok: false, opened: 0, reason: "not_a_kit_page" };
      clearErrors();
      var values = collect();
      var problems = [];
      var all = spec.validate(values);
      for (var i = 0; i < all.length; i += 1) {
        if (all[i].field !== "consent") problems.push(all[i]);
      }
      if (problems.length > 0) {
        showErrors(problems);
        return { ok: false, errors: problems, opened: 0, reason: "invalid" };
      }
      var shim = {
        name: trimmed(values.name),
        business_type: trimmed(values.business_type),
        city: trimmed(values.city),
        phone_e164: NEXUS.phone.toE164(values.phone).e164,
        kit_requested: trimmed(values.kit_requested)
      };
      var kit = tryBuildKit(shim);
      var note = el("saved-note");
      if (note) {
        note.textContent = kit.downloaded
          ? "הערכה ירדה כקובץ " + kit.name + ". לא נשלחה שום הודעה ולא נשמרה שום פנייה."
          : "לא הצלחנו לבנות את הערכה. נסו שוב.";
        note.hidden = false;
      }
      return { ok: kit.downloaded, errors: [], opened: 0, kit: kit, reason: null };
    }

    function syncConsentGate() {
      var box = el("f-consent");
      var btn = el("btn-submit");
      if (!btn) return false;
      var checked = !!(box && box.checked === true);
      btn.disabled = !checked;
      return checked;
    }

    function onSubmit(event) {
      // Always first: without this the browser navigates and everything below is moot.
      if (event && typeof event.preventDefault === "function") event.preventDefault();

      clearErrors();
      var values = collect();
      var problems = spec.validate(values);
      if (problems.length > 0) {
        showErrors(problems);
        return { ok: false, errors: problems, opened: 0, reason: "invalid" };
      }

      var at = isoWithOffset(nowFn());
      var env = {
        at: at,
        nowMs: nowFn().getTime(),
        randomBytes: randomBytes,
        source: readSource(),
        consent: NEXUS.consent.buildConsent({
          granted: values.consent === true,
          at: at,
          page: spec.page,
          url: (win && win.location && text(win.location.href)) || "",
          referrer: (doc && typeof doc.referrer === "string" && doc.referrer !== "") ? doc.referrer : null,
          utm: {},
          user_agent: (win && win.navigator && text(win.navigator.userAgent)) || ""
        })
      };

      var lead = spec.buildLead(values, env);

      // A lead that passed the page but fails the frozen schema is a bug in this page, not
      // a mistake by the person filling it in. Say so instead of sending half a lead.
      var schemaErrors = NEXUS.leadSchema.validate(lead);
      if (schemaErrors.length > 0) {
        logError("lead.schema.invalid", new Error(JSON.stringify(schemaErrors)));
        var summary = el("form-error");
        if (summary) {
          summary.textContent = "משהו אצלנו לא תקין ולכן הפנייה לא נשלחה. נסו שוב בעוד רגע.";
          summary.hidden = false;
        }
        return { ok: false, errors: schemaErrors, opened: 0, reason: "schema" };
      }

      var saved = trySave(lead);
      var kit = spec.kitValues ? tryBuildKit(lead) : null;

      var wa = NEXUS.waLink.buildWaLink(spec.waForm(values, lead));
      if (!wa.ok) {
        logError("wa.link.too_long", new Error(wa.reason));
        return { ok: false, errors: [{ field: "wa", message: wa.reason }], opened: 0, reason: "wa_link", lead: lead, saved: saved, kit: kit };
      }

      var opened = 0;
      var handle = openFn(wa.url, "_blank", "noopener");
      opened = 1;

      var note = el("saved-note");
      if (note) {
        note.textContent = spec.okNote(wa);
        note.hidden = false;
        if (note.classList && note.classList.add) note.classList.add("ok");
      }

      var form = el(spec.formId);
      if (form && typeof form.reset === "function") {
        // keep the typed values: people often want to send a second, similar enquiry
      }

      return { ok: true, lead: lead, saved: saved, kit: kit, url: wa.url, text: wa.text, opened: opened, handle: handle, errors: [] };
    }

    function init() {
      var missing = missingLibs();
      if (missing.length > 0) throw new Error("app: missing libs: " + missing.join(", "));
      firstSeenAt = isoWithOffset(nowFn());
      spec.populate(doc);
      syncConsentGate(); // starts disabled, because the box starts unchecked
      var box = el("f-consent");
      if (box && typeof box.addEventListener === "function") {
        box.addEventListener("change", syncConsentGate);
        box.addEventListener("input", syncConsentGate);
      }
      var form = el(spec.formId);
      if (form && typeof form.addEventListener === "function") {
        form.addEventListener("submit", onSubmit);
      }
      var btn = el("btn-submit");
      if (btn && typeof btn.addEventListener === "function") {
        // a <button type="submit"> already submits the form; this is the belt for browsers
        // where the form listener did not attach
        btn.addEventListener("click", function (ev) {
          if (form) return; // the form listener handles it
          onSubmit(ev);
        });
      }
      var kitOnly = el("btn-kit-only");
      if (kitOnly && typeof kitOnly.addEventListener === "function") {
        kitOnly.addEventListener("click", onKitOnly);
      }
      return this;
    }

    return {
      spec: spec,
      errors: errors,
      init: init,
      collect: collect,
      validate: function () { return spec.validate(collect()); },
      onSubmit: onSubmit,
      onKitOnly: onKitOnly,
      syncConsentGate: syncConsentGate,
      clearErrors: clearErrors,
      showErrors: showErrors,
      readSource: readSource,
      firstSeenAt: function () { return firstSeenAt; },
      storageKey: STORAGE_KEY
    };
  }

  function boot(pageName) {
    var app = createApp({ doc: root.document, win: root, page: pageName });
    app.init();
    NEXUS.appInstance = app;
    return app;
  }

  NEXUS.app = {
    PAGES: PAGES,
    FIND_PRO_FIELDS: FIND_PRO_FIELDS,
    KIT_FIELDS: KIT_FIELDS,
    STORAGE_KEY: STORAGE_KEY,
    FREE_TEXT_MAX_PAGE: FREE_TEXT_MAX_PAGE,
    REQUIRED_LIBS: REQUIRED_LIBS,
    isoWithOffset: isoWithOffset,
    createApp: createApp,
    boot: boot
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
