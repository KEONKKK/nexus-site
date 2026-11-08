// NEXUS - src/lib/wa-link.mjs - builds the wa.me click-to-chat link. Item 4.
//
// Two hard numbers, from recon topic 8:
//   * the pre-filled text is at most 150 SOURCE characters;
//   * the whole URL is at most 700 characters.
// The second one is the binding constraint, not the first: every Hebrew letter becomes 9
// characters once URL-encoded (%D7%A9 and friends), so 150 Hebrew characters would be about
// 1350 encoded. The builder therefore drops the lowest-value field, in a declared order,
// until BOTH limits hold - and reports what it dropped instead of silently truncating.
//
// The text carries only what the recipient cannot guess: trade / city / urgency / budget /
// name. Never the free text (it would blow the length), and never the phone number - the
// recipient already sees it as the sender of the message.
//
// Needs loaded first: lead-schema.mjs. Optional: phone.mjs (only for toWaDigits).
// Dual-mode file (no import/export) - see the header of src/lib/lead-schema.mjs.

(function (root) {
  "use strict";
  var NEXUS = (root.NEXUS = root.NEXUS || {});

  // The business number leads land on. Israel, international format, no leading zero,
  // no brackets and no dashes - exactly what WhatsApp's documentation requires.
  var WA_NUMBER = "972559814818";
  var WA_BASE = "https://wa.me/";

  var MAX_SOURCE_CHARS = 150;
  var MAX_URL_CHARS = 700;

  var LEAD_IN = "שלום, הגעתי מהאתר.";

  // The ONLY keys that may ever reach the text. Anything else on the form object is ignored.
  var ALLOWED_KEYS = [
    "category", "trade", "city", "urgency", "budget_max", "name",
    "deal_type", "timeline", "kit_requested", "business_type"
  ];

  // Dropped first -> dropped last. Name goes first because the recipient sees who is
  // writing anyway; trade/city survive longest because they are what routes the lead.
  var DROP_ORDER = ["name", "urgency", "budget", "city", "trade"];

  function schema() {
    if (!NEXUS.leadSchema) throw new Error("wa-link: src/lib/lead-schema.mjs must be loaded first");
    return NEXUS.leadSchema;
  }

  function str(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  // [{ id, text }] in display order, built only from ALLOWED_KEYS.
  function composeFields(form) {
    var S = schema();
    var f = {};
    for (var i = 0; i < ALLOWED_KEYS.length; i += 1) {
      var key = ALLOWED_KEYS[i];
      if (form && Object.prototype.hasOwnProperty.call(form, key)) f[key] = form[key];
    }

    var fields = [];
    var category = f.category;

    if (category === "realestate") {
      if (str(f.deal_type) !== "") fields.push({ id: "trade", text: S.labelHe("deal_type", f.deal_type) + "." });
      if (str(f.city) !== "") fields.push({ id: "city", text: "עיר: " + str(f.city) + "." });
      if (str(f.timeline) !== "") fields.push({ id: "urgency", text: S.labelHe("timeline", f.timeline) + "." });
    } else if (category === "kit") {
      if (str(f.kit_requested) !== "") fields.push({ id: "trade", text: S.labelHe("kit_requested", f.kit_requested) + "." });
      if (str(f.business_type) !== "") fields.push({ id: "urgency", text: "עסק: " + str(f.business_type) + "." });
      if (str(f.city) !== "") fields.push({ id: "city", text: "עיר: " + str(f.city) + "." });
    } else {
      if (str(f.trade) !== "") fields.push({ id: "trade", text: "תחום: " + str(f.trade) + "." });
      if (str(f.city) !== "") fields.push({ id: "city", text: "עיר: " + str(f.city) + "." });
      if (str(f.urgency) !== "") fields.push({ id: "urgency", text: "דחיפות: " + S.labelHe("urgency", f.urgency) + "." });
    }

    if (Number.isInteger(f.budget_max) && f.budget_max > 0) {
      fields.push({ id: "budget", text: "תקציב עד " + S.formatAgorot(f.budget_max) + "." });
    }
    if (str(f.name) !== "") fields.push({ id: "name", text: str(f.name) + "." });

    return fields;
  }

  function render(fields) {
    var out = LEAD_IN;
    for (var i = 0; i < fields.length; i += 1) out += " " + fields[i].text;
    return out;
  }

  function nextToDrop(fields) {
    for (var i = 0; i < DROP_ORDER.length; i += 1) {
      for (var j = 0; j < fields.length; j += 1) {
        if (fields[j].id === DROP_ORDER[i]) return j;
      }
    }
    return -1;
  }

  // Returns { ok, url, text, source_chars, url_chars, dropped, reason }.
  function buildWaLink(form) {
    var fields = composeFields(form);
    var dropped = [];
    for (;;) {
      var text = render(fields);
      // encodeURIComponent, NOT encodeURI: encodeURI leaves , ; : @ + $ & = ? # / raw,
      // and a raw & or # would cut the message short in the query string.
      var url = WA_BASE + WA_NUMBER + "?text=" + encodeURIComponent(text);
      if (text.length <= MAX_SOURCE_CHARS && url.length <= MAX_URL_CHARS) {
        return {
          ok: true,
          url: url,
          text: text,
          source_chars: text.length,
          url_chars: url.length,
          dropped: dropped,
          reason: null,
        };
      }
      var idx = nextToDrop(fields);
      if (idx === -1) {
        return {
          ok: false,
          url: null,
          text: text,
          source_chars: text.length,
          url_chars: url.length,
          dropped: dropped,
          reason: "too_long",
        };
      }
      dropped.push(fields[idx].id);
      fields.splice(idx, 1);
    }
  }

  // Just the text, for showing the user what is about to be sent.
  function buildWaText(form) {
    var r = buildWaLink(form);
    return r.text;
  }

  NEXUS.waLink = {
    WA_NUMBER: WA_NUMBER,
    WA_BASE: WA_BASE,
    MAX_SOURCE_CHARS: MAX_SOURCE_CHARS,
    MAX_URL_CHARS: MAX_URL_CHARS,
    LEAD_IN: LEAD_IN,
    ALLOWED_KEYS: ALLOWED_KEYS,
    DROP_ORDER: DROP_ORDER,
    buildWaLink: buildWaLink,
    buildWaText: buildWaText,
    composeFields: composeFields,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
