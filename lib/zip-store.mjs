// NEXUS - src/lib/zip-store.mjs - writes a ZIP archive, store method, zero dependencies.
// Item 6 of A1-PRODUCT-CORE.
//
// "store" means no compression at all: every byte of every file is written as-is. That is a
// deliberate choice, not a shortcut - a deflate implementation would be hundreds of lines
// that must be byte-exact, and the kit is four small text files where compression would save
// a few kilobytes and buy real risk. Every ZIP tool opens a stored archive.
//
// Deterministic by construction: the modification time is a FIXED constant, so the same
// input always produces byte-identical output and the kit can be hashed in a test
// (recon topic 10, scenario טז).
//
// Dual-mode file (no import/export) - see the header of src/lib/lead-schema.mjs.

(function (root) {
  "use strict";
  var NEXUS = (root.NEXUS = root.NEXUS || {});

  // 2026-01-01 00:00:00 in the DOS format ZIP uses. A constant, never the clock.
  var FIXED_DOS_TIME = 0;
  var FIXED_DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1; // 23585
  var FIXED_DATE_LABEL = "2026-01-01T00:00:00 (קבוע, לא שעת הריצה)";

  var CRC_TABLE = (function () {
    var table = new Int32Array(256);
    for (var n = 0; n < 256; n += 1) {
      var c = n;
      for (var k = 0; k < 8; k += 1) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[n] = c;
    }
    return table;
  })();

  function crc32(bytes) {
    var crc = -1;
    for (var i = 0; i < bytes.length; i += 1) {
      crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]) & 0xff];
    }
    return (crc ^ -1) >>> 0;
  }

  function utf8(str) {
    if (NEXUS.sha256 && NEXUS.sha256.utf8Bytes) return NEXUS.sha256.utf8Bytes(str);
    throw new Error("zip-store: src/lib/sha256.mjs must be loaded first (for utf8Bytes)");
  }

  function Writer() {
    this.parts = [];
    this.length = 0;
  }
  Writer.prototype.u8 = function (v) {
    this.parts.push(new Uint8Array([v & 0xff]));
    this.length += 1;
  };
  Writer.prototype.u16 = function (v) {
    this.parts.push(new Uint8Array([v & 0xff, (v >>> 8) & 0xff]));
    this.length += 2;
  };
  Writer.prototype.u32 = function (v) {
    this.parts.push(new Uint8Array([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]));
    this.length += 4;
  };
  Writer.prototype.bytes = function (b) {
    this.parts.push(b);
    this.length += b.length;
  };
  Writer.prototype.result = function () {
    var out = new Uint8Array(this.length);
    var at = 0;
    for (var i = 0; i < this.parts.length; i += 1) {
      out.set(this.parts[i], at);
      at += this.parts[i].length;
    }
    return out;
  };

  var ASCII_NAME_RE = /^[A-Za-z0-9._-]+$/;

  // files: [{ name, text }] - names must be plain ASCII, so there is no encoding flag to
  // get wrong and every unzip tool agrees on them. Returns a Uint8Array.
  function createZip(files) {
    if (!Array.isArray(files) || files.length === 0) throw new Error("createZip: no files");

    var entries = [];
    var seen = {};
    var i;
    for (i = 0; i < files.length; i += 1) {
      var f = files[i];
      if (!f || typeof f.name !== "string" || typeof f.text !== "string") {
        throw new Error("createZip: each file needs { name, text }");
      }
      if (!ASCII_NAME_RE.test(f.name)) throw new Error("createZip: name must be plain ASCII: " + f.name);
      if (seen[f.name]) throw new Error("createZip: duplicate name " + f.name);
      seen[f.name] = true;
      var nameBytes = utf8(f.name);
      var data = utf8(f.text);
      entries.push({ name: f.name, nameBytes: nameBytes, data: data, crc: crc32(data), offset: 0 });
    }

    var w = new Writer();

    // ---- local file headers + data
    for (i = 0; i < entries.length; i += 1) {
      var e = entries[i];
      e.offset = w.length;
      w.u32(0x04034b50); // local file header signature
      w.u16(20);         // version needed to extract (2.0)
      w.u16(0);          // general purpose flags - none, names are ASCII
      w.u16(0);          // method 0 = store
      w.u16(FIXED_DOS_TIME);
      w.u16(FIXED_DOS_DATE);
      w.u32(e.crc);
      w.u32(e.data.length); // compressed size == uncompressed size
      w.u32(e.data.length);
      w.u16(e.nameBytes.length);
      w.u16(0);          // extra field length
      w.bytes(e.nameBytes);
      w.bytes(e.data);
    }

    // ---- central directory
    var cdStart = w.length;
    for (i = 0; i < entries.length; i += 1) {
      var c = entries[i];
      w.u32(0x02014b50); // central directory header signature
      w.u16(20);         // version made by
      w.u16(20);         // version needed
      w.u16(0);          // flags
      w.u16(0);          // method
      w.u16(FIXED_DOS_TIME);
      w.u16(FIXED_DOS_DATE);
      w.u32(c.crc);
      w.u32(c.data.length);
      w.u32(c.data.length);
      w.u16(c.nameBytes.length);
      w.u16(0);          // extra
      w.u16(0);          // comment
      w.u16(0);          // disk number start
      w.u16(0);          // internal attributes
      w.u32(0);          // external attributes
      w.u32(c.offset);
      w.bytes(c.nameBytes);
    }
    var cdSize = w.length - cdStart;

    // ---- end of central directory
    w.u32(0x06054b50);
    w.u16(0);                // this disk
    w.u16(0);                // disk with the central directory
    w.u16(entries.length);   // entries on this disk
    w.u16(entries.length);   // entries total
    w.u32(cdSize);
    w.u32(cdStart);
    w.u16(0);                // comment length

    return w.result();
  }

  // Minimal reader, used by the tests to prove the archive really contains what it should
  // without shelling out to an unzip tool.
  function listZip(bytes) {
    var out = [];
    var i = 0;
    function u16(at) {
      return bytes[at] | (bytes[at + 1] << 8);
    }
    function u32(at) {
      return (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0;
    }
    while (i + 4 <= bytes.length && u32(i) === 0x04034b50) {
      var method = u16(i + 8);
      var crc = u32(i + 14);
      var size = u32(i + 18);
      var nameLen = u16(i + 26);
      var extraLen = u16(i + 28);
      var nameBytes = bytes.subarray(i + 30, i + 30 + nameLen);
      var dataAt = i + 30 + nameLen + extraLen;
      var data = bytes.subarray(dataAt, dataAt + size);
      out.push({
        name: String.fromCharCode.apply(null, Array.prototype.slice.call(nameBytes)),
        method: method,
        crc: crc,
        size: size,
        data: data,
        crcOk: crc32(data) === crc,
        dosTime: u16(i + 10),
        dosDate: u16(i + 12)
      });
      i = dataAt + size;
    }
    return out;
  }

  NEXUS.zipStore = {
    FIXED_DOS_TIME: FIXED_DOS_TIME,
    FIXED_DOS_DATE: FIXED_DOS_DATE,
    FIXED_DATE_LABEL: FIXED_DATE_LABEL,
    METHOD: "store",
    crc32: crc32,
    createZip: createZip,
    listZip: listZip
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
