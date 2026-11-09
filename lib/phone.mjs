// NEXUS - src/lib/phone.mjs - phone input -> E.164. Item 2 of A1-PRODUCT-CORE.
// Built from scratch. Recon topic 10 scenario (ב): a 12-input -> 12-output table.
//
// Dual-mode file (no import/export) - see the header of src/lib/lead-schema.mjs.
//
// WhatsApp's own click-to-chat documentation requires "a full phone number in international
// format, omitting any zeroes, brackets, or dashes" - which is exactly what toE164 produces
// (wa-link.mjs then drops the leading "+").

(function (root) {
  "use strict";
  var NEXUS = (root.NEXUS = root.NEXUS || {});

  var IL = "972";

  // Israeli mobile prefixes, as they appear after the country code (local 05X -> 5X).
  var IL_MOBILE_PREFIXES = ["50", "51", "52", "53", "54", "55", "56", "57", "58", "59"];

  var LEADING_ZERO = /^0/;
  var E164_RE = /^\+[1-9]\d{7,14}$/;
  var LETTERS_RE = /[A-Za-z֐-׿]/;
  var ALLOWED_CHARS_RE = /^[0-9+\-().\s  ]*$/;

  function fail(reason) {
    return { ok: false, e164: null, reason: reason };
  }

  // Returns { ok, e164, reason }. Never throws, never guesses a country for a bare
  // 9-digit number: "55-981-4818" is ambiguous and is rejected rather than assumed.
  function toE164(input) {
    if (typeof input !== "string") return fail("not_a_string");
    var raw = input.trim();
    if (raw === "") return fail("empty");
    if (LETTERS_RE.test(raw)) return fail("letters");
    if (!ALLOWED_CHARS_RE.test(raw)) return fail("bad_characters");

    // exactly zero or one "+", and only in the first position
    var plusCount = (raw.match(/\+/g) || []).length;
    if (plusCount > 1 || (plusCount === 1 && raw.charAt(0) !== "+")) return fail("misplaced_plus");
    var plus = plusCount === 1;
    var digits = raw.replace(/\D/g, "");
    if (digits === "") return fail("no_digits");

    var country;
    var local;
    if (digits.indexOf("00") === 0 && !plus) {
      // international access prefix, e.g. 00972...
      var afterAccess = digits.slice(2);
      var splitAccess = splitCountry(afterAccess);
      if (!splitAccess) return fail("unknown_country_code");
      country = splitAccess.country;
      local = splitAccess.local;
    } else if (plus || digits.indexOf(IL) === 0) {
      var split = splitCountry(digits);
      if (!split) return fail("unknown_country_code");
      country = split.country;
      local = split.local;
    } else if (LEADING_ZERO.test(digits)) {
      // national form: 050-123-4567 -> country 972, local 501234567
      country = IL;
      local = digits;
    } else {
      // no "+", no country code and no national leading zero -> we refuse to guess
      return fail("no_country_code");
    }

    // The national trunk prefix "0" is never part of an E.164 number.
    local = local.replace(LEADING_ZERO, "");

    if (country === IL) {
      if (!/^[2-9]\d{7,8}$/.test(local)) {
        return fail(local.length > 9 ? "too_long" : local.length < 8 ? "too_short" : "bad_prefix");
      }
    } else if (!/^[1-9]\d{4,14}$/.test(local)) {
      return fail("bad_national_number");
    }

    var e164 = "+" + country + local;
    if (!E164_RE.test(e164)) return fail("not_e164");
    return { ok: true, e164: e164, reason: null };
  }

  // Only the country codes this product actually needs to tell apart. Israel first;
  // anything else is accepted as a 1-3 digit code so a foreign number is not mangled.
  function splitCountry(digits) {
    if (digits.indexOf(IL) === 0) return { country: IL, local: digits.slice(3) };
    if (digits.length < 8) return null;
    var first = digits.charAt(0);
    if (first === "0") return null;
    // 1 = NANP, 7 = RU/KZ: single-digit codes. Everything else: take two digits if the
    // pair is a known 2-digit code range, otherwise three.
    if (first === "1" || first === "7") return { country: first, local: digits.slice(1) };
    var two = digits.slice(0, 2);
    var TWO_DIGIT = ["20", "27", "30", "31", "32", "33", "34", "36", "39", "40", "41", "43", "44", "45", "46", "47", "48", "49",
      "51", "52", "53", "54", "55", "56", "57", "58", "60", "61", "62", "63", "64", "65", "66", "81", "82", "84", "86", "90", "91", "92", "93", "94", "95", "98"];
    if (TWO_DIGIT.indexOf(two) !== -1) return { country: two, local: digits.slice(2) };
    return { country: digits.slice(0, 3), local: digits.slice(3) };
  }

  // Format check only. This does NOT prove the line exists or that WhatsApp is on it.
  function isIsraeliMobile(value) {
    if (typeof value !== "string") return false;
    if (!E164_RE.test(value)) return false;
    if (value.indexOf("+" + IL) !== 0) return false;
    var local = value.slice(4);
    if (local.length !== 9) return false;
    return IL_MOBILE_PREFIXES.indexOf(local.slice(0, 2)) !== -1;
  }

  // "+972501234567" -> "050-123-4567", for showing the number back to the user.
  function toLocalIsraeliDisplay(e164) {
    if (!isIsraeliMobile(e164)) return typeof e164 === "string" ? e164 : "";
    var local = e164.slice(4);
    return "0" + local.slice(0, 2) + "-" + local.slice(2, 5) + "-" + local.slice(5);
  }

  // The digits WhatsApp wants in a wa.me link: no "+", no separators.
  function toWaDigits(e164) {
    if (typeof e164 !== "string" || !E164_RE.test(e164)) return null;
    return e164.slice(1);
  }

  NEXUS.phone = {
    IL_COUNTRY_CODE: IL,
    IL_MOBILE_PREFIXES: IL_MOBILE_PREFIXES,
    E164_RE: E164_RE,
    toE164: toE164,
    isIsraeliMobile: isIsraeliMobile,
    toLocalIsraeliDisplay: toLocalIsraeliDisplay,
    toWaDigits: toWaDigits,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
