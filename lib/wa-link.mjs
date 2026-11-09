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

  // Round 5 (2026-11-09, urgent): there is NO business number hardcoded here anymore, not even
  // as a fallback. "972559814818" used to live in this constant and shipped to the real site -
  // engine/nexus_master/guardian.py now rejects it by name as a fabricated demo number
  // (PLACEHOLDER_NUMBERS), and this file's own job is to never let that happen again: the real
  // number comes from GET /public/config (engine/public/public_api.py's business_whatsapp,
  // backed by guardian.business_number - None until an admin configures it) at RUNTIME, and
  // buildWaLink below takes it as an explicit argument, not a default. A caller with no number
  // yet (config says null, or could not be reached) gets {ok:false, reason:"no_number"} instead
  // of ever being handed a link to a number nobody chose - see src/assets/app.js and
  // src/assets/partners-app.js for how the three outcomes (real number / null / no API at all)
  // are shown to the visitor.
  var WA_BASE = "https://wa.me/";

  var MAX_SOURCE_CHARS = 150;
  var MAX_URL_CHARS = 700;

  var LEAD_IN = "שלום, הגעתי מהאתר.";

  // Round 4: the site's own production origin, for the status-page link below. Filled in by B
  // (per this file's own prior comment: "replace both constants once the real published origin
  // is confirmed") once the GitHub Pages publish actually happened -- design/STATE-infra.md's
  // "B-publish" round. Note this is NOT a bare origin (scheme+host) despite the name: the repo
  // is named nexus-site and is not the special <user>.github.io repo, so GitHub Pages serves it
  // under a /nexus-site/ path prefix -- confirmed live, not assumed (design/STATE-infra.md
  // records node tools/verify-live-site.mjs matching dist/ byte-for-byte at this address).
  var STATUS_PAGE_ORIGIN = "https://keonkkk.github.io/nexus-site";
  var STATUS_PAGE_PATH = "/pages/status/index.html";

  function statusLinkFor(token) {
    return STATUS_PAGE_ORIGIN + STATUS_PAGE_PATH + "#t=" + encodeURIComponent(token);
  }

  // The ONLY keys that may ever reach the text. Anything else on the form object is ignored.
  // "tracking_token" and "role"/"services"/"regions" added in round 4 (opted_out/engine
  // connection; the new partners page) - everything else here is unchanged from item 4.
  var ALLOWED_KEYS = [
    "category", "trade", "city", "urgency", "budget_max", "name",
    "deal_type", "timeline", "kit_requested", "business_type",
    "tracking_token", "role", "services", "regions"
  ];

  // Dropped first -> dropped last. "tracking_link"/"tracking" are new in round 4 and go
  // first, before even "name": a bonus (a receipt the sender keeps in their own WhatsApp
  // history), not part of what the business needs to act on the lead - if space is tight, the
  // lead's own details must survive before anything tracking-related does. Name goes first
  // among the rest because the recipient sees who is writing anyway; trade/city survive
  // longest because they are what routes the lead.
  //
  // tracking_link drops BEFORE the bare tracking number, not together with it (self-caught
  // while testing this round - see design/STATE-product.md): the full absolute status URL
  // (origin + path + token) alone can run 70-90+ characters, which on its own can blow the
  // 150-SOURCE-char cap even on an otherwise-short message - treating "token + link" as one
  // field meant the WHOLE thing got dropped together almost every time, including the token,
  // which is short enough to almost always fit on its own and is worth keeping even without
  // the clickable link.
  var DROP_ORDER = ["tracking_link", "tracking", "name", "urgency", "budget", "city", "trade"];

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
    } else if (category === "partner") {
      // Round 4, src/pages/partners/index.html - see createPartnersApp in partners-app.js.
      // Reuses the existing "trade"/"urgency"/"city" slots as generic priority positions
      // (the same reuse the "kit" branch above already does), not as literal trade data.
      if (str(f.role) !== "") {
        fields.push({
          id: "trade",
          text: f.role === "supplier" ? "בעל מקצוע, מציע/ה שירות." : "מתעניין/ת לקבל לידים."
        });
      }
      if (str(f.services) !== "") fields.push({ id: "urgency", text: "שירותים: " + str(f.services) + "." });
      if (str(f.regions) !== "") fields.push({ id: "city", text: "אזורים: " + str(f.regions) + "." });
    } else {
      if (str(f.trade) !== "") fields.push({ id: "trade", text: "תחום: " + str(f.trade) + "." });
      if (str(f.city) !== "") fields.push({ id: "city", text: "עיר: " + str(f.city) + "." });
      if (str(f.urgency) !== "") fields.push({ id: "urgency", text: "דחיפות: " + S.labelHe("urgency", f.urgency) + "." });
    }

    if (Number.isInteger(f.budget_max) && f.budget_max > 0) {
      fields.push({ id: "budget", text: "תקציב עד " + S.formatAgorot(f.budget_max) + "." });
    }
    if (str(f.name) !== "") fields.push({ id: "name", text: str(f.name) + "." });

    // Universal, round 4: applies to every category, not just one - a tracking_token can come
    // back from /public/leads (new lead), /public/kits, or /public/partners alike, whenever the
    // caller has one to show. Two SEPARATE fields, not one (see the DROP_ORDER comment above):
    // the link is the one usually sacrificed when space is tight, but the short bare number is
    // worth keeping even then - the business can still look a short tracking number up by hand.
    if (str(f.tracking_token) !== "") {
      fields.push({ id: "tracking", text: "מספר פנייה: " + str(f.tracking_token) + "." });
      fields.push({ id: "tracking_link", text: "סטטוס: " + statusLinkFor(str(f.tracking_token)) + "." });
    }

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

  // Returns { ok, url, text, source_chars, url_chars, dropped, reason }. `waNumber` is
  // required to get a URL at all (round 5 - see the header comment above): without one, this
  // returns ok:false, reason:"no_number" immediately, before even running the drop loop -
  // there is no length budget to satisfy for a URL that is never going to be built.
  function buildWaLink(form, waNumber) {
    var fields = composeFields(form);
    if (!waNumber) {
      var plainText = render(fields);
      return {
        ok: false,
        url: null,
        text: plainText,
        source_chars: plainText.length,
        url_chars: null,
        dropped: [],
        reason: "no_number",
      };
    }
    var dropped = [];
    for (;;) {
      var text = render(fields);
      // encodeURIComponent, NOT encodeURI: encodeURI leaves , ; : @ + $ & = ? # / raw,
      // and a raw & or # would cut the message short in the query string.
      var url = WA_BASE + waNumber + "?text=" + encodeURIComponent(text);
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

  // Just the text, for showing the user what is about to be sent. waNumber is irrelevant to
  // the text itself (it never appears in the message body), so this never fails for lack of
  // one - pass anything truthy when the caller only cares about the composed wording.
  function buildWaText(form, waNumber) {
    var r = buildWaLink(form, waNumber || "x");
    return r.text;
  }

  NEXUS.waLink = {
    WA_BASE: WA_BASE,
    MAX_SOURCE_CHARS: MAX_SOURCE_CHARS,
    MAX_URL_CHARS: MAX_URL_CHARS,
    LEAD_IN: LEAD_IN,
    STATUS_PAGE_ORIGIN: STATUS_PAGE_ORIGIN,
    STATUS_PAGE_PATH: STATUS_PAGE_PATH,
    ALLOWED_KEYS: ALLOWED_KEYS,
    DROP_ORDER: DROP_ORDER,
    statusLinkFor: statusLinkFor,
    buildWaLink: buildWaLink,
    buildWaText: buildWaText,
    composeFields: composeFields,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
