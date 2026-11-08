// NEXUS - src/lib/consent.mjs - the consent object. Item 4 of A1-PRODUCT-CORE.
// Follows recon topic 14: consent is NOT a boolean flag. It records WHEN, WHAT EXACT WORDING
// was shown (as a hash), WHERE it was given, and from what kind of client.
//
// THE WORDING BELOW IS NOT A LEGAL TEXT. It is a placeholder so the page can be built and
// tested today; the user is getting it reviewed by a lawyer. The version string makes the
// swap safe: a new wording means a new version id, and old consents keep pointing at the
// wording that was actually shown to that person.
//
// Needs loaded first: sha256.mjs, lead-schema.mjs.
// Dual-mode file (no import/export) - see the header of src/lib/lead-schema.mjs.

(function (root) {
  "use strict";
  var NEXUS = (root.NEXUS = root.NEXUS || {});

  var TEXT_VERSION = "consent-he-v0";

  // לא משפטי - נוסח זמני. v0 בכוונה, לא v1: v1 יהיה הנוסח שעבר עו"ד.
  var TEXT_HE = [
    "אני מאשר/ת שהפרטים שמסרתי כאן יועברו לבעלי מקצוע או לנותני שירות רלוונטיים,",
    "לצורך יצירת קשר איתי בטלפון, בוואטסאפ או במסרון בנוגע לפנייה הזו בלבד.",
    "אפשר לבקש הסרה בכל רגע בהודעה חזרה, וההסרה תחול על כל הפניות מאותו מספר.",
    "נוסח זמני ולא משפטי - ייבדק על ידי עורך דין לפני איסוף פנייה אמיתית אחת."
  ].join(" ");

  var MAX_UA_LENGTH = 1024;

  function sha() {
    if (!NEXUS.sha256) throw new Error("consent: src/lib/sha256.mjs must be loaded first");
    return NEXUS.sha256;
  }
  function schema() {
    if (!NEXUS.leadSchema) throw new Error("consent: src/lib/lead-schema.mjs must be loaded first");
    return NEXUS.leadSchema;
  }

  // Builds the consent object. Everything is explicit - there is no default for `granted`,
  // and a call that does not pass granted === true produces a consent that fails validation.
  //
  // input = {
  //   granted, at (ISO + offset), text (the exact wording shown), text_version,
  //   page, url, referrer, utm, user_agent, ip_prefix
  // }
  function buildConsent(input) {
    var o = input || {};
    var S = sha();
    var text = typeof o.text === "string" ? o.text : TEXT_HE;
    var ua = typeof o.user_agent === "string" ? o.user_agent.slice(0, MAX_UA_LENGTH) : "";
    return {
      granted: o.granted === true,
      at: typeof o.at === "string" ? o.at : "",
      // the hash of the wording, not the wording: in a year's time this is what proves
      // what exactly was agreed to
      text_shown: S.ref(text),
      text_version: typeof o.text_version === "string" && o.text_version !== "" ? o.text_version : TEXT_VERSION,
      source: {
        page: typeof o.page === "string" ? o.page : "",
        url: typeof o.url === "string" ? o.url : "",
        referrer: typeof o.referrer === "string" ? o.referrer : null,
        utm: o.utm && typeof o.utm === "object" ? o.utm : {},
      },
      // null on the client on purpose: a browser cannot see its own public IP, and we are
      // not calling a third-party service to find out. A server may fill in a /16 prefix
      // later - a prefix, never the full address.
      ip_prefix: o.ip_prefix === undefined ? null : o.ip_prefix,
      // a hash, not the string: enough for evidence, less to store about a person
      user_agent: S.ref(ua),
    };
  }

  // Structural validation is delegated to the frozen schema so the two can never disagree.
  function validateConsent(consent) {
    return schema().validateConsentShape(consent, "consent");
  }

  // Does this consent record the wording we think it does?
  function consentMatchesText(consent, text) {
    if (!consent || typeof consent !== "object") return false;
    return consent.text_shown === sha().ref(typeof text === "string" ? text : "");
  }

  function currentTextRef() {
    return sha().ref(TEXT_HE);
  }

  NEXUS.consent = {
    TEXT_HE: TEXT_HE,
    TEXT_VERSION: TEXT_VERSION,
    TEXT_IS_NOT_LEGAL: true,
    TEXT_NOTE_HE: "לא משפטי - נוסח זמני עד בדיקת עורך דין",
    buildConsent: buildConsent,
    validateConsent: validateConsent,
    consentMatchesText: consentMatchesText,
    currentTextRef: currentTextRef,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
