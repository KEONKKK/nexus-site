// NEXUS - src/lib/lead-schema.mjs - single source of truth for the lead shape.
// Item 1 of A1-PRODUCT-CORE. Built from scratch (recon topic 7). FROZEN once item 1 closed:
// a change here needs an explicit unfreeze decision, because every page and score reads it.
//
// DUAL-MODE FILE - deliberate, see design/STATE-product.md "סטיות":
// this file contains NO import/export statements, so the very same bytes are
//   (a) importable by node  (`await import(fileURL)` runs it, then read globalThis.NEXUS), and
//   (b) loadable by a browser as a CLASSIC `<script src="...">` from file:// .
// ES modules are blocked by CORS on file:// , and the user must be able to open
// src/pages/find-pro/index.html by double-clicking it with zero server and zero build step.
// Cross-lib calls are therefore made lazily through NEXUS.* at call time, never at load time.

(function (root) {
  "use strict";
  var NEXUS = (root.NEXUS = root.NEXUS || {});

  // ---------------------------------------------------------------- closed value lists

  var CATEGORIES = ["pro", "realestate", "kit"];

  // Four, not three: "rent" is the tenant side and "let" is the owner side - two opposite leads.
  var DEAL_TYPES = ["buy", "rent", "sell", "let"];

  var PROPERTY_TYPES = ["apartment", "house", "penthouse", "duplex", "commercial", "office", "lot"];
  var TIMELINES = ["immediate", "up_to_3_months", "up_to_year", "browsing"];
  var URGENCIES = ["immediate", "this_week", "flexible"];
  var PROPERTY_ACCESS = ["anytime", "evenings", "weekend", "by_appointment"];
  var STATUSES = ["new", "contacted", "qualified", "sold", "rejected", "duplicate"];
  var BUSINESS_SIZES = ["solo", "2_5", "6_plus"];

  // זמני - המשתמש מחליף. Same marking as src/lib/trades.mjs.
  var KIT_PAINS = ["no_leads", "leads_dont_answer", "no_time", "no_online_presence", "pricing", "other"];
  var KITS = ["whatsapp_starter", "leads_pack", "landing_page"];

  var OPTOUT_CHANNELS = ["whatsapp", "sms", "all"];

  // Hebrew labels live next to the values so that the page, the WhatsApp text and the
  // kit builder all render the same wording from one place.
  var LABELS_HE = {
    category: { pro: "בעל מקצוע", realestate: "נדל\"ן", kit: "ערכה לעסק" },
    deal_type: { buy: "קנייה", rent: "שכירות", sell: "מכירה", let: "השכרה" },
    property_type: {
      apartment: "דירה", house: "בית פרטי", penthouse: "פנטהאוז", duplex: "דופלקס",
      commercial: "מסחרי", office: "משרד", lot: "מגרש"
    },
    timeline: {
      immediate: "מיידי", up_to_3_months: "עד 3 חודשים",
      up_to_year: "עד שנה", browsing: "מתעניין בלבד"
    },
    urgency: { immediate: "מיידי", this_week: "השבוע", flexible: "גמיש" },
    property_access: {
      anytime: "בכל שעה", evenings: "אחרי הצהריים", weekend: "בסוף השבוע",
      by_appointment: "בתיאום מראש"
    },
    business_size: { solo: "יחיד", "2_5": "2–5", "6_plus": "6+" },
    pain: {
      no_leads: "אין פניות", leads_dont_answer: "פניות שלא עונות", no_time: "אין זמן לטפל",
      no_online_presence: "אין נוכחות באינטרנט", pricing: "לא יודע לתמחר", other: "אחר"
    },
    kit_requested: {
      whatsapp_starter: "ערכת וואטסאפ להתחלה",
      leads_pack: "ערכת לידים",
      landing_page: "ערכת דף נחיתה"
    },
    status: {
      new: "חדש", contacted: "נוצר קשר", qualified: "מוכשר",
      sold: "נמכר", rejected: "נדחה", duplicate: "כפול"
    }
  };

  // ---------------------------------------------------------------- field sets

  var COMMON_REQUIRED = [
    "id", "created_at", "category", "name", "phone_e164", "city",
    "source", "status", "consent", "optout", "scores"
  ];
  var COMMON_OPTIONAL = ["email", "free_text"];

  var BY_CATEGORY = {
    realestate: {
      required: ["deal_type", "property_type", "budget_max", "timeline"],
      optional: ["neighborhood", "budget_min", "rooms_min", "area_sqm_min", "has_mortgage_preapproval"]
    },
    pro: {
      required: ["trade", "urgency"],
      optional: ["budget_max", "property_access"]
    },
    kit: {
      required: ["business_type", "pain", "business_size", "kit_requested"],
      optional: []
    }
  };

  var SOURCE_KEYS = ["page", "utm_source", "utm_medium", "utm_campaign", "referrer", "first_seen_at"];
  var SCORE_KEYS = ["completeness", "reachability", "intent", "fit", "freshness"];

  var FREE_TEXT_MAX = 1000; // declared ceiling (recon topic 7); the page uses a tighter one
  var NAME_MAX = 80;
  var NAME_MIN = 2;
  var CITY_MAX = 60;
  var TRADE_MAX = 40;
  var BUSINESS_TYPE_MAX = 60;
  var NEIGHBORHOOD_MAX = 60;
  var AREA_SQM_MAX = 100000;
  var ROOMS_MAX = 40;
  var ID_CHARS = "0123456789abcdefghijklmnopqrstuv"; // 32 chars -> 5 bits per char, no modulo bias

  // ---------------------------------------------------------------- primitives

  var E164_RE = /^\+[1-9]\d{7,14}$/;
  var EMAIL_RE = /^[^\s@,;:"'()\[\]\\]+@[^\s@.,;:"'()\[\]\\]+(?:\.[^\s@.,;:"'()\[\]\\]+)+$/;
  var ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
  var LEAD_ID_RE = /^lead_[0-9a-v]{24}$/;
  var SHA_REF_RE = /^sha256:[0-9a-f]{64}$/;
  var BUDGET_RE = /^\d+(?:\.\d{1,2})?$/;

  function isPlainObject(v) {
    return typeof v === "object" && v !== null && !Array.isArray(v);
  }
  function isNonEmptyString(v) {
    return typeof v === "string" && v.trim() !== "";
  }
  function isAbsent(v) {
    return v === undefined || v === null;
  }
  function isIsoWithZone(v) {
    return typeof v === "string" && ISO_RE.test(v) && isFinite(Date.parse(v));
  }

  // ---------------------------------------------------------------- budget: agorot as an integer

  // Money is an integer number of agorot. Never a float, never the string "1,800,000".
  // Accepts what a human types ("1,800,000", "1800000.50", "₪ 1800000") and returns agorot.
  function parseBudgetToAgorot(input) {
    var raw = input;
    if (typeof raw === "number") {
      if (!isFinite(raw)) return { ok: false, agorot: null, reason: "not_a_number" };
      if (Math.abs(raw) >= 1e15) return { ok: false, agorot: null, reason: "too_large" };
      raw = fixedString(raw);
    }
    if (typeof raw !== "string") return { ok: false, agorot: null, reason: "not_a_number" };
    var s = raw.replace(/[\s,  ]/g, "").replace(/₪/g, "");
    s = s.replace(/^(?:ils|nis|sh|ש"ח|שח)/i, "").replace(/(?:ils|nis|ש"ח|שח)$/i, "");
    if (s === "") return { ok: false, agorot: null, reason: "empty" };
    if (!BUDGET_RE.test(s)) return { ok: false, agorot: null, reason: "format" };
    var parts = s.split(".");
    var whole = parts[0];
    var frac = (parts.length > 1 ? parts[1] : "") + "00";
    var agorot = Number(whole) * 100 + Number(frac.slice(0, 2));
    if (!Number.isSafeInteger(agorot)) return { ok: false, agorot: null, reason: "too_large" };
    if (agorot <= 0) return { ok: false, agorot: null, reason: "not_positive" };
    return { ok: true, agorot: agorot, reason: null };
  }

  // String form of a number without exponent notation and without parseFloat round-trips.
  function fixedString(n) {
    var s = String(n);
    if (s.indexOf("e") === -1 && s.indexOf("E") === -1) return s;
    return n.toFixed(2);
  }

  function formatAgorot(agorot) {
    if (!Number.isInteger(agorot)) return "";
    var shekels = Math.floor(agorot / 100);
    var rest = agorot % 100;
    var grouped = String(shekels).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return rest === 0 ? grouped : grouped + "." + String(rest + 100).slice(1);
  }

  // ---------------------------------------------------------------- id

  // Stable, client-side, NOT a running number: the lead count must not leak.
  function makeLeadId(randomBytes) {
    var bytes = randomBytes;
    if (!bytes) {
      bytes = new Uint8Array(24);
      if (root.crypto && typeof root.crypto.getRandomValues === "function") {
        root.crypto.getRandomValues(bytes);
      } else {
        throw new Error("no crypto.getRandomValues - pass bytes explicitly");
      }
    }
    if (bytes.length < 24) throw new Error("makeLeadId needs 24 bytes");
    var out = "lead_";
    for (var i = 0; i < 24; i += 1) out += ID_CHARS.charAt(bytes[i] & 31);
    return out;
  }

  // ---------------------------------------------------------------- consent shape

  // Structural only. src/lib/consent.mjs builds the object and owns the wording;
  // it reuses this predicate so the two can never disagree.
  function validateConsentShape(consent, prefix) {
    var p = prefix || "consent";
    var errs = [];
    if (!isPlainObject(consent)) return [{ field: p, reason: "חסרה הסכמה" }];
    // granted must be the boolean true. Not "true", not 1, not a missing key.
    if (consent.granted !== true) errs.push({ field: p + ".granted", reason: "לא ניתנה הסכמה מפורשת" });
    if (!isIsoWithZone(consent.at)) errs.push({ field: p + ".at", reason: "שעת הסכמה חסרה או לא בפורמט ISO עם אזור זמן" });
    if (!SHA_REF_RE.test(String(consent.text_shown))) errs.push({ field: p + ".text_shown", reason: "חסר גיבוב sha256 של הנוסח שהוצג" });
    if (!isNonEmptyString(consent.text_version)) errs.push({ field: p + ".text_version", reason: "חסרה גרסת נוסח" });
    if (!isPlainObject(consent.source)) errs.push({ field: p + ".source", reason: "חסר מקור ההסכמה" });
    if (!(consent.ip_prefix === null || isNonEmptyString(consent.ip_prefix))) {
      errs.push({ field: p + ".ip_prefix", reason: "קידומת IP חייבת להיות null או מחרוזת" });
    }
    if (!SHA_REF_RE.test(String(consent.user_agent))) errs.push({ field: p + ".user_agent", reason: "חסר גיבוב sha256 של ה-user agent" });
    return errs;
  }

  // ---------------------------------------------------------------- validate

  function validate(lead) {
    var errors = [];
    function push(field, reason) {
      for (var i = 0; i < errors.length; i += 1) if (errors[i].field === field) return;
      errors.push({ field: field, reason: reason });
    }
    function requireKey(field) {
      if (!Object.prototype.hasOwnProperty.call(lead, field) || lead[field] === undefined) {
        push(field, "שדה חובה חסר");
        return false;
      }
      return true;
    }

    if (!isPlainObject(lead)) return [{ field: "(lead)", reason: "הליד חייב להיות אובייקט" }];

    // category first - it decides which field sets apply.
    var category = lead.category;
    var categoryOk = false;
    if (requireKey("category")) {
      if (CATEGORIES.indexOf(category) === -1) push("category", "קטגוריה לא מוכרת");
      else categoryOk = true;
    }

    var extra = categoryOk ? BY_CATEGORY[category] : { required: [], optional: [] };
    var allowed = COMMON_REQUIRED.concat(COMMON_OPTIONAL, extra.required, extra.optional);

    // Unknown / wrong-category keys. Strict on purpose: the schema is the source of truth.
    // Checked only once the category is known: otherwise a single missing `category` would
    // make every category field look unknown and one omission would cascade into many errors.
    if (categoryOk) {
      var keys = Object.keys(lead);
      for (var k = 0; k < keys.length; k += 1) {
        if (allowed.indexOf(keys[k]) === -1) {
          push(keys[k], "שדה לא מוכר לקטגוריה הזו");
        }
      }
    }

    // ---- common required
    if (requireKey("id") && !LEAD_ID_RE.test(String(lead.id))) push("id", "מזהה ליד לא בפורמט");
    if (requireKey("created_at") && !isIsoWithZone(lead.created_at)) {
      push("created_at", "שעת יצירה חייבת להיות ISO 8601 עם אזור זמן");
    }
    if (requireKey("name")) {
      if (!isNonEmptyString(lead.name)) push("name", "שם חסר");
      else if (lead.name.trim().length < NAME_MIN) push("name", "שם קצר מדי");
      else if (lead.name.length > NAME_MAX) push("name", "שם ארוך מדי");
    }
    if (requireKey("phone_e164") && !E164_RE.test(String(lead.phone_e164))) {
      push("phone_e164", "טלפון חייב להיות בפורמט E.164");
    }
    if (requireKey("city")) {
      if (!isNonEmptyString(lead.city)) push("city", "עיר חסרה");
      else if (lead.city.length > CITY_MAX) push("city", "שם עיר ארוך מדי");
    }
    if (requireKey("status") && STATUSES.indexOf(lead.status) === -1) {
      push("status", "סטטוס לא מוכר");
    }

    // ---- common optional (null means "not provided"; "" is a bug, not a value)
    if (!isAbsent(lead.email)) {
      if (typeof lead.email !== "string" || lead.email === "") push("email", "אימייל ריק - השמט אותו או שלח null");
      else if (!EMAIL_RE.test(lead.email)) push("email", "אימייל לא בפורמט");
    }
    if (!isAbsent(lead.free_text)) {
      if (typeof lead.free_text !== "string" || lead.free_text === "") push("free_text", "טקסט ריק - השמט אותו או שלח null");
      else if (lead.free_text.length > FREE_TEXT_MAX) push("free_text", "טקסט חופשי מעל " + FREE_TEXT_MAX + " תווים");
    }

    // ---- source
    if (requireKey("source")) {
      if (!isPlainObject(lead.source)) push("source", "מקור חייב להיות אובייקט");
      else {
        var srcKeys = Object.keys(lead.source);
        for (var s = 0; s < SOURCE_KEYS.length; s += 1) {
          if (!Object.prototype.hasOwnProperty.call(lead.source, SOURCE_KEYS[s])) {
            push("source." + SOURCE_KEYS[s], "שדה חובה חסר");
          }
        }
        for (var s2 = 0; s2 < srcKeys.length; s2 += 1) {
          if (SOURCE_KEYS.indexOf(srcKeys[s2]) === -1) push("source." + srcKeys[s2], "שדה לא מוכר");
        }
        if (!isNonEmptyString(lead.source.page)) push("source.page", "חסר שם הדף");
        if (!isIsoWithZone(lead.source.first_seen_at)) push("source.first_seen_at", "חסרה שעת כניסה ראשונה");
        var nullable = ["utm_source", "utm_medium", "utm_campaign", "referrer"];
        for (var n = 0; n < nullable.length; n += 1) {
          var v = lead.source[nullable[n]];
          if (!(v === null || typeof v === "string")) push("source." + nullable[n], "חייב להיות null או מחרוזת");
        }
      }
    }

    // ---- consent (recon topic 14)
    if (requireKey("consent")) {
      var cErrs = validateConsentShape(lead.consent, "consent");
      for (var c = 0; c < cErrs.length; c += 1) push(cErrs[c].field, cErrs[c].reason);
    }

    // ---- optout: a separate collection owns the real list; here it is object-or-null.
    if (requireKey("optout")) {
      if (lead.optout !== null) {
        if (!isPlainObject(lead.optout)) push("optout", "הסרה חייבת להיות אובייקט או null");
        else {
          if (!isIsoWithZone(lead.optout.at)) push("optout.at", "חסרה שעת הסרה");
          if (OPTOUT_CHANNELS.indexOf(lead.optout.channel) === -1) push("optout.channel", "ערוץ הסרה לא מוכר");
          if (!isNonEmptyString(lead.optout.reason)) push("optout.reason", "חסרה סיבת הסרה");
        }
      }
    }

    // ---- scores: five separate numbers, no single blended score.
    if (requireKey("scores")) {
      if (!isPlainObject(lead.scores)) push("scores", "ציונים חייבים להיות אובייקט");
      else {
        for (var q = 0; q < SCORE_KEYS.length; q += 1) {
          var key = SCORE_KEYS[q];
          var val = lead.scores[key];
          if (!Object.prototype.hasOwnProperty.call(lead.scores, key)) push("scores." + key, "שדה חובה חסר");
          else if (!Number.isInteger(val) || val < 0 || val > 100) push("scores." + key, "ציון חייב להיות מספר שלם בין 0 ל-100");
        }
        var sKeys = Object.keys(lead.scores);
        for (var q2 = 0; q2 < sKeys.length; q2 += 1) {
          if (SCORE_KEYS.indexOf(sKeys[q2]) === -1) push("scores." + sKeys[q2], "ציון לא מוכר");
        }
      }
    }

    if (!categoryOk) return errors;

    // ---- realestate
    if (category === "realestate") {
      if (requireKey("deal_type") && DEAL_TYPES.indexOf(lead.deal_type) === -1) {
        push("deal_type", "סוג עסקה לא מוכר");
      }
      if (requireKey("property_type") && PROPERTY_TYPES.indexOf(lead.property_type) === -1) {
        push("property_type", "סוג נכס לא מוכר");
      }
      if (requireKey("timeline") && TIMELINES.indexOf(lead.timeline) === -1) {
        push("timeline", "לוח זמנים לא מוכר");
      }
      if (requireKey("budget_max")) checkAgorot("budget_max", lead.budget_max, push);
      if (!isAbsent(lead.budget_min)) {
        if (checkAgorot("budget_min", lead.budget_min, push) && Number.isInteger(lead.budget_max)) {
          if (lead.budget_min > lead.budget_max) push("budget_min", "תקציב מינימום גדול מהמקסימום");
        }
      }
      if (!isAbsent(lead.neighborhood)) {
        if (!isNonEmptyString(lead.neighborhood)) push("neighborhood", "שכונה ריקה - השמט או שלח null");
        else if (lead.neighborhood.length > NEIGHBORHOOD_MAX) push("neighborhood", "שם שכונה ארוך מדי");
      }
      if (!isAbsent(lead.rooms_min)) {
        if (typeof lead.rooms_min !== "number" || !isFinite(lead.rooms_min)) push("rooms_min", "מספר חדרים לא מספר");
        else if (lead.rooms_min <= 0 || lead.rooms_min > ROOMS_MAX) push("rooms_min", "מספר חדרים מחוץ לטווח");
        else if (Math.round(lead.rooms_min * 2) !== lead.rooms_min * 2) push("rooms_min", "חדרים בחצאים בלבד");
      }
      if (!isAbsent(lead.area_sqm_min)) {
        if (!Number.isInteger(lead.area_sqm_min)) push("area_sqm_min", "שטח חייב להיות מספר שלם");
        else if (lead.area_sqm_min <= 0 || lead.area_sqm_min > AREA_SQM_MAX) push("area_sqm_min", "שטח מחוץ לטווח");
      }
      // Asked only when buying. On rent/sell/let the key must not be there at all -
      // null here means "was not asked", it must never be read as "no".
      if (Object.prototype.hasOwnProperty.call(lead, "has_mortgage_preapproval")) {
        if (lead.deal_type !== "buy") {
          push("has_mortgage_preapproval", "נשאל רק בקנייה");
        } else if (!(lead.has_mortgage_preapproval === true || lead.has_mortgage_preapproval === false || lead.has_mortgage_preapproval === null)) {
          push("has_mortgage_preapproval", "חייב להיות true, false או null");
        }
      }
    }

    // ---- pro
    if (category === "pro") {
      // The trade list (src/lib/trades.mjs) is temporary and user-replaceable, so the
      // FROZEN schema only requires a short non-empty string. The page enforces the list.
      if (requireKey("trade")) {
        if (!isNonEmptyString(lead.trade)) push("trade", "תחום חסר");
        else if (lead.trade.length > TRADE_MAX) push("trade", "שם תחום ארוך מדי");
      }
      if (requireKey("urgency") && URGENCIES.indexOf(lead.urgency) === -1) {
        push("urgency", "דחיפות לא מוכרת");
      }
      if (!isAbsent(lead.budget_max)) checkAgorot("budget_max", lead.budget_max, push);
      if (!isAbsent(lead.property_access) && PROPERTY_ACCESS.indexOf(lead.property_access) === -1) {
        push("property_access", "זמן גישה לא מוכר");
      }
    }

    // ---- kit
    if (category === "kit") {
      if (requireKey("business_type")) {
        if (!isNonEmptyString(lead.business_type)) push("business_type", "סוג העסק חסר");
        else if (lead.business_type.length > BUSINESS_TYPE_MAX) push("business_type", "סוג העסק ארוך מדי");
      }
      if (requireKey("pain") && KIT_PAINS.indexOf(lead.pain) === -1) push("pain", "בחירה לא מוכרת");
      if (requireKey("business_size") && BUSINESS_SIZES.indexOf(lead.business_size) === -1) {
        push("business_size", "גודל עסק לא מוכר");
      }
      if (requireKey("kit_requested") && KITS.indexOf(lead.kit_requested) === -1) {
        push("kit_requested", "ערכה לא מוכרת");
      }
    }

    return errors;
  }

  function checkAgorot(field, value, push) {
    if (!Number.isInteger(value)) {
      push(field, "תקציב חייב להיות מספר שלם באגורות");
      return false;
    }
    if (value <= 0) {
      push(field, "תקציב חייב להיות גדול מאפס");
      return false;
    }
    if (!Number.isSafeInteger(value)) {
      push(field, "תקציב גדול מדי");
      return false;
    }
    return true;
  }

  function labelHe(group, value) {
    var g = LABELS_HE[group];
    if (!g) return String(value);
    return Object.prototype.hasOwnProperty.call(g, value) ? g[value] : String(value);
  }

  NEXUS.leadSchema = {
    CATEGORIES: CATEGORIES,
    DEAL_TYPES: DEAL_TYPES,
    PROPERTY_TYPES: PROPERTY_TYPES,
    TIMELINES: TIMELINES,
    URGENCIES: URGENCIES,
    PROPERTY_ACCESS: PROPERTY_ACCESS,
    STATUSES: STATUSES,
    BUSINESS_SIZES: BUSINESS_SIZES,
    KIT_PAINS: KIT_PAINS,
    KITS: KITS,
    OPTOUT_CHANNELS: OPTOUT_CHANNELS,
    LABELS_HE: LABELS_HE,
    COMMON_REQUIRED: COMMON_REQUIRED,
    COMMON_OPTIONAL: COMMON_OPTIONAL,
    BY_CATEGORY: BY_CATEGORY,
    SOURCE_KEYS: SOURCE_KEYS,
    SCORE_KEYS: SCORE_KEYS,
    FREE_TEXT_MAX: FREE_TEXT_MAX,
    LEAD_ID_RE: LEAD_ID_RE,
    E164_RE: E164_RE,
    EMAIL_RE: EMAIL_RE,
    ISO_RE: ISO_RE,
    validate: validate,
    validateConsentShape: validateConsentShape,
    parseBudgetToAgorot: parseBudgetToAgorot,
    formatAgorot: formatAgorot,
    makeLeadId: makeLeadId,
    labelHe: labelHe,
    isIsoWithZone: isIsoWithZone,
    isPlainObject: isPlainObject,
    isNonEmptyString: isNonEmptyString
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
