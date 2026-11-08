// NEXUS - src/lib/score-config.mjs - EVERY number used by the five scores lives here.
// Item 3 of A1-PRODUCT-CORE. src/lib/lead-score.mjs contains logic only, never a weight.
// That is the point: a score you cannot explain to a customer is a score you cannot defend
// when you charge per lead. Change a number here and the explanation changes with it.
//
// Dual-mode file (no import/export) - see the header of src/lib/lead-schema.mjs.

(function (root) {
  "use strict";
  var NEXUS = (root.NEXUS = root.NEXUS || {});

  // ---------------------------------------------------------------- completeness
  // Weight of each field that is actually useful to a supplier. The score is
  // (sum of weights of filled fields) / (sum of weights that apply to this lead) * 100,
  // so the totals below do not need to add up to 100.
  var COMPLETENESS_WEIGHTS = {
    common: {
      name: 8,
      phone_e164: 15,
      city: 8,
      email: 6,
      free_text: 12,
    },
    pro: {
      trade: 15,
      urgency: 12,
      budget_max: 14,
      property_access: 10,
    },
    realestate: {
      deal_type: 12,
      property_type: 10,
      budget_max: 12,
      timeline: 10,
      neighborhood: 5,
      budget_min: 4,
      rooms_min: 4,
      area_sqm_min: 4,
      // counted only when deal_type === "buy", because it is the only case where it is asked
      has_mortgage_preapproval: 6,
    },
    kit: {
      business_type: 14,
      pain: 12,
      business_size: 10,
      kit_requested: 15,
    },
  };

  // ---------------------------------------------------------------- reachability
  // FORMAT ONLY - see the comment in lead-score.mjs. Adds up to exactly 100.
  var REACHABILITY_WEIGHTS = {
    e164_format: 50,
    israeli_mobile: 25,
    email_format: 25,
  };

  // ---------------------------------------------------------------- intent
  // Deliberately adds up to 120, not 100: a lead that fires every signal is clamped to 100.
  // The clamp is the declared behaviour, and scenario (ה) in recon topic 10 tests it.
  var INTENT_WEIGHTS = {
    category_chosen: 20,
    budget_filled: 30,
    free_text_rich: 25,
    timeline_early: 45, // multiplied by the earliness factor below
  };
  var FREE_TEXT_MIN_CHARS = 40;

  var TIMELINE_FACTOR = { immediate: 1, up_to_3_months: 0.7, up_to_year: 0.35, browsing: 0 };
  var URGENCY_FACTOR = { immediate: 1, this_week: 0.7, flexible: 0.3 };
  // The kits page has no urgency field (recon topic 8), so the requested kit is the proxy.
  var KIT_REQUEST_FACTOR = { requested: 0.6, none: 0 };

  // ---------------------------------------------------------------- fit
  // Also adds up to 120 on purpose, for the same reason as intent.
  var FIT_WEIGHTS = {
    category: 40,
    city: 35,
    budget_in_range: 30,
    active_provider: 15,
  };

  // ---------------------------------------------------------------- freshness
  // Declared decay curve. Anchors are exact: the five points in recon topic 10 scenario (ד).
  // Between two anchors the value is interpolated geometrically (an exponent per segment),
  // and linearly on a segment that ends at zero.
  var FRESHNESS_CURVE = [
    { minutes: 0, value: 100 },      // just now
    { minutes: 60, value: 100 },     // one hour - still fully hot
    { minutes: 1440, value: 50 },    // one day
    { minutes: 10080, value: 10 },   // one week
    { minutes: 43200, value: 2 },    // 30 days
    { minutes: 129600, value: 0 },   // 90 days - cold
  ];

  NEXUS.scoreConfig = {
    VERSION: "score-config-v0",
    COMPLETENESS_WEIGHTS: COMPLETENESS_WEIGHTS,
    REACHABILITY_WEIGHTS: REACHABILITY_WEIGHTS,
    INTENT_WEIGHTS: INTENT_WEIGHTS,
    FREE_TEXT_MIN_CHARS: FREE_TEXT_MIN_CHARS,
    TIMELINE_FACTOR: TIMELINE_FACTOR,
    URGENCY_FACTOR: URGENCY_FACTOR,
    KIT_REQUEST_FACTOR: KIT_REQUEST_FACTOR,
    FIT_WEIGHTS: FIT_WEIGHTS,
    FRESHNESS_CURVE: FRESHNESS_CURVE,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
