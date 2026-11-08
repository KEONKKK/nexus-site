// NEXUS - src/lib/lead-score.mjs - the five scores. Item 3 of A1-PRODUCT-CORE.
// Logic only: every weight and every curve anchor lives in src/lib/score-config.mjs.
//
// Five separate numbers, no blended total. One weighted number is a black box, and a black
// box is indefensible when you charge per lead. Five numbers can be explained one by one.
//
// Determinism is a hard requirement: no Math.random anywhere in this file, and no clock -
// freshness() takes its reference time as an argument and throws if it is missing.
//
// Needs loaded first: lead-schema.mjs, phone.mjs, score-config.mjs.
// Dual-mode file (no import/export) - see the header of src/lib/lead-schema.mjs.

(function (root) {
  "use strict";
  var NEXUS = (root.NEXUS = root.NEXUS || {});

  function cfg() {
    if (!NEXUS.scoreConfig) throw new Error("lead-score: src/lib/score-config.mjs must be loaded first");
    return NEXUS.scoreConfig;
  }
  function schema() {
    if (!NEXUS.leadSchema) throw new Error("lead-score: src/lib/lead-schema.mjs must be loaded first");
    return NEXUS.leadSchema;
  }
  function phoneLib() {
    if (!NEXUS.phone) throw new Error("lead-score: src/lib/phone.mjs must be loaded first");
    return NEXUS.phone;
  }

  // Every score passes through here. Integer, 0-100, always.
  function clamp(n) {
    if (typeof n !== "number" || !isFinite(n)) return 0;
    return Math.min(100, Math.max(0, Math.round(n)));
  }

  function isFilled(value) {
    if (value === undefined || value === null) return false;
    if (typeof value === "string") return value.trim() !== "";
    if (typeof value === "number") return isFinite(value);
    if (Array.isArray(value)) return value.length > 0;
    return true; // a boolean false IS an answer
  }

  // ---------------------------------------------------------------- 1. completeness

  // How much of what a supplier can actually use was filled in. Fully deterministic:
  // the same lead always gives the same number.
  function completeness(lead) {
    if (!lead || typeof lead !== "object") return 0;
    var W = cfg().COMPLETENESS_WEIGHTS;
    var applicable = {};
    var key;
    for (key in W.common) if (Object.prototype.hasOwnProperty.call(W.common, key)) applicable[key] = W.common[key];
    var catWeights = W[lead.category];
    if (catWeights) {
      for (key in catWeights) {
        if (!Object.prototype.hasOwnProperty.call(catWeights, key)) continue;
        // asked only when buying, so it only counts towards the total when buying
        if (key === "has_mortgage_preapproval" && lead.deal_type !== "buy") continue;
        applicable[key] = catWeights[key];
      }
    }
    var total = 0;
    var filled = 0;
    for (key in applicable) {
      if (!Object.prototype.hasOwnProperty.call(applicable, key)) continue;
      total += applicable[key];
      if (isFilled(lead[key])) filled += applicable[key];
    }
    if (total === 0) return 0;
    return clamp((filled / total) * 100);
  }

  // ---------------------------------------------------------------- 2. reachability

  // FORMAT ONLY. Nothing here dials a number, sends a message or verifies an address.
  // It must never be presented to a customer as "verified" - it is "looks reachable".
  function reachability(lead) {
    if (!lead || typeof lead !== "object") return 0;
    var W = cfg().REACHABILITY_WEIGHTS;
    var S = schema();
    var P = phoneLib();
    var total = 0;
    var phone = typeof lead.phone_e164 === "string" ? lead.phone_e164 : "";
    if (S.E164_RE.test(phone)) total += W.e164_format;
    if (P.isIsraeliMobile(phone)) total += W.israeli_mobile;
    var email = typeof lead.email === "string" ? lead.email : "";
    if (email !== "" && S.EMAIL_RE.test(email)) total += W.email_format;
    return clamp(total);
  }

  // ---------------------------------------------------------------- 3. intent

  // How much the enquiry looks like a real intention rather than curiosity.
  function intent(lead) {
    if (!lead || typeof lead !== "object") return 0;
    var C = cfg();
    var W = C.INTENT_WEIGHTS;
    var S = schema();
    var total = 0;
    if (S.CATEGORIES.indexOf(lead.category) !== -1) total += W.category_chosen;
    if (Number.isInteger(lead.budget_max) && lead.budget_max > 0) total += W.budget_filled;
    var text = typeof lead.free_text === "string" ? lead.free_text.trim() : "";
    if (text.length >= C.FREE_TEXT_MIN_CHARS) total += W.free_text_rich;
    total += W.timeline_early * earlinessFactor(lead);
    return clamp(total);
  }

  // 0 .. 1 . Which field carries "how soon" depends on the category (recon topic 8).
  function earlinessFactor(lead) {
    var C = cfg();
    if (lead.category === "realestate") return factorOf(C.TIMELINE_FACTOR, lead.timeline);
    if (lead.category === "pro") return factorOf(C.URGENCY_FACTOR, lead.urgency);
    if (lead.category === "kit") {
      return isFilled(lead.kit_requested) ? C.KIT_REQUEST_FACTOR.requested : C.KIT_REQUEST_FACTOR.none;
    }
    return 0;
  }
  function factorOf(table, value) {
    if (!table || !Object.prototype.hasOwnProperty.call(table, value)) return 0;
    var f = table[value];
    return typeof f === "number" && isFinite(f) ? f : 0;
  }

  // ---------------------------------------------------------------- 4. fit

  // How well the lead matches the suppliers we actually have. `providers` is a parameter,
  // never a global and never a fetch: with an empty list the honest answer is 0.
  // provider = { id, active, categories:[], cities:[], trades:[], budget_min, budget_max }
  // (budget_min/budget_max in agorot; a provider with no trades list matches any trade.)
  function fit(lead, providers) {
    if (!lead || typeof lead !== "object") return 0;
    var W = cfg().FIT_WEIGHTS;
    var list = Array.isArray(providers) ? providers : [];
    var best = 0;
    for (var i = 0; i < list.length; i += 1) {
      var p = list[i];
      if (!p || typeof p !== "object") continue;
      if (p.active !== true) continue;
      var cats = Array.isArray(p.categories) ? p.categories : [];
      if (cats.indexOf(lead.category) === -1) continue;
      if (lead.category === "pro") {
        var trades = Array.isArray(p.trades) ? p.trades : [];
        if (trades.length > 0 && trades.indexOf(lead.trade) === -1) continue;
      }
      var s = W.category + W.active_provider;
      if (cityMatches(p.cities, lead.city)) s += W.city;
      if (budgetOverlaps(p, lead)) s += W.budget_in_range;
      if (s > best) best = s;
    }
    return clamp(best);
  }

  // "תל אביב" and "תל-אביב" are the same city.
  function normalizeCity(value) {
    if (typeof value !== "string") return "";
    return value.replace(/[\s\-־'"״׳.,]/g, "").toLowerCase();
  }
  function cityMatches(cities, city) {
    var want = normalizeCity(city);
    if (want === "") return false;
    var list = Array.isArray(cities) ? cities : [];
    for (var i = 0; i < list.length; i += 1) {
      if (normalizeCity(list[i]) === want) return true;
    }
    return false;
  }
  function budgetOverlaps(provider, lead) {
    var leadMax = Number.isInteger(lead.budget_max) && lead.budget_max > 0 ? lead.budget_max : null;
    if (leadMax === null) return false;
    var leadMin = Number.isInteger(lead.budget_min) && lead.budget_min > 0 ? lead.budget_min : 0;
    var pMin = Number.isInteger(provider.budget_min) ? provider.budget_min : 0;
    var pMax = Number.isInteger(provider.budget_max) ? provider.budget_max : Number.MAX_SAFE_INTEGER;
    return leadMax >= pMin && leadMin <= pMax;
  }

  // ---------------------------------------------------------------- 5. freshness

  // Time dependent, so the reference time is INJECTED. Without it the score would be
  // untestable; with it, the same lead and the same reference time always give the same
  // number. Passing no reference time is a programming error, not a default to "now".
  function freshness(lead, now) {
    if (now === undefined || now === null) {
      throw new Error("freshness(lead, now): a reference time must be injected");
    }
    var nowMs = toMs(now);
    if (!isFinite(nowMs)) throw new Error("freshness: reference time is not a valid time");
    if (!lead || typeof lead !== "object") return 0;
    var createdMs = toMs(lead.created_at);
    if (!isFinite(createdMs)) return 0;
    var ageMinutes = (nowMs - createdMs) / 60000;
    return clamp(curveValue(ageMinutes));
  }

  function toMs(value) {
    if (typeof value === "number") return isFinite(value) ? value : NaN;
    if (value instanceof Date) return value.getTime();
    if (typeof value === "string") return Date.parse(value);
    return NaN;
  }

  // The declared curve. Monotonically non-increasing by construction.
  function curveValue(ageMinutes) {
    var C = cfg().FRESHNESS_CURVE;
    if (!(ageMinutes > C[0].minutes)) return C[0].value; // also covers a future created_at
    for (var i = 0; i < C.length - 1; i += 1) {
      var a = C[i];
      var b = C[i + 1];
      if (ageMinutes <= b.minutes) {
        var frac = (ageMinutes - a.minutes) / (b.minutes - a.minutes);
        if (a.value <= 0 || b.value <= 0) return a.value + (b.value - a.value) * frac;
        return a.value * Math.pow(b.value / a.value, frac);
      }
    }
    return C[C.length - 1].value;
  }

  // ---------------------------------------------------------------- all five

  // opts = { providers: [], now: ISO string | ms | Date }
  function scoreLead(lead, opts) {
    var o = opts || {};
    return {
      completeness: completeness(lead),
      reachability: reachability(lead),
      intent: intent(lead),
      fit: fit(lead, o.providers),
      freshness: freshness(lead, o.now),
    };
  }

  NEXUS.leadScore = {
    completeness: completeness,
    reachability: reachability,
    intent: intent,
    fit: fit,
    freshness: freshness,
    scoreLead: scoreLead,
    curveValue: curveValue,
    earlinessFactor: earlinessFactor,
    normalizeCity: normalizeCity,
    clamp: clamp,
    isFilled: isFilled,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
