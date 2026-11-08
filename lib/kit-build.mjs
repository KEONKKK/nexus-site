// NEXUS - src/lib/kit-build.mjs - assembles a kit from the templates. Item 6.
//
// Route M1 from recon topic 9: templates with placeholders + a filled-in form + a ZIP the
// browser builds itself. Zero dependencies, zero server, zero API key, zero running cost,
// and fully deterministic - the same five answers always produce the same bytes.
//
// Needs loaded first: lead-schema.mjs, sha256.mjs, zip-store.mjs, templates-inline.mjs.
// Dual-mode file (no import/export) - see the header of src/lib/lead-schema.mjs.

(function (root) {
  "use strict";
  var NEXUS = (root.NEXUS = root.NEXUS || {});

  // The five placeholders named in the task, plus {{wa_digits}}.
  //
  // Why a sixth: a wa.me link must carry the number WITHOUT the leading "+"
  // ("a full phone number in international format, omitting any zeroes, brackets, or
  // dashes"), while a tel: link must keep it. Reusing {{phone_e164}} in the wa.me href
  // would ship every business a link of the form wa.me/+972..., which is not the documented
  // form. One extra placeholder is cheaper than a broken button in the deliverable.
  var PLACEHOLDER_KEYS = ["business_name", "trade", "city", "phone_e164", "kit_name", "wa_digits"];

  var FILE_ORDER = ["landing.html", "messages.md", "cover.svg", "readme.md"];

  // Declared size window for the finished archive. Outside it, something is badly wrong -
  // an empty template, a duplicated file, a runaway replacement.
  var ZIP_MIN_BYTES = 4000;
  var ZIP_MAX_BYTES = 20000;

  function schema() {
    if (!NEXUS.leadSchema) throw new Error("kit-build: src/lib/lead-schema.mjs must be loaded first");
    return NEXUS.leadSchema;
  }
  function templates() {
    if (!NEXUS.kitTemplates) throw new Error("kit-build: src/kits/templates/templates-inline.mjs must be loaded first");
    return NEXUS.kitTemplates;
  }
  function zip() {
    if (!NEXUS.zipStore) throw new Error("kit-build: src/lib/zip-store.mjs must be loaded first");
    return NEXUS.zipStore;
  }

  function str(v) {
    return typeof v === "string" ? v.trim() : "";
  }

  // values = { business_name, trade, city, phone_e164, kit_requested }
  function buildDictionary(values) {
    var S = schema();
    var v = values || {};
    var phone = str(v.phone_e164);
    var dict = {
      business_name: str(v.business_name),
      trade: str(v.trade),
      city: str(v.city),
      phone_e164: phone,
      kit_name: str(v.kit_name) !== "" ? str(v.kit_name) : S.labelHe("kit_requested", v.kit_requested),
      wa_digits: phone.charAt(0) === "+" ? phone.slice(1) : phone
    };
    return dict;
  }

  // Replaces every {{key}} present in the dictionary. Anything left over is REPORTED, never
  // silently shipped: a kit with a raw {{...}} in it is worthless to the business.
  function render(template, dict) {
    var out = template;
    for (var i = 0; i < PLACEHOLDER_KEYS.length; i += 1) {
      var key = PLACEHOLDER_KEYS[i];
      if (!Object.prototype.hasOwnProperty.call(dict, key)) continue;
      out = out.split("{{" + key + "}}").join(String(dict[key]));
    }
    return out;
  }

  function leftoverPlaceholders(text) {
    var found = [];
    var re = /\{\{([^}]*)\}\}/g;
    var m;
    while ((m = re.exec(text)) !== null) found.push(m[0]);
    return found;
  }

  // "מספרת דני" -> "מספרת-דני" . Hebrew is kept; the archive NAME is allowed to be Hebrew
  // because it is only a download filename, unlike the names INSIDE the archive.
  function slug(value) {
    var s = str(value);
    if (s === "") return "kit";
    s = s.replace(/[\\/:*?"<>|]/g, "");
    s = s.replace(/\s+/g, "-");
    s = s.replace(/-+/g, "-");
    s = s.replace(/^-|-$/g, "");
    if (s.length > 40) s = s.slice(0, 40).replace(/-$/, "");
    return s === "" ? "kit" : s;
  }

  // Returns { ok, files, zip, zipName, dict, remaining, bytes, reason }.
  function buildKit(values) {
    var T = templates();
    var dict = buildDictionary(values);

    var missingValues = [];
    for (var i = 0; i < PLACEHOLDER_KEYS.length; i += 1) {
      if (String(dict[PLACEHOLDER_KEYS[i]]) === "") missingValues.push(PLACEHOLDER_KEYS[i]);
    }

    var files = [];
    var remaining = [];

    var landing = render(T.get("landing.html"), dict);
    files.push({ name: "landing.html", text: landing });

    var messages = render(T.get("messages.md"), dict);
    files.push({ name: "messages.md", text: messages });

    var cover = render(T.get("cover.svg"), dict);
    files.push({ name: "cover.svg", text: cover });

    var readme = render(T.get("readme.md"), dict);
    files.push({ name: "readme.md", text: readme });

    for (var f = 0; f < files.length; f += 1) {
      var left = leftoverPlaceholders(files[f].text);
      for (var k = 0; k < left.length; k += 1) remaining.push(files[f].name + " " + left[k]);
    }

    var out = {
      ok: false,
      files: files,
      zip: null,
      zipName: "kit-" + slug(dict.business_name) + ".zip",
      dict: dict,
      remaining: remaining,
      missingValues: missingValues,
      bytes: 0,
      reason: null
    };

    if (missingValues.length > 0) {
      out.reason = "missing_values";
      return out;
    }
    if (remaining.length > 0) {
      out.reason = "placeholders_left";
      return out;
    }

    out.zip = zip().createZip(files);
    out.bytes = out.zip.length;
    if (out.bytes < ZIP_MIN_BYTES || out.bytes > ZIP_MAX_BYTES) {
      out.reason = "size_out_of_range";
      return out;
    }
    out.ok = true;
    return out;
  }

  // sha256 of each rendered file, for the determinism test and for a future audit entry.
  function hashKit(result) {
    if (!NEXUS.sha256) throw new Error("kit-build: src/lib/sha256.mjs must be loaded first");
    var out = {};
    for (var i = 0; i < result.files.length; i += 1) {
      out[result.files[i].name] = NEXUS.sha256.hex(result.files[i].text);
    }
    return out;
  }

  NEXUS.kitBuild = {
    PLACEHOLDER_KEYS: PLACEHOLDER_KEYS,
    FILE_ORDER: FILE_ORDER,
    ZIP_MIN_BYTES: ZIP_MIN_BYTES,
    ZIP_MAX_BYTES: ZIP_MAX_BYTES,
    buildDictionary: buildDictionary,
    render: render,
    leftoverPlaceholders: leftoverPlaceholders,
    slug: slug,
    buildKit: buildKit,
    hashKit: hashKit
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
