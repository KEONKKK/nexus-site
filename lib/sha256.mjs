// NEXUS - src/lib/sha256.mjs - SHA-256 in plain JavaScript, synchronous, zero dependencies.
// Item 4 of A1-PRODUCT-CORE.
//
// Why this file exists at all: recon topic 14 requires the consent object to store a hash of
// the exact wording that was shown (`text_shown`), computed in the browser at submit time.
// The alternatives were rejected: crypto.subtle.digest is asynchronous and is not exposed on
// an insecure/file:// origin in every browser, and a library would mean a CDN - which the
// "0 external dependency" rule forbids. So: one small, fully tested implementation, verified
// byte for byte against node's own crypto over 40+ vectors (tests/product-04-consent-wa.mjs).
//
// Dual-mode file (no import/export) - see the header of src/lib/lead-schema.mjs.

(function (root) {
  "use strict";
  var NEXUS = (root.NEXUS = root.NEXUS || {});

  var K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  var H0 = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

  function rotr(x, n) {
    return ((x >>> n) | (x << (32 - n))) >>> 0;
  }

  // UTF-8 encoder written out by hand so there is exactly one code path in both node and the
  // browser. A lone surrogate becomes U+FFFD, which is what node's Buffer does too.
  function utf8Bytes(str) {
    var out = [];
    for (var i = 0; i < str.length; i += 1) {
      var c = str.charCodeAt(i);
      if (c < 0x80) {
        out.push(c);
      } else if (c < 0x800) {
        out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      } else if (c >= 0xd800 && c <= 0xdbff) {
        var c2 = str.charCodeAt(i + 1);
        if (c2 >= 0xdc00 && c2 <= 0xdfff) {
          var cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
          out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
          i += 1;
        } else {
          out.push(0xef, 0xbf, 0xbd);
        }
      } else if (c >= 0xdc00 && c <= 0xdfff) {
        out.push(0xef, 0xbf, 0xbd);
      } else {
        out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      }
    }
    return new Uint8Array(out);
  }

  function sha256Bytes(bytes) {
    var len = bytes.length;
    var padded = len + 1;
    var zeros = (56 - (padded % 64) + 64) % 64;
    var total = padded + zeros + 8;
    var msg = new Uint8Array(total);
    msg.set(bytes, 0);
    msg[len] = 0x80;

    // message length in BITS, big-endian, 64 bit
    var bitsHigh = Math.floor(len / 536870912); // len * 8 / 2^32
    var bitsLow = (len * 8) % 4294967296;
    msg[total - 8] = (bitsHigh >>> 24) & 0xff;
    msg[total - 7] = (bitsHigh >>> 16) & 0xff;
    msg[total - 6] = (bitsHigh >>> 8) & 0xff;
    msg[total - 5] = bitsHigh & 0xff;
    msg[total - 4] = Math.floor(bitsLow / 16777216) & 0xff;
    msg[total - 3] = Math.floor(bitsLow / 65536) & 0xff;
    msg[total - 2] = Math.floor(bitsLow / 256) & 0xff;
    msg[total - 1] = bitsLow & 0xff;

    var H = H0.slice();
    var w = new Uint32Array(64);

    for (var off = 0; off < total; off += 64) {
      var i;
      for (i = 0; i < 16; i += 1) {
        var j = off + i * 4;
        w[i] = ((msg[j] << 24) | (msg[j + 1] << 16) | (msg[j + 2] << 8) | msg[j + 3]) >>> 0;
      }
      for (i = 16; i < 64; i += 1) {
        var x = w[i - 15];
        var y = w[i - 2];
        var s0 = (rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)) >>> 0;
        var s1 = (rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10)) >>> 0;
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (i = 0; i < 64; i += 1) {
        var S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
        var ch = ((e & f) ^ (~e & g)) >>> 0;
        var t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
        var S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
        var maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
        var t2 = (S0 + maj) >>> 0;
        h = g;
        g = f;
        f = e;
        e = (d + t1) >>> 0;
        d = c;
        c = b;
        b = a;
        a = (t1 + t2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0;
      H[1] = (H[1] + b) >>> 0;
      H[2] = (H[2] + c) >>> 0;
      H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0;
      H[5] = (H[5] + f) >>> 0;
      H[6] = (H[6] + g) >>> 0;
      H[7] = (H[7] + h) >>> 0;
    }

    var hex = "";
    for (var k = 0; k < 8; k += 1) {
      hex += ("00000000" + H[k].toString(16)).slice(-8);
    }
    return hex;
  }

  // Hex digest of a UTF-8 string.
  function sha256Hex(input) {
    if (typeof input === "string") return sha256Bytes(utf8Bytes(input));
    if (input instanceof Uint8Array) return sha256Bytes(input);
    if (Array.isArray(input)) return sha256Bytes(new Uint8Array(input));
    throw new Error("sha256Hex: expected a string or bytes");
  }

  // "sha256:<64 hex>" - the form recon topic 14 stores in the consent object.
  function sha256Ref(input) {
    return "sha256:" + sha256Hex(input);
  }

  // Canonical JSON: sorted keys, no spaces. Without it the same content hashes differently
  // and a later verification fails for no good reason (recon topic 14, rule 1).
  function canonicalJson(value) {
    if (value === null || typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
    if (typeof value === "string") return JSON.stringify(value);
    if (Array.isArray(value)) {
      var parts = [];
      for (var i = 0; i < value.length; i += 1) parts.push(canonicalJson(value[i] === undefined ? null : value[i]));
      return "[" + parts.join(",") + "]";
    }
    if (typeof value === "object") {
      var keys = Object.keys(value).sort();
      var out = [];
      for (var k = 0; k < keys.length; k += 1) {
        if (value[keys[k]] === undefined) continue;
        out.push(JSON.stringify(keys[k]) + ":" + canonicalJson(value[keys[k]]));
      }
      return "{" + out.join(",") + "}";
    }
    throw new Error("canonicalJson: unsupported value " + typeof value);
  }

  NEXUS.sha256 = {
    hex: sha256Hex,
    ref: sha256Ref,
    utf8Bytes: utf8Bytes,
    canonicalJson: canonicalJson,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
