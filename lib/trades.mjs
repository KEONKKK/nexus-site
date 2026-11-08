// NEXUS - src/lib/trades.mjs - the closed list of trades for the "find a pro" page.
//
// זמני - המשתמש מחליף.
// TEMPORARY LIST. This is NOT derived from any existing code and was NOT approved by the
// user; it exists so that items 1-6 can be built and tested today. The user replaces the
// contents of TRADES_HE. Nothing else in the product hard-codes a trade name:
// lead-schema.mjs deliberately validates `trade` as a short non-empty string, so swapping
// this list does NOT touch the frozen schema and does NOT break any test.
//
// Dual-mode file (no import/export) - see the header of src/lib/lead-schema.mjs.

(function (root) {
  "use strict";
  var NEXUS = (root.NEXUS = root.NEXUS || {});

  var TRADES_HE = [
    "חשמלאי",
    "אינסטלטור",
    "שיפוצניק",
    "מזגנים",
    "נגר",
    "צבעי",
    "מנעולן",
    "גנן",
    "הובלות",
    "ניקיון",
    "מחשבים",
    "טכנאי מכשירי חשמל"
  ];

  function isKnownTrade(value) {
    return TRADES_HE.indexOf(value) !== -1;
  }

  NEXUS.trades = {
    TRADES_HE: TRADES_HE,
    IS_TEMPORARY: true,
    NOTE_HE: "זמני - המשתמש מחליף",
    isKnownTrade: isKnownTrade
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
