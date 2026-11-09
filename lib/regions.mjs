// NEXUS - src/lib/regions.mjs - the closed list of regions for the "partners" page. Round 4.
//
// זמני - המשתמש מחליף. Same convention and same disclaimer as src/lib/trades.mjs (which this
// file otherwise does not depend on): this is a TEMPORARY list, NOT derived from any existing
// code and NOT approved by the user. Nothing else in the product hard-codes a region name -
// partners-app.js validates `regions` as a non-empty array of short strings, not against any
// one fixed enum baked into a frozen schema, so swapping this list later touches only this file.
//
// Dual-mode file (no import/export) - see the header of src/lib/lead-schema.mjs.

(function (root) {
  "use strict";
  var NEXUS = (root.NEXUS = root.NEXUS || {});

  var REGIONS_HE = [
    "תל אביב והמרכז",
    "ירושלים והסביבה",
    "חיפה והצפון",
    "השרון",
    "השפלה",
    "הדרום והנגב"
  ];

  function isKnownRegion(value) {
    return REGIONS_HE.indexOf(value) !== -1;
  }

  NEXUS.regions = {
    REGIONS_HE: REGIONS_HE,
    IS_TEMPORARY: true,
    NOTE_HE: "זמני - המשתמש מחליף",
    isKnownRegion: isKnownRegion
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
