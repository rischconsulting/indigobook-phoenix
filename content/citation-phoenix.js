var CitationPhoenix = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // lib/main.mjs
  var main_exports = {};
  __export(main_exports, {
    activate: () => activate,
    deactivate: () => deactivate
  });

  // lib/services/dataStore.mjs
  var DataStore = class {
    constructor(rootURI) {
      this.rootURI = rootURI;
      this.cache = /* @__PURE__ */ new Map();
    }
    async init() {
      await Promise.all([
        this.loadJSON("style-modules/index.json").catch(() => null),
        this.loadJSON("juris-abbrevs/DIRECTORY_LISTING.json").catch(() => null),
        this.loadJSON("juris-maps/DIRECTORY_LISTING.json").catch(() => null),
        this.loadJSON("juris-maps/versions.json").catch(() => null),
        this.loadJSON("juris-maps/primary-jurisdictions.json").catch(() => null)
      ]);
    }
    async loadText(relPath) {
      if (this.cache.has(relPath)) return this.cache.get(relPath);
      const url = this.rootURI.spec + relPath;
      const text = await this._loadURLText(url);
      this.cache.set(relPath, text);
      return text;
    }
    async _loadURLText(url) {
      if (/^https?:/i.test(url)) {
        const req = await Zotero.HTTP.request("GET", url);
        return req.response;
      }
      return new Promise((resolve, reject) => {
        const req = new XMLHttpRequest();
        req.open("GET", url, true);
        req.overrideMimeType?.("text/plain; charset=UTF-8");
        req.onloadend = () => {
          if (req.status === 0 || req.status >= 200 && req.status < 300) {
            resolve(req.responseText);
          } else {
            reject(new Error(`Failed to load ${url}: ${req.status}`));
          }
        };
        req.onerror = () => reject(new Error(`Failed to load ${url}`));
        req.send(null);
      });
    }
    async loadJSON(relPath) {
      if (this.cache.has(relPath)) return this.cache.get(relPath);
      const text = await this.loadText(relPath);
      const obj = JSON.parse(text);
      this.cache.set(relPath, obj);
      return obj;
    }
    async loadTextAny(relPaths) {
      const paths = Array.isArray(relPaths) ? relPaths : [relPaths];
      for (const relPath of paths) {
        if (!relPath) continue;
        try {
          return await this.loadText(relPath);
        } catch (error) {
        }
      }
      return null;
    }
    async loadJSONAny(relPaths) {
      const paths = Array.isArray(relPaths) ? relPaths : [relPaths];
      for (const relPath of paths) {
        if (!relPath) continue;
        try {
          return await this.loadJSON(relPath);
        } catch (error) {
        }
      }
      return null;
    }
  };

  // lib/services/jurisdiction.mjs
  var Jurisdiction = class {
    static fromItem(item) {
      const extra = (item.getField?.("extra") || item.extra || "") + "";
      const jur = this._fromMLZ(extra) || this._fromKeyValue(extra);
      if (!jur) return "";
      return this._normalizeJurisdiction(jur);
    }
    static getMLZExtraFields(itemOrExtra) {
      const extra = typeof itemOrExtra === "string" ? itemOrExtra : itemOrExtra?.getField?.("extra") || itemOrExtra?.extra || "";
      const jsonText = this._extractMLZJSON(extra);
      if (!jsonText) return null;
      try {
        const obj = JSON.parse(jsonText);
        return this._getMLZFieldObject(obj);
      } catch (e) {
        return null;
      }
    }
    static getMLZExtraCreators(itemOrExtra) {
      const extra = typeof itemOrExtra === "string" ? itemOrExtra : itemOrExtra?.getField?.("extra") || itemOrExtra?.extra || "";
      const jsonText = this._extractMLZJSON(extra);
      if (!jsonText) return [];
      try {
        const obj = JSON.parse(jsonText);
        return Array.isArray(obj?.extracreators) ? obj.extracreators : [];
      } catch (e) {
        return [];
      }
    }
    static getMLZExtraCreatorsByType(itemOrExtra, creatorType) {
      const normalizedType = String(creatorType || "").trim().toLowerCase();
      if (!normalizedType) return [];
      return this.getMLZExtraCreators(itemOrExtra).filter((creator) => String(creator?.creatorType || "").trim().toLowerCase() === normalizedType).map((creator) => ({ ...creator }));
    }
    static updateMLZExtraCreators(itemOrExtra, creatorType, creators) {
      const extra = typeof itemOrExtra === "string" ? itemOrExtra : itemOrExtra?.getField?.("extra") || itemOrExtra?.extra || "";
      const normalizedType = String(creatorType || "").trim().toLowerCase();
      if (!normalizedType) return extra;
      const parsed = this._getMLZPayloadAndRange(extra);
      const payload = parsed.payload || {};
      const existingCreators = Array.isArray(payload.extracreators) ? payload.extracreators : [];
      const retainedCreators = existingCreators.filter((creator) => {
        return String(creator?.creatorType || "").trim().toLowerCase() !== normalizedType;
      });
      const incomingCreators = Array.isArray(creators) ? creators : [];
      for (const creator of incomingCreators) {
        const normalizedCreator = this._normalizeExtraCreator(creator, normalizedType);
        if (normalizedCreator) retainedCreators.push(normalizedCreator);
      }
      if (retainedCreators.length) payload.extracreators = retainedCreators;
      else delete payload.extracreators;
      const hasExtraFields = this._hasMLZFields(payload);
      const hasExtraCreators = Array.isArray(payload.extracreators) && payload.extracreators.length;
      if (!hasExtraFields && !hasExtraCreators) {
        if (parsed.start != null && parsed.end != null) {
          return this._removeMLZBlock(extra, parsed.start, parsed.end);
        }
        return extra;
      }
      const mlzBlock = `mlzsync1:${JSON.stringify(payload)}`;
      if (parsed.start != null && parsed.end != null) {
        return `${extra.slice(0, parsed.start)}${mlzBlock}${extra.slice(parsed.end)}`;
      }
      const base = String(extra || "").trimEnd();
      return base ? `${base}
${mlzBlock}` : mlzBlock;
    }
    static getMLZJurisdiction(itemOrExtra) {
      const fields = this.getMLZExtraFields(itemOrExtra);
      const value = fields?.jurisdiction;
      if (!value) return "";
      return this._normalizeJurisdiction(this._decodeLengthPrefixedJurisdiction(String(value)) || "");
    }
    static getMLZItemType(itemOrExtra) {
      const extra = typeof itemOrExtra === "string" ? itemOrExtra : itemOrExtra?.getField?.("extra") || itemOrExtra?.extra || "";
      const payload = this._getMLZPayloadAndRange(extra).payload || null;
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
      const nestedFields = payload.extrafields && typeof payload.extrafields === "object" && !Array.isArray(payload.extrafields) ? payload.extrafields : null;
      return String(
        payload.xtype || payload.itemType || nestedFields?.xtype || nestedFields?.itemType || ""
      ).trim();
    }
    static updateMLZJurisdiction(itemOrExtra, jurisdiction, displayValue = "") {
      const normalized = this._normalizeJurisdiction(jurisdiction || "");
      const encoded = normalized ? this._encodeLengthPrefixedJurisdiction(normalized, displayValue) : "";
      return this.updateMLZExtraField(itemOrExtra, "jurisdiction", encoded);
    }
    static updateMLZItemType(itemOrExtra, itemType) {
      const extra = typeof itemOrExtra === "string" ? itemOrExtra : itemOrExtra?.getField?.("extra") || itemOrExtra?.extra || "";
      const parsed = this._getMLZPayloadAndRange(extra);
      const payload = parsed.payload || {};
      const value = String(itemType || "").trim();
      if (value) payload.xtype = value;
      else delete payload.xtype;
      delete payload.itemType;
      if (payload.extrafields && typeof payload.extrafields === "object" && !Array.isArray(payload.extrafields)) {
        delete payload.extrafields.xtype;
        delete payload.extrafields.itemType;
        if (!Object.keys(payload.extrafields).length) {
          delete payload.extrafields;
        }
      }
      const hasExtraFields = this._hasMLZFields(payload);
      const hasExtraCreators = Array.isArray(payload.extracreators) && payload.extracreators.length;
      const hasControlSections = this._hasMLZControlSections(payload);
      if (!hasExtraFields && !hasExtraCreators && !hasControlSections) {
        if (parsed.start != null && parsed.end != null) {
          return this._removeMLZBlock(extra, parsed.start, parsed.end);
        }
        return extra;
      }
      const mlzBlock = `mlzsync1:${JSON.stringify(payload)}`;
      if (parsed.start != null && parsed.end != null) {
        return `${extra.slice(0, parsed.start)}${mlzBlock}${extra.slice(parsed.end)}`;
      }
      const base = String(extra || "").trimEnd();
      return base ? `${base}
${mlzBlock}` : mlzBlock;
    }
    static updateMLZExtraField(itemOrExtra, fieldName, fieldValue) {
      const extra = typeof itemOrExtra === "string" ? itemOrExtra : itemOrExtra?.getField?.("extra") || itemOrExtra?.extra || "";
      const field = (fieldName || "").toString().trim();
      if (!field) return extra;
      const parsed = this._getMLZPayloadAndRange(extra);
      if (!parsed.payload && (fieldValue == null || String(fieldValue).trim() === "")) {
        return extra;
      }
      const payload = parsed.payload || {};
      const targetFields = this._ensureMLZFieldObject(payload);
      const value = fieldValue == null ? "" : String(fieldValue).trim();
      if (value) {
        targetFields[field] = value;
        if (targetFields !== payload) delete payload[field];
      } else {
        delete targetFields[field];
        if (payload.extrafields && typeof payload.extrafields === "object" && !Array.isArray(payload.extrafields)) {
          delete payload.extrafields[field];
        }
        delete payload[field];
      }
      this._cleanupEmptyMLZFieldObject(payload);
      const hasExtraFields = this._hasMLZFields(payload);
      const hasExtraCreators = Array.isArray(payload.extracreators) && payload.extracreators.length;
      const hasControlSections = this._hasMLZControlSections(payload);
      if (!hasExtraFields && !hasExtraCreators && !hasControlSections) {
        if (parsed.start != null && parsed.end != null) {
          return this._removeMLZBlock(extra, parsed.start, parsed.end);
        }
        return extra;
      }
      const mlzBlock = `mlzsync1:${JSON.stringify(payload)}`;
      if (parsed.start != null && parsed.end != null) {
        return `${extra.slice(0, parsed.start)}${mlzBlock}${extra.slice(parsed.end)}`;
      }
      const base = String(extra || "").trimEnd();
      return base ? `${base}
${mlzBlock}` : mlzBlock;
    }
    static _fromMLZ(extra) {
      const fields = this.getMLZExtraFields(extra);
      const j = fields?.jurisdiction;
      if (!j) return null;
      return this._decodeLengthPrefixedJurisdiction(j);
    }
    static _extractMLZJSON(extra) {
      return this._getMLZPayloadAndRange(extra).jsonText || null;
    }
    static _getMLZPayloadAndRange(extra) {
      const source = String(extra || "");
      const marker = "mlzsync1:";
      const markerIndex = source.indexOf(marker);
      if (markerIndex === -1) {
        return { payload: null, start: null, end: null };
      }
      const braceStart = this._findMLZPayloadBraceStart(source, markerIndex + marker.length);
      if (braceStart == null) {
        return { payload: null, start: null, end: null };
      }
      let depth = 0;
      let inString = false;
      let escaping = false;
      for (let i = braceStart; i < source.length; i += 1) {
        const ch = source[i];
        if (inString) {
          if (escaping) escaping = false;
          else if (ch === "\\") escaping = true;
          else if (ch === '"') inString = false;
          continue;
        }
        if (ch === '"') {
          inString = true;
          continue;
        }
        if (ch === "{") {
          depth += 1;
          continue;
        }
        if (ch === "}") {
          depth -= 1;
          if (depth === 0) {
            const jsonText = source.slice(braceStart, i + 1);
            try {
              return {
                payload: JSON.parse(jsonText),
                start: markerIndex,
                end: i + 1,
                jsonText
              };
            } catch (e) {
              return {
                payload: null,
                start: markerIndex,
                end: i + 1,
                jsonText
              };
            }
          }
        }
      }
      return { payload: null, start: markerIndex, end: source.length, jsonText: null };
    }
    static _findMLZPayloadBraceStart(source, searchStart = 0) {
      const text = String(source || "");
      let idx = Math.max(0, Number(searchStart) || 0);
      while (idx < text.length) {
        const ch = text[idx];
        if (ch === "{") return idx;
        if (/\s/.test(ch) || /\d/.test(ch)) {
          idx += 1;
          continue;
        }
        return null;
      }
      return null;
    }
    static _removeMLZBlock(extra, start, end) {
      const source = String(extra || "");
      const prefix = source.slice(0, start).replace(/[ \t]+\n?$/, "");
      const suffix = source.slice(end).replace(/^\r?\n/, "");
      const combined = `${prefix}${prefix && suffix ? "\n" : ""}${suffix}`;
      return combined.trimEnd();
    }
    static _getMLZFieldObject(payload) {
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
      const topLevelFields = Object.fromEntries(
        Object.entries(payload).filter(([key]) => !this._getMLZControlKeys().includes(key))
      );
      if (payload.extrafields && typeof payload.extrafields === "object" && !Array.isArray(payload.extrafields)) {
        return {
          ...topLevelFields,
          ...payload.extrafields
        };
      }
      if (!Object.keys(topLevelFields).length) return null;
      return topLevelFields;
    }
    static _ensureMLZFieldObject(payload) {
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        return {};
      }
      if (payload.extrafields && typeof payload.extrafields === "object" && !Array.isArray(payload.extrafields)) {
        return payload.extrafields;
      }
      if (this._hasMLZControlSections(payload)) {
        if (!payload.extrafields || typeof payload.extrafields !== "object" || Array.isArray(payload.extrafields)) {
          payload.extrafields = {};
        }
        return payload.extrafields;
      }
      return payload;
    }
    static _cleanupEmptyMLZFieldObject(payload) {
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) return;
      if (payload.extrafields && typeof payload.extrafields === "object" && !Array.isArray(payload.extrafields) && !Object.keys(payload.extrafields).length) {
        delete payload.extrafields;
      }
    }
    static _hasMLZFields(payload) {
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
      const fields = this._getMLZFieldObject(payload);
      return !!fields && Object.keys(fields).length > 0;
    }
    static _hasMLZControlSections(payload) {
      return this._getMLZControlKeys().some((key) => key in payload);
    }
    static _getMLZControlKeys() {
      return ["extracreators", "extrafields", "multifields", "multicreators", "xtype", "itemType"];
    }
    static _normalizeExtraCreator(creator, creatorType) {
      if (!creator || typeof creator !== "object") return null;
      const literalName = String(creator.name || "").trim();
      if (literalName) {
        return {
          name: literalName,
          creatorType
        };
      }
      const firstName = String(creator.firstName || "").trim();
      const lastName = String(creator.lastName || "").trim();
      if (!firstName && !lastName) return null;
      return {
        firstName,
        lastName,
        creatorType
      };
    }
    static _decodeLengthPrefixedJurisdiction(s) {
      if (!s || s.length < 4) return null;
      const prefix = s.slice(0, 3);
      if (!/^\d{3}$/.test(prefix)) return s;
      const len = parseInt(prefix, 10);
      const code = s.slice(3, 3 + len);
      return code || null;
    }
    static _encodeLengthPrefixedJurisdiction(value, displayValue = "") {
      const jurisdiction = (value || "").toString().trim();
      if (!jurisdiction) return "";
      const display = (displayValue || "").toString().trim();
      return `${String(jurisdiction.length).padStart(3, "0")}${jurisdiction}${display}`;
    }
    static _fromKeyValue(extra) {
      const m = extra.match(/^\s*jurisdiction\s*:\s*([^\n\r]+?)\s*$/im);
      return m ? m[1] : null;
    }
    static _normalizeJurisdiction(jur) {
      let value = (jur || "").toString().trim().toLowerCase();
      if (!value) return "";
      const stateInfoByName = {
        alabama: { code: "al", circuit: "11" },
        alaska: { code: "ak", circuit: "9" },
        arizona: { code: "az", circuit: "9" },
        arkansas: { code: "ar", circuit: "8" },
        california: { code: "ca", circuit: "9" },
        colorado: { code: "co", circuit: "10" },
        connecticut: { code: "ct", circuit: "2" },
        delaware: { code: "de", circuit: "3" },
        districtofcolumbia: { code: "dc", circuit: "0" },
        dc: { code: "dc", circuit: "0" },
        florida: { code: "fl", circuit: "11" },
        georgia: { code: "ga", circuit: "11" },
        hawaii: { code: "hi", circuit: "9" },
        idaho: { code: "id", circuit: "9" },
        illinois: { code: "il", circuit: "7" },
        indiana: { code: "in", circuit: "7" },
        iowa: { code: "ia", circuit: "8" },
        kansas: { code: "ks", circuit: "10" },
        kentucky: { code: "ky", circuit: "6" },
        louisiana: { code: "la", circuit: "5" },
        maine: { code: "me", circuit: "1" },
        maryland: { code: "md", circuit: "4" },
        massachusetts: { code: "ma", circuit: "1" },
        michigan: { code: "mi", circuit: "6" },
        minnesota: { code: "mn", circuit: "8" },
        mississippi: { code: "ms", circuit: "5" },
        missouri: { code: "mo", circuit: "8" },
        montana: { code: "mt", circuit: "9" },
        nebraska: { code: "ne", circuit: "8" },
        nevada: { code: "nv", circuit: "9" },
        newhampshire: { code: "nh", circuit: "1" },
        newjersey: { code: "nj", circuit: "3" },
        newmexico: { code: "nm", circuit: "10" },
        newyork: { code: "ny", circuit: "2" },
        northcarolina: { code: "nc", circuit: "4" },
        northdakota: { code: "nd", circuit: "8" },
        ohio: { code: "oh", circuit: "6" },
        oklahoma: { code: "ok", circuit: "10" },
        oregon: { code: "or", circuit: "9" },
        pennsylvania: { code: "pa", circuit: "3" },
        puertorico: { code: "pr", circuit: "1" },
        rhodeisland: { code: "ri", circuit: "1" },
        southcarolina: { code: "sc", circuit: "4" },
        southdakota: { code: "sd", circuit: "8" },
        tennessee: { code: "tn", circuit: "6" },
        texas: { code: "tx", circuit: "5" },
        utah: { code: "ut", circuit: "10" },
        vermont: { code: "vt", circuit: "2" },
        virginia: { code: "va", circuit: "4" },
        washington: { code: "wa", circuit: "9" },
        westvirginia: { code: "wv", circuit: "4" },
        wisconsin: { code: "wi", circuit: "7" },
        wyoming: { code: "wy", circuit: "10" },
        guam: { code: "gu", circuit: "9" },
        usvirginislands: { code: "vi", circuit: "3" },
        virginislands: { code: "vi", circuit: "3" },
        northernmarianaislands: { code: "mp", circuit: "9" }
      };
      if (/^us(?::[a-z0-9._-]+)*$/.test(value)) return value;
      const districtMatch = value.match(/^([nsewmc])?\s*\.?\s*d\.?\s+(.+)$/i);
      if (districtMatch) {
        const districtPart = districtMatch[1] ? `${String(districtMatch[1]).toLowerCase()}d` : "d";
        const stateCompact = String(districtMatch[2] || "").replace(/[^a-z]/g, "");
        const state = stateInfoByName[stateCompact];
        if (state?.code) {
          if (state.code === "dc") return "us:dc.d";
          if (state.circuit) return `us:c${state.circuit}:${state.code}.${districtPart}`;
          return `us:${state.code}.${districtPart}`;
        }
      }
      const compact = value.replace(/[^a-z0-9]/g, "");
      if (compact === "federalcircuit" || compact === "fedcir" || compact === "cafc") return "us:c";
      if (compact === "dccircuit" || compact === "districtofcolumbiacircuit" || compact === "dccir") return "us:c0";
      const ordinals = {
        first: "1",
        second: "2",
        third: "3",
        fourth: "4",
        fifth: "5",
        sixth: "6",
        seventh: "7",
        eighth: "8",
        ninth: "9",
        tenth: "10",
        eleventh: "11"
      };
      for (const [word, num] of Object.entries(ordinals)) {
        if (compact === `${word}circuit`) return `us:c${num}`;
      }
      const numbered = compact.match(/^(1|2|3|4|5|6|7|8|9|10|11)(st|nd|rd|th)?circuit$/);
      if (numbered) return `us:c${numbered[1]}`;
      const byName = {
        ohio: "us:oh",
        california: "us:ca",
        newyork: "us:ny",
        texas: "us:tx",
        florida: "us:fl",
        illinois: "us:il",
        pennsylvania: "us:pa",
        virginia: "us:va",
        massachusetts: "us:ma",
        michigan: "us:mi"
      };
      const compactAlpha = value.replace(/[^a-z]/g, "");
      if (stateInfoByName[compactAlpha]?.code) return `us:${stateInfoByName[compactAlpha].code}`;
      if (byName[compactAlpha]) return byName[compactAlpha];
      return value;
    }
    static isRecognizedJurisdiction(jur) {
      const normalized = this._normalizeJurisdiction(jur || "");
      if (!normalized) return false;
      if (/^us(?::[a-z0-9._-]+)*$/.test(normalized)) return true;
      const compact = normalized.replace(/[^a-z0-9]/g, "");
      const knownRoots = /* @__PURE__ */ new Set([
        "au",
        "ca",
        "uk"
      ]);
      return knownRoots.has(compact);
    }
    static trimChain(jur) {
      const parts = (jur || "us").toLowerCase().split(":");
      const chain = [];
      for (let i = parts.length; i >= 1; i--) chain.push(parts.slice(0, i).join(":"));
      return chain;
    }
    static isCircuit(jur) {
      const parts = (jur || "").toLowerCase().split(":");
      return parts[0] === "us" && /^c\d+$/.test(parts[1] || "");
    }
    static topToken(jur) {
      const parts = (jur || "").toLowerCase().split(":");
      return parts[1] || null;
    }
  };

  // lib/services/moduleLoader.mjs
  var ModuleLoader = class {
    constructor({ rootURI, dataStore, locale }) {
      this.rootURI = rootURI;
      this.dataStore = dataStore;
      this.locale = locale;
      this._defaultJurisdiction = "us";
      this._availableFiles = [];
      this._byFile = /* @__PURE__ */ new Map();
      this._byJur = /* @__PURE__ */ new Map();
      this._byModuleID = /* @__PURE__ */ new Map();
    }
    async preload() {
      const idx = await this.dataStore.loadJSON("style-modules/index.json");
      const allFiles = Array.isArray(idx?.files) ? idx.files.slice() : [];
      this._availableFiles = allFiles.filter((file) => /\.csl$/i.test(file) && file.toLowerCase().startsWith("juris-")).sort((a, b) => a.localeCompare(b));
      for (const file of this._availableFiles) {
        const path = "style-modules/" + file;
        const xml = await this.dataStore.loadText(path);
        this._byFile.set(file, xml);
        const info = this._parseModuleFilename(file);
        if (!info) continue;
        this._byModuleID.set(info.id, xml);
        let byVariant = this._byJur.get(info.jurisdiction);
        if (!byVariant) {
          byVariant = /* @__PURE__ */ new Map();
          this._byJur.set(info.jurisdiction, byVariant);
        }
        byVariant.set(info.variant, xml);
      }
      if (!this._hasModuleForJurisdiction(this._defaultJurisdiction) && this._availableFiles.length) {
        const firstInfo = this._parseModuleFilename(this._availableFiles[0]);
        const firstRoot = firstInfo?.jurisdiction?.split(":")[0] || "";
        if (firstRoot && this._hasModuleForJurisdiction(firstRoot)) {
          this._defaultJurisdiction = firstRoot;
        }
      }
    }
    _parseModuleFilename(file) {
      const stem = String(file || "").replace(/\.csl$/i, "");
      if (!stem.toLowerCase().startsWith("juris-")) return null;
      const body = stem.slice(6);
      if (!body) return null;
      const dashIdx = body.indexOf("-");
      const jurisdictionPart = dashIdx === -1 ? body : body.slice(0, dashIdx);
      const variantPart = dashIdx === -1 ? "" : body.slice(dashIdx + 1);
      if (!jurisdictionPart) return null;
      return {
        fileName: file,
        id: stem,
        jurisdiction: jurisdictionPart.toLowerCase().replace(/\+/g, ":"),
        variant: variantPart.toLowerCase()
      };
    }
    _hasModuleForJurisdiction(jurisdiction) {
      return this._byJur.has(String(jurisdiction || "").toLowerCase());
    }
    hasJurisdiction(jur) {
      return this._hasModuleForJurisdiction(jur);
    }
    _normalizeVariantName(variantName) {
      return String(variantName || "").trim().toLowerCase();
    }
    _getJurisdictionVariantMap(jurisdiction) {
      return this._byJur.get(String(jurisdiction || "").toLowerCase()) || null;
    }
    _getModuleForJurisdiction(jurisdiction, variantName = "") {
      const byVariant = this._getJurisdictionVariantMap(jurisdiction);
      if (!byVariant) return null;
      const variant = this._normalizeVariantName(variantName);
      if (variant && byVariant.has(variant)) {
        return byVariant.get(variant);
      }
      if (byVariant.has("")) {
        return byVariant.get("");
      }
      if (!variant && byVariant.size) {
        return byVariant.values().next().value || null;
      }
      return null;
    }
    loadJurisdictionStyleSync(jurisdiction, variantName = "IndigoTemp") {
      const variant = this._normalizeVariantName(variantName);
      const jur = String(jurisdiction || this._defaultJurisdiction || "us").trim().toLowerCase() || "us";
      const chain = Jurisdiction.trimChain(jur);
      if (variant) {
        for (const j of chain) {
          const byVariant = this._getJurisdictionVariantMap(j);
          if (byVariant?.has(variant)) {
            return byVariant.get(variant);
          }
        }
      }
      for (const j of chain) {
        const xml = this._getModuleForJurisdiction(j, "");
        if (xml) return xml;
      }
      return this._getModuleForJurisdiction(this._defaultJurisdiction, variant) || null;
    }
  };

  // lib/services/locale.mjs
  function getLocaleCandidates(rawLocale) {
    const locale = String(rawLocale || "").trim().replace(/_/g, "-");
    if (!locale) {
      return ["us"];
    }
    const parts = locale.split("-").filter(Boolean);
    const candidates = [];
    const push = (value) => {
      const code = String(value || "").trim().toLowerCase();
      if (code && !candidates.includes(code)) {
        candidates.push(code);
      }
    };
    push(parts.join("-"));
    if (parts.length >= 2) {
      push(`${parts[1]}-${parts[0]}`);
    }
    for (let index = 1; index < parts.length; index += 1) {
      const part = parts[index];
      if (/^[A-Za-z]{2}$/.test(part) || /^\d{3}$/.test(part)) {
        push(part);
        break;
      }
    }
    push(parts[0]);
    push("us");
    return candidates;
  }
  function filePrefixMatches(fileName, prefix) {
    const file = String(fileName || "").toLowerCase();
    const stem = String(prefix || "").toLowerCase();
    const fileStem = file.replace(/\.[^.]+$/, "");
    return fileStem === stem || fileStem.startsWith(`${stem}-`) || fileStem.startsWith(`${stem}+`);
  }
  function selectLocaleFiles(fileNames, prefix, rawLocale, extension) {
    const files = Array.isArray(fileNames) ? fileNames.slice() : [];
    const normalizedExtension = String(extension || "").trim().toLowerCase();
    const candidates = getLocaleCandidates(rawLocale);
    const matchingFiles = (candidate) => {
      const lowerCandidate = String(candidate || "").trim().toLowerCase();
      const exactName = normalizedExtension ? `${prefix}-${lowerCandidate}${normalizedExtension}` : `${prefix}-${lowerCandidate}`;
      const exact = [];
      const variants = [];
      for (const file of files) {
        const lower = String(file || "").toLowerCase();
        if (normalizedExtension && !lower.endsWith(normalizedExtension)) continue;
        if (!filePrefixMatches(lower, `${prefix}-${lowerCandidate}`)) continue;
        if (lower === exactName) {
          exact.push(file);
        } else {
          variants.push(file);
        }
      }
      exact.sort((a, b) => a.localeCompare(b));
      variants.sort((a, b) => a.localeCompare(b));
      return exact.concat(variants);
    };
    for (const candidate of candidates) {
      const matches = matchingFiles(candidate);
      if (matches.length) {
        return matches;
      }
    }
    return [];
  }

  // lib/services/abbrevService.mjs
  var AbbrevService = class {
    constructor({ dataStore, locale }) {
      this.dataStore = dataStore;
      this.locale = locale;
      this._localeCandidates = getLocaleCandidates(locale);
      this._autoDatasets = /* @__PURE__ */ new Map();
      this._autoDatasetsByRoot = /* @__PURE__ */ new Map();
      this._autoDomainsByRoot = /* @__PURE__ */ new Map();
      this._primaryDatasets = /* @__PURE__ */ new Map();
      this._primaryDatasetsByRoot = /* @__PURE__ */ new Map();
      this._mapDatasets = /* @__PURE__ */ new Map();
      this._mapDatasetsByRoot = /* @__PURE__ */ new Map();
      this._defaultAutoDataset = null;
      this._defaultPrimaryDataset = null;
      this._defaultMapDataset = null;
      this._autoUS = null;
      this._primaryUS = null;
      this._secondaryDatasets = {};
      this._secondaryDatasetOrder = [];
      this._secondaryDatasetMeta = /* @__PURE__ */ new Map();
      this._defaultSecondaryDataset = "secondary-us-bluebook";
      this._jurisUSMap = null;
      this._primaryJur = null;
      this._defaultJurisdiction = "us";
      this._userSecondaryOverrides = {};
      this._secondaryOverridesPref = "extensions.citation-phoenix.secondaryContainerTitleOverrides";
      this._legacySecondaryOverridesPref = "extensions.indigobook-cslm.secondaryContainerTitleOverrides";
      this._userJurisdictionOverrides = {};
      this._jurisdictionOverridesPref = "extensions.citation-phoenix.jurisdictionOverrides";
      this._legacyJurisdictionOverridesPref = "extensions.indigobook-cslm.jurisdictionOverrides";
    }
    async preload() {
      const listing = await this.dataStore.loadJSON("juris-abbrevs/DIRECTORY_LISTING.json");
      const listingEntries = Array.isArray(listing) ? listing : [];
      const listingFiles = this._expandListingFiles(listingEntries);
      const fileNames = listingFiles.map((item) => item.filename);
      const fileMetaByName = new Map(listingFiles.map((item) => [item.filename, item.name]));
      const mapListing = await this.dataStore.loadJSONAny(["juris-maps/DIRECTORY_LISTING.json"]);
      const mapListingEntries = Array.isArray(mapListing) ? mapListing : [];
      const mapFileMetaByName = new Map(
        mapListingEntries.map((item) => [String(item?.filename || "").trim(), String(item?.name || "").trim()]).filter(([filename]) => Boolean(filename))
      );
      const autoFiles = fileNames.filter((file) => /^auto-.*\.json$/i.test(file));
      this._autoDatasets = await this._loadDatasetGroup("juris-abbrevs", autoFiles, fileMetaByName);
      this._autoDatasetsByRoot = this._groupDatasetsByRoot(this._autoDatasets);
      this._autoDomainsByRoot = this._groupDatasetDomainsByRoot(this._autoDatasets);
      this._defaultAutoDataset = this._pickLocaleDataset(Array.from(this._autoDatasets.keys()), "auto") || null;
      this._autoUS = this._defaultAutoDataset ? this._autoDatasets.get(this._defaultAutoDataset)?.data || null : null;
      this._defaultJurisdiction = this._jurisdictionRootFromFilename(this._defaultAutoDataset) || this._defaultJurisdiction;
      const primaryFiles = fileNames.filter((file) => /^primary-.*\.json$/i.test(file));
      this._primaryDatasets = await this._loadDatasetGroup("juris-abbrevs", primaryFiles, fileMetaByName);
      this._primaryDatasetsByRoot = this._groupDatasetsByRoot(this._primaryDatasets);
      this._defaultPrimaryDataset = this._primaryDatasets.has("primary-us") ? "primary-us" : Array.from(this._primaryDatasets.keys())[0] || null;
      this._primaryUS = this._defaultPrimaryDataset ? this._primaryDatasets.get(this._defaultPrimaryDataset)?.data || null : null;
      const mapFiles = Array.from(/* @__PURE__ */ new Set([
        ...mapListingEntries.map((item) => String(item?.filename || "").trim()).filter((file) => /^juris-.*-map\.json$/i.test(file)),
        ...fileNames.filter((file) => /^juris-.*-map\.json$/i.test(file))
      ])).sort((a, b) => a.localeCompare(b));
      this._mapDatasets = await this._loadDatasetGroup("juris-maps", mapFiles, mapFileMetaByName);
      this._mapDatasetsByRoot = this._groupDatasetsByRoot(this._mapDatasets);
      this._defaultMapDataset = this._mapDatasets.has("juris-us-map") ? "juris-us-map" : Array.from(this._mapDatasets.keys())[0] || null;
      this._jurisUSMap = this._defaultMapDataset ? this._mapDatasets.get(this._defaultMapDataset)?.data || null : null;
      const secondaryFiles = fileNames.filter((file) => /^secondary-.*\.json$/i.test(file));
      this._secondaryDatasetMeta = new Map(
        secondaryFiles.map((file) => {
          const dataset = this._datasetNameFromFilename(file);
          return [dataset, {
            filename: file,
            name: fileMetaByName.get(file) || dataset
          }];
        })
      );
      this._secondaryDatasets = {};
      for (const file of secondaryFiles) {
        const dataset = this._datasetNameFromFilename(file);
        this._secondaryDatasets[dataset] = await this.dataStore.loadJSON(`juris-abbrevs/${file}`);
      }
      this._secondaryDatasetOrder = this._buildSecondaryDatasetOrder(Object.keys(this._secondaryDatasets));
      this._defaultSecondaryDataset = this._secondaryDatasetOrder.find((dataset) => this._secondaryDatasets?.[dataset]) || this._secondaryDatasetOrder[0] || "secondary-us-bluebook";
      this._primaryJur = await this.dataStore.loadJSONAny(["juris-maps/primary-jurisdictions.json", "data/primary-jurisdictions.json"]);
      this._userSecondaryOverrides = this._loadSecondaryOverrides();
      this._userJurisdictionOverrides = this._loadJurisdictionOverrides();
    }
    _buildLocalePathCandidates(basePath, suffix) {
      const candidates = [];
      const seen = /* @__PURE__ */ new Set();
      for (const candidate of this._localeCandidates) {
        const path = `${basePath}-${candidate}${suffix}`;
        if (seen.has(path)) continue;
        seen.add(path);
        candidates.push(path);
      }
      return candidates;
    }
    _expandListingFiles(listingEntries = []) {
      const rows = [];
      const seen = /* @__PURE__ */ new Set();
      for (const item of Array.isArray(listingEntries) ? listingEntries : []) {
        const filename = String(item?.filename || "").trim();
        const name = String(item?.name || "").trim();
        if (filename && !seen.has(filename)) {
          seen.add(filename);
          rows.push({ filename, name });
        }
        const variants = item?.variants;
        if (!variants || typeof variants !== "object" || Array.isArray(variants) || !filename) continue;
        for (const variantName of Object.keys(variants)) {
          const variant = String(variantName || "").trim();
          if (!variant) continue;
          const variantFile = filename.replace(/\.json$/i, `-${variant}.json`);
          if (!variantFile || seen.has(variantFile)) continue;
          seen.add(variantFile);
          rows.push({ filename: variantFile, name });
        }
      }
      return rows;
    }
    async _loadDatasetGroup(rootDir, fileNames, metaByFileName = /* @__PURE__ */ new Map()) {
      const datasets = /* @__PURE__ */ new Map();
      const files = Array.isArray(fileNames) ? fileNames.slice().sort((a, b) => a.localeCompare(b)) : [];
      for (const file of files) {
        const dataset = this._datasetNameFromFilename(file);
        const data = await this.dataStore.loadJSON(`${rootDir}/${file}`);
        datasets.set(dataset, {
          dataset,
          fileName: file,
          root: this._jurisdictionRootFromFilename(file),
          domain: this._datasetDomainFromFilename(file),
          domainKey: this._normalizeDatasetDomain(this._datasetDomainFromFilename(file)),
          name: String(metaByFileName.get(file) || this._inferDatasetDisplayName(dataset, data)).trim(),
          data
        });
      }
      return datasets;
    }
    _inferDatasetDisplayName(dataset, data) {
      const explicitName = String(data?.name || "").trim();
      if (explicitName) return explicitName;
      const localizedJurisdictions = this._getLocalizedMapJurisdictions(data);
      if (Array.isArray(localizedJurisdictions)) {
        for (const item of localizedJurisdictions) {
          if (!Array.isArray(item) || item.length < 2) continue;
          const label = String(item[1] || "").trim();
          if (label) return label;
        }
      }
      return this._formatDatasetLabel(dataset);
    }
    _getLocalizedMapJurisdictions(mapData) {
      const jurisdictions = mapData?.jurisdictions;
      if (!jurisdictions || typeof jurisdictions !== "object" || Array.isArray(jurisdictions)) return null;
      for (const candidate of this._localeCandidates || []) {
        const rows = jurisdictions?.[candidate];
        if (Array.isArray(rows) && rows.length) return rows;
      }
      return Array.isArray(jurisdictions?.default) ? jurisdictions.default : null;
    }
    _groupDatasetsByRoot(datasets) {
      const byRoot = /* @__PURE__ */ new Map();
      for (const info of datasets?.values?.() || []) {
        const root = String(info?.root || "").trim().toLowerCase();
        if (!root) continue;
        if (!byRoot.has(root)) byRoot.set(root, []);
        byRoot.get(root).push(info);
      }
      for (const infos of byRoot.values()) {
        infos.sort((a, b) => String(a.fileName || "").localeCompare(String(b.fileName || "")));
      }
      return byRoot;
    }
    _groupDatasetDomainsByRoot(datasets) {
      const byRoot = /* @__PURE__ */ new Map();
      for (const info of datasets?.values?.() || []) {
        const root = String(info?.root || "").trim().toLowerCase();
        const domain = String(info?.domain || "").trim();
        const domainKey = this._normalizeDatasetDomain(domain);
        if (!root || !domain || !domainKey) continue;
        if (!byRoot.has(root)) byRoot.set(root, []);
        const entries = byRoot.get(root);
        if (!entries.some((entry) => this._normalizeDatasetDomain(entry) === domainKey)) {
          entries.push(domain);
        }
      }
      for (const entries of byRoot.values()) {
        entries.sort((a, b) => a.localeCompare(b));
      }
      return byRoot;
    }
    _pickLocaleDataset(datasetNames, prefix) {
      const names = Array.isArray(datasetNames) ? datasetNames.slice() : [];
      if (!names.length) return null;
      const exactCandidates = selectLocaleFiles(names.map((name) => `${name}.json`), prefix, this.locale, ".json").map((file) => this._datasetNameFromFilename(file));
      if (exactCandidates.length) {
        return exactCandidates[0];
      }
      const exactPrefix = `${prefix}-`;
      const lowerLocale = this._localeCandidates[0] || "";
      for (const name of names) {
        if (name.toLowerCase() === `${prefix}-${lowerLocale}`.toLowerCase()) return name;
        if (name.toLowerCase().startsWith(exactPrefix)) return name;
      }
      return names[0];
    }
    _buildSecondaryDatasetOrder(loadedDatasets = []) {
      const core = ["secondary-us-bluebook", "secondary-science"];
      const loaded = Array.isArray(loadedDatasets) ? loadedDatasets : [];
      const names = [];
      for (const dataset of core) {
        if (loaded.includes(dataset) && !names.includes(dataset)) names.push(dataset);
      }
      for (const dataset of loaded.slice().sort((a, b) => a.localeCompare(b))) {
        if (!names.includes(dataset)) names.push(dataset);
      }
      return names;
    }
    _datasetNameFromFilename(fileName) {
      return String(fileName || "").trim().replace(/\.json$/i, "");
    }
    _datasetBodyFromFilename(fileName) {
      return this._datasetNameFromFilename(fileName).replace(/^auto-/i, "").replace(/^primary-/i, "").replace(/^secondary-/i, "").replace(/^juris-/i, "").replace(/-map$/i, "");
    }
    _jurisdictionRootFromFilename(fileName) {
      const body = this._datasetBodyFromFilename(fileName);
      const root = body.split("-")[0];
      return root ? root.toLowerCase().replace(/\+/g, ":") : null;
    }
    _datasetDomainFromFilename(fileName) {
      const body = this._datasetBodyFromFilename(fileName);
      const dashIdx = body.indexOf("-");
      if (dashIdx === -1) return null;
      const domain = body.slice(dashIdx + 1).trim();
      return domain || null;
    }
    _normalizeDatasetDomain(rawDomain) {
      return String(rawDomain || "").trim().toLowerCase() || null;
    }
    _splitJurisdictionDomain(rawJurisdiction) {
      const input = String(rawJurisdiction || "").trim();
      const atIdx = input.indexOf("@");
      const jurisdiction = (atIdx === -1 ? input : input.slice(0, atIdx)).trim().toLowerCase();
      const domain = atIdx === -1 ? "" : input.slice(atIdx + 1).trim();
      return {
        jurisdiction,
        domain,
        domainKey: this._normalizeDatasetDomain(domain)
      };
    }
    _jurisdictionRoot(rawJurisdiction) {
      const jurisdiction = this._splitJurisdictionDomain(rawJurisdiction).jurisdiction;
      if (!jurisdiction || jurisdiction === "default") {
        return this._defaultJurisdiction || "us";
      }
      return jurisdiction.split(":")[0] || (this._defaultJurisdiction || "us");
    }
    _jurisdictionMapCode(rawJurisdiction) {
      const jurisdiction = this._splitJurisdictionDomain(rawJurisdiction).jurisdiction;
      if (!jurisdiction || jurisdiction === "default") {
        return this._defaultJurisdiction || "us";
      }
      const parts = jurisdiction.split(":").filter(Boolean);
      return parts[parts.length - 1] || (this._defaultJurisdiction || "us");
    }
    _pickDatasetInfoForRoot(byRoot, root, fallbackDatasetName = null, preferredDomain = null) {
      const normalizedRoot = String(root || "").trim().toLowerCase();
      if (!normalizedRoot) return null;
      const entries = byRoot?.get?.(normalizedRoot) || [];
      if (Array.isArray(entries) && entries.length) {
        const normalizedDomain = this._normalizeDatasetDomain(preferredDomain);
        if (normalizedDomain) {
          const exactDomain = entries.find((entry) => this._normalizeDatasetDomain(entry?.domain) === normalizedDomain);
          if (exactDomain) return exactDomain;
        }
        const fallback = String(fallbackDatasetName || "").trim().toLowerCase();
        if (fallback.startsWith("juris-") && fallback.endsWith("-map")) {
          const exactMap = entries.find((entry) => String(entry.dataset || "").toLowerCase() === `juris-${normalizedRoot}-map`);
          if (exactMap) return exactMap;
        } else if (fallback.startsWith("primary-")) {
          const exactPrimary = entries.find((entry) => String(entry.dataset || "").toLowerCase() === `primary-${normalizedRoot}`);
          if (exactPrimary) return exactPrimary;
        } else if (fallback.startsWith("auto-")) {
          const exactAuto = entries.find((entry) => String(entry.dataset || "").toLowerCase() === `auto-${normalizedRoot}`);
          if (exactAuto) return exactAuto;
        }
        return entries[0];
      }
      if (fallbackDatasetName) {
        for (const group of byRoot?.values?.() || []) {
          const match = group.find((entry) => entry.dataset === fallbackDatasetName);
          if (match) return match;
        }
      }
      return null;
    }
    _normalizeJurisdictionDatasetName(rawDataset) {
      const dataset = String(rawDataset || "").trim();
      if (!dataset) return this._defaultAutoDataset || "auto-us";
      return dataset.replace(/^jurisdiction:/i, "");
    }
    _getJurisdictionDatasetInfo(rawDataset) {
      const dataset = this._normalizeJurisdictionDatasetName(rawDataset);
      if (this._autoDatasets.has(dataset)) {
        return { kind: "auto", ...this._autoDatasets.get(dataset) };
      }
      if (this._primaryDatasets.has(dataset)) {
        return { kind: "primary", ...this._primaryDatasets.get(dataset) };
      }
      if (this._mapDatasets.has(dataset)) {
        return { kind: "map", ...this._mapDatasets.get(dataset) };
      }
      return null;
    }
    _getJurisdictionOverrideBucket(rawDataset) {
      const dataset = this._normalizeJurisdictionDatasetName(rawDataset);
      if (!dataset) return {};
      const bucket = this._userJurisdictionOverrides?.[dataset];
      return bucket && typeof bucket === "object" && !Array.isArray(bucket) ? bucket : {};
    }
    _getAutoDatasetInfoForJurisdiction(rawJurisdiction) {
      const parsed = this._splitJurisdictionDomain(rawJurisdiction);
      const root = this._jurisdictionRoot(parsed.jurisdiction);
      return this._pickDatasetInfoForRoot(this._autoDatasetsByRoot, root, this._defaultAutoDataset, parsed.domain);
    }
    _getPrimaryDatasetInfoForJurisdiction(rawJurisdiction) {
      const root = this._jurisdictionRoot(rawJurisdiction);
      return this._pickDatasetInfoForRoot(this._primaryDatasetsByRoot, root, this._defaultPrimaryDataset);
    }
    _getMapDatasetInfoForJurisdiction(rawJurisdiction) {
      const root = this._jurisdictionRoot(rawJurisdiction);
      return this._pickDatasetInfoForRoot(this._mapDatasetsByRoot, root, this._defaultMapDataset);
    }
    getAvailableAbbrevDomains() {
      const out = {};
      for (const [root, infos] of this._autoDatasetsByRoot.entries()) {
        if (!Array.isArray(infos) || !infos.length) continue;
        const domains = this._autoDomainsByRoot.get(root);
        out[root] = Array.isArray(domains) ? domains.slice() : [];
      }
      return out;
    }
    normalizeKey(s) {
      return (s || "").toString().trim().toLowerCase().replace(/[“”]/g, '"').replace(/[’]/g, "'").replace(/[^a-z0-9\s\.-]/g, " ").replace(/\s+/g, " ").trim();
    }
    parseDirective(val) {
      if (!val) return { value: val, directive: null };
      const m = /^!([a-z-]+)\>\>\>(.+)$/.exec(val);
      if (!m) return { value: val, directive: null };
      return { value: m[2], directive: m[1] };
    }
    lookupForCiteProc(category, key, jur, options = {}) {
      const parsedJurisdiction = this._splitJurisdictionDomain(jur || this._defaultJurisdiction || "default");
      const preferredJur = parsedJurisdiction.jurisdiction || (this._defaultJurisdiction || "default");
      const effectiveJur = preferredJur === "default" ? this._defaultJurisdiction || "us" : preferredJur;
      const preferredJurWithDomain = parsedJurisdiction.domain ? `${effectiveJur}@${parsedJurisdiction.domain}` : effectiveJur;
      const autoInfo = this._getAutoDatasetInfoForJurisdiction(preferredJurWithDomain) || this._getAutoDatasetInfoForJurisdiction(effectiveJur) || this._getJurisdictionDatasetInfo(this._defaultAutoDataset) || { kind: "auto", dataset: this._defaultAutoDataset || "auto-us", data: this._autoUS };
      const primaryData = this._primaryUS?.xdata || null;
      const primaryOverrides = this._getJurisdictionOverrideBucket(this._defaultPrimaryDataset);
      const autoOverrides = this._getJurisdictionOverrideBucket(autoInfo?.dataset);
      const noHints = !!options.noHints;
      const normalizedKey = this.normalizeKey(key);
      const normalizedKeyNoDots = normalizedKey.replace(/\./g, " ").replace(/\s+/g, " ").trim();
      const containerTitleKeys = [normalizedKey];
      if (normalizedKeyNoDots && normalizedKeyNoDots !== normalizedKey) {
        containerTitleKeys.push(normalizedKeyNoDots);
      }
      let hit = null;
      if (category === "institution-part" || category === "institution-entire") {
        hit = this._lookupInstitutionCategoryValue(
          category,
          key,
          normalizedKey,
          effectiveJur,
          autoInfo?.data?.xdata,
          autoOverrides
        );
        if (hit?.value) return { jurisdiction: preferredJurWithDomain, value: hit.value };
        return null;
      }
      if (category === "place") {
        const upper = effectiveJur.toUpperCase();
        const value = this._lookupAutoUSPlaceOverride(upper, autoInfo?.dataset) || this._primaryJur?.xdata?.default?.place?.[upper] || autoInfo?.data?.xdata?.default?.place?.[upper] || null;
        return value ? { jurisdiction: preferredJurWithDomain, value } : null;
      }
      if (category === "container-title") {
        for (const containerTitleKey of containerTitleKeys) {
          hit = lookupJurChainWithOverrides(
            primaryData,
            primaryOverrides,
            effectiveJur,
            "container-title",
            containerTitleKey
          );
          if (hit?.value) return { jurisdiction: preferredJurWithDomain, value: hit.value };
          const secondaryValue = this._lookupSecondaryContainerTitle(containerTitleKey);
          if (secondaryValue) return { jurisdiction: "default", value: secondaryValue };
        }
        if (!noHints) {
          const fallback = this.abbreviateContainerTitleFallback(key, preferredJur);
          if (fallback) return { jurisdiction: preferredJur === "default" ? "default" : preferredJurWithDomain, value: fallback };
        }
      }
      if (category === "title") {
        hit = lookupJurChainWithOverrides(
          primaryData,
          primaryOverrides,
          effectiveJur,
          "title",
          normalizedKey
        );
        if (hit?.value) return { jurisdiction: preferredJurWithDomain, value: hit.value };
        if (!noHints) {
          const fallback = this.abbreviateTitleFallback(key, preferredJur);
          if (fallback) return { jurisdiction: preferredJur === "default" ? "default" : preferredJurWithDomain, value: fallback };
        }
      }
      return null;
    }
    lookupSync(listname, key, jur) {
      return this.lookupForCiteProc(listname, key, jur)?.value || null;
    }
    listAutoUSPlaceJurisdictions() {
      const place = this._getAutoDatasetInfoForJurisdiction(this._defaultJurisdiction)?.data?.xdata?.default?.place || this._autoUS?.xdata?.default?.place || {};
      const keys = new Set(Object.keys(place));
      for (const key of this._listAutoUSPlaceOverrideKeys(this._defaultAutoDataset)) {
        keys.add(key);
      }
      return Array.from(keys).map((key) => {
        const code = String(key || "").trim().toLowerCase();
        return {
          code,
          label: this.formatJurisdictionDisplay(code)
        };
      }).sort((a, b) => a.label.localeCompare(b.label) || a.code.localeCompare(b.code));
    }
    listJurisdictionMenuOptions() {
      const rows = [];
      const seen = /* @__PURE__ */ new Set();
      for (const info of this._autoDatasets.values()) {
        const place = info?.data?.xdata?.default?.place;
        if (!place || typeof place !== "object" || Array.isArray(place)) continue;
        for (const [rawCode, rawLabel] of Object.entries(place)) {
          const code = String(rawCode || "").trim().toLowerCase().replace(/\+/g, ":");
          if (!code || seen.has(code)) continue;
          seen.add(code);
          const display = this.formatJurisdictionDisplay(code) || String(rawLabel || "").trim() || code;
          const parts = this._buildJurisdictionDisplayParts(code, info);
          rows.push({
            code,
            label: display,
            root: parts?.root || code.split(":")[0] || code,
            rootLabel: parts?.rootLabel || display,
            depth: parts?.depth || code.split(":").filter(Boolean).length
          });
        }
      }
      return rows.sort((a, b) => {
        return a.rootLabel.localeCompare(b.rootLabel) || a.root.localeCompare(b.root) || a.depth - b.depth || a.label.localeCompare(b.label) || a.code.localeCompare(b.code);
      });
    }
    listCourtOptionsForJurisdiction(rawJurisdiction) {
      const mapInfo = this._getMapDatasetInfoForJurisdiction(rawJurisdiction) || { data: this._jurisUSMap };
      const mapData = mapInfo?.data || null;
      const mapJurisdiction = this._jurisdictionMapCode(rawJurisdiction);
      const selectionJurisdiction = String(rawJurisdiction || this._defaultJurisdiction || "us").trim().toLowerCase();
      const jurisdictions = this._getLocalizedMapJurisdictions(mapData);
      const courts = Array.isArray(mapData?.courts) ? mapData.courts : [];
      const row = Array.isArray(jurisdictions) ? jurisdictions.find((item) => Array.isArray(item) && String(item[0] || "").trim().toLowerCase() === mapJurisdiction) : null;
      if (!row || !courts.length) {
        return this.listInstitutionPartOptionsForJurisdictionTree(rawJurisdiction);
      }
      const rows = [];
      const seen = /* @__PURE__ */ new Set();
      for (const ref of row.slice(2)) {
        const index = Number(ref);
        if (!Number.isFinite(index) || index < 0 || index >= courts.length) continue;
        const court = courts[index];
        if (!Array.isArray(court) || court.length < 2) continue;
        const key = this.normalizeKey(court[0]);
        const label = String(court[1] ?? "").trim();
        if (!key || !label || seen.has(key)) continue;
        seen.add(key);
        rows.push({
          key,
          label,
          abbreviation: court[0] || "",
          jurisdiction: selectionJurisdiction,
          isChild: false
        });
      }
      return rows.sort((a, b) => a.label.localeCompare(b.label) || a.key.localeCompare(b.key));
    }
    formatJurisdictionDisplay(rawJurisdiction) {
      const jurisdiction = (rawJurisdiction || "").toString().trim().toLowerCase();
      if (!jurisdiction) return "";
      const parts = this._buildJurisdictionDisplayParts(jurisdiction);
      if (!parts?.labels?.length) return "";
      return parts.labels.join("|");
    }
    _buildJurisdictionDisplayParts(rawJurisdiction, rawAutoInfo = null) {
      const jurisdiction = (rawJurisdiction || "").toString().trim().toLowerCase();
      if (!jurisdiction) return null;
      const parts = jurisdiction.split(":").filter(Boolean);
      if (!parts.length) return null;
      const autoInfo = rawAutoInfo || this._getAutoDatasetInfoForJurisdiction(jurisdiction) || { data: this._autoUS };
      const rootCode = parts[0].toLowerCase();
      const rootLabel = String(
        autoInfo?.data?.name || this._lookupJurisdictionPlaceLabel(rootCode, autoInfo) || parts[0]
      ).trim();
      const labels = [rootLabel || parts[0].toUpperCase()];
      let chain = rootCode;
      for (let index = 1; index < parts.length; index += 1) {
        chain = `${chain}:${parts[index]}`;
        const label = this._lookupJurisdictionPlaceLabel(chain, autoInfo) || parts[index].replace(/\./g, " ");
        labels.push(this._normalizeJurisdictionDisplayLabel(chain, label));
      }
      return {
        code: jurisdiction,
        root: rootCode,
        rootLabel: labels[0],
        labels,
        depth: parts.length
      };
    }
    listInstitutionPartOptionsForJurisdiction(rawJurisdiction) {
      const jurisdiction = (rawJurisdiction || this._defaultJurisdiction || "us").toString().trim().toLowerCase() || "us";
      const normalizedJurisdiction = jurisdiction === "default" ? this._defaultJurisdiction || "us" : jurisdiction;
      const autoInfo = this._getAutoDatasetInfoForJurisdiction(normalizedJurisdiction) || { data: this._autoUS };
      const rows = [];
      const entries = this._listInstitutionPartEntriesForJurisdiction(normalizedJurisdiction, autoInfo);
      for (const [key, value] of entries.entries()) {
        rows.push({
          key,
          label: this.formatInstitutionPartDisplay(key, normalizedJurisdiction),
          abbreviation: value,
          jurisdiction: normalizedJurisdiction,
          isChild: false
        });
      }
      return rows.sort((a, b) => a.label.localeCompare(b.label) || a.key.localeCompare(b.key));
    }
    listInstitutionPartOptionsForJurisdictionTree(rawJurisdiction) {
      const jurisdiction = (rawJurisdiction || this._defaultJurisdiction || "us").toString().trim().toLowerCase() || "us";
      const normalizedJurisdiction = jurisdiction === "default" ? this._defaultJurisdiction || "us" : jurisdiction;
      const autoInfo = this._getAutoDatasetInfoForJurisdiction(normalizedJurisdiction) || { data: this._autoUS };
      const rows = [];
      const exactEntries = this._listInstitutionPartEntriesForJurisdiction(normalizedJurisdiction, autoInfo);
      for (const [key, value] of exactEntries.entries()) {
        rows.push({
          key,
          label: this.formatInstitutionPartDisplay(key, normalizedJurisdiction),
          abbreviation: value,
          jurisdiction: normalizedJurisdiction,
          isChild: false
        });
      }
      const childPrefix = `${normalizedJurisdiction}:`;
      const childJurisdictions = /* @__PURE__ */ new Set();
      for (const childJur of Object.keys(autoInfo?.data?.xdata || {})) {
        if (childJur.startsWith(childPrefix)) childJurisdictions.add(childJur);
      }
      for (const parsed of this._listAutoUSInstitutionOverrideEntries(autoInfo?.dataset)) {
        if (parsed.jurisdiction.startsWith(childPrefix)) childJurisdictions.add(parsed.jurisdiction);
      }
      for (const childJur of Array.from(childJurisdictions).sort()) {
        if (!childJur.startsWith(childPrefix)) continue;
        const childEntries = this._listInstitutionPartEntriesForJurisdiction(childJur, autoInfo);
        if (!childEntries.size) continue;
        const placeLabel = this._lookupJurisdictionPlaceLabel(childJur, autoInfo) || childJur;
        for (const [key, value] of childEntries.entries()) {
          rows.push({
            key,
            label: `${placeLabel}: ${this.formatInstitutionPartDisplay(key, childJur)}`,
            abbreviation: value,
            jurisdiction: childJur,
            isChild: true
          });
        }
      }
      return rows.sort((a, b) => {
        if (!a.isChild && b.isChild) return -1;
        if (a.isChild && !b.isChild) return 1;
        return a.label.localeCompare(b.label) || a.key.localeCompare(b.key);
      });
    }
    formatInstitutionPartDisplay(rawKey, rawJurisdiction = this._defaultJurisdiction || "us") {
      const key = this.normalizeKey(rawKey);
      if (!key) return "";
      const mapInfo = this._getMapDatasetInfoForJurisdiction(rawJurisdiction) || { data: this._jurisUSMap };
      const mapped = this._lookupCourtDisplayLabel(key, mapInfo?.data);
      if (mapped) return mapped;
      const lookupJurisdiction = (rawJurisdiction || this._defaultJurisdiction || "us").toString().trim().toLowerCase() || "us";
      for (const category of ["institution-part", "institution-entire"]) {
        const hit = this.lookupForCiteProc(category, key, lookupJurisdiction, { noHints: true });
        const value = this.parseDirective(hit?.value).value;
        if (value) return value;
      }
      return key.split(".").filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
    }
    _listInstitutionPartEntriesForJurisdiction(rawJurisdiction, autoInfo = null) {
      const jurisdiction = (rawJurisdiction || "us").toString().trim().toLowerCase();
      if (!jurisdiction) return /* @__PURE__ */ new Map();
      const entries = /* @__PURE__ */ new Map();
      for (const category of ["institution-entire", "institution-part"]) {
        const baseEntries = autoInfo?.data?.xdata?.[jurisdiction]?.[category];
        if (baseEntries && typeof baseEntries === "object" && !Array.isArray(baseEntries)) {
          for (const [rawKey, rawValue] of Object.entries(baseEntries)) {
            const key = this.normalizeKey(rawKey);
            const value = String(rawValue ?? "").trim();
            if (!key || !value) continue;
            entries.set(key, value);
          }
        }
        for (const parsed of this._listAutoUSInstitutionOverrideEntries(autoInfo?.dataset)) {
          if (parsed.category !== category) continue;
          if (parsed.jurisdiction !== jurisdiction) continue;
          if (!parsed.key || !parsed.value) continue;
          entries.set(parsed.key, parsed.value);
        }
      }
      return entries;
    }
    _listAutoUSInstitutionOverrideEntries(rawDataset = this._defaultAutoDataset) {
      const bucket = this._getJurisdictionOverrideBucket(rawDataset);
      if (!bucket || typeof bucket !== "object" || Array.isArray(bucket)) return [];
      const datasetRoot = this._jurisdictionRootFromFilename(rawDataset) || "us";
      const rows = [];
      for (const [overrideKey, overrideValue] of Object.entries(bucket)) {
        const parsed = this._parseJurisdictionDatasetOverrideKey(overrideKey);
        if (!parsed) continue;
        if (parsed.category !== "institution-part" && parsed.category !== "institution-entire") continue;
        let jurisdiction = (parsed.jurisdiction || "").toString().trim().toLowerCase();
        if (rawDataset && datasetRoot !== "us" && jurisdiction === "us") {
          jurisdiction = datasetRoot;
        }
        const key = this.normalizeKey(parsed.key);
        const value = String(overrideValue ?? "").trim();
        if (!jurisdiction || !key || !value) continue;
        rows.push({
          jurisdiction: jurisdiction === "default" ? "us" : jurisdiction,
          key,
          value,
          category: parsed.category
        });
      }
      return rows.sort((a, b) => {
        const rank = (category) => category === "institution-part" ? 1 : 0;
        return rank(a.category) - rank(b.category);
      });
    }
    abbreviateContainerTitleFallback(title, jur) {
      return this._abbreviateByWords(title, jur, ["container-title"]);
    }
    abbreviateTitleFallback(title, jur) {
      return this._abbreviateByWords(title, jur, ["title", "container-title"]);
    }
    _abbreviateByWords(title, jur, categories) {
      const source = (title || "").toString().trim();
      if (!source) return null;
      if (/^(?:[A-Za-z]\.){2,}[A-Za-z]?\.?$/.test(source)) return null;
      const segments = this._tokenizeWordAndSeparatorSegments(source);
      const hasWord = segments.some((segment) => segment.type === "word");
      if (!hasWord) return null;
      const output = [];
      for (let index = 0; index < segments.length; ) {
        const segment = segments[index];
        if (segment.type !== "word") {
          output.push(segment.text);
          index += 1;
          continue;
        }
        const phraseWords = [];
        let bestMatch = null;
        for (let scan = index; scan < segments.length && phraseWords.length < 4; scan += 1) {
          if (segments[scan].type !== "word") continue;
          phraseWords.push(segments[scan].text);
          const normalized = this.normalizeKey(phraseWords.join(" "));
          const hit = this._lookupFallbackPhrase(normalized, jur, categories);
          if (hit?.value) {
            bestMatch = {
              value: this.parseDirective(hit.value).value,
              endIndex: scan
            };
          }
        }
        if (bestMatch) {
          output.push(bestMatch.value);
          index = bestMatch.endIndex + 1;
          continue;
        }
        output.push(this._abbreviateCoreWord(segment.text, jur, categories));
        index += 1;
      }
      const abbreviated = output.join("").trim();
      return abbreviated && abbreviated !== source ? abbreviated : null;
    }
    _tokenizeWordAndSeparatorSegments(source) {
      const segments = [];
      const matcher = /([A-Za-z0-9]+|[^A-Za-z0-9]+)/g;
      let match;
      while ((match = matcher.exec(source)) !== null) {
        const text = match[0];
        segments.push({
          type: /^[A-Za-z0-9]+$/.test(text) ? "word" : "sep",
          text
        });
      }
      return segments;
    }
    _abbreviateSingleToken(token, jur, categories) {
      const parts = token.match(/^([^A-Za-z0-9]*)(.*?)([^A-Za-z0-9]*)$/);
      if (!parts) return token;
      const prefix = parts[1] || "";
      const core = parts[2] || "";
      const suffix = parts[3] || "";
      if (!core) return token;
      const compoundParts = core.split(/([-\u2010-\u2015])/);
      const abbreviatedCore = compoundParts.map((part) => /^[-\u2010-\u2015]$/.test(part) ? part : this._abbreviateCoreWord(part, jur, categories)).join("");
      const safeSuffix = abbreviatedCore.endsWith(".") && suffix.startsWith(".") ? suffix.slice(1) : suffix;
      return `${prefix}${abbreviatedCore}${safeSuffix}`;
    }
    _abbreviateCoreWord(word, jur, categories) {
      const normalized = this.normalizeKey(word);
      if (!normalized) return word;
      const hit = this._lookupFallbackPhrase(normalized, jur, categories) || this._lookupSupplementalWord(normalized);
      if (!hit?.value) return word;
      return this.parseDirective(hit.value).value;
    }
    _lookupFallbackPhrase(normalized, jur, categories) {
      const normalizedJur = jur === "default" ? this._defaultJurisdiction || "us" : jur;
      const autoInfo = this._getAutoDatasetInfoForJurisdiction(normalizedJur) || this._getJurisdictionDatasetInfo(this._defaultAutoDataset) || { data: this._autoUS };
      const primaryData = this._primaryUS?.xdata || null;
      const primaryOverrides = this._getJurisdictionOverrideBucket(this._defaultPrimaryDataset);
      for (const category of categories) {
        const primaryHit = lookupJurChainWithOverrides(
          primaryData,
          primaryOverrides,
          normalizedJur,
          category,
          normalized
        );
        if (primaryHit?.value) return primaryHit;
        const secondaryValue = category === "container-title" ? this._lookupSecondaryContainerTitle(normalized) : this._lookupSecondaryCategoryValue(category, normalized) || this._lookupSecondaryContainerTitle(normalized) || null;
        if (secondaryValue) return { jurisdiction: "default", value: secondaryValue };
      }
      return null;
    }
    _lookupJurisdictionPlaceLabel(rawJurisdiction) {
      const jurisdiction = (rawJurisdiction || "").toString().trim().toUpperCase();
      if (!jurisdiction) return null;
      const autoInfo = this._getAutoDatasetInfoForJurisdiction(jurisdiction) || this._getJurisdictionDatasetInfo(this._defaultAutoDataset) || { data: this._autoUS };
      return this._lookupAutoUSPlaceOverride(jurisdiction, autoInfo?.dataset) || this._primaryJur?.xdata?.default?.place?.[jurisdiction] || autoInfo?.data?.xdata?.default?.place?.[jurisdiction] || null;
    }
    _lookupAutoUSPlaceOverride(rawJurisdiction, rawDataset = this._defaultAutoDataset) {
      const jurisdiction = (rawJurisdiction || "").toString().trim().toUpperCase();
      if (!jurisdiction) return null;
      const overrideKey = this._makeJurisdictionDatasetOverrideKey("default", "place", jurisdiction);
      if (!overrideKey) return null;
      const bucket = this._getJurisdictionOverrideBucket(rawDataset);
      if (!bucket || !Object.prototype.hasOwnProperty.call(bucket, overrideKey)) return null;
      return bucket[overrideKey] || null;
    }
    _listAutoUSPlaceOverrideKeys(rawDataset = this._defaultAutoDataset) {
      const bucket = this._getJurisdictionOverrideBucket(rawDataset);
      if (!bucket || typeof bucket !== "object" || Array.isArray(bucket)) return [];
      const keys = [];
      for (const overrideKey of Object.keys(bucket)) {
        const parsed = this._parseJurisdictionDatasetOverrideKey(overrideKey);
        if (!parsed) continue;
        if (parsed.jurisdiction !== "default" || parsed.category !== "place") continue;
        keys.push(parsed.key);
      }
      return keys;
    }
    _lookupCourtDisplayLabel(rawKey, mapData = this._jurisUSMap) {
      const key = this.normalizeKey(rawKey);
      if (!key) return null;
      const courts = mapData?.courts;
      if (!Array.isArray(courts)) return null;
      for (const item of courts) {
        if (!Array.isArray(item) || item.length < 2) continue;
        if (this.normalizeKey(item[0]) !== key) continue;
        const value = String(item[1] ?? "").trim();
        if (value) return value;
      }
      return null;
    }
    _normalizeJurisdictionDisplayLabel(jurisdiction, label) {
      return String(label || "").trim();
    }
    listSecondaryContainerTitleAbbreviations(rawDataset = this._defaultSecondaryDataset) {
      const dataset = this._normalizeSecondaryDataset(rawDataset);
      const base = this._secondaryDatasets?.[dataset]?.xdata?.default?.["container-title"] || {};
      const user = this._userSecondaryOverrides?.[dataset] || {};
      const merged = { ...base, ...user };
      return Object.keys(merged).sort((a, b) => a.localeCompare(b)).map((key) => ({
        key,
        value: merged[key],
        source: Object.prototype.hasOwnProperty.call(user, key) ? "user" : "base"
      }));
    }
    listSecondaryDatasetOptions() {
      const rows = [];
      const seen = /* @__PURE__ */ new Set();
      for (const dataset of this._getSecondaryLookupOrder()) {
        if (!this._secondaryDatasets?.[dataset] || seen.has(dataset)) continue;
        seen.add(dataset);
        rows.push({
          dataset,
          label: this._secondaryDatasetMeta.get(dataset)?.name || this._formatDatasetLabel(dataset),
          isDefault: dataset === this._defaultSecondaryDataset
        });
      }
      for (const dataset of Object.keys(this._secondaryDatasets || {}).sort((a, b) => a.localeCompare(b))) {
        if (seen.has(dataset)) continue;
        seen.add(dataset);
        rows.push({
          dataset,
          label: this._secondaryDatasetMeta.get(dataset)?.name || this._formatDatasetLabel(dataset),
          isDefault: dataset === this._defaultSecondaryDataset
        });
      }
      return rows;
    }
    listPrimaryDatasetOptions() {
      const rows = [];
      const seen = /* @__PURE__ */ new Set();
      for (const info of this._primaryDatasets.values()) {
        if (!info || seen.has(info.dataset)) continue;
        seen.add(info.dataset);
        rows.push({
          dataset: info.dataset,
          label: this._formatJurisdictionDatasetLabel({ ...info, kind: "primary" }),
          isDefault: info.dataset === this._defaultPrimaryDataset
        });
      }
      return rows;
    }
    listPrimaryAbbreviations(rawDataset = this._defaultPrimaryDataset) {
      return this.listJurisdictionPreferenceEntries(rawDataset);
    }
    upsertPrimaryAbbreviation(rawDataset, rawJurisdiction, category, key, value) {
      return this.upsertJurisdictionPreferenceEntry(rawDataset, rawJurisdiction, category, key, value);
    }
    removePrimaryAbbreviation(rawDataset, rawJurisdiction, category, key) {
      return this.removeJurisdictionPreferenceEntry(rawDataset, rawJurisdiction, category, key);
    }
    resetPrimaryAbbreviations(rawDataset = this._defaultPrimaryDataset) {
      this.resetJurisdictionPreferenceOverrides(rawDataset);
    }
    listJurisdictionDatasetOptions() {
      const rows = [];
      const seen = /* @__PURE__ */ new Set();
      const pushInfo = (info) => {
        if (!info || seen.has(info.dataset)) return;
        seen.add(info.dataset);
        rows.push({
          value: `jurisdiction:${info.dataset}`,
          label: this._formatJurisdictionDatasetLabel(info),
          dataset: info.dataset,
          kind: info.kind,
          isDefault: info.dataset === this._defaultAutoDataset || info.dataset === this._defaultMapDataset
        });
      };
      for (const info of this._autoDatasets.values()) pushInfo({ kind: "auto", ...info });
      for (const info of this._primaryDatasets.values()) pushInfo({ kind: "primary", ...info });
      for (const info of this._mapDatasets.values()) pushInfo({ kind: "map", ...info });
      return rows;
    }
    upsertSecondaryContainerTitleAbbreviation(rawDataset, rawKey, rawValue) {
      const dataset = this._normalizeSecondaryDataset(rawDataset);
      const key = this.normalizeKey(rawKey);
      const value = (rawValue || "").toString().trim();
      if (!key || !value) return false;
      if (!this._userSecondaryOverrides[dataset] || typeof this._userSecondaryOverrides[dataset] !== "object") {
        this._userSecondaryOverrides[dataset] = {};
      }
      this._userSecondaryOverrides[dataset][key] = value;
      this._saveSecondaryOverrides();
      return true;
    }
    removeSecondaryContainerTitleAbbreviation(rawDataset, rawKey) {
      const dataset = this._normalizeSecondaryDataset(rawDataset);
      const key = this.normalizeKey(rawKey);
      if (!key) return false;
      const bucket = this._userSecondaryOverrides?.[dataset];
      if (!bucket || !Object.prototype.hasOwnProperty.call(bucket, key)) return false;
      delete bucket[key];
      this._saveSecondaryOverrides();
      return true;
    }
    resetSecondaryContainerTitleOverrides(rawDataset = this._defaultSecondaryDataset) {
      const dataset = this._normalizeSecondaryDataset(rawDataset);
      this._userSecondaryOverrides[dataset] = {};
      this._saveSecondaryOverrides();
    }
    listJurisdictionPreferenceEntries(rawDataset = null) {
      const info = this._getJurisdictionDatasetInfo(rawDataset) || this._getJurisdictionDatasetInfo(this._defaultAutoDataset);
      const rows = [];
      if (info?.kind === "primary") {
        this._collectXDataRows(rows, info.dataset, info.data?.xdata);
      } else if (info?.kind === "map") {
        this._collectJurisMapRows(rows, info);
      } else {
        this._collectXDataRows(rows, info?.dataset || this._defaultAutoDataset || "auto-us", info?.data?.xdata);
      }
      this._collectOverrideOnlyJurisdictionRows(rows, info?.dataset || null);
      return rows.sort((a, b) => {
        return a.dataset.localeCompare(b.dataset) || a.jurisdiction.localeCompare(b.jurisdiction) || a.category.localeCompare(b.category) || a.key.localeCompare(b.key);
      }).map((row) => ({
        ...row,
        source: this._getJurisdictionOverrideValue(row.id) != null ? "user" : "base",
        value: this._getJurisdictionOverrideValue(row.id) ?? row.value
      }));
    }
    upsertJurisdictionPreferenceEntry(dataset, jurisdiction, category, key, value) {
      const ds = (dataset || "").toString().trim();
      const normalizedJurisdiction = this._normalizeOverrideJurisdictionForCategory(ds, jurisdiction, category);
      const id = this._makeJurisdictionDatasetOverrideKey(normalizedJurisdiction, category, key);
      const val = (value || "").toString().trim();
      if (!ds || !id || !val) return false;
      if (!this._userJurisdictionOverrides[ds] || typeof this._userJurisdictionOverrides[ds] !== "object") {
        this._userJurisdictionOverrides[ds] = {};
      }
      this._userJurisdictionOverrides[ds][id] = val;
      this._saveJurisdictionOverrides();
      return true;
    }
    removeJurisdictionPreferenceEntry(dataset, jurisdiction, category, key) {
      const ds = (dataset || "").toString().trim();
      const normalizedJurisdiction = this._normalizeOverrideJurisdictionForCategory(ds, jurisdiction, category);
      const id = this._makeJurisdictionDatasetOverrideKey(normalizedJurisdiction, category, key);
      if (!ds || !id) return false;
      const bucket = this._userJurisdictionOverrides?.[ds];
      if (!bucket) return false;
      let targetID = id;
      if (!Object.prototype.hasOwnProperty.call(bucket, targetID)) {
        const legacyJurisdiction = this._normalizeLegacyOverrideJurisdictionForCategory(ds, normalizedJurisdiction, category);
        const legacyID = this._makeJurisdictionDatasetOverrideKey(legacyJurisdiction, category, key);
        if (!legacyID || !Object.prototype.hasOwnProperty.call(bucket, legacyID)) return false;
        targetID = legacyID;
      }
      delete bucket[targetID];
      this._saveJurisdictionOverrides();
      return true;
    }
    resetJurisdictionPreferenceOverrides(rawDataset = null) {
      if (!rawDataset) {
        this._userJurisdictionOverrides = {};
        this._saveJurisdictionOverrides();
        return;
      }
      const dataset = this._normalizeJurisdictionDatasetName(rawDataset);
      if (!dataset) return;
      delete this._userJurisdictionOverrides[dataset];
      this._saveJurisdictionOverrides();
    }
    importOverrides(kind, rawDataset, payload) {
      const importKind = (kind || "").toString().trim().toLowerCase();
      const xdata = payload?.xdata && typeof payload.xdata === "object" && !Array.isArray(payload.xdata) ? payload.xdata : payload;
      const summary = this._createImportSummary();
      if (!xdata || typeof xdata !== "object" || Array.isArray(xdata)) {
        summary.error = "Import file did not contain an xdata object.";
        return summary;
      }
      if (importKind === "journals") {
        return this._importSecondaryOverrides(rawDataset, xdata, summary);
      }
      if (importKind === "abbrev" || importKind === "jurisdiction") {
        return this._importJurisdictionOverrides(rawDataset, xdata, summary);
      }
      summary.error = `Unsupported import target: ${importKind || "unknown"}.`;
      return summary;
    }
    _importSecondaryOverrides(rawDataset, xdata, summary) {
      const dataset = this._normalizeSecondaryDataset(rawDataset);
      const defaultRows = xdata?.default;
      const containerTitles = defaultRows?.["container-title"];
      if (!defaultRows || typeof defaultRows !== "object" || Array.isArray(defaultRows)) {
        summary.error = "Import file did not contain xdata.default entries for journal abbreviations.";
        return summary;
      }
      const existingRows = this.listSecondaryContainerTitleAbbreviations(dataset);
      const existingByKey = new Map(existingRows.map((row) => [this.normalizeKey(row.key), String(row.value ?? "").trim()]));
      let changed = false;
      for (const [jurisdiction, categories] of Object.entries(xdata)) {
        if (String(jurisdiction || "").trim().toLowerCase() !== "default") {
          this._recordImportSkip(summary, "outside_selected_dataset_scope", jurisdiction);
          continue;
        }
        if (!categories || typeof categories !== "object" || Array.isArray(categories)) {
          this._recordImportSkip(summary, "invalid_category_block", jurisdiction);
          continue;
        }
        for (const [category, entries] of Object.entries(categories)) {
          const normalizedCategory = String(category || "").trim().toLowerCase();
          if (normalizedCategory !== "container-title") {
            this._recordImportSkip(summary, "unsupported_category", `default::${normalizedCategory}`);
            continue;
          }
          if (!entries || typeof entries !== "object" || Array.isArray(entries)) {
            this._recordImportSkip(summary, "invalid_entries_block", `default::${normalizedCategory}`);
            continue;
          }
          for (const [rawKey, rawValue] of Object.entries(entries)) {
            const key = this.normalizeKey(rawKey);
            const value = String(rawValue ?? "").trim();
            const context = `default::container-title::${String(rawKey || "").trim()}`;
            if (!key || !value) {
              this._recordImportSkip(summary, "blank_key_or_value", context);
              continue;
            }
            const existingValue = existingByKey.get(key);
            if (existingValue === value) {
              this._recordImportSkip(summary, "unchanged", context);
              continue;
            }
            if (!this._userSecondaryOverrides[dataset] || typeof this._userSecondaryOverrides[dataset] !== "object") {
              this._userSecondaryOverrides[dataset] = {};
            }
            this._userSecondaryOverrides[dataset][key] = value;
            existingByKey.set(key, value);
            changed = true;
            if (typeof existingValue === "string") {
              summary.updated += 1;
            } else {
              summary.added += 1;
            }
          }
        }
      }
      if (changed) this._saveSecondaryOverrides();
      return this._finalizeImportSummary(summary);
    }
    _importJurisdictionOverrides(rawDataset, xdata, summary) {
      const info = this._getJurisdictionDatasetInfo(rawDataset) || this._getJurisdictionDatasetInfo(this._defaultAutoDataset);
      if (!info) {
        summary.error = "Selected dataset could not be resolved.";
        return summary;
      }
      if (info.kind === "map") {
        summary.error = "Map datasets do not accept abbrev imports.";
        return summary;
      }
      const dataset = info.dataset;
      const root = String(info.root || this._jurisdictionRootFromFilename(dataset) || "").trim().toLowerCase();
      const categories = this._getImportableJurisdictionCategories(info);
      const existingRows = this.listJurisdictionPreferenceEntries(dataset);
      const existingByID = new Map(
        existingRows.map((row) => {
          const id = this._makeJurisdictionDatasetOverrideKey(row.jurisdiction, row.category, row.key);
          return id ? [id, String(row.value ?? "").trim()] : null;
        }).filter(Boolean)
      );
      if (!this._userJurisdictionOverrides[dataset] || typeof this._userJurisdictionOverrides[dataset] !== "object") {
        this._userJurisdictionOverrides[dataset] = {};
      }
      const bucket = this._userJurisdictionOverrides[dataset];
      let changed = false;
      for (const [rawJurisdiction, categoryRows] of Object.entries(xdata)) {
        const jurisdiction = String(rawJurisdiction || "").trim().toLowerCase();
        if (!this._isImportJurisdictionInScope(jurisdiction, root)) {
          this._recordImportSkip(summary, "outside_selected_dataset_scope", jurisdiction);
          continue;
        }
        if (!categoryRows || typeof categoryRows !== "object" || Array.isArray(categoryRows)) {
          this._recordImportSkip(summary, "invalid_category_block", jurisdiction);
          continue;
        }
        for (const [rawCategory, entries] of Object.entries(categoryRows)) {
          const category = String(rawCategory || "").trim().toLowerCase();
          const categoryContext = `${jurisdiction || "default"}::${category}`;
          if (!categories.has(category)) {
            this._recordImportSkip(summary, "unsupported_category", categoryContext);
            continue;
          }
          if (!entries || typeof entries !== "object" || Array.isArray(entries)) {
            this._recordImportSkip(summary, "invalid_entries_block", categoryContext);
            continue;
          }
          for (const [rawKey, rawValue] of Object.entries(entries)) {
            const key = String(rawKey || "").trim();
            const value = String(rawValue ?? "").trim();
            const context = `${jurisdiction || "default"}::${category}::${key}`;
            if (!key || !value) {
              this._recordImportSkip(summary, "blank_key_or_value", context);
              continue;
            }
            const normalizedJurisdiction = this._normalizeOverrideJurisdictionForCategory(dataset, jurisdiction, category);
            const id = this._makeJurisdictionDatasetOverrideKey(normalizedJurisdiction, category, key);
            if (!id) {
              this._recordImportSkip(summary, "invalid_override_key", context);
              continue;
            }
            const existingValue = existingByID.get(id);
            if (existingValue === value) {
              this._recordImportSkip(summary, "unchanged", context);
              continue;
            }
            bucket[id] = value;
            existingByID.set(id, value);
            changed = true;
            if (typeof existingValue === "string") {
              summary.updated += 1;
            } else {
              summary.added += 1;
            }
          }
        }
      }
      if (changed) this._saveJurisdictionOverrides();
      return this._finalizeImportSummary(summary);
    }
    _createImportSummary() {
      return {
        added: 0,
        updated: 0,
        skipped: 0,
        skipReasons: /* @__PURE__ */ new Map(),
        error: ""
      };
    }
    _recordImportSkip(summary, reason, context = "") {
      if (!summary?.skipReasons) return;
      summary.skipped += 1;
      const current = summary.skipReasons.get(reason) || { reason, count: 0, examples: [] };
      current.count += 1;
      const example = String(context || "").trim();
      if (example && current.examples.length < 3 && !current.examples.includes(example)) {
        current.examples.push(example);
      }
      summary.skipReasons.set(reason, current);
    }
    _finalizeImportSummary(summary) {
      return {
        added: summary.added,
        updated: summary.updated,
        skipped: summary.skipped,
        error: summary.error || "",
        skipReasons: Array.from(summary.skipReasons.values()).sort((a, b) => a.reason.localeCompare(b.reason))
      };
    }
    _isImportJurisdictionInScope(jurisdiction, root) {
      const jur = String(jurisdiction || "").trim().toLowerCase();
      const normalizedRoot = String(root || "").trim().toLowerCase();
      if (!jur) return false;
      if (jur === "default") return true;
      if (!normalizedRoot) return true;
      return jur === normalizedRoot || jur.startsWith(`${normalizedRoot}:`);
    }
    _getImportableJurisdictionCategories(info) {
      const categories = /* @__PURE__ */ new Set([
        "container-title",
        "institution-entire",
        "institution-part",
        "place",
        "title"
      ]);
      for (const row of this.listJurisdictionPreferenceEntries(info?.dataset || null)) {
        const category = String(row?.category || "").trim().toLowerCase();
        if (category) categories.add(category);
      }
      return categories;
    }
    _lookupSecondaryContainerTitle(normalizedKey, rawDataset = null) {
      if (!normalizedKey) return null;
      const dataset = rawDataset ? this._normalizeSecondaryDataset(rawDataset) : null;
      if (dataset) {
        const bucket = this._userSecondaryOverrides?.[dataset] || {};
        if (Object.prototype.hasOwnProperty.call(bucket, normalizedKey)) {
          return bucket[normalizedKey];
        }
        return this._secondaryDatasets?.[dataset]?.xdata?.default?.["container-title"]?.[normalizedKey] || null;
      }
      for (const name of this._getSecondaryLookupOrder()) {
        const bucket = this._userSecondaryOverrides?.[name] || {};
        if (Object.prototype.hasOwnProperty.call(bucket, normalizedKey)) {
          return bucket[normalizedKey];
        }
        const value = this._secondaryDatasets?.[name]?.xdata?.default?.["container-title"]?.[normalizedKey];
        if (value) return value;
      }
      return null;
    }
    _lookupSecondaryCategoryValue(category, normalizedKey) {
      if (!category || !normalizedKey) return null;
      for (const name of this._getSecondaryLookupOrder()) {
        const value = this._secondaryDatasets?.[name]?.xdata?.default?.[category]?.[normalizedKey];
        if (value) return value;
      }
      return null;
    }
    _getSecondaryLookupOrder() {
      const names = [];
      for (const name of this._secondaryDatasetOrder) {
        if (this._secondaryDatasets?.[name]) names.push(name);
      }
      for (const name of Object.keys(this._secondaryDatasets || {})) {
        if (!names.includes(name) && this._secondaryDatasets?.[name]) names.push(name);
      }
      return names;
    }
    _normalizeSecondaryDataset(rawDataset) {
      const dataset = (rawDataset || "").toString().trim() || this._defaultSecondaryDataset;
      if (this._secondaryDatasets?.[dataset]) return dataset;
      return this._defaultSecondaryDataset;
    }
    _formatDatasetLabel(dataset) {
      return String(dataset || "").replace(/^secondary-/i, "").replace(/-/g, " ").replace(/\b([a-z])/g, (match) => match.toUpperCase());
    }
    _formatJurisdictionDatasetLabel(info) {
      const name = String(info?.name || "").trim();
      if (!name) return this._formatDatasetLabel(info?.dataset);
      return `${name} (${info.dataset})`;
    }
    _loadSecondaryOverrides() {
      try {
        const raw = Zotero?.Prefs?.get?.(this._secondaryOverridesPref) || Zotero?.Prefs?.get?.(this._legacySecondaryOverridesPref);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
        const looksFlat = Object.values(parsed).some((v) => typeof v === "string" || typeof v === "number");
        if (looksFlat) {
          const migrated = {};
          for (const [k, v] of Object.entries(parsed)) {
            const key = this.normalizeKey(k);
            const value = (v || "").toString().trim();
            if (key && value) migrated[key] = value;
          }
          return { [this._defaultSecondaryDataset]: migrated };
        }
        const cleaned = {};
        for (const [dataset, bucket] of Object.entries(parsed)) {
          const ds = (dataset || "").toString().trim();
          if (!ds || !bucket || typeof bucket !== "object" || Array.isArray(bucket)) continue;
          cleaned[ds] = {};
          for (const [k, v] of Object.entries(bucket)) {
            const key = this.normalizeKey(k);
            const value = (v || "").toString().trim();
            if (key && value) cleaned[ds][key] = value;
          }
        }
        return cleaned;
      } catch (e) {
        return {};
      }
    }
    _saveSecondaryOverrides() {
      try {
        Zotero?.Prefs?.set?.(this._secondaryOverridesPref, JSON.stringify(this._userSecondaryOverrides || {}));
      } catch (e) {
      }
    }
    _makeJurisdictionOverrideID(dataset, jurisdiction, category, key) {
      const ds = (dataset || "").toString().trim();
      const inner = this._makeJurisdictionDatasetOverrideKey(jurisdiction, category, key);
      if (!ds || !inner) return null;
      return `${ds}::${inner}`;
    }
    _makeJurisdictionDatasetOverrideKey(jurisdiction, category, key) {
      const jur = (jurisdiction || "").toString().trim();
      const cat = (category || "").toString().trim();
      const k = (key || "").toString().trim();
      if (!jur || !cat || !k) return null;
      return `${jur}::${cat}::${k}`;
    }
    _normalizeOverrideJurisdictionForCategory(dataset, jurisdiction, category) {
      const ds = (dataset || "").toString().trim().toLowerCase();
      const jur = (jurisdiction || "").toString().trim().toLowerCase();
      const cat = (category || "").toString().trim().toLowerCase();
      if (!jur) return jur;
      if (jur !== "default") return jur;
      if (cat === "place" || cat === "courts" || cat === "jurisdictions") {
        return "default";
      }
      if (ds.startsWith("auto-")) {
        return this._jurisdictionRootFromFilename(ds) || "us";
      }
      return "us";
    }
    _normalizeLegacyOverrideJurisdictionForCategory(dataset, jurisdiction, category) {
      const ds = (dataset || "").toString().trim().toLowerCase();
      const jur = (jurisdiction || "").toString().trim().toLowerCase();
      const cat = (category || "").toString().trim().toLowerCase();
      if (!jur) return jur;
      if (cat === "place" || cat === "courts" || cat === "jurisdictions") return jur;
      if (ds.startsWith("auto-")) {
        const root = this._jurisdictionRootFromFilename(ds) || "us";
        if (jur === root && root !== "us") return "us";
      }
      return jur;
    }
    _getJurisdictionOverrideValue(id) {
      if (!id) return null;
      const parts = id.split("::");
      if (parts.length < 4) return null;
      const ds = parts.shift();
      const inner = parts.join("::");
      const bucket = this._userJurisdictionOverrides?.[ds];
      if (!bucket || !Object.prototype.hasOwnProperty.call(bucket, inner)) return null;
      return bucket[inner];
    }
    _collectXDataRows(rows, dataset, xdata) {
      if (!xdata || typeof xdata !== "object") return;
      for (const [jurisdiction, byCategory] of Object.entries(xdata)) {
        if (!byCategory || typeof byCategory !== "object") continue;
        for (const [category, entries] of Object.entries(byCategory)) {
          if (!entries || typeof entries !== "object" || Array.isArray(entries)) continue;
          for (const [key, value] of Object.entries(entries)) {
            if (value == null) continue;
            const row = {
              dataset,
              jurisdiction: String(jurisdiction),
              category: String(category),
              key: String(key),
              value: String(value)
            };
            row.id = this._makeJurisdictionOverrideID(row.dataset, row.jurisdiction, row.category, row.key);
            rows.push(row);
          }
        }
      }
    }
    _collectJurisMapRows(rows, mapInfo = this._jurisUSMap) {
      const mapData = mapInfo?.data || mapInfo || this._jurisUSMap;
      const dataset = mapInfo?.dataset || this._defaultMapDataset || "juris-us-map";
      const courts = mapData?.courts;
      if (Array.isArray(courts)) {
        for (const item of courts) {
          if (!Array.isArray(item) || item.length < 2) continue;
          const code = String(item[0] ?? "").trim();
          const name = String(item[1] ?? "").trim();
          if (!code || !name) continue;
          const row = {
            dataset,
            jurisdiction: "default",
            category: "courts",
            key: code,
            value: name
          };
          row.id = this._makeJurisdictionOverrideID(row.dataset, row.jurisdiction, row.category, row.key);
          rows.push(row);
        }
      }
      const jurisdictions = this._getLocalizedMapJurisdictions(mapData);
      if (Array.isArray(jurisdictions)) {
        for (const item of jurisdictions) {
          if (!Array.isArray(item) || item.length < 2) continue;
          const code = String(item[0] ?? "").trim();
          const name = String(item[1] ?? "").trim();
          if (!code || !name) continue;
          const row = {
            dataset,
            jurisdiction: "default",
            category: "jurisdictions",
            key: code,
            value: name
          };
          row.id = this._makeJurisdictionOverrideID(row.dataset, row.jurisdiction, row.category, row.key);
          rows.push(row);
        }
      }
    }
    _collectOverrideOnlyJurisdictionRows(rows, allowedDataset = null) {
      const seen = new Set(rows.map((row) => row.id).filter(Boolean));
      const normalizedAllowedDataset = allowedDataset ? this._normalizeJurisdictionDatasetName(allowedDataset) : null;
      for (const [dataset, bucket] of Object.entries(this._userJurisdictionOverrides || {})) {
        if (!bucket || typeof bucket !== "object" || Array.isArray(bucket)) continue;
        if (normalizedAllowedDataset && dataset !== normalizedAllowedDataset) continue;
        for (const [overrideKey, overrideValue] of Object.entries(bucket)) {
          const parsed = this._parseJurisdictionDatasetOverrideKey(overrideKey);
          if (!parsed) continue;
          const mappedJurisdiction = this._normalizeListedOverrideJurisdiction(dataset, parsed.jurisdiction, parsed.category);
          const id = this._makeJurisdictionOverrideID(dataset, mappedJurisdiction, parsed.category, parsed.key);
          if (!id || seen.has(id)) continue;
          rows.push({
            dataset: String(dataset),
            jurisdiction: mappedJurisdiction,
            category: parsed.category,
            key: parsed.key,
            value: String(overrideValue),
            id
          });
          seen.add(id);
        }
      }
    }
    _parseJurisdictionDatasetOverrideKey(overrideKey) {
      const parts = String(overrideKey || "").split("::");
      if (parts.length < 3) return null;
      const jurisdiction = String(parts[0] || "").trim();
      const category = String(parts[1] || "").trim();
      const key = String(parts.slice(2).join("::") || "").trim();
      if (!jurisdiction || !category || !key) return null;
      return { jurisdiction, category, key };
    }
    _normalizeListedOverrideJurisdiction(dataset, jurisdiction, category) {
      const ds = (dataset || "").toString().trim().toLowerCase();
      const jur = (jurisdiction || "").toString().trim().toLowerCase();
      const cat = (category || "").toString().trim().toLowerCase();
      if (!jur) return jur;
      if (cat === "place" || cat === "courts" || cat === "jurisdictions") return jur;
      if (ds.startsWith("auto-")) {
        const root = this._jurisdictionRootFromFilename(ds) || "us";
        if (jur === "us" && root !== "us") return root;
      }
      return jur;
    }
    _loadJurisdictionOverrides() {
      try {
        const raw = Zotero?.Prefs?.get?.(this._jurisdictionOverridesPref) || Zotero?.Prefs?.get?.(this._legacyJurisdictionOverridesPref);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
        const cleaned = {};
        for (const [dataset, bucket] of Object.entries(parsed)) {
          const ds = (dataset || "").toString().trim();
          if (!ds || !bucket || typeof bucket !== "object" || Array.isArray(bucket)) continue;
          const outBucket = {};
          for (const [id, value] of Object.entries(bucket)) {
            const key = (id || "").toString().trim();
            const val = (value || "").toString().trim();
            if (!key || !val) continue;
            outBucket[key] = val;
          }
          cleaned[ds] = outBucket;
        }
        return cleaned;
      } catch (e) {
        return {};
      }
    }
    _saveJurisdictionOverrides() {
      try {
        Zotero?.Prefs?.set?.(this._jurisdictionOverridesPref, JSON.stringify(this._userJurisdictionOverrides || {}));
      } catch (e) {
      }
    }
    _lookupSupplementalWord(normalized) {
      const supplemental = {
        "association": "Ass\u2019n",
        "broadcasting": "Broad.",
        "company": "Co.",
        "companies": "Cos.",
        "corporation": "Corp.",
        "corporations": "Corps.",
        "incorporated": "Inc.",
        "international": "Int\u2019l",
        "limited": "Ltd.",
        "ltd": "Ltd.",
        "online": "Online",
        "production": "Prod.",
        "productions": "Prods.",
        "professional": "Pro.",
        "public": "Pub.",
        "services": "Servs.",
        "service": "Serv.",
        "technology": "Tech.",
        "technologies": "Techs.",
        "university": "U."
      };
      const value = supplemental[normalized] || null;
      return value ? { jurisdiction: "default", value } : null;
    }
    _lookupInstitutionCategoryValue(category, rawKey, normalizedKey, jurisdiction, xdata, overrides) {
      const categoryName = String(category || "").trim().toLowerCase();
      if (!categoryName || !xdata) return null;
      const lookupKeys = [];
      for (const candidate of [rawKey, normalizedKey]) {
        const value = String(candidate || "").trim();
        if (value && !lookupKeys.includes(value)) {
          lookupKeys.push(value);
        }
      }
      for (const lookupKey of lookupKeys) {
        const hit = lookupJurChainWithOverrides(
          xdata,
          overrides,
          jurisdiction,
          categoryName,
          lookupKey
        );
        if (hit?.value != null) return hit;
      }
      return null;
    }
  };
  function lookupJurChainWithOverrides(xdata, overrides, jur, variable, key) {
    if (!xdata) return null;
    const parts = (jur || "us").toLowerCase().split(":");
    for (let i = parts.length; i >= 1; i--) {
      const jj = parts.slice(0, i).join(":");
      const overrideKey = `${jj}::${variable}::${String(key ?? "")}`;
      if (overrides && Object.prototype.hasOwnProperty.call(overrides, overrideKey)) {
        return { jurisdiction: jj, value: overrides[overrideKey] };
      }
      if (jj === "us") {
        const defaultOverrideKey2 = `default::${variable}::${String(key ?? "")}`;
        if (overrides && Object.prototype.hasOwnProperty.call(overrides, defaultOverrideKey2)) {
          return { jurisdiction: "us", value: overrides[defaultOverrideKey2] };
        }
      }
      const obj2 = xdata?.[jj]?.[variable];
      if (obj2 && obj2[key] != null) return { jurisdiction: jj, value: obj2[key] };
    }
    const usOverrideKey = `us::${variable}::${String(key ?? "")}`;
    if (overrides && Object.prototype.hasOwnProperty.call(overrides, usOverrideKey)) {
      return { jurisdiction: "us", value: overrides[usOverrideKey] };
    }
    const defaultOverrideKey = `default::${variable}::${String(key ?? "")}`;
    if (overrides && Object.prototype.hasOwnProperty.call(overrides, defaultOverrideKey)) {
      return { jurisdiction: "us", value: overrides[defaultOverrideKey] };
    }
    const obj = xdata?.["us"]?.[variable];
    if (obj && obj[key] != null) return { jurisdiction: "us", value: obj[key] };
    return null;
  }

  // lib/services/patcher.mjs
  var Patcher = class {
    constructor({ pluginID, moduleLoader, abbrevService, jurisdiction, caseCourtMapper, schemaConfig }) {
      this.pluginID = String(pluginID || "indigobook-phoenix@risch.example").trim();
      this.moduleLoader = moduleLoader;
      this.abbrevService = abbrevService;
      this.Jurisdiction = jurisdiction;
      this.caseCourtMapper = caseCourtMapper || null;
      this.schemaConfig = schemaConfig || null;
      this._orig = {};
      this._didWarnNoSyncStyleRead = false;
      this._didWarnRetrieveItem = false;
      this._retrieveItemLogCount = 0;
      this._maxRetrieveItemLogs = 40;
      this._abbrevLogCount = 0;
      this._maxAbbrevLogs = 40;
      this._shortFormLogCount = 0;
      this._maxShortFormLogs = 40;
      this._fieldLogCount = 0;
      this._maxFieldLogs = 40;
      this._citationDataLogCount = 0;
      this._maxCitationDataLogs = 80;
      this._itemObserverID = null;
      this._itemPanePatchTimer = null;
      this._infoPaneRefreshTimer = null;
      this._forceFullInfoPaneRefresh = false;
      this._itemPanePatchAttempts = 0;
      this._maxItemPanePatchAttempts = 20;
      this._commenterRowID = "ibcslm-commenter-row";
      this._extraPersonTypes = this.schemaConfig?.getExtraCreatorTypes?.() || [];
      this._jurisdictionRowID = "ibcslm-jurisdiction-row";
      this._customCourtRowID = "ibcslm-custom-court-row";
      this._schemaInfoRowIDPrefix = "ibcslm-schema-row";
      this._customItemTypeMenuValuePrefix = "ibcslm-type:";
      this._newItemMenuMarkerAttribute = "data-ibcslm-new-item-custom";
      this._pendingCustomNewItemTypes = [];
      this._registeredSchemaRowIDs = [];
      this._syncInFlight = /* @__PURE__ */ new Set();
      this._journalAbbrByContainerTitleKey = /* @__PURE__ */ new Map();
      this._containerTitleShortByKey = /* @__PURE__ */ new Map();
      this._containerTitleContextByKey = /* @__PURE__ */ new Map();
    }
    patch() {
      this._patchCreatorTypes();
      this._patchItemCreators();
      this._patchInfoBoxPrototype();
      this._patchRetrieveItem();
      this._patchAbbreviations();
      this._patchLoadJurisdictionStyle();
      this._patchGetCiteProcFallback();
      this._registerCaseReporterSync();
      this._patchItemPaneRender();
      this._patchInfoBoxRender();
      this._patchNewItemBuilders();
      this._patchNewItemMenus();
    }
    unpatch() {
      this._unpatchNewItemMenus();
      this._unpatchNewItemBuilders();
      this._unregisterCaseReporterSync();
      this._unpatchInfoBoxRender();
      this._unpatchItemPaneRender();
      this._journalAbbrByContainerTitleKey.clear();
      this._containerTitleShortByKey.clear();
      this._containerTitleContextByKey.clear();
      const sysProto = Zotero?.Cite?.System?.prototype;
      if (sysProto) {
        if (this._orig.retrieveItem) sysProto.retrieveItem = this._orig.retrieveItem;
        if (this._orig.getAbbreviation) sysProto.getAbbreviation = this._orig.getAbbreviation;
        if (this._orig.normalizeAbbrevsKey) sysProto.normalizeAbbrevsKey = this._orig.normalizeAbbrevsKey;
        if (this._orig.loadJurisdictionStyle) sysProto.loadJurisdictionStyle = this._orig.loadJurisdictionStyle;
        if (this._orig.retrieveStyleModule) sysProto.retrieveStyleModule = this._orig.retrieveStyleModule;
      }
      const creatorTypes = Zotero?.CreatorTypes;
      if (creatorTypes) {
        if (this._orig.creatorTypesGetID) creatorTypes.getID = this._orig.creatorTypesGetID;
        if (this._orig.creatorTypesGetName) creatorTypes.getName = this._orig.creatorTypesGetName;
        if (this._orig.creatorTypesGetLocalizedString) creatorTypes.getLocalizedString = this._orig.creatorTypesGetLocalizedString;
        if (this._orig.creatorTypesGetTypesForItemType) creatorTypes.getTypesForItemType = this._orig.creatorTypesGetTypesForItemType;
      }
      const itemProto = Zotero?.Item?.prototype;
      if (itemProto && this._orig.itemSetCreator) itemProto.setCreator = this._orig.itemSetCreator;
      const infoBoxProto = this._getInfoBoxPrototype();
      if (infoBoxProto) {
        if (this._orig.infoBoxProtoRender) infoBoxProto.render = this._orig.infoBoxProtoRender;
        if (this._orig.infoBoxProtoModifyCreator) infoBoxProto.modifyCreator = this._orig.infoBoxProtoModifyCreator;
        if (this._orig.infoBoxProtoRemoveCreator) infoBoxProto.removeCreator = this._orig.infoBoxProtoRemoveCreator;
      }
      if (this._orig.getCiteProc) Zotero.Style.prototype.getCiteProc = this._orig.getCiteProc;
    }
    _registerSchemaInfoRows() {
      this._registeredSchemaRowIDs = [];
    }
    _unregisterSchemaInfoRows() {
      this._registeredSchemaRowIDs = [];
    }
    _getSchemaInfoRowID(fieldName) {
      return `${this._schemaInfoRowIDPrefix}-${String(fieldName || "").trim()}`;
    }
    _getSchemaInfoRowDefinition(item, fieldName) {
      if (!item || !fieldName) return null;
      const itemTypeName = this._getItemTypeName(item);
      return this.schemaConfig?.getFieldDefinition?.(itemTypeName, fieldName) || null;
    }
    _shouldUseSchemaInfoRow(item, definition) {
      if (!item || item.deleted || !definition?.field) return false;
      const fieldName = String(definition.field || "").trim();
      if (!fieldName || fieldName === "jurisdiction") return false;
      const itemTypeName = this._getItemTypeName(item);
      if (itemTypeName === "case" && fieldName === "court") return false;
      const nativeFieldName = this._resolveNativeFieldName(item.itemTypeID, fieldName, definition.baseField);
      return nativeFieldName !== fieldName;
    }
    _getSchemaInfoRowDisplayValue(item, fieldName) {
      const definition = this._getSchemaInfoRowDefinition(item, fieldName);
      if (!this._shouldUseSchemaInfoRow(item, definition)) return "";
      const value = this._getSchemaFieldValue(item, fieldName, this.Jurisdiction.getMLZExtraFields?.(item) || null);
      if (this._isSchemaFlagField(fieldName)) {
        return this._coerceSchemaFlagValue(value) ? "true" : "";
      }
      if (definition?.kind === "date") {
        return this._formatSchemaDateDisplay(value);
      }
      return String(value || "");
    }
    _patchCreatorTypes() {
      const creatorTypes = Zotero?.CreatorTypes;
      if (!creatorTypes) return;
      if (!this._orig.creatorTypesGetID && creatorTypes.getID) this._orig.creatorTypesGetID = creatorTypes.getID;
      if (!this._orig.creatorTypesGetName && creatorTypes.getName) this._orig.creatorTypesGetName = creatorTypes.getName;
      if (!this._orig.creatorTypesGetLocalizedString && creatorTypes.getLocalizedString) {
        this._orig.creatorTypesGetLocalizedString = creatorTypes.getLocalizedString;
      }
      if (!this._orig.creatorTypesGetTypesForItemType && creatorTypes.getTypesForItemType) {
        this._orig.creatorTypesGetTypesForItemType = creatorTypes.getTypesForItemType;
      }
      const self = this;
      creatorTypes.getID = function(creatorType) {
        const extraPersonType = self._getExtraPersonConfigBySyntheticCreatorType(creatorType);
        if (extraPersonType) return extraPersonType.creatorTypeID;
        return self._orig.creatorTypesGetID?.apply(this, arguments);
      };
      creatorTypes.getName = function(creatorTypeID) {
        const extraPersonType = self._getExtraPersonConfigBySyntheticCreatorType(creatorTypeID);
        if (extraPersonType) return extraPersonType.creatorTypeName;
        return self._orig.creatorTypesGetName?.apply(this, arguments);
      };
      creatorTypes.getLocalizedString = function(creatorType) {
        const extraPersonType = self._getExtraPersonConfigBySyntheticCreatorType(creatorType);
        if (extraPersonType) return self._getExtraPersonLabel(extraPersonType);
        return self._orig.creatorTypesGetLocalizedString?.apply(this, arguments);
      };
      creatorTypes.getTypesForItemType = function(itemTypeID) {
        const result = self._orig.creatorTypesGetTypesForItemType?.apply(this, arguments) || [];
        if (!self._itemTypeSupportsExtraPerson(itemTypeID)) return result;
        const next = [...result];
        for (const extraPersonType of self._getExtraPersonTypesForItemType(itemTypeID)) {
          if (next.some((entry) => self._getExtraPersonConfigBySyntheticCreatorType(entry?.id || entry?.name)?.key === extraPersonType.key)) continue;
          next.push({ id: extraPersonType.creatorTypeID, name: extraPersonType.creatorTypeName });
        }
        return next;
      };
    }
    _getInfoBoxPrototype() {
      try {
        const mainWindow = Zotero.getMainWindow?.();
        const ctor = mainWindow?.customElements?.get?.("info-box");
        return ctor?.prototype || null;
      } catch (e) {
      }
      return null;
    }
    _patchInfoBoxPrototype(protoOverride = null) {
      const proto = protoOverride || this._getInfoBoxPrototype();
      if (!proto) return;
      if (!this._orig.infoBoxProtoRender && typeof proto.render === "function") {
        this._orig.infoBoxProtoRender = proto.render;
      }
      if (!this._orig.infoBoxProtoModifyCreator && typeof proto.modifyCreator === "function") {
        this._orig.infoBoxProtoModifyCreator = proto.modifyCreator;
      }
      if (!this._orig.infoBoxProtoRemoveCreator && typeof proto.removeCreator === "function") {
        this._orig.infoBoxProtoRemoveCreator = proto.removeCreator;
      }
      const self = this;
      if (this._orig.infoBoxProtoRender) {
        proto.render = function(...args) {
          const result = self._orig.infoBoxProtoRender.apply(this, args);
          try {
            try {
              const itemID = this.item?.id;
              const customRows = this.querySelectorAll?.("[data-custom-row-id]")?.length || 0;
              Zotero.debug(`[Citation Phoenix] info-box proto render: item=${String(itemID || "")} customRows=${String(customRows)}`);
            } catch (e) {
            }
            self._ensureExtraPersonMenuItems(this);
            self._removeCommenterField(this);
            self._renderExtraPersonCreatorRows(this);
            self._refreshCustomInfoRows(this);
          } catch (e) {
            try {
              Zotero.debug(`[Citation Phoenix] info-box commenter render patch failed: ${String(e)}`);
            } catch (_) {
            }
          }
          return result;
        };
      }
      if (this._orig.infoBoxProtoModifyCreator) {
        proto.modifyCreator = function(index, fields) {
          const nativeCount = this.item?.numCreators?.() || 0;
          const row = self._getCreatorTypeLabel(this, index)?.closest?.(".meta-row") || null;
          const existingExtraPersonType = self._getExtraPersonConfigByIndex(this, index);
          const hasExplicitCreatorType = fields && Object.prototype.hasOwnProperty.call(fields, "creatorTypeID") && fields.creatorTypeID != null && String(fields.creatorTypeID) !== "";
          const requestedExtraPersonType = self._getExtraPersonConfigBySyntheticCreatorType(fields?.creatorTypeID);
          if (hasExplicitCreatorType && !requestedExtraPersonType && existingExtraPersonType) {
            const storageIndex = self._getExtraPersonStorageIndex(row);
            const storedPerson = self._getStoredExtraPeople(this.item, existingExtraPersonType)[storageIndex] || null;
            const nextPerson = self._extraPersonFromCreatorFields(fields);
            if (storedPerson && nextPerson && self._extraPersonLikelySameDraft(storedPerson, nextPerson)) {
              self._removeStoredExtraPersonAtIndex(this.item, existingExtraPersonType, storageIndex);
            }
            self._unmarkExtraPersonCreatorRow(row);
            const nativeIndex2 = self._getNativeCreatorIndex(this, index);
            return self._orig.infoBoxProtoModifyCreator.call(this, Math.min(nativeIndex2, nativeCount), fields);
          }
          const extraPersonType = requestedExtraPersonType || existingExtraPersonType || self._getExtraPersonConfigByRowCreatorType(row);
          if (extraPersonType) {
            const nextPerson = self._extraPersonFromCreatorFields(fields);
            let storageIndex = self._getExtraPersonStorageIndex(row);
            if (nextPerson) {
              if (storageIndex == null) storageIndex = self._appendStoredExtraPerson(this.item, extraPersonType, nextPerson);
              else storageIndex = self._setStoredExtraPersonAtNearestIndex(this.item, extraPersonType, storageIndex, nextPerson);
            }
            self._markExtraPersonCreatorRow(self._getCreatorTypeLabel(this, index)?.closest?.(".meta-row"), extraPersonType, storageIndex);
            return true;
          }
          if (existingExtraPersonType) {
            const nativeIndex2 = self._getNativeCreatorIndex(this, index);
            return self._orig.infoBoxProtoModifyCreator.call(this, Math.min(nativeIndex2, nativeCount), fields);
          }
          const nativeIndex = self._getNativeCreatorIndex(this, index);
          return self._orig.infoBoxProtoModifyCreator.call(this, nativeIndex, fields);
        };
      }
      if (this._orig.infoBoxProtoRemoveCreator) {
        proto.removeCreator = async function(index) {
          const extraPersonType = self._getExtraPersonConfigByIndex(this, index);
          if (extraPersonType) {
            const row = self._getCreatorTypeLabel(this, index)?.closest?.(".meta-row") || null;
            if (self._consumePendingExtraPersonRemoval(this, index, extraPersonType)) {
              self._removeStoredExtraPersonAtIndex(this.item, extraPersonType, self._getExtraPersonStorageIndex(row));
              if (row?.parentNode) row.parentNode.removeChild(row);
              if (this.saveOnEdit) {
                await this.item.saveTx({ skipDateModifiedUpdate: true });
              }
            }
            return;
          }
          const nativeIndex = self._getNativeCreatorIndex(this, index);
          return self._orig.infoBoxProtoRemoveCreator.call(this, nativeIndex);
        };
      }
    }
    _patchInfoBoxPrototypeFromInstance(infoBox) {
      try {
        const proto = Object.getPrototypeOf(infoBox);
        if (!proto) return;
        this._patchInfoBoxPrototype(proto);
      } catch (e) {
      }
    }
    _registerCaseReporterSync() {
      if (!Zotero?.Notifier?.registerObserver) return;
      if (this._itemObserverID) return;
      const self = this;
      this._itemObserverID = Zotero.Notifier.registerObserver({
        async notify(event, type, ids) {
          try {
            Zotero.debug(`[Citation Phoenix] case reporter sync notifier: event=${String(event)} type=${String(type)} ids=${Array.isArray(ids) ? ids.length : 0}`);
          } catch (e) {
          }
          const isSyncEvent = ["add", "modify", "refresh", "redraw", "select"].includes(event);
          if (!isSyncEvent) return;
          if (type === "item" && Array.isArray(ids) && ids.length) {
            let changed = false;
            for (const id of ids) {
              if (event === "add") {
                changed = await self._applyPendingCustomNewItemType(id) || changed;
              }
              changed = await self._syncItemFromFieldsAndMLZ(id) || changed;
            }
            if (changed) {
              self._scheduleActiveInfoPaneRefresh(75, true);
            } else if (["select", "refresh", "redraw", "modify"].includes(event)) {
              self._scheduleActiveInfoPaneRefresh(75);
            }
            return;
          }
          await self._syncCaseReporterFromActiveSelection();
        }
      }, ["item", "itempane", "tab"], "citation-phoenix-case-reporter-sync");
    }
    _patchNewItemMenus() {
      const mainWindow = Zotero.getMainWindow?.();
      const doc = mainWindow?.document;
      if (!doc) {
        this._scheduleItemPaneRenderPatch();
        return;
      }
      if (this._orig.newItemMenuDocument === doc) return;
      this._unpatchNewItemMenus();
      const self = this;
      const onPopupShowing = function(event) {
        try {
          self._augmentAnyNewItemPopup(event?.target || null);
        } catch (e) {
          try {
            Zotero.debug(`[Citation Phoenix] new item popup patch failed: ${String(e)}`);
          } catch (_) {
          }
        }
      };
      doc.addEventListener("popupshowing", onPopupShowing, false);
      this._orig.newItemMenuDocument = doc;
      this._orig.newItemMenuPopupShowing = onPopupShowing;
    }
    _patchNewItemBuilders() {
      const mainWindow = Zotero.getMainWindow?.();
      const doc = mainWindow?.document;
      const zoteroPaneLocal = mainWindow?.ZoteroPane_Local || mainWindow?.ZoteroPane;
      let patched = false;
      if (this._orig.updateNewItemTypesOwner === zoteroPaneLocal && this._orig.updateNewItemTypes) {
        patched = true;
      }
      if (zoteroPaneLocal?.updateNewItemTypes && this._orig.updateNewItemTypesOwner !== zoteroPaneLocal) {
        if (this._orig.updateNewItemTypesOwner && this._orig.updateNewItemTypes) {
          this._orig.updateNewItemTypesOwner.updateNewItemTypes = this._orig.updateNewItemTypes;
        }
        this._orig.updateNewItemTypes = zoteroPaneLocal.updateNewItemTypes;
        this._orig.updateNewItemTypesOwner = zoteroPaneLocal;
        const self = this;
        zoteroPaneLocal.updateNewItemTypes = function(...args) {
          const result = self._orig.updateNewItemTypes.apply(this, args);
          try {
            self._augmentKnownNewItemPopups(doc, "toolbar");
          } catch (e) {
            try {
              Zotero.debug(`[Citation Phoenix] toolbar new-item patch failed: ${String(e)}`);
            } catch (_) {
            }
          }
          return result;
        };
        patched = true;
      }
      const zoteroStandalone = mainWindow?.ZoteroStandalone;
      if (this._orig.buildNewItemMenuOwner === zoteroStandalone && this._orig.buildNewItemMenu) {
        patched = true;
      }
      if (zoteroStandalone?.buildNewItemMenu && this._orig.buildNewItemMenuOwner !== zoteroStandalone) {
        if (this._orig.buildNewItemMenuOwner && this._orig.buildNewItemMenu) {
          this._orig.buildNewItemMenuOwner.buildNewItemMenu = this._orig.buildNewItemMenu;
        }
        this._orig.buildNewItemMenu = zoteroStandalone.buildNewItemMenu;
        this._orig.buildNewItemMenuOwner = zoteroStandalone;
        const self = this;
        zoteroStandalone.buildNewItemMenu = function(...args) {
          const result = self._orig.buildNewItemMenu.apply(this, args);
          try {
            self._augmentKnownNewItemPopups(doc, "file-menu");
          } catch (e) {
            try {
              Zotero.debug(`[Citation Phoenix] file-menu new-item patch failed: ${String(e)}`);
            } catch (_) {
            }
          }
          return result;
        };
        patched = true;
      }
      if (!patched) {
        this._scheduleItemPaneRenderPatch();
      }
    }
    _unpatchNewItemBuilders() {
      if (this._orig.updateNewItemTypesOwner && this._orig.updateNewItemTypes) {
        this._orig.updateNewItemTypesOwner.updateNewItemTypes = this._orig.updateNewItemTypes;
      }
      if (this._orig.buildNewItemMenuOwner && this._orig.buildNewItemMenu) {
        this._orig.buildNewItemMenuOwner.buildNewItemMenu = this._orig.buildNewItemMenu;
      }
      delete this._orig.updateNewItemTypes;
      delete this._orig.updateNewItemTypesOwner;
      delete this._orig.buildNewItemMenu;
      delete this._orig.buildNewItemMenuOwner;
    }
    _unpatchNewItemMenus() {
      try {
        if (this._orig.newItemMenuDocument && this._orig.newItemMenuPopupShowing) {
          this._orig.newItemMenuDocument.removeEventListener("popupshowing", this._orig.newItemMenuPopupShowing, false);
        }
      } catch (e) {
      } finally {
        delete this._orig.newItemMenuDocument;
        delete this._orig.newItemMenuPopupShowing;
        this._pendingCustomNewItemTypes = [];
      }
    }
    _augmentAnyNewItemPopup(node) {
      const popup = this._coerceMenuPopup(node);
      if (!popup) return;
      if (!this._isKnownNewItemMenuPopup(popup)) return;
      this._augmentNewItemPopupWithCustomTypes(popup);
    }
    _coerceMenuPopup(node) {
      if (!node) return null;
      if (node.localName === "menupopup") return node;
      return node.querySelector?.("menupopup") || null;
    }
    /**
     * Whether `popup` is specifically the toolbar "+" button's popup or the
     * File > New Item submenu's popup -- and NOT some other, unrelated
     * menupopup/submenu/context-menu elsewhere in the app. This check must
     * stay strict (exact known IDs only): a loose structural heuristic (e.g.
     * "looks like a plain list of >=8 menuitems") also matches things like the
     * column-picker or sort submenus, causing custom entries to leak into
     * every menu in the app.
     */
    _isKnownNewItemMenuPopup(popup) {
      if (!popup || popup.localName !== "menupopup") return false;
      const knownIDs = ["menu_NewItemPopup", "menu_newItemPopup", "newItemPopup", "zotero-tb-add-menu", "zotero-add-item"];
      if (knownIDs.includes(popup.id)) return true;
      const parentID = popup.parentNode?.id;
      return parentID === "zotero-tb-add" || knownIDs.includes(parentID);
    }
    _augmentKnownNewItemPopups(doc = Zotero.getMainWindow?.()?.document) {
      if (!doc) return;
      const candidates = /* @__PURE__ */ new Set();
      for (const id of [
        "zotero-tb-add",
        "zotero-tb-add-menu",
        "zotero-add-item",
        "menu_NewItemPopup",
        "menu_newItemPopup",
        "newItemPopup"
      ]) {
        const node = doc.getElementById?.(id);
        const popup = this._coerceMenuPopup(node);
        if (popup) candidates.add(popup);
        if (node?.localName === "menupopup") candidates.add(node);
      }
      for (const popup of candidates) {
        this._augmentNewItemPopupWithCustomTypes(popup);
      }
    }
    /**
     * Insert our custom item-type entries into a "New Item" menupopup,
     * interleaved in true alphabetical order among the existing (native)
     * entries -- not just appended as a sorted group at the end.
     *
     * This intentionally does NOT try to detect which native menuitem
     * corresponds to which native base item type. Zotero's own toolbar/File-menu
     * builders (`updateNewItemTypes()` / `buildNewItemMenu()`) only set
     * `label`/`tooltiptext` on their generated `<menuitem>`s -- they carry no
     * `value`/`typeid` attribute we could match against reliably -- so matching
     * by type is fragile and can silently insert nothing at all if it fails.
     * Instead, each custom entry is positioned purely by comparing its label
     * against the labels of the menuitems already in the popup, which both
     * native and custom entries always have.
     */
    _augmentNewItemPopupWithCustomTypes(popup) {
      if (!popup || popup.localName !== "menupopup") return;
      if (!this._isKnownNewItemMenuPopup(popup)) return;
      if (popup.closest?.("#itembox-field-itemType-menu")) return;
      if (popup.querySelector?.("[data-ibcslm-option-key]")) return;
      if (popup.state && popup.state !== "closed" && popup.state !== "showing") return;
      for (const node of Array.from(popup.querySelectorAll?.(`[${this._newItemMenuMarkerAttribute}="true"]`) || [])) {
        node.remove();
      }
      const options = this._getSortedCustomItemTypeOptions();
      if (!options.length) return;
      const doc = popup.ownerDocument;
      const seen = /* @__PURE__ */ new Set();
      for (const option of options) {
        const itemType = String(option?.itemType || "").trim();
        const baseItemType = String(option?.baseItemType || "").trim();
        if (!itemType || !baseItemType || seen.has(itemType)) continue;
        seen.add(itemType);
        const label = String(option?.label || "").trim() || itemType;
        const menuitem = doc.createXULElement("menuitem");
        menuitem.setAttribute(this._newItemMenuMarkerAttribute, "true");
        menuitem.setAttribute("label", label);
        menuitem.setAttribute("tooltiptext", itemType);
        menuitem.addEventListener("command", (event) => {
          event?.preventDefault?.();
          event?.stopPropagation?.();
          this._createCustomNewItem(itemType, baseItemType);
        });
        this._insertMenuitemInAlphabeticalPosition(popup, menuitem, label);
      }
    }
    /**
     * Insert `menuitem` into `popup` immediately before the first sibling
     * `<menuitem>` whose label sorts after `label`, or at the end if none does.
     *
     * Zotero's native "New Item" menus aren't one single alphabetically sorted
     * list: the toolbar button puts a "recently used" subset of types on top
     * (itself alphabetically sorted, but a small subset), then a separator,
     * then the complete alphabetically sorted list of all types below it. The
     * File menu similarly splits "primary" and "secondary" types across a
     * separator. Comparing a custom entry's label against the *whole* popup
     * would frequently match something early in that small top section,
     * making custom entries appear to jump to the top of the menu. To avoid
     * that, only compare against -- and insert within -- the section *after*
     * the last separator, which is always a complete, non-truncated
     * alphabetically sorted list.
     */
    _insertMenuitemInAlphabeticalPosition(popup, menuitem, label) {
      let collation = null;
      try {
        collation = Zotero?.getLocaleCollation?.();
      } catch (e) {
      }
      const children = Array.from(popup.children || []);
      let lastSeparatorIndex = -1;
      children.forEach((node, index) => {
        if (node?.localName === "menuseparator") lastSeparatorIndex = index;
      });
      let referenceNode = null;
      for (let index = lastSeparatorIndex + 1; index < children.length; index += 1) {
        const node = children[index];
        if (node?.localName !== "menuitem") continue;
        const siblingLabel = String(node.getAttribute("label") || "");
        const comparison = collation?.compareString ? collation.compareString(1, label, siblingLabel) : label.localeCompare(siblingLabel, void 0, { sensitivity: "base" });
        if (comparison < 0) {
          referenceNode = node;
          break;
        }
      }
      popup.insertBefore(menuitem, referenceNode);
    }
    /**
     * Custom item-type options, sorted alphabetically by label (locale-aware,
     * matching how Zotero itself sorts native item types in these same menus).
     */
    _getSortedCustomItemTypeOptions() {
      const locale = Zotero?.locale || "en-US";
      const options = (this.schemaConfig?.getCustomItemTypeOptions?.(locale) || []).slice();
      let collation = null;
      try {
        collation = Zotero?.getLocaleCollation?.();
      } catch (e) {
      }
      options.sort((a, b) => {
        const labelA = String(a?.label || a?.itemType || "");
        const labelB = String(b?.label || b?.itemType || "");
        if (collation?.compareString) return collation.compareString(1, labelA, labelB);
        return labelA.localeCompare(labelB, void 0, { sensitivity: "base" });
      });
      return options;
    }
    async _createCustomNewItem(itemType, baseItemType) {
      const customItemType = String(itemType || "").trim();
      const nativeType = String(baseItemType || "").trim();
      if (!customItemType || !nativeType) return null;
      const typeID = Zotero?.ItemTypes?.getID?.(nativeType);
      const mainWindow = Zotero.getMainWindow?.();
      const pane = mainWindow?.ZoteroPane_Local || mainWindow?.ZoteroPane;
      const created = await pane?.newItem?.(typeID ?? nativeType, {}, null, true);
      const item = this._resolveCreatedZoteroItem(created);
      if (!item || item.deleted) return item || null;
      const extra = String(item.getField?.("extra") || "");
      const nextExtra = this.Jurisdiction.updateMLZItemType?.(extra, customItemType) ?? extra;
      if (nextExtra !== extra) {
        item.setField("extra", nextExtra);
        await item.saveTx({ skipDateModifiedUpdate: true });
      }
      this._scheduleActiveInfoPaneRefresh(0, true);
      try {
        Zotero.debug(`[Citation Phoenix] created custom new-item type: item=${String(item.id || "")} native=${nativeType} custom=${customItemType}`);
      } catch (e) {
      }
      return item;
    }
    _resolveCreatedZoteroItem(created) {
      if (!created) return null;
      if (typeof created.getField === "function" && typeof created.setField === "function") return created;
      return this._getZoteroItemByAnyID(created);
    }
    _queuePendingCustomNewItemType(itemType, baseItemType) {
      const customItemType = String(itemType || "").trim();
      const nativeType = String(baseItemType || "").trim();
      if (!customItemType || !nativeType) return;
      this._pendingCustomNewItemTypes = this._pendingCustomNewItemTypes.filter((entry) => {
        return String(entry?.baseItemType || "").trim() !== nativeType;
      });
      this._pendingCustomNewItemTypes.push({
        itemType: customItemType,
        baseItemType: nativeType,
        createdAt: Date.now()
      });
      while (this._pendingCustomNewItemTypes.length > 8) {
        this._pendingCustomNewItemTypes.shift();
      }
    }
    async _applyPendingCustomNewItemType(itemID) {
      if (!this._pendingCustomNewItemTypes.length) return false;
      const item = this._getZoteroItemByAnyID(itemID);
      if (!item || item.deleted) return false;
      const now = Date.now();
      this._pendingCustomNewItemTypes = this._pendingCustomNewItemTypes.filter(
        (entry) => entry && now - Number(entry.createdAt || 0) < 15e3
      );
      if (!this._pendingCustomNewItemTypes.length) return false;
      const nativeItemType = this._getItemTypeNameByID(item.itemTypeID);
      let matchIndex = -1;
      for (let idx = this._pendingCustomNewItemTypes.length - 1; idx >= 0; idx -= 1) {
        if (String(this._pendingCustomNewItemTypes[idx]?.baseItemType || "").trim() === nativeItemType) {
          matchIndex = idx;
          break;
        }
      }
      if (matchIndex === -1) return false;
      const [match] = this._pendingCustomNewItemTypes.splice(matchIndex, 1);
      const extra = String(item.getField?.("extra") || "");
      const nextExtra = this.Jurisdiction.updateMLZItemType?.(extra, match.itemType) ?? extra;
      if (nextExtra === extra) return false;
      item.setField("extra", nextExtra);
      await item.saveTx({ skipDateModifiedUpdate: true });
      try {
        Zotero.debug(`[Citation Phoenix] applied custom new-item type: item=${String(item.id || "")} native=${nativeItemType} custom=${match.itemType}`);
      } catch (e) {
      }
      return true;
    }
    _patchItemPaneRender() {
      if (this._orig.itemDetailsRender && this._orig.itemDetailsOwner) return;
      const itemDetails = this._getActiveItemDetails();
      if (!itemDetails?.render) {
        this._scheduleItemPaneRenderPatch();
        return;
      }
      const self = this;
      this._orig.itemDetailsOwner = itemDetails;
      this._orig.itemDetailsRender = itemDetails.render;
      itemDetails.render = async function(...args) {
        try {
          const itemID = this.item?.id;
          if (itemID != null) {
            try {
              Zotero.debug(`[Citation Phoenix] case reporter item-pane render sync: item=${String(itemID)}`);
            } catch (e) {
            }
            await self._syncItemFromFieldsAndMLZ(itemID);
          }
        } catch (e) {
          try {
            Zotero.debug(`[Citation Phoenix] case reporter item-pane render sync failed: ${String(e)}`);
          } catch (_) {
          }
        }
        return self._orig.itemDetailsRender.apply(this, args);
      };
      this._patchNewItemMenus();
    }
    _patchInfoBoxRender() {
      if (this._orig.infoBoxRender && this._orig.infoBoxOwner) return;
      const infoBox = this._getActiveInfoBox();
      if (!infoBox?.render) {
        this._scheduleItemPaneRenderPatch();
        return;
      }
      this._patchInfoBoxPrototypeFromInstance(infoBox);
      const self = this;
      this._orig.infoBoxOwner = infoBox;
      this._orig.infoBoxRender = infoBox.render;
      infoBox.render = function(...args) {
        const result = self._orig.infoBoxRender.apply(this, args);
        try {
          try {
            const itemID = this.item?.id;
            const customRows = this.querySelectorAll?.("[data-custom-row-id]")?.length || 0;
            Zotero.debug(`[Citation Phoenix] info-box instance render: item=${String(itemID || "")} customRows=${String(customRows)}`);
          } catch (e) {
          }
          self._ensureExtraPersonMenuItems(this);
          self._removeCommenterField(this);
          self._renderExtraPersonCreatorRows(this);
          self._refreshCustomInfoRows(this);
        } catch (e) {
          try {
            Zotero.debug(`[Citation Phoenix] custom info row render failed: ${String(e)}`);
          } catch (_) {
          }
        }
        return result;
      };
      this._patchNewItemMenus();
    }
    _scheduleItemPaneRenderPatch() {
      if (this._orig.itemDetailsRender && this._orig.itemDetailsOwner && (this._orig.infoBoxRender && this._orig.infoBoxOwner)) return;
      if (this._itemPanePatchAttempts >= this._maxItemPanePatchAttempts) return;
      if (this._itemPanePatchTimer) return;
      this._itemPanePatchAttempts += 1;
      this._itemPanePatchTimer = setTimeout(() => {
        this._itemPanePatchTimer = null;
        this._patchNewItemBuilders();
        this._patchItemPaneRender();
        this._patchInfoBoxRender();
      }, 500);
    }
    _unpatchItemPaneRender() {
      try {
        if (this._itemPanePatchTimer) {
          clearTimeout(this._itemPanePatchTimer);
          this._itemPanePatchTimer = null;
        }
        if (this._infoPaneRefreshTimer) {
          clearTimeout(this._infoPaneRefreshTimer);
          this._infoPaneRefreshTimer = null;
        }
        this._forceFullInfoPaneRefresh = false;
        if (this._orig.itemDetailsOwner && this._orig.itemDetailsRender) {
          this._orig.itemDetailsOwner.render = this._orig.itemDetailsRender;
        }
      } catch (e) {
      } finally {
        delete this._orig.itemDetailsOwner;
        delete this._orig.itemDetailsRender;
      }
    }
    _unpatchInfoBoxRender() {
      try {
        if (this._orig.infoBoxOwner && this._orig.infoBoxRender) {
          this._orig.infoBoxOwner.render = this._orig.infoBoxRender;
        }
        this._removeExtraPersonCreatorRows(this._getActiveInfoBox());
        this._removeCommenterField(this._getActiveInfoBox());
        this._removeJurisdictionField(this._getActiveInfoBox());
        this._removeCustomCourtField(this._getActiveInfoBox());
        this._cleanupRegisteredSchemaInfoRows(this._getActiveInfoBox());
      } catch (e) {
      } finally {
        delete this._orig.infoBoxOwner;
        delete this._orig.infoBoxRender;
      }
    }
    _unregisterCaseReporterSync() {
      try {
        if (this._itemObserverID && Zotero?.Notifier?.unregisterObserver) {
          Zotero.Notifier.unregisterObserver(this._itemObserverID);
        }
      } catch (e) {
      } finally {
        this._itemObserverID = null;
        this._syncInFlight.clear();
      }
    }
    _scheduleActiveInfoPaneRefresh(delay = 0, forceFullRender = false) {
      if (this._infoPaneRefreshTimer) {
        clearTimeout(this._infoPaneRefreshTimer);
      }
      this._forceFullInfoPaneRefresh = this._forceFullInfoPaneRefresh || !!forceFullRender;
      this._infoPaneRefreshTimer = setTimeout(() => {
        this._infoPaneRefreshTimer = null;
        const shouldForceFullRender = this._forceFullInfoPaneRefresh;
        this._forceFullInfoPaneRefresh = false;
        this._refreshActiveInfoPane(shouldForceFullRender);
      }, Math.max(0, Number(delay) || 0));
    }
    _refreshActiveInfoPane(forceFullRender = false) {
      try {
        const infoBox = this._getActiveInfoBox?.();
        if (!infoBox) return;
        if (forceFullRender && typeof infoBox.render === "function") {
          infoBox.render();
          return;
        }
        this._refreshCustomInfoRows(infoBox);
      } catch (e) {
      }
    }
    _refreshRegisteredInfoRows() {
    }
    _refreshCustomInfoRows(infoBox) {
      if (!infoBox) return;
      this._renderItemTypeField(infoBox);
      this._renderJurisdictionField(infoBox);
      this._renderCourtField(infoBox);
      this._renderSchemaFieldRows(infoBox);
      this._renderCustomCourtField(infoBox);
    }
    async _syncCaseReporterFromFieldsAndMLZ(itemID) {
      const item = this._getZoteroItemByAnyID(itemID);
      if (!item || item.deleted) return false;
      const itemTypeName = this._getItemTypeName(item);
      if (itemTypeName !== "case") return false;
      const reporter = String(item.getField?.("reporter") || "").trim();
      const rawCourt = String(item.getField?.("court") || "").trim();
      const hasCourtKeyAlready = this._looksLikeCourtKey(rawCourt);
      const parsedCourt = hasCourtKeyAlready ? null : this.caseCourtMapper?.mapCaseCourt?.(rawCourt) || null;
      const mappedCourt = this.abbrevService.normalizeKey(parsedCourt?.courtKey || "");
      const mappedJurisdiction = String(parsedCourt?.jurisdiction || "").trim().toLowerCase();
      const court = this.abbrevService.normalizeKey(rawCourt || "");
      const extra = String(item.getField?.("extra") || "");
      const mlzFields = this.Jurisdiction.getMLZExtraFields?.(extra) || null;
      const mlzReporter = String(mlzFields?.reporter || "").trim();
      const mlzCourt = this.abbrevService.normalizeKey(mlzFields?.court || "");
      const mlzJurisdiction = this.Jurisdiction.getMLZJurisdiction?.(extra) || "";
      const derivedJurisdiction = this.Jurisdiction.fromItem(item);
      const inferredJurisdiction = mappedJurisdiction || derivedJurisdiction;
      const upgradedCourt = this._upgradeGenericCourtKey(court, inferredJurisdiction);
      try {
        Zotero.debug(`[Citation Phoenix] case court mapping: raw="${rawCourt}" mappedCourt="${mappedCourt}" mappedJurisdiction="${mappedJurisdiction}" derivedJurisdiction="${derivedJurisdiction}" inferredJurisdiction="${inferredJurisdiction}" upgradedCourt="${upgradedCourt}"`);
      } catch (e) {
      }
      let nextExtra = extra;
      let changed = false;
      const targetCourt = mappedCourt || upgradedCourt;
      if (targetCourt && (!hasCourtKeyAlready || court !== targetCourt)) {
        item.setField("court", targetCourt);
        changed = true;
      }
      const effectiveCourt = targetCourt || court;
      const effectiveJurisdiction = inferredJurisdiction;
      const canRewriteJurisdiction = !mlzJurisdiction || /^us(?::|$)/.test(mlzJurisdiction);
      if (reporter && reporter !== mlzReporter) {
        nextExtra = this.Jurisdiction.updateMLZExtraField?.(nextExtra, "reporter", reporter) ?? nextExtra;
      }
      if (!reporter && mlzReporter) {
        item.setField("reporter", mlzReporter);
        changed = true;
      }
      if (canRewriteJurisdiction && effectiveJurisdiction && effectiveJurisdiction !== mlzJurisdiction) {
        const displayJurisdiction = this.abbrevService.formatJurisdictionDisplay(effectiveJurisdiction);
        nextExtra = this.Jurisdiction.updateMLZJurisdiction?.(nextExtra, effectiveJurisdiction, displayJurisdiction) ?? nextExtra;
      }
      if (effectiveCourt && effectiveCourt !== mlzCourt) {
        nextExtra = this.Jurisdiction.updateMLZExtraField?.(nextExtra, "court", effectiveCourt) ?? nextExtra;
      }
      if (!effectiveCourt && mlzCourt) {
        item.setField("court", mlzCourt);
        changed = true;
      }
      if (nextExtra !== extra) {
        item.setField("extra", nextExtra);
        changed = true;
      }
      if (!changed) return false;
      await item.saveTx({ skipDateModifiedUpdate: true });
      try {
        Zotero.debug(`[Citation Phoenix] case sync: wrote reporter/jurisdiction/court mlz state (item ${String(itemID)})`);
      } catch (e) {
      }
      return true;
    }
    async _syncItemFromFieldsAndMLZ(itemID) {
      const normalizedID = String(itemID);
      if (this._syncInFlight.has(normalizedID)) return false;
      this._syncInFlight.add(normalizedID);
      try {
        const itemTypeChanged = await this._syncStoredCustomItemType(itemID);
        const caseChanged = await this._syncCaseReporterFromFieldsAndMLZ(itemID);
        const schemaChanged = await this._syncSchemaConfiguredFields(itemID);
        return !!(itemTypeChanged || caseChanged || schemaChanged);
      } catch (e) {
        try {
          Zotero.logError(e);
        } catch (_) {
        }
        try {
          Zotero.debug(`[Citation Phoenix] item sync failed for item ${normalizedID}: ${String(e)}`);
        } catch (_) {
        }
        return false;
      } finally {
        this._syncInFlight.delete(normalizedID);
      }
    }
    async _syncStoredCustomItemType(itemID) {
      const item = this._getZoteroItemByAnyID(itemID);
      if (!item || item.deleted) return false;
      const nativeItemType = this._getItemTypeNameByID(item.itemTypeID);
      const storedItemType = this._getStoredCustomItemTypeName(item);
      if (!storedItemType) return false;
      const expectedNativeType = this.schemaConfig?.getBaseItemType?.(storedItemType) || "";
      if (!expectedNativeType || expectedNativeType === nativeItemType) return false;
      const extra = String(item.getField?.("extra") || "");
      const nextExtra = this.Jurisdiction.updateMLZItemType?.(extra, "") ?? extra;
      if (nextExtra === extra) return false;
      item.setField("extra", nextExtra);
      await item.saveTx({ skipDateModifiedUpdate: true });
      try {
        Zotero.debug(`[Citation Phoenix] cleared stale custom item type: item=${String(item.id || "")} native=${nativeItemType} stale=${storedItemType}`);
      } catch (e) {
      }
      return true;
    }
    async _syncSchemaConfiguredFields(itemID) {
      const item = this._getZoteroItemByAnyID(itemID);
      if (!item || item.deleted) return false;
      const itemTypeName = this._getItemTypeName(item);
      const fieldDefinitions = this.schemaConfig?.getFieldDefinitionsForItemType?.(itemTypeName) || [];
      if (!fieldDefinitions.length) return false;
      const extra = String(item.getField?.("extra") || "");
      const mlzFields = this.Jurisdiction.getMLZExtraFields?.(extra) || null;
      let nextExtra = extra;
      let changed = false;
      for (const definition of fieldDefinitions) {
        if (!definition?.field) continue;
        if (itemTypeName === "case" && ["reporter", "court", "jurisdiction"].includes(definition.field)) continue;
        const nativeFieldName = this._resolveNativeFieldName(item.itemTypeID, definition.field, definition.baseField);
        const nativeValue = nativeFieldName ? String(item.getField?.(nativeFieldName) || "").trim() : "";
        if (definition.field === "jurisdiction") {
          const normalizedNative = nativeValue ? this._normalizeJurisdictionValue(nativeValue) : "";
          const mlzJurisdiction = this.Jurisdiction.getMLZJurisdiction?.(extra) || "";
          if (nativeFieldName && normalizedNative && normalizedNative !== mlzJurisdiction) {
            const displayJurisdiction = this.abbrevService.formatJurisdictionDisplay(normalizedNative);
            nextExtra = this.Jurisdiction.updateMLZJurisdiction?.(nextExtra, normalizedNative, displayJurisdiction) ?? nextExtra;
          }
          if (nativeFieldName && !normalizedNative && mlzJurisdiction) {
            item.setField(nativeFieldName, mlzJurisdiction);
            changed = true;
          }
          continue;
        }
        const mlzValue = String(mlzFields?.[definition.field] || "").trim();
        if (nativeFieldName && nativeValue && nativeValue !== mlzValue) {
          nextExtra = this.Jurisdiction.updateMLZExtraField?.(nextExtra, definition.field, nativeValue) ?? nextExtra;
        }
        if (nativeFieldName && !nativeValue && mlzValue) {
          item.setField(nativeFieldName, mlzValue);
          changed = true;
        }
      }
      if (nextExtra !== extra) {
        item.setField("extra", nextExtra);
        changed = true;
      }
      if (!changed) return false;
      await item.saveTx({ skipDateModifiedUpdate: true });
      return true;
    }
    _looksLikeCourtKey(value) {
      const normalized = this.abbrevService.normalizeKey(value || "");
      if (!normalized) return false;
      return /^[a-z0-9]+(?:\.[a-z0-9]+)*$/.test(normalized);
    }
    _upgradeGenericCourtKey(courtKey, jurisdiction) {
      const key = this.abbrevService.normalizeKey(courtKey || "");
      const jur = String(jurisdiction || "").trim().toLowerCase();
      if (!key) return "";
      if ((key === "court.appeal" || key === "court.appeals") && jur === "us:c") {
        return "court.appeals.federal.circuit";
      }
      if (key === "court.appeal") {
        return "court.appeals";
      }
      return "";
    }
    async _syncCaseReporterFromActiveSelection() {
      try {
        const pane = Zotero.getActiveZoteroPane?.();
        if (!pane?.getSelectedItems) return;
        const selected = pane.getSelectedItems();
        if (!Array.isArray(selected) || !selected.length) return;
        for (const entry of selected) {
          const id = typeof entry === "number" || typeof entry === "string" ? entry : entry?.id;
          if (id == null) continue;
          await this._syncItemFromFieldsAndMLZ(id);
        }
      } catch (e) {
        try {
          Zotero.debug(`[Citation Phoenix] case reporter selection sync failed: ${String(e)}`);
        } catch (_) {
        }
      }
    }
    _getActiveItemDetails() {
      try {
        const mainWindow = Zotero.getMainWindow?.();
        const fromMainWindow = mainWindow?.ZoteroPane?.itemPane?._itemDetails;
        if (fromMainWindow) return fromMainWindow;
        const activePane = Zotero.getActiveZoteroPane?.();
        return activePane?.itemPane?._itemDetails || null;
      } catch (e) {
      }
      return null;
    }
    _getActiveInfoBox() {
      try {
        const itemDetails = this._getActiveItemDetails();
        if (itemDetails?.getPane) {
          const pane = itemDetails.getPane("info");
          if (pane) return pane;
        }
        const mainWindow = Zotero.getMainWindow?.();
        return mainWindow?.document?.getElementById?.("zotero-editpane-info-box") || null;
      } catch (e) {
      }
      return null;
    }
    _renderJurisdictionField(infoBox) {
      const item = infoBox?.item;
      const itemTypeName = this._getItemTypeName(item);
      const definition = item ? this.schemaConfig?.getFieldDefinition?.(itemTypeName, "jurisdiction") : null;
      if (!item || item.deleted || !definition) {
        this._removeJurisdictionField(infoBox);
        return;
      }
      const table = this._getInfoTable(infoBox);
      if (!table) return;
      const row = this._getOrCreateJurisdictionRow(infoBox);
      if (row.parentNode !== table) {
        table.appendChild(row);
      }
      this._updateJurisdictionRow(infoBox, row, item, definition);
    }
    _renderExtraPersonCreatorRows(infoBox) {
      const allowed = this._getExtraPersonTypesForItem(infoBox?.item);
      const allowedKeys = new Set(allowed.map((entry) => entry.key));
      for (const extraPersonType of this._extraPersonTypes) {
        if (!allowedKeys.has(extraPersonType.key)) {
          this._removeExtraPersonCreatorRows(infoBox, extraPersonType);
        }
      }
      for (const extraPersonType of allowed) {
        this._renderExtraPersonCreatorRow(infoBox, extraPersonType);
      }
    }
    _renderExtraPersonCreatorRow(infoBox, extraPersonType) {
      const item = infoBox?.item;
      if (!item || item.deleted || !this._itemTypeSupportsExtraPerson(item)) {
        this._removeExtraPersonCreatorRows(infoBox, extraPersonType);
        return;
      }
      const extraPeople = this._getStoredExtraPeople(item, extraPersonType);
      if (!extraPeople.length) {
        const activeRow = this._getActiveExtraPersonCreatorRow(infoBox, extraPersonType);
        if (activeRow) {
          this._markExtraPersonCreatorRow(activeRow, extraPersonType, this._getExtraPersonStorageIndex(activeRow));
          return;
        }
        this._removeExtraPersonCreatorRows(infoBox, extraPersonType);
        try {
          Zotero.debug(`[Citation Phoenix] ${extraPersonType.key} creator row skipped: item=${String(item?.id || "")} no stored value`);
        } catch (e) {
        }
        return;
      }
      if (typeof infoBox.addCreatorRow !== "function") {
        try {
          Zotero.debug(`[Citation Phoenix] ${extraPersonType.key} creator row skipped: item=${String(item?.id || "")} addCreatorRow unavailable`);
        } catch (e) {
        }
        return;
      }
      const existingRows = this._getExtraPersonCreatorRows(infoBox, extraPersonType);
      if (existingRows.length >= extraPeople.length) {
        existingRows.forEach((row, idx) => this._markExtraPersonCreatorRow(row, extraPersonType, idx));
        return;
      }
      this._removeEmptyDefaultCreatorRows(infoBox);
      for (let storageIndex = existingRows.length; storageIndex < extraPeople.length; storageIndex += 1) {
        const creatorData = this._extraPersonToCreatorData(extraPeople[storageIndex]);
        const rowIndex = infoBox._creatorCount;
        infoBox.addCreatorRow(creatorData, extraPersonType.creatorTypeID, false, infoBox._firstRowBeforeCreators || null);
        const label = this._getCreatorTypeLabel(infoBox, rowIndex);
        const row = label?.closest(".meta-row") || null;
        if (!row) continue;
        this._markExtraPersonCreatorRow(row, extraPersonType, storageIndex);
        row.setAttribute("data-ibcslm-rendered-extra-person-row", extraPersonType.key);
        try {
          Zotero.debug(`[Citation Phoenix] ${extraPersonType.key} creator row rendered: item=${String(item?.id || "")} rowIndex=${String(rowIndex)} storageIndex=${String(storageIndex)}`);
        } catch (e) {
        }
      }
    }
    _getCreatorTypeLabel(infoBox, rowIndex) {
      return infoBox?.querySelector?.(`.meta-label[fieldname="creator-${rowIndex}-typeID"]`) || infoBox?.querySelector?.(`.meta-label[fieldname="creator-${rowIndex}"]`) || null;
    }
    _getCreatorRowIndex(row) {
      const fieldName = String(row?.querySelector?.(".meta-label")?.getAttribute?.("fieldname") || "");
      const match = fieldName.match(/^creator-(\d+)(?:-|$)/);
      return match ? Number(match[1]) : null;
    }
    _getCreatorRows(infoBox) {
      if (!infoBox?.querySelectorAll) return [];
      const labels = Array.from(infoBox.querySelectorAll('.meta-label[fieldname^="creator-"]'));
      const rows = [];
      for (const label of labels) {
        const row = label.closest?.(".meta-row") || null;
        if (row && !rows.includes(row)) rows.push(row);
      }
      return rows;
    }
    _getExtraPersonCreatorRows(infoBox, extraPersonType = null) {
      return this._getCreatorRows(infoBox).filter((row) => {
        const rowTypeKey = row.getAttribute?.("data-ibcslm-extra-person-type") || "";
        if (rowTypeKey) return !extraPersonType || rowTypeKey === extraPersonType.key;
        if (!extraPersonType && row.getAttribute?.("data-ibcslm-commenter-row") === "true") return true;
        return false;
      });
    }
    _patchItemCreators() {
      const itemProto = Zotero?.Item?.prototype;
      if (!itemProto || this._orig.itemSetCreator || typeof itemProto.setCreator !== "function") return;
      this._orig.itemSetCreator = itemProto.setCreator;
      const self = this;
      itemProto.setCreator = function(index, creator, creatorTypeID, ...rest) {
        const extraPersonType = self._getExtraPersonConfigBySyntheticCreatorType(
          creatorTypeID ?? creator?.creatorTypeID ?? creator?.creatorType ?? creator?.creatorTypeName
        );
        if (!extraPersonType) {
          return self._orig.itemSetCreator.call(this, index, creator, creatorTypeID, ...rest);
        }
        const person = self._extraPersonFromCreatorFields(creator);
        if (person) {
          const nativeCount = this.numCreators?.() || 0;
          const numericIndex = Number(index);
          const storageIndex = Number.isInteger(numericIndex) ? Math.max(0, numericIndex - nativeCount) : null;
          self._setStoredExtraPersonAtNearestIndex(this, extraPersonType, storageIndex, person);
        }
        try {
          Zotero.debug(`[Citation Phoenix] synthetic creator diverted to mlzsync1: type=${extraPersonType.key} index=${String(index || 0)}`);
        } catch (e) {
        }
        return true;
      };
    }
    _getExtraPersonConfigByIndex(infoBox, rowIndex) {
      const row = this._getCreatorTypeLabel(infoBox, rowIndex)?.closest?.(".meta-row") || null;
      if (!row) return null;
      const rowTypeKey = row.getAttribute?.("data-ibcslm-extra-person-type") || "";
      if (rowTypeKey) return this._extraPersonTypes.find((config) => config.key === rowTypeKey) || null;
      if (row.getAttribute?.("data-ibcslm-commenter-row") === "true") {
        return this._extraPersonTypes.find((config) => config.key === "commenter") || null;
      }
      return null;
    }
    _getExtraPersonConfigByRowCreatorType(row) {
      const label = row?.querySelector?.(".meta-label") || null;
      return this._getExtraPersonConfigBySyntheticCreatorType(label?.getAttribute?.("typeid"));
    }
    _getNativeCreatorIndex(infoBox, rowIndex) {
      let nativeIndex = Number(rowIndex) || 0;
      for (const row of this._getExtraPersonCreatorRows(infoBox)) {
        const extraIndex = this._getCreatorRowIndex(row);
        if (extraIndex != null && extraIndex < rowIndex) nativeIndex -= 1;
      }
      return Math.max(0, nativeIndex);
    }
    _getDefaultNativeCreatorTypeID(itemTypeID) {
      const nativeTypes = this._orig.creatorTypesGetTypesForItemType?.call(Zotero.CreatorTypes, itemTypeID) || [];
      const firstNative = nativeTypes.find((entry) => !this._getExtraPersonConfigBySyntheticCreatorType(entry?.id || entry?.name));
      return firstNative?.id || firstNative?.name || this._orig.creatorTypesGetID?.call(Zotero.CreatorTypes, "author") || "author";
    }
    _getActiveExtraPersonCreatorRow(infoBox, extraPersonType) {
      const activeElement = infoBox?.ownerDocument?.activeElement || null;
      return this._getExtraPersonCreatorRows(infoBox, extraPersonType).find((row) => {
        return activeElement && row.contains?.(activeElement);
      }) || null;
    }
    _markExtraPersonCreatorRow(row, extraPersonType, storageIndex = null) {
      if (!row) return;
      row.setAttribute("data-ibcslm-extra-person-type", extraPersonType.key);
      if (storageIndex != null) row.setAttribute("data-ibcslm-extra-person-index", String(storageIndex));
      if (extraPersonType.key === "commenter") row.setAttribute("data-ibcslm-commenter-row", "true");
      const labelNode = row.querySelector?.(".meta-label label");
      if (labelNode) {
        labelNode.textContent = this._getExtraPersonLabel(extraPersonType);
      }
      const plusButton = row.querySelector(".zotero-clicky-plus");
      const minusButton = row.querySelector(".zotero-clicky-minus");
      const optionsButton = row.querySelector(".zotero-clicky-options");
      const grippy = row.querySelector(".zotero-clicky-grippy");
      if (plusButton) plusButton.hidden = false;
      if (minusButton && !minusButton._ibcslmExtraPersonRemovalBound) {
        minusButton._ibcslmExtraPersonRemovalBound = true;
        minusButton.addEventListener("mousedown", () => {
          const infoBox = row.closest?.("info-box") || row.closest?.("#zotero-editpane-info-box") || row.parentNode?.closest?.("info-box") || null;
          if (!infoBox) return;
          infoBox._ibcslmPendingExtraPersonRemoval = {
            key: extraPersonType.key,
            index: this._getCreatorRowIndex(row),
            storageIndex: this._getExtraPersonStorageIndex(row),
            at: Date.now()
          };
        }, true);
      }
      if (optionsButton) optionsButton.hidden = false;
      if (grippy) {
        grippy.hidden = true;
        grippy.disabled = true;
      }
    }
    _removeEmptyDefaultCreatorRows(infoBox) {
      const item = infoBox?.item;
      if (item?.numCreators?.()) return;
      for (const row of this._getCreatorRows(infoBox)) {
        if (this._getExtraPersonCreatorRows(infoBox).includes(row)) continue;
        const values = Array.from(row.querySelectorAll("input, textarea, editable-text")).map((node) => {
          return String(node.value ?? node.getAttribute?.("value") ?? "").trim();
        });
        if (values.some(Boolean)) continue;
        row.parentNode?.removeChild(row);
        if (typeof infoBox._creatorCount === "number" && infoBox._creatorCount > 0) {
          infoBox._creatorCount -= 1;
        }
      }
    }
    _ensureExtraPersonMenuItems(infoBox) {
      const item = infoBox?.item;
      if (!item || !this._itemTypeSupportsExtraPerson(item) || !infoBox.editable) return;
      const menu = infoBox._creatorTypeMenu;
      if (!menu) return;
      const doc = menu.ownerDocument || infoBox.ownerDocument;
      for (const extraPersonType of this._getExtraPersonTypesForItem(item)) {
        const existing = Array.from(menu.children || []).some((node) => {
          return String(node?.getAttribute?.("typeid") || "") === extraPersonType.creatorTypeID;
        });
        if (existing) continue;
        const menuitem = doc.createXULElement("menuitem");
        menuitem.setAttribute("label", this._getExtraPersonLabel(extraPersonType));
        menuitem.setAttribute("typeid", extraPersonType.creatorTypeID);
        menu.appendChild(menuitem);
      }
    }
    _removeExtraPersonCreatorRows(infoBox, extraPersonType = null) {
      for (const row of this._getExtraPersonCreatorRows(infoBox, extraPersonType)) {
        row.parentNode?.removeChild(row);
        if (typeof infoBox._creatorCount === "number" && infoBox._creatorCount > 0) {
          infoBox._creatorCount -= 1;
        }
      }
    }
    _unmarkExtraPersonCreatorRow(row) {
      if (!row) return;
      row.removeAttribute?.("data-ibcslm-extra-person-type");
      row.removeAttribute?.("data-ibcslm-extra-person-index");
      row.removeAttribute?.("data-ibcslm-rendered-extra-person-row");
      row.removeAttribute?.("data-ibcslm-commenter-row");
    }
    _consumePendingExtraPersonRemoval(infoBox, rowIndex, extraPersonType) {
      const pending = infoBox?._ibcslmPendingExtraPersonRemoval || null;
      try {
        delete infoBox._ibcslmPendingExtraPersonRemoval;
      } catch (e) {
      }
      if (!pending) return false;
      if (Date.now() - Number(pending.at || 0) > 1500) return false;
      if (String(pending.key || "") !== extraPersonType.key) return false;
      return Number(pending.index) === Number(rowIndex);
    }
    _getExtraPersonStorageIndex(row) {
      const raw = row?.getAttribute?.("data-ibcslm-extra-person-index");
      const index = Number(raw);
      return Number.isInteger(index) && index >= 0 ? index : null;
    }
    _renderCourtField(infoBox) {
      const item = infoBox?.item;
      const itemTypeName = item ? Zotero?.ItemTypes?.getName?.(item.itemTypeID) : null;
      const row = this._findInfoFieldRow(infoBox, "court");
      if (!row) return;
      if (!item || item.deleted || itemTypeName !== "case") {
        this._removeCustomCourtField(infoBox);
        this._restoreCourtField(row, item);
        return;
      }
      this._updateCourtRow(infoBox, row, item);
    }
    _renderCustomCourtField(infoBox) {
      const item = infoBox?.item;
      const itemTypeName = item ? Zotero?.ItemTypes?.getName?.(item.itemTypeID) : null;
      const courtRow = this._findInfoFieldRow(infoBox, "court");
      if (!courtRow) {
        this._removeCustomCourtField(infoBox);
        return;
      }
      if (!item || item.deleted || itemTypeName !== "case" || !infoBox.editable) {
        this._removeCustomCourtField(infoBox);
        return;
      }
      const table = this._getInfoTable(infoBox);
      if (!table) return;
      const row = this._getOrCreateCustomCourtRow(infoBox);
      if (courtRow.parentNode === table) {
        const afterCourt = courtRow.nextSibling;
        if (afterCourt !== row) table.insertBefore(row, afterCourt);
      } else if (row.parentNode !== table) {
        table.appendChild(row);
      }
      this._updateCustomCourtRow(row, item);
    }
    _removeJurisdictionField(infoBox) {
      const row = infoBox?.querySelector?.(`#${this._jurisdictionRowID}`);
      if (row?.parentNode) row.parentNode.removeChild(row);
    }
    _removeCommenterField(infoBox) {
      const row = infoBox?.querySelector?.(`#${this._commenterRowID}`);
      if (row?.parentNode) row.parentNode.removeChild(row);
      for (const customRow of infoBox?.querySelectorAll?.('[data-custom-row-id$="citation-phoenix-commenter-row"]') || []) {
        customRow.parentNode?.removeChild(customRow);
      }
    }
    _removeCustomCourtField(infoBox) {
      const row = infoBox?.querySelector?.(`#${this._customCourtRowID}`);
      if (row?.parentNode) row.parentNode.removeChild(row);
    }
    _removeSchemaFieldRows(infoBox) {
      for (const row of infoBox?.querySelectorAll?.('[data-ibcslm-schema-field-row="true"]') || []) {
        row.parentNode?.removeChild(row);
      }
    }
    _getInfoTable(infoBox) {
      return infoBox?._infoTable || infoBox?.querySelector?.("#info-table") || null;
    }
    _findInfoFieldRow(infoBox, fieldName) {
      const table = this._getInfoTable(infoBox);
      if (!table) return null;
      for (const row of table.querySelectorAll(".meta-row")) {
        const labelWrapper = row.querySelector(".meta-label");
        if (labelWrapper?.getAttribute("fieldname") === fieldName) return row;
      }
      return null;
    }
    _getOrCreateJurisdictionRow(infoBox) {
      let row = infoBox.querySelector(`#${this._jurisdictionRowID}`);
      if (row) return row;
      const doc = infoBox.ownerDocument;
      row = doc.createElement("div");
      row.id = this._jurisdictionRowID;
      row.className = "meta-row";
      const labelWrapper = doc.createElement("div");
      labelWrapper.className = "meta-label";
      labelWrapper.setAttribute("fieldname", "jurisdiction");
      let label;
      if (typeof infoBox.createLabelElement === "function") {
        label = infoBox.createLabelElement({
          id: "itembox-field-jurisdiction-label",
          text: this._getLocalizedBuiltinLabel("jurisdiction")
        });
      } else {
        label = doc.createElement("label");
        label.id = "itembox-field-jurisdiction-label";
        label.textContent = this._getLocalizedBuiltinLabel("jurisdiction");
      }
      labelWrapper.appendChild(label);
      const dataWrapper = doc.createElement("div");
      dataWrapper.className = "meta-data";
      row.appendChild(labelWrapper);
      row.appendChild(dataWrapper);
      return row;
    }
    _getOrCreateCustomCourtRow(infoBox) {
      let row = infoBox.querySelector(`#${this._customCourtRowID}`);
      if (row) return row;
      const doc = infoBox.ownerDocument;
      row = doc.createElement("div");
      row.id = this._customCourtRowID;
      row.className = "meta-row";
      const labelWrapper = doc.createElement("div");
      labelWrapper.className = "meta-label";
      labelWrapper.setAttribute("fieldname", "custom-court");
      let label;
      if (typeof infoBox.createLabelElement === "function") {
        label = infoBox.createLabelElement({
          id: "itembox-field-custom-court-label",
          text: this._getLocalizedBuiltinLabel("customCourt")
        });
      } else {
        label = doc.createElement("label");
        label.id = "itembox-field-custom-court-label";
        label.textContent = this._getLocalizedBuiltinLabel("customCourt");
      }
      labelWrapper.appendChild(label);
      const dataWrapper = doc.createElement("div");
      dataWrapper.className = "meta-data";
      row.appendChild(labelWrapper);
      row.appendChild(dataWrapper);
      return row;
    }
    _updateCustomCourtRow(row, item) {
      const dataWrapper = row.querySelector(".meta-data");
      if (!dataWrapper) return;
      dataWrapper.textContent = "";
      const doc = row.ownerDocument;
      const container = doc.createElement("div");
      container.style.display = "flex";
      container.style.alignItems = "center";
      container.style.gap = "6px";
      const customInput = doc.createElement("input");
      customInput.id = "itembox-field-court-custom";
      customInput.className = "value";
      customInput.placeholder = this._getLocalizedBuiltinLabel("customCourtPlaceholder");
      customInput.style.maxWidth = "220px";
      const currentCourt = String(item?.getField?.("court") || "").trim();
      customInput.value = currentCourt;
      const saveCustomCourtValue = async () => {
        const rawCustomValue = String(customInput.value || "").trim();
        if (!rawCustomValue) return;
        await this._saveCourtFromMenu(item, rawCustomValue);
      };
      const setButton = doc.createElement("button");
      setButton.type = "button";
      setButton.textContent = this._getLocalizedBuiltinLabel("setButton");
      setButton.addEventListener("click", () => {
        saveCustomCourtValue();
      });
      customInput.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        saveCustomCourtValue();
      });
      container.appendChild(customInput);
      container.appendChild(setButton);
      dataWrapper.appendChild(container);
    }
    _updateJurisdictionRow(infoBox, row, item, definition = null) {
      const dataWrapper = row.querySelector(".meta-data");
      if (!dataWrapper) return;
      const currentJurisdiction = this._getDisplayedJurisdictionCode(item);
      const displayValue = this.abbrevService.formatJurisdictionDisplay(currentJurisdiction);
      dataWrapper.textContent = "";
      if (infoBox.editable) {
        const itemTypeName = this._getItemTypeName(item);
        if (itemTypeName === "case") {
          dataWrapper.appendChild(this._buildJurisdictionMenuList(infoBox, item, currentJurisdiction, displayValue));
        } else {
          const effectiveDefinition = definition || this.schemaConfig?.getFieldDefinition?.(itemTypeName, "jurisdiction") || { field: "jurisdiction" };
          dataWrapper.appendChild(this._buildSchemaJurisdictionMenuList(infoBox, item, effectiveDefinition, currentJurisdiction, displayValue));
        }
        return;
      }
      if (typeof infoBox.createValueElement === "function") {
        const valueElem = infoBox.createValueElement({
          editable: false,
          text: displayValue,
          id: "itembox-field-jurisdiction-value",
          attributes: {
            "aria-labelledby": "itembox-field-jurisdiction-label",
            fieldname: "jurisdiction",
            title: currentJurisdiction
          }
        });
        valueElem.value = displayValue;
        dataWrapper.appendChild(valueElem);
        return;
      }
      const input = row.ownerDocument.createElement("input");
      input.className = "value";
      input.readOnly = true;
      input.value = displayValue;
      input.title = currentJurisdiction;
      dataWrapper.appendChild(input);
    }
    _updateCourtRow(infoBox, row, item) {
      const dataWrapper = row.querySelector(".meta-data");
      if (!dataWrapper) return;
      const currentJurisdiction = this._getDisplayedJurisdictionCode(item);
      const currentCourtKey = this._getDisplayedCourtKey(item);
      const displayValue = this._formatCourtDisplay(currentCourtKey, currentJurisdiction);
      dataWrapper.textContent = "";
      if (infoBox.editable) {
        dataWrapper.appendChild(this._buildCourtMenuList(infoBox, item, currentJurisdiction, currentCourtKey, displayValue));
        return;
      }
      if (typeof infoBox.createValueElement === "function") {
        const valueElem = infoBox.createValueElement({
          editable: false,
          text: displayValue,
          id: "itembox-field-court-value",
          attributes: {
            "aria-labelledby": "itembox-field-court-label",
            fieldname: "court",
            title: currentCourtKey
          }
        });
        valueElem.value = displayValue;
        dataWrapper.appendChild(valueElem);
        return;
      }
      const input = row.ownerDocument.createElement("input");
      input.className = "value";
      input.readOnly = true;
      input.value = displayValue;
      input.title = currentCourtKey;
      dataWrapper.appendChild(input);
    }
    _restoreCourtField(row, item) {
      const dataWrapper = row?.querySelector(".meta-data");
      if (!dataWrapper) return;
      const courtValue = String(item?.getField?.("court") || "");
      const currentJurisdiction = this._getDisplayedJurisdictionCode(item);
      const displayValue = this._formatCourtDisplay(courtValue, currentJurisdiction);
      dataWrapper.textContent = "";
      const infoBox = row.closest("#zotero-editpane-info-box");
      if (infoBox && typeof infoBox.createValueElement === "function") {
        const valueElem = infoBox.createValueElement({
          editable: false,
          text: displayValue,
          id: "itembox-field-court-value",
          attributes: {
            "aria-labelledby": "itembox-field-court-label",
            fieldname: "court",
            title: courtValue
          }
        });
        valueElem.value = displayValue;
        dataWrapper.appendChild(valueElem);
        return;
      }
      const input = row.ownerDocument.createElement("input");
      input.className = "value";
      input.readOnly = true;
      input.value = displayValue;
      input.title = courtValue;
      dataWrapper.appendChild(input);
    }
    _buildJurisdictionMenuList(infoBox, item, currentJurisdiction, displayValue) {
      const doc = infoBox.ownerDocument;
      return this._buildFilteredPickerControl(doc, {
        fieldName: "jurisdiction",
        inputId: "itembox-field-jurisdiction-input",
        listId: "itembox-field-jurisdiction-list",
        currentValue: currentJurisdiction,
        displayValue,
        options: this._getJurisdictionOptions(currentJurisdiction),
        minChars: 2,
        onSelect: async (option) => {
          await this._saveJurisdictionFromMenu(item, option.code);
        },
        formatOptionText: (option) => option.label
      });
    }
    _buildSchemaJurisdictionMenuList(infoBox, item, definition, currentJurisdiction, displayValue) {
      const doc = infoBox.ownerDocument;
      return this._buildFilteredPickerControl(doc, {
        fieldName: definition.field,
        inputId: `itembox-field-${definition.field}-input`,
        listId: `itembox-field-${definition.field}-list`,
        currentValue: currentJurisdiction,
        displayValue,
        options: this._getJurisdictionOptions(currentJurisdiction),
        minChars: 2,
        onSelect: async (option) => {
          await this._saveSchemaFieldValue(item, definition, option.code);
        },
        formatOptionText: (option) => option.label
      });
    }
    _buildCourtMenuList(infoBox, item, currentJurisdiction, currentCourtKey, displayValue) {
      const doc = infoBox.ownerDocument;
      const menulist = doc.createXULElement("menulist");
      menulist.id = "itembox-field-court-menu";
      menulist.className = "zotero-clicky keyboard-clickable";
      menulist.setAttribute("aria-labelledby", "itembox-field-court-label");
      menulist.setAttribute("fieldname", "court");
      menulist.setAttribute("tooltiptext", currentCourtKey);
      menulist.style.flex = "1";
      const popup = menulist.appendChild(doc.createXULElement("menupopup"));
      const options = this._getCourtOptions(currentJurisdiction, currentCourtKey);
      const hasCourt = !!String(currentCourtKey || "").trim();
      const noEntryValue = `${currentJurisdiction}||__no_entry__`;
      const compoundCurrentValue = hasCourt ? `${currentJurisdiction}||${currentCourtKey}` : noEntryValue;
      if (!hasCourt) {
        const placeholder = doc.createXULElement("menuitem");
        placeholder.setAttribute("value", noEntryValue);
        placeholder.setAttribute("label", "no entry");
        placeholder.setAttribute("tooltiptext", "no entry");
        popup.appendChild(placeholder);
      }
      for (const option of options) {
        const menuitem = doc.createXULElement("menuitem");
        menuitem.setAttribute("value", `${option.jurisdiction}||${option.key}`);
        menuitem.setAttribute("label", option.label);
        menuitem.setAttribute("tooltiptext", option.abbreviation || option.key);
        popup.appendChild(menuitem);
      }
      menulist.value = compoundCurrentValue;
      if (!hasCourt && menulist.selectedItem) {
        menulist.setAttribute("label", "no entry");
      } else if (!menulist.selectedItem && options.length) {
        const fallbackIndex = options.findIndex((option) => !option.isChild && option.key === currentCourtKey && option.jurisdiction === currentJurisdiction);
        menulist.selectedIndex = fallbackIndex >= 0 ? fallbackIndex : 0;
      }
      if (menulist.selectedItem && displayValue) {
        menulist.setAttribute("label", menulist.selectedItem.getAttribute("label"));
      }
      const saveCourtValue = async () => {
        const selectedValue = String(menulist.value || "").trim();
        if (!selectedValue) return;
        if (selectedValue.endsWith("||__no_entry__")) {
          const extra = String(item.getField?.("extra") || "");
          let nextExtra = this.Jurisdiction.updateMLZExtraField?.(extra, "court", "") ?? extra;
          if (nextExtra === extra && String(item.getField?.("court") || "").trim() === "") return;
          item.setField("extra", nextExtra);
          item.setField("court", "");
          await item.saveTx({ skipDateModifiedUpdate: true });
          this._scheduleActiveInfoPaneRefresh(75, true);
          return;
        }
        await this._saveCourtFromMenu(item, selectedValue);
      };
      menulist.addEventListener("command", saveCourtValue);
      menulist.addEventListener("change", saveCourtValue);
      return menulist;
    }
    _buildFilteredPickerControl(doc, {
      fieldName,
      inputId,
      listId,
      currentValue,
      displayValue,
      options,
      minChars = 2,
      onSelect,
      formatOptionText
    }) {
      let currentDisplayValue = String(displayValue || "");
      let currentRawValue = String(currentValue || "");
      const wrapper = doc.createElement("div");
      wrapper.style.display = "flex";
      wrapper.style.alignItems = "center";
      wrapper.style.gap = "0";
      wrapper.style.width = "100%";
      wrapper.style.position = "relative";
      if (fieldName === "jurisdiction") {
        wrapper.style.maxWidth = "22em";
      }
      const input = doc.createElement("input");
      input.id = inputId;
      input.className = "value";
      input.setAttribute("fieldname", fieldName);
      input.setAttribute("aria-labelledby", `itembox-field-${fieldName}-label`);
      input.autocomplete = "off";
      input.spellcheck = false;
      input.style.flex = "1";
      input.style.minWidth = "0";
      input.value = currentDisplayValue;
      input.title = currentRawValue;
      input.style.boxSizing = "border-box";
      input.style.width = "100%";
      input.style.maxWidth = fieldName === "jurisdiction" ? "22em" : "100%";
      input.style.whiteSpace = "nowrap";
      input.style.overflow = "hidden";
      input.style.textOverflow = "ellipsis";
      const normalizedOptions = Array.isArray(options) ? options.map((option) => ({
        ...option,
        displayText: String(typeof formatOptionText === "function" ? formatOptionText(option) : option.label || option.code || "").trim(),
        searchText: this._normalizeMenuSearchText(`${String(option.label || "")} ${String(option.code || "")} ${String(option.abbreviation || "")}`)
      })).filter((option) => option.displayText) : [];
      const popup = doc.createElement("div");
      popup.id = listId;
      popup.style.position = "absolute";
      popup.style.left = "0";
      popup.style.right = "0";
      popup.style.top = "100%";
      popup.style.zIndex = "2000";
      popup.style.maxHeight = "220px";
      popup.style.overflowY = "auto";
      popup.style.border = "1px solid ThreeDShadow";
      popup.style.background = "Field";
      popup.style.color = "FieldText";
      popup.style.display = "none";
      popup.style.boxShadow = "0 2px 8px rgba(0,0,0,0.2)";
      popup.style.marginTop = "2px";
      const hidePopup = () => {
        popup.style.display = "none";
        while (popup.firstChild) popup.removeChild(popup.firstChild);
      };
      const renderOptions = () => {
        const query = this._normalizeMenuSearchText(String(input.value || ""));
        hidePopup();
        if (query.length < Math.max(1, Number(minChars) || 2)) return;
        const matches = normalizedOptions.filter((option) => option.searchText.includes(query));
        if (!matches.length) {
          const empty = doc.createElement("div");
          empty.textContent = "No matches";
          empty.style.padding = "4px 8px";
          empty.style.opacity = "0.7";
          popup.appendChild(empty);
          popup.style.display = "block";
          return;
        }
        for (const option of matches.slice(0, 100)) {
          const row = doc.createElement("button");
          row.type = "button";
          row.textContent = option.displayText;
          row.title = option.displayText;
          row.style.display = "block";
          row.style.width = "100%";
          row.style.boxSizing = "border-box";
          row.style.textAlign = "left";
          row.style.padding = "2px 8px";
          row.style.border = "0";
          row.style.margin = "0";
          row.style.background = "transparent";
          row.style.color = "inherit";
          row.style.whiteSpace = "nowrap";
          row.style.overflow = "hidden";
          row.style.textOverflow = "ellipsis";
          row.style.lineHeight = "1.2";
          row.addEventListener("mousedown", (event) => {
            event.preventDefault();
            event.stopPropagation();
          });
          row.addEventListener("click", async () => {
            input.value = option.displayText;
            input.title = option.displayText;
            currentDisplayValue = option.displayText;
            currentRawValue = option.code;
            hidePopup();
            await onSelect?.(option);
          });
          popup.appendChild(row);
        }
        popup.style.display = "block";
      };
      const resolveSelectedOption = async () => {
        const raw = String(input.value || "").trim();
        if (!raw) return;
        const normalizedRaw = this._normalizeMenuSearchText(raw);
        const exact = normalizedOptions.find((option) => {
          return this._normalizeMenuSearchText(option.displayText) === normalizedRaw || this._normalizeMenuSearchText(option.code) === normalizedRaw;
        });
        const uniquePrefix = !exact ? normalizedOptions.filter((option) => option.searchText.includes(normalizedRaw)) : [];
        const match = exact || (uniquePrefix.length === 1 ? uniquePrefix[0] : null);
        if (!match) {
          input.value = currentDisplayValue;
          input.title = currentRawValue;
          hidePopup();
          return;
        }
        input.value = match.displayText;
        input.title = match.code;
        currentDisplayValue = match.displayText;
        currentRawValue = match.code;
        hidePopup();
        await onSelect?.(match);
      };
      input.addEventListener("input", renderOptions);
      input.addEventListener("focus", () => {
        if (typeof input.select === "function") input.select();
        renderOptions();
      });
      input.addEventListener("change", resolveSelectedOption);
      input.addEventListener("blur", resolveSelectedOption);
      input.addEventListener("keydown", (event) => {
        const key = String(event.key || "");
        if (key === "Escape") {
          hidePopup();
          return;
        }
        if (key !== "Enter") return;
        event.preventDefault();
        resolveSelectedOption();
      });
      wrapper.appendChild(input);
      wrapper.appendChild(popup);
      return wrapper;
    }
    _attachMenuSearchFilter(menulist, popup, { minChars = 2, displayValue = "" } = {}) {
      if (!menulist || !popup) return;
      const searchField = menulist.inputField || menulist;
      const state = {
        timer: null,
        minChars: Math.max(1, Number(minChars) || 2)
      };
      const clearTimer = () => {
        if (!state.timer) return;
        clearTimeout(state.timer);
        state.timer = null;
      };
      const setAllVisible = () => {
        this._removeMenuNoResultsItem(popup);
        for (const node of Array.from(popup.children || [])) {
          if (node?.localName !== "menuitem") continue;
          node.hidden = false;
        }
      };
      const applyFilter = (rawQuery = "") => {
        const normalizedQuery = this._normalizeMenuSearchText(rawQuery);
        if (!normalizedQuery || normalizedQuery.length < state.minChars) {
          setAllVisible();
          return;
        }
        let visibleCount = 0;
        for (const node of Array.from(popup.children || [])) {
          if (node?.localName !== "menuitem") continue;
          const haystack = String(node._ibcslmSearchText || node.getAttribute("label") || node.getAttribute("value") || "").trim();
          const matches = this._normalizeMenuSearchText(haystack).includes(normalizedQuery);
          node.hidden = !matches;
          if (matches) visibleCount += 1;
        }
        if (!visibleCount) {
          this._showMenuNoResultsItem(popup);
          return;
        }
        this._removeMenuNoResultsItem(popup);
      };
      const resetSearch = () => {
        clearTimer();
        if (searchField && "value" in searchField) searchField.value = "";
        applyFilter("");
      };
      const onInput = () => {
        clearTimer();
        const query = String(searchField?.value || "");
        applyFilter(query);
      };
      const onKeyDown = (event) => {
        if (!event || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
        if (String(event.key || "") === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          resetSearch();
        }
      };
      if (searchField?.addEventListener) {
        searchField.addEventListener("input", onInput);
        searchField.addEventListener("keydown", onKeyDown, true);
      } else {
        menulist.addEventListener("keydown", onKeyDown, true);
      }
      popup.addEventListener("popuphidden", resetSearch);
      popup.addEventListener("popupshown", onInput);
      popup.addEventListener("command", resetSearch);
      if (displayValue) {
        menulist.setAttribute("label", displayValue);
        if (searchField && "value" in searchField) {
          searchField.value = "";
        }
      }
      setAllVisible();
    }
    _normalizeMenuSearchText(value) {
      return this.abbrevService.normalizeKey(value || "");
    }
    _showMenuNoResultsItem(popup) {
      if (!popup) return;
      this._removeMenuNoResultsItem(popup);
      const doc = popup.ownerDocument;
      const item = doc.createXULElement("menuitem");
      item.setAttribute("label", "No matches");
      item.setAttribute("disabled", "true");
      item.hidden = false;
      item._ibcslmNoResults = true;
      popup.appendChild(item);
      popup._ibcslmNoResultsItem = item;
    }
    _removeMenuNoResultsItem(popup) {
      const item = popup?._ibcslmNoResultsItem;
      if (item?.parentNode) item.parentNode.removeChild(item);
      if (popup?._ibcslmNoResultsItem) delete popup._ibcslmNoResultsItem;
    }
    _getJurisdictionOptions(currentJurisdiction) {
      const options = this.abbrevService.listJurisdictionMenuOptions(currentJurisdiction);
      if (!currentJurisdiction) return options;
      if (options.some((option) => option.code === currentJurisdiction)) return options;
      return [{
        code: currentJurisdiction,
        label: this.abbrevService.formatJurisdictionDisplay(currentJurisdiction) || currentJurisdiction
      }, ...options];
    }
    _getCourtOptions(currentJurisdiction, currentCourtKey) {
      const options = this.abbrevService.listInstitutionPartOptionsForJurisdictionTree(currentJurisdiction);
      if (!currentCourtKey) return options;
      const hasExact = options.some((option) => !option.isChild && option.key === currentCourtKey && option.jurisdiction === currentJurisdiction);
      if (hasExact) return options;
      return [{
        key: currentCourtKey,
        label: this._formatCourtDisplay(currentCourtKey, currentJurisdiction),
        abbreviation: "",
        jurisdiction: currentJurisdiction || "us",
        isChild: false
      }, ...options];
    }
    _getDisplayedJurisdictionCode(item) {
      const mlzJurisdiction = this.Jurisdiction.getMLZJurisdiction?.(item) || "";
      if (mlzJurisdiction) return mlzJurisdiction;
      return this.Jurisdiction.fromItem(item);
    }
    _getDisplayedCourtKey(item) {
      return this.abbrevService.normalizeKey(item?.getField?.("court") || "");
    }
    _formatCourtDisplay(courtKey, jurisdiction) {
      const key = this.abbrevService.normalizeKey(courtKey || "");
      if (!key) return "";
      return this.abbrevService.formatInstitutionPartDisplay(key, jurisdiction) || String(courtKey || "");
    }
    _getStoredExtraPeople(item, extraPersonType) {
      return this.Jurisdiction.getMLZExtraCreatorsByType?.(item, extraPersonType.mlzType) || [];
    }
    _setStoredExtraPeople(item, extraPersonType, people) {
      if (!item?.setField) return;
      const extra = String(item.getField?.("extra") || "");
      const nextExtra = this.Jurisdiction.updateMLZExtraCreators?.call(
        this.Jurisdiction,
        extra,
        extraPersonType.mlzType,
        Array.isArray(people) ? people : []
      ) ?? extra;
      if (nextExtra !== extra) {
        item.setField("extra", nextExtra);
      }
    }
    _appendStoredExtraPerson(item, extraPersonType, person) {
      if (!person) return null;
      const people = this._getStoredExtraPeople(item, extraPersonType);
      people.push(person);
      this._setStoredExtraPeople(item, extraPersonType, people);
      return people.length - 1;
    }
    _setStoredExtraPersonAtIndex(item, extraPersonType, index, person) {
      if (!person) return;
      const people = this._getStoredExtraPeople(item, extraPersonType);
      const normalizedIndex = Number.isInteger(index) && index >= 0 ? index : people.length;
      people[normalizedIndex] = person;
      this._setStoredExtraPeople(item, extraPersonType, people.filter(Boolean));
    }
    _setStoredExtraPersonAtNearestIndex(item, extraPersonType, index, person) {
      if (!person) return null;
      const people = this._getStoredExtraPeople(item, extraPersonType);
      let normalizedIndex = Number.isInteger(index) && index >= 0 ? index : people.length;
      if (normalizedIndex > people.length) {
        const lastIndex = people.length - 1;
        normalizedIndex = lastIndex >= 0 && this._extraPersonLikelySameDraft(people[lastIndex], person) ? lastIndex : people.length;
      } else if (people[normalizedIndex] && !this._extraPersonLikelySameDraft(people[normalizedIndex], person)) {
        normalizedIndex = people.length;
      }
      people[normalizedIndex] = person;
      this._setStoredExtraPeople(item, extraPersonType, people.filter(Boolean));
      return normalizedIndex;
    }
    _extraPersonLikelySameDraft(left, right) {
      if (!left || !right) return false;
      const leftName = String(left.name || "").trim();
      const rightName = String(right.name || "").trim();
      if (leftName && rightName) return leftName === rightName;
      const leftLastName = String(left.lastName || "").trim();
      const rightLastName = String(right.lastName || "").trim();
      if (leftLastName && rightLastName) return leftLastName === rightLastName;
      const leftFirstName = String(left.firstName || "").trim();
      const rightFirstName = String(right.firstName || "").trim();
      return Boolean(leftFirstName && rightFirstName && leftFirstName === rightFirstName);
    }
    _removeStoredExtraPersonAtIndex(item, extraPersonType, index) {
      const people = this._getStoredExtraPeople(item, extraPersonType);
      if (!people.length) return;
      if (!Number.isInteger(index) || index < 0 || index >= people.length) return;
      people.splice(index, 1);
      this._setStoredExtraPeople(item, extraPersonType, people);
    }
    _formatStoredExtraPerson(person) {
      if (!person || typeof person !== "object") return "";
      if (person.name) return String(person.name).trim();
      const firstName = String(person.firstName || "").trim();
      const lastName = String(person.lastName || "").trim();
      return `${firstName}${firstName && lastName ? " " : ""}${lastName}`.trim();
    }
    _extraPersonFromCreatorFields(fields) {
      if (!fields || typeof fields !== "object") return null;
      const fieldMode = Number(fields.fieldMode) || 0;
      const name = String(fields.name || "").trim();
      const firstName = String(fields.firstName || "").trim();
      const lastName = String(fields.lastName || "").trim();
      if (name) return { name };
      if (!firstName && !lastName) return null;
      if (fieldMode === 1) {
        return { name: lastName || firstName };
      }
      return { firstName, lastName };
    }
    _extraPersonToCreatorData(person) {
      if (!person || typeof person !== "object") return null;
      if (person.name) {
        return {
          firstName: "",
          lastName: String(person.name || "").trim(),
          fieldMode: 1
        };
      }
      return {
        firstName: String(person.firstName || "").trim(),
        lastName: String(person.lastName || "").trim(),
        fieldMode: 0
      };
    }
    _getExtraPersonConfigByCreatorType(value) {
      const normalized = String(value || "").trim().toLowerCase();
      if (!normalized) return null;
      return this._extraPersonTypes.find((config) => {
        if (normalized === String(config.creatorTypeID).toLowerCase()) return true;
        if (normalized === String(config.creatorTypeName).toLowerCase()) return true;
        if (normalized === String(config.key).toLowerCase()) return true;
        if (normalized === String(config.label).toLowerCase()) return true;
        return normalized === String(this._getExtraPersonLabel(config)).toLowerCase();
      }) || null;
    }
    _getExtraPersonConfigBySyntheticCreatorType(value) {
      const normalized = String(value || "").trim().toLowerCase();
      if (!normalized) return null;
      return this._extraPersonTypes.find((config) => {
        if (normalized === String(config.creatorTypeID).toLowerCase()) return true;
        return normalized === String(config.creatorTypeName).toLowerCase();
      }) || null;
    }
    _getExtraPersonLabel(extraPersonType) {
      if (!extraPersonType?.key) return "";
      return this.schemaConfig?.getLocalizedCreatorLabel?.(extraPersonType.key, Zotero?.locale || "en-US") || extraPersonType.label || String(extraPersonType.key || "");
    }
    _getLocalizedItemTypeLabel(itemTypeName, locale = Zotero?.locale || "en-US") {
      const key = String(itemTypeName || "").trim();
      if (!key) return "";
      return this.schemaConfig?.getLocalizedItemTypeLabel?.(key, locale) || key;
    }
    _itemTypeSupportsExtraPerson(itemOrTypeID) {
      return this._getExtraPersonTypesForItemType(itemOrTypeID).length > 0;
    }
    _getExtraPersonTypesForItem(item) {
      return this._getExtraPersonTypesForItemType(item?.itemTypeID, item);
    }
    _getExtraPersonTypesForItemType(itemOrTypeID, item = null) {
      const itemTypeID = typeof itemOrTypeID === "object" ? itemOrTypeID?.itemTypeID : itemOrTypeID;
      const itemTypeName = item ? this._getItemTypeName(item) : this._getItemTypeNameByID(itemTypeID);
      if (!itemTypeName) return [];
      const creatorKeys = new Set(this.schemaConfig?.getCreatorKeysForItemType?.(itemTypeName) || []);
      if (!creatorKeys.size) return [];
      return this._extraPersonTypes.filter((config) => {
        return creatorKeys.has(config.key) && !this._itemTypeHasNativeCreator(itemTypeID, config.key);
      });
    }
    _itemTypeHasNativeCreator(itemTypeID, creatorKey) {
      const normalize = (value) => String(value || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
      const target = normalize(creatorKey);
      if (!target) return false;
      const creatorTypes = this._orig.creatorTypesGetTypesForItemType?.call(Zotero.CreatorTypes, itemTypeID) || Zotero?.CreatorTypes?.getTypesForItemType?.(itemTypeID) || [];
      for (const entry of creatorTypes) {
        if (normalize(entry?.name) === target) return true;
        const resolvedName = this._orig.creatorTypesGetName?.call(Zotero.CreatorTypes, entry?.id);
        if (normalize(resolvedName) === target) return true;
      }
      return false;
    }
    _getItemTypeName(item) {
      const nativeItemType = this._getItemTypeNameByID(item?.itemTypeID);
      const storedItemType = this._getStoredCustomItemTypeName(item);
      if (!storedItemType || !this.schemaConfig?.isCustomItemType?.(storedItemType)) {
        return nativeItemType;
      }
      const expectedNativeType = this.schemaConfig?.getBaseItemType?.(storedItemType) || "";
      return expectedNativeType === nativeItemType ? storedItemType : nativeItemType;
    }
    _getItemTypeNameByID(itemTypeID) {
      try {
        return Zotero?.ItemTypes?.getName?.(itemTypeID) || "";
      } catch (e) {
      }
      return "";
    }
    _getStoredCustomItemTypeName(item) {
      return String(this.Jurisdiction.getMLZItemType?.(item) || "").trim();
    }
    async _saveJurisdictionFromMenu(item, selectedCode) {
      try {
        const current = this.Jurisdiction.getMLZJurisdiction?.(item) || "";
        if (current === selectedCode) return;
        const extra = String(item.getField?.("extra") || "");
        const displayValue = this.abbrevService.formatJurisdictionDisplay(selectedCode);
        let nextExtra = this.Jurisdiction.updateMLZJurisdiction?.(extra, selectedCode, displayValue) ?? extra;
        nextExtra = this.Jurisdiction.updateMLZExtraField?.(nextExtra, "court", "") ?? nextExtra;
        if (nextExtra === extra && String(item.getField?.("court") || "").trim() === "") return;
        item.setField("extra", nextExtra);
        item.setField("court", "");
        await item.saveTx({ skipDateModifiedUpdate: true });
        this._scheduleActiveInfoPaneRefresh(75, true);
        try {
          Zotero.debug(`[Citation Phoenix] jurisdiction row saved: item=${String(item.id)} jurisdiction=${selectedCode}`);
        } catch (e) {
        }
      } catch (e) {
        try {
          Zotero.logError(e);
        } catch (_) {
        }
        try {
          Zotero.debug(`[Citation Phoenix] jurisdiction row save failed: ${String(e)}`);
        } catch (_) {
        }
      }
    }
    async _saveCourtFromMenu(item, selectedValue) {
      try {
        const sep = selectedValue.indexOf("||");
        const targetJurisdiction = sep >= 0 ? selectedValue.slice(0, sep).trim().toLowerCase() : null;
        const rawKey = sep >= 0 ? selectedValue.slice(sep + 2).trim() : selectedValue.trim();
        const normalizedKey = this.abbrevService.normalizeKey(rawKey);
        if (!normalizedKey) return;
        const currentCourtKey = this._getDisplayedCourtKey(item);
        const currentJurisdiction = this._getDisplayedJurisdictionCode(item);
        const jurisdictionChanged = targetJurisdiction && targetJurisdiction !== currentJurisdiction;
        const courtChanged = currentCourtKey !== normalizedKey;
        if (!jurisdictionChanged && !courtChanged) return;
        if (jurisdictionChanged) {
          const extra = String(item.getField?.("extra") || "");
          const displayValue = this.abbrevService.formatJurisdictionDisplay(targetJurisdiction);
          const updatedExtra = this.Jurisdiction.updateMLZJurisdiction?.(extra, targetJurisdiction, displayValue) ?? extra;
          item.setField("extra", updatedExtra);
          const targetOptions = this.abbrevService.listInstitutionPartOptionsForJurisdictionTree(targetJurisdiction);
          if (!targetOptions.length) {
            item.setField("court", "");
            await item.saveTx({ skipDateModifiedUpdate: true });
            this._scheduleActiveInfoPaneRefresh(75, true);
            try {
              Zotero.debug(`[Citation Phoenix] court row cleared for jurisdiction with no institution-part: item=${String(item.id)} jurisdiction=${targetJurisdiction}`);
            } catch (e) {
            }
            return;
          }
        }
        item.setField("court", normalizedKey);
        await item.saveTx({ skipDateModifiedUpdate: true });
        this._scheduleActiveInfoPaneRefresh(75, true);
        try {
          Zotero.debug(`[Citation Phoenix] court row saved: item=${String(item.id)} court=${normalizedKey} jurisdiction=${targetJurisdiction || "unchanged"}`);
        } catch (e) {
        }
      } catch (e) {
        try {
          Zotero.logError(e);
        } catch (_) {
        }
        try {
          Zotero.debug(`[Citation Phoenix] court row save failed: ${String(e)}`);
        } catch (_) {
        }
      }
    }
    _resolveNativeFieldName(itemTypeID, fieldName, baseField = null) {
      const direct = this._getNativeFieldNameForType(itemTypeID, fieldName);
      if (direct) return direct;
      if (!baseField) return null;
      return this._getFieldNameFromBaseForType(itemTypeID, baseField) || this._getNativeFieldNameForType(itemTypeID, baseField);
    }
    _getNativeFieldNameForType(itemTypeID, fieldName) {
      const name = String(fieldName || "").trim();
      if (!name) return null;
      try {
        const fieldID = Zotero?.ItemFields?.getID?.(name);
        if (!fieldID) return null;
        if (Zotero?.ItemFields?.isValidForType?.(fieldID, itemTypeID)) {
          return name;
        }
      } catch (e) {
      }
      return null;
    }
    _renderItemTypeField(infoBox) {
      const item = infoBox?.item;
      const row = this._findItemTypeRow(infoBox);
      if (!row || !item || item.deleted) return;
      const dataWrapper = row.querySelector(".meta-data");
      if (!dataWrapper) return;
      const displayedItemType = this._getItemTypeName(item);
      const displayedLabel = this._getLocalizedItemTypeLabel(displayedItemType);
      if (!displayedLabel) return;
      if (infoBox.editable) {
        const nativeOptions = this._getNativeItemTypeOptions(infoBox, row, item);
        if (!nativeOptions.length) return;
        dataWrapper.textContent = "";
        dataWrapper.appendChild(this._buildItemTypeMenuList(infoBox, item, nativeOptions));
        return;
      }
      if (!this.schemaConfig?.isCustomItemType?.(displayedItemType)) return;
      dataWrapper.textContent = "";
      if (typeof infoBox.createValueElement === "function") {
        const valueElem = infoBox.createValueElement({
          editable: false,
          text: displayedLabel,
          id: "itembox-field-item-type-value",
          attributes: {
            "aria-labelledby": "itembox-field-itemType-label",
            fieldname: "itemType",
            title: displayedItemType
          }
        });
        valueElem.value = displayedLabel;
        dataWrapper.appendChild(valueElem);
        return;
      }
      const input = row.ownerDocument.createElement("input");
      input.className = "value";
      input.readOnly = true;
      input.value = displayedLabel;
      input.title = displayedItemType;
      dataWrapper.appendChild(input);
    }
    _findItemTypeRow(infoBox) {
      return this._findInfoFieldRow(infoBox, "itemType") || this._findInfoFieldRow(infoBox, "itemTypeID") || infoBox?.querySelector?.('.meta-label[fieldname="itemType"]')?.closest?.(".meta-row") || infoBox?.querySelector?.('.meta-label[fieldname="itemTypeID"]')?.closest?.(".meta-row") || infoBox?.querySelector?.("#itembox-field-itemType-label")?.closest?.(".meta-row") || null;
    }
    _getNativeItemTypeOptions(infoBox, row, item) {
      const fromRow = this._extractNativeItemTypeOptionsFromRow(row, item);
      if (fromRow.length) return fromRow;
      const locale = Zotero?.locale || "en-US";
      const fallback = [];
      for (const itemTypeName of this.schemaConfig?.getKnownItemTypeNames?.() || []) {
        if (this.schemaConfig?.isCustomItemType?.(itemTypeName)) continue;
        fallback.push({
          kind: "native",
          value: this._getNativeItemTypeMenuValue(itemTypeName),
          label: this._getLocalizedItemTypeLabel(itemTypeName, locale),
          nativeType: itemTypeName
        });
      }
      return this._dedupeAndSortItemTypeOptions(fallback);
    }
    _extractNativeItemTypeOptionsFromRow(row, item) {
      const popup = row?.querySelector?.("menupopup");
      const out = [];
      for (const node of Array.from(popup?.children || [])) {
        if (node?.localName !== "menuitem") continue;
        if (node.hasAttribute?.("data-ibcslm-custom-item-type")) continue;
        const label = String(node.getAttribute("label") || "").trim();
        if (!label) continue;
        const value = String(
          node.getAttribute("value") || node.getAttribute("typeid") || node.value || ""
        ).trim();
        const nativeType = this._resolveNativeItemTypeName(value, label) || "";
        if (!nativeType) continue;
        out.push({
          kind: "native",
          value: value || this._getNativeItemTypeMenuValue(nativeType),
          label,
          nativeType
        });
      }
      if (out.length) return this._dedupeAndSortItemTypeOptions(out);
      const currentNativeType = this._getItemTypeNameByID(item?.itemTypeID);
      const currentLabel = this._getLocalizedItemTypeLabel(currentNativeType);
      if (!currentNativeType || !currentLabel) return [];
      return this._dedupeAndSortItemTypeOptions([{
        kind: "native",
        value: this._getNativeItemTypeMenuValue(currentNativeType),
        label: currentLabel,
        nativeType: currentNativeType
      }]);
    }
    _buildItemTypeMenuList(infoBox, item, nativeOptions) {
      const doc = infoBox.ownerDocument;
      const menulist = doc.createXULElement("menulist");
      menulist.id = "itembox-field-itemType-menu";
      menulist.className = "zotero-clicky keyboard-clickable";
      menulist.setAttribute("aria-labelledby", "itembox-field-itemType-label");
      menulist.setAttribute("fieldname", "itemType");
      menulist.style.flex = "1";
      const popup = menulist.appendChild(doc.createXULElement("menupopup"));
      const options = this._buildFullItemTypeOptions(nativeOptions);
      const optionIndex = /* @__PURE__ */ new Map();
      for (const option of options) {
        const optionKey = this._getItemTypeOptionKey(option);
        optionIndex.set(optionKey, option);
        const menuitem = doc.createXULElement("menuitem");
        menuitem.setAttribute("value", option.value);
        menuitem.setAttribute("label", option.label);
        menuitem.setAttribute("tooltiptext", option.kind === "custom" ? option.itemType : option.nativeType);
        menuitem.setAttribute("data-ibcslm-option-key", optionKey);
        if (option.kind === "custom") {
          menuitem.setAttribute("data-ibcslm-custom-item-type", option.itemType);
        }
        menuitem.addEventListener("command", async () => {
          menulist.value = option.value;
          menulist.setAttribute("label", option.label);
          menulist.setAttribute("data-ibcslm-option-key", optionKey);
          await this._saveItemTypeSelection(item, option);
        });
        popup.appendChild(menuitem);
      }
      const currentOption = this._getCurrentItemTypeOption(item, nativeOptions);
      if (currentOption) {
        menulist.value = currentOption.value;
        menulist.setAttribute("label", currentOption.label);
        menulist.setAttribute("data-ibcslm-option-key", this._getItemTypeOptionKey(currentOption));
      }
      const saveSelection = async () => {
        const selectedKey = String(
          menulist.selectedItem?.getAttribute?.("data-ibcslm-option-key") || menulist.getAttribute?.("data-ibcslm-option-key") || ""
        ).trim();
        const selectedOption = optionIndex.get(selectedKey);
        if (!selectedOption) return;
        menulist.value = selectedOption.value;
        menulist.setAttribute("label", selectedOption.label);
        menulist.setAttribute("data-ibcslm-option-key", selectedKey);
        await this._saveItemTypeSelection(item, selectedOption);
      };
      popup.addEventListener("command", saveSelection);
      return menulist;
    }
    _buildFullItemTypeOptions(nativeOptions) {
      const locale = Zotero?.locale || "en-US";
      const customByBase = /* @__PURE__ */ new Map();
      for (const option of this.schemaConfig?.getCustomItemTypeOptions?.(locale) || []) {
        const baseType = String(option.baseItemType || "").trim();
        if (!baseType) continue;
        if (!customByBase.has(baseType)) customByBase.set(baseType, []);
        customByBase.get(baseType).push({
          kind: "custom",
          value: this._getCustomItemTypeMenuValue(option.itemType),
          label: option.label,
          itemType: option.itemType,
          nativeType: baseType,
          zoteroValue: this._getNativeItemTypeMenuValue(baseType)
        });
      }
      const out = [];
      const seenCustom = /* @__PURE__ */ new Set();
      for (const nativeOption of nativeOptions) {
        out.push(nativeOption);
        const customOptions = customByBase.get(nativeOption.nativeType) || [];
        for (const customOption of customOptions) {
          if (seenCustom.has(customOption.itemType)) continue;
          seenCustom.add(customOption.itemType);
          out.push(customOption);
        }
      }
      for (const options of customByBase.values()) {
        for (const customOption of options) {
          if (seenCustom.has(customOption.itemType)) continue;
          seenCustom.add(customOption.itemType);
          out.push(customOption);
        }
      }
      return this._dedupeAndSortItemTypeOptions(out);
    }
    _dedupeAndSortItemTypeOptions(options) {
      const byValue = /* @__PURE__ */ new Map();
      for (const option of Array.isArray(options) ? options : []) {
        const value = String(this._getItemTypeOptionKey(option) || "").trim();
        const label = String(option?.label || "").trim();
        if (!value || !label) continue;
        const existing = byValue.get(value);
        if (!existing) {
          byValue.set(value, { ...option, value, label });
          continue;
        }
        const existingLabel = String(existing.label || "").trim();
        if (label.length > existingLabel.length) {
          byValue.set(value, { ...existing, ...option, value, label });
        }
      }
      return Array.from(byValue.values()).sort((a, b) => {
        const labelCompare = String(a.label || "").localeCompare(String(b.label || ""), void 0, { sensitivity: "base" });
        if (labelCompare) return labelCompare;
        return String(a.value || "").localeCompare(String(b.value || ""), void 0, { sensitivity: "base" });
      });
    }
    _getItemTypeOptionKey(option) {
      if (!option) return "";
      if (option.kind === "custom") {
        return this._getCustomItemTypeMenuValue(option.itemType);
      }
      return String(option.nativeType || option.value || "").trim();
    }
    _getCurrentItemTypeOption(item, nativeOptions) {
      const itemTypeName = this._getItemTypeName(item);
      if (this.schemaConfig?.isCustomItemType?.(itemTypeName)) {
        const baseItemType = this.schemaConfig?.getBaseItemType?.(itemTypeName) || "";
        return {
          kind: "custom",
          itemType: itemTypeName,
          nativeType: baseItemType,
          value: this._getCustomItemTypeMenuValue(itemTypeName),
          zoteroValue: this._getNativeItemTypeMenuValue(baseItemType),
          label: this._getLocalizedItemTypeLabel(itemTypeName)
        };
      }
      const nativeItemType = this._getItemTypeNameByID(item?.itemTypeID);
      const direct = nativeOptions.find((option) => option.nativeType === nativeItemType);
      return direct || {
        kind: "native",
        nativeType: nativeItemType,
        value: this._getNativeItemTypeMenuValue(nativeItemType),
        zoteroValue: this._getNativeItemTypeMenuValue(nativeItemType),
        label: this._getLocalizedItemTypeLabel(nativeItemType)
      };
    }
    _getNativeItemTypeMenuValue(itemTypeName) {
      const key = String(itemTypeName || "").trim();
      if (!key) return "";
      try {
        const itemTypeID = Zotero?.ItemTypes?.getID?.(key);
        if (itemTypeID != null && itemTypeID !== "") return String(itemTypeID);
      } catch (e) {
      }
      return key;
    }
    _getCustomItemTypeMenuValue(itemTypeName) {
      const key = String(itemTypeName || "").trim();
      return key ? `${this._customItemTypeMenuValuePrefix}${key}` : "";
    }
    _parseCustomItemTypeMenuValue(value) {
      const raw = String(value || "").trim();
      if (!raw.startsWith(this._customItemTypeMenuValuePrefix)) return "";
      return raw.slice(this._customItemTypeMenuValuePrefix.length).trim();
    }
    _resolveNativeItemTypeName(value, label = "") {
      const rawValue = String(value || "").trim();
      if (rawValue) {
        try {
          const byNumericID = /^\d+$/.test(rawValue) ? Zotero?.ItemTypes?.getName?.(Number(rawValue)) : null;
          if (byNumericID) return String(byNumericID).trim();
        } catch (e) {
        }
        try {
          const byDirectName = Zotero?.ItemTypes?.getID?.(rawValue) != null ? rawValue : "";
          if (byDirectName) return String(byDirectName).trim();
        } catch (e) {
        }
      }
      const normalizedLabel = String(label || "").trim().toLowerCase();
      if (!normalizedLabel) return "";
      try {
        for (const itemType of Zotero?.ItemTypes?.getTypes?.() || []) {
          const itemTypeName = String(itemType?.name || "").trim();
          const itemTypeID = itemType?.id;
          const candidateLabel = String(Zotero?.ItemTypes?.getLocalizedString?.(itemTypeID) || "").trim().toLowerCase();
          if (itemTypeName && candidateLabel && candidateLabel === normalizedLabel) {
            return itemTypeName;
          }
        }
      } catch (e) {
      }
      for (const itemTypeName of this.schemaConfig?.getKnownItemTypeNames?.() || []) {
        if (this.schemaConfig?.isCustomItemType?.(itemTypeName)) continue;
        const candidateLabel = this._getLocalizedItemTypeLabel(itemTypeName).trim().toLowerCase();
        if (candidateLabel && candidateLabel === normalizedLabel) {
          return itemTypeName;
        }
      }
      return "";
    }
    async _saveItemTypeSelection(item, option) {
      if (!item || !option) return;
      const targetNativeType = String(option.nativeType || "").trim();
      const targetCustomType = option.kind === "custom" ? String(option.itemType || "").trim() : "";
      const currentNativeType = this._getItemTypeNameByID(item.itemTypeID);
      const currentCustomType = this._getStoredCustomItemTypeName(item);
      if (currentNativeType === targetNativeType && currentCustomType === targetCustomType) return;
      try {
        if (targetNativeType && currentNativeType !== targetNativeType) {
          await this._setNativeItemType(item, targetNativeType);
        }
        const extra = String(item.getField?.("extra") || "");
        const nextExtra = this.Jurisdiction.updateMLZItemType?.(extra, targetCustomType) ?? extra;
        if (nextExtra !== extra) {
          item.setField("extra", nextExtra);
        }
        await item.saveTx({ skipDateModifiedUpdate: true });
        this._scheduleActiveInfoPaneRefresh(75, true);
        try {
          Zotero.debug(`[Citation Phoenix] item type saved: item=${String(item.id || "")} native=${targetNativeType} custom=${targetCustomType || "(none)"}`);
        } catch (e) {
        }
      } catch (e) {
        try {
          Zotero.logError(e);
        } catch (_) {
        }
        try {
          Zotero.debug(`[Citation Phoenix] item type save failed: ${String(e)}`);
        } catch (_) {
        }
      }
    }
    async _setNativeItemType(item, targetItemTypeName) {
      const target = String(targetItemTypeName || "").trim();
      if (!item || !target) return;
      const targetID = Zotero?.ItemTypes?.getID?.(target);
      if (typeof item.setType === "function") {
        const result = item.setType(targetID ?? target);
        if (result && typeof result.then === "function") {
          await result;
        }
        return;
      }
      if (targetID != null && "itemTypeID" in item) {
        item.itemTypeID = targetID;
        return;
      }
      throw new Error(`Unable to set native item type to ${target}`);
    }
    _renderSchemaFieldRows(infoBox) {
      const item = infoBox?.item;
      if (!item || item.deleted) {
        this._cleanupRegisteredSchemaInfoRows(infoBox);
        return;
      }
      this._removeSchemaFieldRows(infoBox);
      this._resetSchemaHiddenBaseRows(infoBox);
      const table = this._getInfoTable(infoBox);
      if (!table) return;
      const itemTypeName = this._getItemTypeName(item);
      const definitions = this.schemaConfig?.getFieldDefinitionsForItemType?.(itemTypeName) || [];
      for (const definition of definitions) {
        if (!this._shouldUseSchemaInfoRow(item, definition)) continue;
        const row = this._buildSchemaFieldRow(infoBox, item, definition, !!infoBox.editable);
        if (!row) continue;
        table.appendChild(row);
        this._hideSchemaBaseFieldRow(infoBox, item, definition);
      }
      this._applySchemaSequence(infoBox);
    }
    _cleanupRegisteredSchemaInfoRows(infoBox) {
      this._removeSchemaFieldRows(infoBox);
      this._resetSchemaHiddenBaseRows(infoBox);
    }
    _resetRegisteredSchemaInfoRows(infoBox) {
      this._removeSchemaFieldRows(infoBox);
    }
    _findSchemaInfoRow(infoBox, fieldName) {
      return infoBox?.querySelector?.(
        `[data-ibcslm-schema-field-row="true"][data-ibcslm-schema-field="${String(fieldName || "").trim()}"]`
      ) || null;
    }
    _buildSchemaFieldRow(infoBox, item, definition, editable) {
      const fieldName = String(definition?.field || "").trim();
      if (!fieldName) return null;
      const doc = infoBox?.ownerDocument;
      if (!doc) return null;
      const row = doc.createElement("div");
      row.id = this._getSchemaInfoRowID(fieldName);
      row.className = "meta-row";
      row.setAttribute("data-ibcslm-schema-field-row", "true");
      row.setAttribute("data-ibcslm-schema-field", fieldName);
      const labelWrapper = doc.createElement("div");
      labelWrapper.className = "meta-label";
      labelWrapper.setAttribute("fieldname", fieldName);
      let label;
      if (typeof infoBox.createLabelElement === "function") {
        label = infoBox.createLabelElement({
          id: `itembox-field-${fieldName}-label`,
          text: this._getSchemaFieldLabel(fieldName)
        });
      } else {
        label = doc.createElement("label");
        label.id = `itembox-field-${fieldName}-label`;
        label.textContent = this._getSchemaFieldLabel(fieldName);
      }
      labelWrapper.appendChild(label);
      const valueWrapper = doc.createElement("div");
      valueWrapper.className = "meta-data";
      const storedValue = this._getSchemaFieldValue(item, fieldName, this.Jurisdiction.getMLZExtraFields?.(item) || null);
      if (this._isSchemaFlagField(fieldName)) {
        valueWrapper.appendChild(this._buildSchemaCheckboxValueControl(
          doc,
          item,
          definition,
          storedValue,
          editable
        ));
      } else {
        const displayValue = definition?.kind === "date" ? this._formatSchemaDateDisplay(storedValue) : String(storedValue || "");
        if (editable) {
          valueWrapper.appendChild(this._buildSchemaValueControl(infoBox, item, definition, storedValue, displayValue));
        } else if (typeof infoBox.createValueElement === "function") {
          const valueElem = infoBox.createValueElement({
            editable: false,
            text: displayValue,
            id: `itembox-field-${fieldName}-value`,
            attributes: {
              "aria-labelledby": `itembox-field-${fieldName}-label`,
              fieldname: fieldName,
              title: String(storedValue || "")
            }
          });
          valueElem.value = displayValue;
          valueWrapper.appendChild(valueElem);
        } else {
          const input = doc.createElement("input");
          input.className = "value";
          input.readOnly = true;
          input.value = displayValue;
          input.title = String(storedValue || "");
          valueWrapper.appendChild(input);
        }
      }
      row.appendChild(labelWrapper);
      row.appendChild(valueWrapper);
      return row;
    }
    _hideSchemaBaseFieldRow(infoBox, item, definition) {
      const fieldName = String(definition?.field || "").trim();
      if (!fieldName || !definition?.baseField) return;
      if (definition.kind !== "field") return;
      const nativeFieldName = this._resolveNativeFieldName(item.itemTypeID, fieldName, definition.baseField);
      if (!nativeFieldName || nativeFieldName === fieldName) return;
      if (["title", "caseName"].includes(nativeFieldName)) return;
      const row = this._findInfoFieldRow(infoBox, nativeFieldName);
      if (!row) return;
      row.hidden = true;
      row.setAttribute("data-ibcslm-schema-hidden-base-row", "true");
    }
    _resetSchemaHiddenBaseRows(infoBox) {
      for (const row of infoBox?.querySelectorAll?.('[data-ibcslm-schema-hidden-base-row="true"]') || []) {
        row.hidden = false;
        row.removeAttribute("data-ibcslm-schema-hidden-base-row");
      }
    }
    _applySchemaSequence(infoBox) {
      const table = this._getInfoTable(infoBox);
      if (!table) return;
      const sequence = this.schemaConfig?.getSequenceForItemType?.(this._getItemTypeName(infoBox?.item)) || [];
      let anchor = null;
      for (let idx = sequence.length - 1; idx >= 0; idx -= 1) {
        const row = this._findInfoFieldRow(infoBox, sequence[idx]);
        if (!row || row.hidden || row.parentNode !== table) continue;
        if (anchor && row.nextSibling !== anchor) {
          table.insertBefore(row, anchor);
        }
        anchor = row;
      }
      const firstFieldName = String(sequence[0] || "").trim();
      if (!firstFieldName) return;
      const firstRow = this._findInfoFieldRow(infoBox, firstFieldName);
      const itemTypeRow = this._findItemTypeRow(infoBox);
      if (!firstRow || !itemTypeRow) return;
      if (firstRow.hidden || firstRow.parentNode !== table || itemTypeRow.parentNode !== table) return;
      const desiredPosition = itemTypeRow.nextSibling;
      if (desiredPosition !== firstRow) {
        table.insertBefore(firstRow, desiredPosition);
      }
    }
    _getFieldNameFromBaseForType(itemTypeID, baseField) {
      const name = String(baseField || "").trim();
      if (!name) return null;
      try {
        const baseFieldID = Zotero?.ItemFields?.getID?.(name);
        if (!baseFieldID) return null;
        const typeFieldID = Zotero?.ItemFields?.getFieldIDFromTypeAndBase?.(itemTypeID, baseFieldID);
        if (!typeFieldID) return null;
        return Zotero?.ItemFields?.getName?.(typeFieldID) || null;
      } catch (e) {
      }
      return null;
    }
    _getLocalizedBuiltinLabel(key) {
      if (key === "jurisdiction") {
        return this._getSchemaFieldLabel("jurisdiction");
      }
      const locale = Zotero?.locale || "en-US";
      const candidates = getLocaleCandidates(locale);
      const translations = {
        customCourt: {
          de: "Benutzerdefiniertes Gericht",
          "de-de": "Benutzerdefiniertes Gericht",
          "de-at": "Benutzerdefiniertes Gericht",
          "de-ch": "Benutzerdefiniertes Gericht",
          en: "Custom Court",
          us: "Custom Court"
        },
        customCourtPlaceholder: {
          de: "Benutzerdefinierten Gerichtsschluessel eingeben",
          "de-de": "Benutzerdefinierten Gerichtsschluessel eingeben",
          "de-at": "Benutzerdefinierten Gerichtsschluessel eingeben",
          "de-ch": "Benutzerdefinierten Gerichtsschluessel eingeben",
          en: "Enter custom court key",
          us: "Enter custom court key"
        },
        setButton: {
          de: "Setzen",
          "de-de": "Setzen",
          "de-at": "Setzen",
          "de-ch": "Setzen",
          en: "Set",
          us: "Set"
        }
      };
      const table = translations[key] || {};
      for (const candidate of candidates) {
        if (table[candidate]) return table[candidate];
      }
      return table.en || String(key || "");
    }
    _normalizeJurisdictionValue(value) {
      const raw = String(value || "").trim();
      if (!raw) return "";
      return this.Jurisdiction?._normalizeJurisdiction?.(raw) || raw.toLowerCase();
    }
    _getSchemaFieldValue(item, fieldName, mlzFields = null) {
      if (!item) return "";
      const itemTypeName = this._getItemTypeName(item);
      const definition = this.schemaConfig?.getFieldDefinition?.(itemTypeName, fieldName) || null;
      const nativeFieldName = this._resolveNativeFieldName(item.itemTypeID, fieldName, definition?.baseField);
      if (fieldName === "jurisdiction") {
        const nativeValue2 = nativeFieldName ? this._normalizeJurisdictionValue(item.getField?.(nativeFieldName)) : "";
        if (nativeValue2) return nativeValue2;
        return this.Jurisdiction.getMLZJurisdiction?.(item) || "";
      }
      const nativeValue = nativeFieldName ? String(item.getField?.(nativeFieldName) || "").trim() : "";
      if (nativeValue) return nativeValue;
      if (fieldName === "court") {
        return this.abbrevService.normalizeKey(mlzFields?.court || "");
      }
      return String(mlzFields?.[fieldName] || "").trim();
    }
    _hasCSLValue(value) {
      if (value == null) return false;
      if (Array.isArray(value)) return value.length > 0;
      if (typeof value === "string") return value.trim() !== "";
      if (typeof value === "object") return Object.keys(value).length > 0;
      return true;
    }
    _getFirstSchemaFieldValue(item, fieldNames, mlzFields = null) {
      for (const fieldName of Array.isArray(fieldNames) ? fieldNames : []) {
        const value = this._getSchemaFieldValue(item, fieldName, mlzFields);
        if (this._hasCSLValue(value)) return value;
      }
      return "";
    }
    _assignCSLFieldValue(cslItem, cslField, value) {
      if (!this._hasCSLValue(value)) return;
      if (cslField === "authority") {
        cslItem.authority = [{ literal: String(value).trim() }];
        return;
      }
      cslItem[cslField] = value;
    }
    _parseRawDateToCSL(value) {
      const raw = String(value || "").trim();
      if (!raw) return null;
      const isoMatch = raw.match(/^(\d{4})(?:[-/](\d{1,2})(?:[-/](\d{1,2}))?)?$/);
      if (isoMatch) {
        const year = Number(isoMatch[1]);
        const month = isoMatch[2] ? Number(isoMatch[2]) : null;
        const day = isoMatch[3] ? Number(isoMatch[3]) : null;
        const parts = [year];
        if (month) parts.push(month);
        if (day) parts.push(day);
        return { "date-parts": [parts], raw };
      }
      return { raw };
    }
    _getSchemaFieldLabel(fieldName) {
      const raw = String(fieldName || "").trim();
      if (!raw) return "";
      return this.schemaConfig?.getLocalizedFieldLabel?.(raw, Zotero?.locale || "en-US") || raw;
    }
    _isSchemaFlagField(fieldName) {
      return /Flag$/.test(String(fieldName || "").trim());
    }
    _coerceSchemaFlagValue(value) {
      const normalized = String(value == null ? "" : value).trim().toLowerCase();
      return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
    }
    _serializeSchemaFlagValue(checked) {
      return checked ? "true" : "";
    }
    _formatSchemaDateDisplay(value) {
      const raw = String(value || "").trim();
      if (!raw) return "";
      const ymd = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      if (ymd) {
        const date = new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));
        return new Intl.DateTimeFormat(this._getSchemaLocale()).format(date);
      }
      const ym = raw.match(/^(\d{4})-(\d{1,2})$/);
      if (ym) {
        const date = new Date(Number(ym[1]), Number(ym[2]) - 1, 1);
        return new Intl.DateTimeFormat(this._getSchemaLocale(), {
          year: "numeric",
          month: "numeric"
        }).format(date);
      }
      const y = raw.match(/^(\d{4})$/);
      if (y) return y[1];
      return raw;
    }
    _normalizeSchemaDateInput(value) {
      const raw = String(value || "").trim();
      if (!raw) return "";
      const isoLike = raw.match(/^(\d{4})(?:[-/.\s](\d{1,2})(?:[-/.\s](\d{1,2}))?)?$/);
      if (isoLike) {
        return this._serializeSchemaDateParts(isoLike[1], isoLike[2] || "", isoLike[3] || "");
      }
      const localizedNumeric = this._parseSchemaNumericDate(raw);
      if (localizedNumeric) return localizedNumeric;
      const monthNameDate = this._parseSchemaMonthNameDate(raw);
      if (monthNameDate) return monthNameDate;
      return raw;
    }
    _getSchemaLocale() {
      return Zotero?.locale || "en-US";
    }
    _getSchemaLocaleDateOrder() {
      try {
        const parts = new Intl.DateTimeFormat(this._getSchemaLocale()).formatToParts(new Date(2001, 10, 22)).filter((part) => ["day", "month", "year"].includes(part.type)).map((part) => part.type);
        return parts.length ? parts : ["month", "day", "year"];
      } catch (e) {
      }
      return ["month", "day", "year"];
    }
    _getSchemaDatePlaceholder() {
      const order = this._getSchemaLocaleDateOrder();
      const mapping = {
        day: "DD",
        month: "MM",
        year: "YYYY"
      };
      return order.map((part) => mapping[part] || part.toUpperCase()).join("/");
    }
    _serializeSchemaDateParts(year, month = "", day = "") {
      const yyyy = String(year || "").trim();
      const mm = String(month || "").trim();
      const dd = String(day || "").trim();
      if (!/^\d{4}$/.test(yyyy)) return "";
      if (!mm) return yyyy;
      const monthNumber = Number(mm);
      if (!(monthNumber >= 1 && monthNumber <= 12)) return "";
      if (!dd) return `${yyyy}-${String(monthNumber).padStart(2, "0")}`;
      const dayNumber = Number(dd);
      if (!(dayNumber >= 1 && dayNumber <= 31)) return "";
      return `${yyyy}-${String(monthNumber).padStart(2, "0")}-${String(dayNumber).padStart(2, "0")}`;
    }
    _parseSchemaNumericDate(raw) {
      const parts = raw.split(/[\/.\-\s]+/).map((part) => String(part || "").trim()).filter(Boolean);
      if (parts.length < 2 || parts.length > 3) return "";
      const tryOrders = [];
      const localeOrder = this._getSchemaLocaleDateOrder();
      if (parts.length === 3) {
        tryOrders.push(localeOrder);
        tryOrders.push(["month", "day", "year"]);
        tryOrders.push(["day", "month", "year"]);
        tryOrders.push(["year", "month", "day"]);
      } else if (parts.length === 2) {
        tryOrders.push(["year", "month"]);
        tryOrders.push(["month", "year"]);
      }
      for (const order of tryOrders) {
        const parsed = this._tryParseSchemaDateWithOrder(parts, order);
        if (parsed) return parsed;
      }
      return "";
    }
    _tryParseSchemaDateWithOrder(parts, order) {
      const values = {};
      for (let idx = 0; idx < Math.min(parts.length, order.length); idx += 1) {
        values[order[idx]] = parts[idx];
      }
      const year = String(values.year || "").trim();
      const month = String(values.month || "").trim();
      const day = String(values.day || "").trim();
      if (!year || !/^\d{4}$/.test(year)) return "";
      if (!month || !/^\d{1,2}$/.test(month)) return "";
      if (day && !/^\d{1,2}$/.test(day)) return "";
      return this._serializeSchemaDateParts(year, month, day);
    }
    _parseSchemaMonthNameDate(raw) {
      const monthMap = {
        january: "01",
        jan: "01",
        february: "02",
        feb: "02",
        march: "03",
        mar: "03",
        april: "04",
        apr: "04",
        may: "05",
        june: "06",
        jun: "06",
        july: "07",
        jul: "07",
        august: "08",
        aug: "08",
        september: "09",
        sept: "09",
        sep: "09",
        october: "10",
        oct: "10",
        november: "11",
        nov: "11",
        december: "12",
        dec: "12"
      };
      const normalized = raw.replace(/,/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
      let match = normalized.match(/^([a-z]+)\s+(\d{1,2})\s+(\d{4})$/);
      if (match) {
        const month = monthMap[match[1]];
        if (month) return this._serializeSchemaDateParts(match[3], month, match[2]);
      }
      match = normalized.match(/^(\d{1,2})\s+([a-z]+)\s+(\d{4})$/);
      if (match) {
        const month = monthMap[match[2]];
        if (month) return this._serializeSchemaDateParts(match[3], month, match[1]);
      }
      match = normalized.match(/^([a-z]+)\s+(\d{4})$/);
      if (match) {
        const month = monthMap[match[1]];
        if (month) return this._serializeSchemaDateParts(match[2], month, "");
      }
      return "";
    }
    _readSchemaControlValue(node) {
      if (!node) return "";
      if (typeof node.value !== "undefined") return String(node.value || "").trim();
      return String(node.textContent || "").trim();
    }
    _buildSchemaValueControl(infoBox, item, definition, value, displayValue) {
      const fieldName = String(definition?.field || "").trim();
      if (typeof infoBox?.createValueElement === "function") {
        const valueElem = infoBox.createValueElement({
          editable: true,
          text: displayValue,
          id: `itembox-field-${fieldName}-input`,
          attributes: {
            "aria-labelledby": `itembox-field-${fieldName}-label`,
            fieldname: fieldName,
            title: displayValue
          }
        });
        valueElem.value = displayValue;
        if (definition?.kind === "date") {
          valueElem.setAttribute?.("placeholder", this._getSchemaDatePlaceholder());
        }
        const saveValue2 = async () => {
          let nextValue = this._readSchemaControlValue(valueElem);
          if (definition?.kind === "date") {
            nextValue = this._normalizeSchemaDateInput(nextValue);
          }
          await this._saveSchemaFieldValue(item, definition, nextValue);
        };
        valueElem.addEventListener?.("change", saveValue2);
        valueElem.addEventListener?.("blur", saveValue2);
        valueElem.addEventListener?.("keydown", (event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          saveValue2();
        });
        return valueElem;
      }
      const doc = infoBox?.ownerDocument;
      const input = doc.createElement("input");
      input.className = "value";
      input.id = `itembox-field-${fieldName}-input`;
      input.setAttribute("fieldname", fieldName);
      input.setAttribute("aria-labelledby", `itembox-field-${fieldName}-label`);
      input.value = displayValue;
      if (definition?.kind === "date") {
        input.placeholder = this._getSchemaDatePlaceholder();
      }
      input.style.maxWidth = "22em";
      const saveValue = async () => {
        let nextValue = String(input.value || "").trim();
        if (definition?.kind === "date") {
          nextValue = this._normalizeSchemaDateInput(nextValue);
        }
        await this._saveSchemaFieldValue(item, definition, nextValue);
      };
      input.addEventListener("change", saveValue);
      input.addEventListener("blur", saveValue);
      input.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        saveValue();
      });
      return input;
    }
    _buildSchemaCheckboxValueControl(doc, item, definition, value, editable) {
      const fieldName = String(definition?.field || "").trim();
      if (typeof doc.createXULElement === "function") {
        const checkbox = doc.createXULElement("checkbox");
        checkbox.id = `itembox-field-${fieldName}-input`;
        checkbox.checked = this._coerceSchemaFlagValue(value);
        checkbox.disabled = !editable;
        checkbox.addEventListener("command", async () => {
          if (checkbox.disabled) return;
          await this._saveSchemaFieldValue(item, definition, this._serializeSchemaFlagValue(!!checkbox.checked));
        });
        return checkbox;
      }
      const input = doc.createElement("input");
      input.type = "checkbox";
      input.id = `itembox-field-${fieldName}-input`;
      input.checked = this._coerceSchemaFlagValue(value);
      input.disabled = !editable;
      input.addEventListener("change", async () => {
        if (input.disabled) return;
        await this._saveSchemaFieldValue(item, definition, this._serializeSchemaFlagValue(input.checked));
      });
      return input;
    }
    async _saveSchemaFieldValue(item, definition, rawValue) {
      if (!item?.setField || !definition?.field) return;
      const fieldName = String(definition.field || "").trim();
      const nativeFieldName = this._resolveNativeFieldName(item.itemTypeID, fieldName, definition.baseField);
      const value = String(rawValue == null ? "" : rawValue).trim();
      const extra = String(item.getField?.("extra") || "");
      let nextExtra = extra;
      let changed = false;
      if (fieldName === "jurisdiction") {
        const normalized = this._normalizeJurisdictionValue(value);
        const displayValue = this.abbrevService.formatJurisdictionDisplay(normalized);
        nextExtra = this.Jurisdiction.updateMLZJurisdiction?.(extra, normalized, displayValue) ?? extra;
        if (nativeFieldName) {
          item.setField(nativeFieldName, normalized);
          changed = true;
        }
      } else {
        if (nativeFieldName) {
          item.setField(nativeFieldName, value);
          changed = true;
        }
        nextExtra = this.Jurisdiction.updateMLZExtraField?.(nextExtra, fieldName, value) ?? nextExtra;
      }
      if (nextExtra !== extra) {
        item.setField("extra", nextExtra);
        changed = true;
      }
      if (!changed) return;
      await item.saveTx({ skipDateModifiedUpdate: true });
      try {
        this._scheduleActiveInfoPaneRefresh(75, !!nativeFieldName);
      } catch (e) {
      }
    }
    _patchRetrieveItem() {
      const sysProto = Zotero?.Cite?.System?.prototype;
      if (!sysProto?.retrieveItem) return;
      this._orig.retrieveItem = sysProto.retrieveItem;
      const self = this;
      sysProto.retrieveItem = function(id) {
        const cslItem = self._orig.retrieveItem.call(this, id);
        if (cslItem && typeof cslItem.then === "function") {
          return cslItem.then((item) => self._decorateCSLItem(item, id));
        }
        return self._decorateCSLItem(cslItem, id);
      };
    }
    _decorateCSLItem(cslItem, id) {
      if (Array.isArray(cslItem)) {
        if (Array.isArray(id)) {
          return cslItem.map((item, idx) => this._decorateCSLItem(item, id[idx]));
        }
        return cslItem.map((item) => this._decorateCSLItem(item, id));
      }
      if (!cslItem || typeof cslItem !== "object") {
        try {
          this._logRetrieveItemDetails(id, null, "non-object return");
          this._warnRetrieveItem(`retrieveItem returned non-object for id ${id}`);
        } catch (e) {
        }
        return cslItem;
      }
      cslItem = { ...cslItem };
      const normalizedID = this._normalizeItemID(id);
      if (normalizedID != null) cslItem.id = String(normalizedID);
      this._logRetrieveItemDetails(id, cslItem.id, "ok");
      try {
        const zotItem = this._getZoteroItemByAnyID(id);
        if (zotItem) {
          this._hydrateCSLItemFromZotero(cslItem, zotItem);
          const jur = this.Jurisdiction.fromItem(zotItem);
          cslItem.jurisdiction = jur;
          cslItem.country = jur.split(":")[0];
          this._decorateShortForms(cslItem, jur);
          this._sanitizeCSLControlFields(cslItem);
          this._logCitationItemData(cslItem, zotItem, "retrieveItem");
          this._logRenderProbeFromItem(cslItem, jur, "retrieveItem");
        } else {
          this._logField("missing-zotero-item", `id=${String(id)}`);
        }
      } catch (e) {
        this._warnRetrieveItem(String(e));
      }
      return cslItem;
    }
    _getZoteroItemByAnyID(id) {
      try {
        let zotItem = Zotero.Items.get(id);
        if (zotItem) return zotItem;
        if (typeof id === "string" && /^\d+$/.test(id)) {
          zotItem = Zotero.Items.get(Number(id));
          if (zotItem) return zotItem;
        }
        if (typeof id === "object" && id && id.id != null) {
          zotItem = Zotero.Items.get(id.id);
          if (zotItem) return zotItem;
        }
      } catch (e) {
      }
      return null;
    }
    _hydrateCSLItemFromZotero(cslItem, zotItem) {
      try {
        const mlzFields = this.Jurisdiction.getMLZExtraFields?.(zotItem) || null;
        const schemaItemType = this._getItemTypeName(zotItem);
        const mappedCSLType = this.schemaConfig?.getCSLTypeForItemType?.(schemaItemType) || "";
        const isCustomSchemaItemType = this.schemaConfig?.isCustomItemType?.(schemaItemType) || false;
        if (mappedCSLType && isCustomSchemaItemType) {
          cslItem.type = mappedCSLType;
        }
        if (!cslItem.title) {
          const title = zotItem.getField?.("title");
          if (title) cslItem.title = title;
        }
        if (!cslItem["container-title"]) {
          const containerTitle = zotItem.getField?.("publicationTitle") || zotItem.getField?.("reporter") || zotItem.getField?.("report") || mlzFields?.reporter || "";
          if (containerTitle) cslItem["container-title"] = containerTitle;
          else this._logField("missing-container-title-source", `itemType=${String(cslItem.type)} title=${String(cslItem.title || "")}`);
        }
        const journalAbbr = String(
          zotItem.getField?.("journalAbbreviation") || zotItem.getField?.("journalAbbr") || ""
        ).trim();
        if (journalAbbr) {
          const normalizedContainerTitle = this.abbrevService.normalizeKey(cslItem["container-title"] || "");
          if (normalizedContainerTitle) {
            this._journalAbbrByContainerTitleKey.set(normalizedContainerTitle, journalAbbr);
          }
          const hadShort = !!String(cslItem["container-title-short"] || "").trim();
          cslItem["container-title-short"] = journalAbbr;
          this._logShortForm(
            "container-title",
            cslItem["container-title"] || "",
            cslItem["container-title-short"],
            hadShort ? "journal-abbr-override" : "journal-abbr"
          );
        }
        if (!cslItem.authority) {
          const court = String(zotItem.getField?.("court") || "").trim();
          if (court) {
            cslItem.authority = [{ literal: this.abbrevService.normalizeKey(court) || court }];
          }
        }
        this._applySchemaCreatorMappings(cslItem, zotItem);
        this._applySchemaCSLFieldMappings(cslItem, zotItem, mlzFields);
        this._applySchemaCSLDateMappings(cslItem, zotItem, mlzFields);
        this._rememberContainerTitleContext(cslItem, zotItem);
        const seeAlso = this._collectSeeAlsoURIs(cslItem, zotItem);
        if (seeAlso.length) {
          cslItem.seeAlso = seeAlso;
        }
      } catch (e) {
        this._warnRetrieveItem(`hydrateCSLItemFromZotero failed: ${String(e)}`);
      }
    }
    _applySchemaCreatorMappings(cslItem, zotItem) {
      for (const extraPersonType of this._extraPersonTypes) {
        const cslField = extraPersonType.cslField;
        if (!cslField || this._hasCSLValue(cslItem[cslField])) continue;
        const creators = this.Jurisdiction.getMLZExtraCreatorsByType?.(zotItem, extraPersonType.mlzType) || [];
        if (!creators.length) continue;
        const mapped = creators.map((creator) => this._extraPersonToCSLCreator(creator)).filter((creator) => creator.literal || creator.given || creator.family);
        if (mapped.length) cslItem[cslField] = mapped;
      }
    }
    _applySchemaCSLFieldMappings(cslItem, zotItem, mlzFields) {
      const mappings = this.schemaConfig?.getCSLFieldMappings?.() || [];
      for (const mapping of mappings) {
        if (!mapping?.cslField || this._hasCSLValue(cslItem[mapping.cslField])) continue;
        const value = this._getFirstSchemaFieldValue(zotItem, mapping.fields, mlzFields);
        this._assignCSLFieldValue(cslItem, mapping.cslField, value);
      }
    }
    _applySchemaCSLDateMappings(cslItem, zotItem, mlzFields) {
      const mappings = this.schemaConfig?.getCSLDateMappings?.() || [];
      for (const mapping of mappings) {
        if (!mapping?.cslField || this._hasCSLValue(cslItem[mapping.cslField])) continue;
        const rawValue = this._getFirstSchemaFieldValue(zotItem, mapping.fields, mlzFields);
        const parsed = this._parseRawDateToCSL(rawValue);
        if (parsed) cslItem[mapping.cslField] = parsed;
      }
    }
    _collectSeeAlsoURIs(cslItem, zotItem) {
      const out = [];
      const seen = /* @__PURE__ */ new Set();
      const selfURI = this._getItemURI(zotItem);
      const add = (value) => {
        const normalized = this._resolveSeeAlsoEntryToURI(value, zotItem?.libraryID);
        if (!normalized) return;
        if (selfURI && normalized === selfURI) return;
        if (seen.has(normalized)) return;
        seen.add(normalized);
        out.push(normalized);
      };
      try {
        const existingSeeAlso = Array.isArray(cslItem?.seeAlso) ? cslItem.seeAlso : [];
        for (const entry of existingSeeAlso) {
          add(entry);
        }
        const relatedKeys = Array.isArray(zotItem?.relatedItems) ? zotItem.relatedItems : [];
        for (const key of relatedKeys) {
          const relatedItem = Zotero.Items.getByLibraryAndKey?.(zotItem.libraryID, key);
          add(relatedItem);
        }
        const relatedPredicate = Zotero.Relations?.relatedItemPredicate;
        const relatedURIs = relatedPredicate ? zotItem?.getRelationsByPredicate?.(relatedPredicate) || [] : [];
        for (const uri of relatedURIs) {
          add(uri);
        }
      } catch (e) {
        this._warnRetrieveItem(`collectSeeAlsoURIs failed: ${String(e)}`);
      }
      return out;
    }
    _sanitizeCSLControlFields(cslItem) {
      if (!cslItem || typeof cslItem !== "object") return;
      const rawNote = cslItem.note;
      const parsed = this.Jurisdiction?._getMLZPayloadAndRange?.(rawNote) || null;
      const sanitizedNote = this._stripEmbeddedControlText(rawNote);
      try {
        const payload = {
          type: cslItem?.type ?? null,
          title: cslItem?.title ?? null,
          rawNote: rawNote ?? null,
          mlzStart: parsed?.start ?? null,
          mlzEnd: parsed?.end ?? null,
          sanitizedNote: sanitizedNote ?? null
        };
        const msg = `[Citation Phoenix] sanitize note: ${JSON.stringify(payload)}`;
        Zotero.debug(msg);
        Zotero.logError(msg);
      } catch (e) {
      }
      if (sanitizedNote == null) {
        delete cslItem.note;
      } else {
        cslItem.note = sanitizedNote;
      }
    }
    _stripEmbeddedControlText(value) {
      let text = String(value || "");
      if (!text.trim()) return null;
      const parsed = this.Jurisdiction?._getMLZPayloadAndRange?.(text);
      if (parsed?.start != null && parsed?.end != null) {
        const stripped = this.Jurisdiction._removeMLZBlock?.(text, parsed.start, parsed.end);
        if (stripped != null) {
          text = stripped;
        }
      }
      text = text.replace(/\b(container-title-short|title-short|hereinafter)\s*:\s*.*$/i, "");
      text = text.replace(/^[\s"'`]+|[\s"'`]+$/g, "").trim();
      return text || null;
    }
    _resolveSeeAlsoEntryToURI(value, libraryID = null) {
      if (value == null) return null;
      if (typeof value === "object") {
        const directURI = this._getItemURI(value);
        if (directURI) return directURI;
        if ("key" in value && libraryID != null) {
          const relatedItem = Zotero.Items.getByLibraryAndKey?.(libraryID, value.key);
          return this._getItemURI(relatedItem);
        }
        return null;
      }
      const raw = String(value).trim();
      if (!raw) return null;
      if (/^https?:\/\/zotero\.org\//i.test(raw)) return raw;
      if (/^\d+$/.test(raw)) return this._getItemURI(Zotero.Items.get?.(Number(raw)));
      if (/^[A-Z0-9]{8}$/i.test(raw) && libraryID != null) return this._getItemURI(Zotero.Items.getByLibraryAndKey?.(libraryID, raw));
      return raw;
    }
    _getItemURI(item) {
      if (!item) return null;
      try {
        return Zotero.URI?.getItemURI?.(item) || null;
      } catch (e) {
      }
      return null;
    }
    _extraPersonToCSLCreator(person) {
      const literalName = String(person?.name || "").trim();
      if (literalName) return { literal: literalName };
      return {
        given: String(person?.firstName || "").trim(),
        family: String(person?.lastName || "").trim()
      };
    }
    _rememberContainerTitleContext(cslItem, zotItem = null) {
      const containerTitle = String(cslItem?.["container-title"] || "").trim();
      if (!containerTitle) return;
      const key = this.abbrevService.normalizeKey(containerTitle);
      if (!key) return;
      const shortTitle = String(cslItem?.["container-title-short"] || "").trim();
      if (shortTitle) {
        this._containerTitleShortByKey.set(key, shortTitle);
      }
      const type = String(cslItem?.type || "").trim();
      const language = String(
        cslItem?.language || zotItem?.getField?.("language") || zotItem?.getField?.("languageCode") || zotItem?.language || ""
      ).trim();
      const prior = this._containerTitleContextByKey.get(key) || {
        journal: false,
        englishBook: false
      };
      if (["article-journal", "article-magazine", "article-newspaper"].includes(type)) {
        prior.journal = true;
      }
      if (type === "chapter" && this._isEnglishLanguage(language)) {
        prior.englishBook = true;
      }
      this._containerTitleContextByKey.set(key, prior);
    }
    _shouldAllowContainerTitleFallback(containerTitle, styleID = "") {
      if (!this._styleAllowsContainerTitleFallback(styleID)) return false;
      const key = this.abbrevService.normalizeKey(containerTitle || "");
      if (!key) return false;
      const context = this._containerTitleContextByKey.get(key);
      return !!(context?.journal || context?.englishBook);
    }
    _styleAllowsContainerTitleFallback(styleID) {
      const key = String(styleID || "").trim().toLowerCase();
      return key === "http://juris-m.github.io/styles/jm-indigobook" || key === "http://juris-m.github.io/styles/jm-indigobook-law-review";
    }
    _isEnglishLanguage(language) {
      const value = String(language || "").trim().toLowerCase();
      return value === "en" || value.startsWith("en-") || value.startsWith("eng");
    }
    _protectAbbreviationValue(value) {
      const text = String(value || "").trim();
      if (!text || /<span\s+class=["']nocase["']>/i.test(text)) return text;
      return `<span class="nocase">${this._escapeNoCaseText(text)}</span>`;
    }
    _escapeNoCaseText(value) {
      return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }
    _decorateShortForms(cslItem, jur) {
      try {
        if (!cslItem["container-title-short"] && cslItem["container-title"]) {
          const hit = this.abbrevService.lookupForCiteProc("container-title", cslItem["container-title"], jur, { noHints: true });
          if (hit?.value) {
            cslItem["container-title-short"] = this._protectAbbreviationValue(this.abbrevService.parseDirective(hit.value).value);
            this._logShortForm("container-title", cslItem["container-title"], cslItem["container-title-short"], "hit");
          } else {
            this._logShortForm("container-title", cslItem["container-title"], null, "miss");
          }
        }
        if (!cslItem["title-short"] && cslItem.title) {
          const hit = this.abbrevService.lookupForCiteProc("title", cslItem.title, jur, { noHints: true });
          if (hit?.value) {
            cslItem["title-short"] = this._protectAbbreviationValue(this.abbrevService.parseDirective(hit.value).value);
            this._logShortForm("title", cslItem.title, cslItem["title-short"], "hit");
          } else {
            this._logShortForm("title", cslItem.title, null, "miss");
          }
        }
        this._rememberContainerTitleContext(cslItem);
      } catch (e) {
        this._warnRetrieveItem(`decorateShortForms failed: ${String(e)}`);
      }
    }
    _logShortForm(category, source, value, stage) {
      if (this._shortFormLogCount >= this._maxShortFormLogs) return;
      this._shortFormLogCount += 1;
      const msg = `[Citation Phoenix] shortForm[${this._shortFormLogCount}] ${stage}: category=${category} source=${String(source)} value=${String(value)}`;
      try {
        Zotero.debug(msg);
      } catch (e) {
      }
    }
    _logField(stage, detail) {
      if (this._fieldLogCount >= this._maxFieldLogs) return;
      this._fieldLogCount += 1;
      const msg = `[Citation Phoenix] field[${this._fieldLogCount}] ${stage}: ${detail}`;
      try {
        Zotero.debug(msg);
      } catch (e) {
      }
    }
    _isHarvardCRCL(text) {
      const normalized = this.abbrevService.normalizeKey(text || "");
      return normalized.includes("harvard civil rights") && normalized.includes("civil liberties") && normalized.includes("law review");
    }
    _logRenderProbeFromItem(cslItem, jur, stage) {
      try {
        const source = String(cslItem?.["container-title"] || "");
        if (!this._isHarvardCRCL(source)) return;
        const msg = `[Citation Phoenix] renderProbe item(${stage}): jur=${String(jur)} type=${String(cslItem?.type || "")} container-title=${source} container-title-short=${String(cslItem?.["container-title-short"] || "")} title=${String(cslItem?.title || "")} title-short=${String(cslItem?.["title-short"] || "")}`;
        Zotero.debug(msg);
        Zotero.logError(msg);
      } catch (e) {
      }
    }
    _logRenderProbeFromAbbreviation(category, key, jurisdiction, noHints, stage) {
      try {
        if (category !== "container-title") return;
        if (!this._isHarvardCRCL(key)) return;
        const normalized = this.abbrevService.normalizeKey(key || "");
        const msg = `[Citation Phoenix] renderProbe abbr(${stage}): category=${String(category)} jur=${String(jurisdiction)} noHints=${String(!!noHints)} key=${String(key)} normalized=${normalized}`;
        Zotero.debug(msg);
        Zotero.logError(msg);
      } catch (e) {
      }
    }
    _normalizeItemID(id) {
      if (id == null) return null;
      if (Array.isArray(id)) return null;
      if (typeof id === "object") {
        if ("id" in id) return id.id;
        return String(id);
      }
      return id;
    }
    _logRetrieveItemDetails(inputID, outputID, stage) {
      if (this._retrieveItemLogCount >= this._maxRetrieveItemLogs) return;
      this._retrieveItemLogCount += 1;
      const inType = Array.isArray(inputID) ? "array" : typeof inputID;
      const outType = Array.isArray(outputID) ? "array" : typeof outputID;
      const msg = `[Citation Phoenix] retrieveItem[${this._retrieveItemLogCount}] ${stage}: inputID(${inType})=${String(inputID)} => cslItem.id(${outType})=${String(outputID)}`;
      try {
        Zotero.debug(msg);
      } catch (e) {
      }
      try {
        Zotero.logError(msg);
      } catch (e) {
      }
    }
    _warnRetrieveItem(reason) {
      if (this._didWarnRetrieveItem) return;
      this._didWarnRetrieveItem = true;
      try {
        Zotero.debug(`[Citation Phoenix] retrieveItem patch warning: ${reason}`);
      } catch (e) {
      }
    }
    _patchAbbreviations() {
      const sysProto = Zotero?.Cite?.System?.prototype;
      if (!sysProto) return;
      if (sysProto.getAbbreviation) this._orig.getAbbreviation = sysProto.getAbbreviation;
      if (sysProto.normalizeAbbrevsKey) this._orig.normalizeAbbrevsKey = sysProto.normalizeAbbrevsKey;
      const self = this;
      sysProto.normalizeAbbrevsKey = function(_familyVar, key) {
        return self.abbrevService.normalizeKey(key);
      };
      sysProto.getAbbreviation = function(styleID, obj, jurisdiction, category, key, noHints) {
        let origJurisdiction = jurisdiction || "default";
        if (self._orig.getAbbreviation) {
          origJurisdiction = self._orig.getAbbreviation.call(this, styleID, obj, jurisdiction, category, key, noHints) || origJurisdiction;
        }
        self._logRenderProbeFromAbbreviation(category, key, jurisdiction || origJurisdiction || "default", noHints, "pre");
        try {
          const jur = (jurisdiction || origJurisdiction || "default").toLowerCase();
          if (category === "container-title") {
            const normalizedContainerTitle = self.abbrevService.normalizeKey(key);
            const storedShort = self._containerTitleShortByKey.get(normalizedContainerTitle);
            if (storedShort) {
              if (!obj[jur]) obj[jur] = self._newAbbreviationSegments(this);
              if (!obj[jur][category]) obj[jur][category] = {};
              obj[jur][category][key] = self._protectAbbreviationValue(storedShort);
              self._logRenderProbeFromAbbreviation(category, key, jur, noHints, "container-title-short");
              self._logAbbreviation(category, key, jur, obj[jur][category][key], "container-title-short");
              return jur;
            }
            const journalAbbr = self._journalAbbrByContainerTitleKey.get(normalizedContainerTitle);
            if (journalAbbr) {
              if (!obj[jur]) obj[jur] = self._newAbbreviationSegments(this);
              if (!obj[jur][category]) obj[jur][category] = {};
              obj[jur][category][key] = self._protectAbbreviationValue(journalAbbr);
              self._logRenderProbeFromAbbreviation(category, key, jur, noHints, "journal-abbr");
              self._logAbbreviation(category, key, jur, journalAbbr, "journal-abbr");
              return jur;
            }
          }
          const lookupNoHints = category === "title" ? true : category === "container-title" ? !self._shouldAllowContainerTitleFallback(key, styleID) : noHints;
          const hit = self.abbrevService.lookupForCiteProc(category, key, jur, { noHints: lookupNoHints });
          if (hit?.value) {
            const targetJur = hit.jurisdiction || jur || "default";
            if (!obj[targetJur]) obj[targetJur] = self._newAbbreviationSegments(this);
            if (!obj[targetJur][category]) obj[targetJur][category] = {};
            obj[targetJur][category][key] = category === "title" || category === "container-title" ? self._protectAbbreviationValue(hit.value) : hit.value;
            self._logRenderProbeFromAbbreviation(category, key, targetJur, noHints, "hit");
            self._logAbbreviation(category, key, targetJur, obj[targetJur][category][key], "hit");
            return targetJur;
          }
          const resolvedJur = (origJurisdiction || jur || "default").toLowerCase();
          if (!obj[resolvedJur]) obj[resolvedJur] = self._newAbbreviationSegments(this);
          if (!obj.default) obj.default = self._newAbbreviationSegments(this);
          self._logRenderProbeFromAbbreviation(category, key, resolvedJur, noHints, "miss");
          self._logAbbreviation(category, key, resolvedJur, null, "miss");
          return resolvedJur;
        } catch (e) {
          self._logAbbreviation(category, key, origJurisdiction, String(e), "error");
        }
        const fallbackJur = (origJurisdiction || jurisdiction || "default").toLowerCase();
        try {
          if (!obj[fallbackJur]) obj[fallbackJur] = self._newAbbreviationSegments(this);
          if (!obj.default) obj.default = self._newAbbreviationSegments(this);
        } catch (e) {
        }
        return fallbackJur;
      };
    }
    _newAbbreviationSegments(sysObj) {
      if (typeof sysObj?.AbbreviationSegments === "function") {
        return new sysObj.AbbreviationSegments();
      }
      return {
        "container-title": {},
        "collection-title": {},
        "institution-entire": {},
        "institution-part": {},
        nickname: {},
        number: {},
        title: {},
        place: {},
        hereinafter: {},
        classic: {},
        "container-phrase": {},
        "title-phrase": {}
      };
    }
    _logAbbreviation(category, key, jurisdiction, value, stage) {
      if (this._abbrevLogCount >= this._maxAbbrevLogs) return;
      this._abbrevLogCount += 1;
      const msg = `[Citation Phoenix] getAbbreviation[${this._abbrevLogCount}] ${stage}: category=${category} jurisdiction=${jurisdiction} key=${String(key)} value=${String(value)}`;
      try {
        Zotero.debug(msg);
      } catch (e) {
      }
    }
    _patchLoadJurisdictionStyle() {
      const sysProto = Zotero?.Cite?.System?.prototype;
      if (!sysProto) return;
      if (sysProto.loadJurisdictionStyle) this._orig.loadJurisdictionStyle = sysProto.loadJurisdictionStyle;
      if (sysProto.retrieveStyleModule) this._orig.retrieveStyleModule = sysProto.retrieveStyleModule;
      const self = this;
      sysProto.loadJurisdictionStyle = function(jurisdiction, variantName) {
        const xml = self.moduleLoader.loadJurisdictionStyleSync(jurisdiction, variantName);
        if (xml) {
          self._logJurisdictionModuleLoad("loadJurisdictionStyle", jurisdiction, variantName, xml);
          return xml;
        }
        if (self._orig.loadJurisdictionStyle) return self._orig.loadJurisdictionStyle.call(this, jurisdiction, variantName);
        return null;
      };
      sysProto.retrieveStyleModule = function(jurisdiction, variantName) {
        const xml = self.moduleLoader.loadJurisdictionStyleSync(jurisdiction, variantName);
        if (xml) {
          self._logJurisdictionModuleLoad("retrieveStyleModule", jurisdiction, variantName, xml);
          return xml;
        }
        if (self._orig.retrieveStyleModule) return self._orig.retrieveStyleModule.call(this, jurisdiction, variantName);
        return null;
      };
    }
    _patchGetCiteProcFallback() {
      const proto = Zotero?.Style?.prototype;
      if (!proto?.getCiteProc) return;
      this._orig.getCiteProc = proto.getCiteProc;
      const self = this;
      proto.getCiteProc = function(...args) {
        const styleXML = self._getStyleXMLSync(this);
        if (!styleXML) {
          const citeproc = self._orig.getCiteProc.apply(this, args);
          return self._instrumentCiteProcEngine(citeproc);
        }
        let effectiveXML = styleXML;
        const hasIndigoPref = effectiveXML.includes('jurisdiction-preference="IndigoTemp"');
        const hasEmptyCitation = self._hasEmptyCitationLayout(effectiveXML);
        if (hasEmptyCitation && (hasIndigoPref || self._looksLikeJurisStyle(effectiveXML))) {
          const baseUS = self.moduleLoader?._byFile?.get("juris-us.csl") || null;
          if (baseUS) {
            effectiveXML = baseUS;
            try {
              Zotero.debug("[Citation Phoenix] Replaced empty IndigoTemp citation layout with base juris-us.csl");
            } catch (e) {
            }
          }
        }
        let patched = effectiveXML.replace(/\[HINT:[^\]]+\]/g, "");
        const restore = self._tempSetXML(this, patched);
        try {
          const citeproc = self._orig.getCiteProc.apply(this, args);
          return self._instrumentCiteProcEngine(citeproc);
        } finally {
          restore();
        }
      };
    }
    _instrumentCiteProcEngine(citeproc) {
      if (!citeproc || typeof citeproc !== "object") return citeproc;
      if (citeproc.__indigoRenderProbeInstrumented) return citeproc;
      citeproc.__indigoRenderProbeInstrumented = true;
      this._logCiteprocEngineDetails(citeproc);
      this._instrumentParallelLifecycle(citeproc);
      try {
        const availableAbbrevDomains = this.abbrevService?.getAvailableAbbrevDomains?.();
        if (citeproc.opt && availableAbbrevDomains && Object.keys(availableAbbrevDomains).length) {
          citeproc.opt.availableAbbrevDomains = {
            ...citeproc.opt.availableAbbrevDomains || {},
            ...availableAbbrevDomains
          };
        }
      } catch (e) {
      }
      try {
        const methodList = [
          "processCitationCluster",
          "previewCitationCluster",
          "appendCitationCluster",
          "makeBibliography",
          "updateItems"
        ];
        const available = methodList.filter((name) => typeof citeproc[name] === "function").join(",");
        Zotero.debug(`[Citation Phoenix] renderProbe citeproc instrumentation: methods=${available || "none"}`);
      } catch (e) {
      }
      this._instrumentParallelTracker(citeproc);
      const wrap = (methodName) => {
        const orig = citeproc?.[methodName];
        if (typeof orig !== "function") return;
        const self = this;
        citeproc[methodName] = function(...args) {
          self._logCiteprocMethodStart(methodName, args);
          self._logCitationBranchProbe(methodName, args[0]);
          try {
            const result = orig.apply(this, args);
            self._logCiteprocMethodEnd(methodName, result);
            return result;
          } catch (e) {
            self._logCiteprocMethodError(methodName, e);
            throw e;
          }
        };
      };
      wrap("processCitationCluster");
      wrap("previewCitationCluster");
      wrap("appendCitationCluster");
      wrap("makeBibliography");
      wrap("updateItems");
      return citeproc;
    }
    _instrumentParallelLifecycle(citeproc) {
      const wrap = (methodName) => {
        const orig = citeproc?.[methodName];
        if (typeof orig !== "function") return;
        const marker = `__indigoParallelLifecycle_${methodName}`;
        if (citeproc[marker]) return;
        citeproc[marker] = true;
        const self = this;
        citeproc[methodName] = function(...args) {
          self._logParallelLifecycle(citeproc, `${methodName}:before`, args);
          try {
            const result = orig.apply(this, args);
            self._logParallelLifecycle(citeproc, `${methodName}:after`, args, result);
            return result;
          } catch (e) {
            self._logParallelLifecycle(citeproc, `${methodName}:error`, args, e);
            throw e;
          }
        };
      };
      wrap("retrieveAllStyleModules");
      wrap("loadStyleModule");
      wrap("buildTokenLists");
      wrap("configureTokenList");
    }
    _logCiteprocEngineDetails(citeproc) {
      try {
        const ctorName = String(citeproc?.constructor?.name || "unknown");
        const prefRs = Zotero.Prefs?.get?.("cite.useCiteprocRs");
        const parallelEnabled = citeproc?.opt?.parallel?.enable;
        const trackRepeat = Object.keys(citeproc?.opt?.track_repeat || {});
        const hasParallelTracker = !!citeproc?.parallel;
        const msg = `[Citation Phoenix] citeproc engine: ctor=${ctorName} citeprocRsPref=${String(!!prefRs)} hasParallelTracker=${String(hasParallelTracker)} parallelEnabled=${String(!!parallelEnabled)} trackRepeat=${trackRepeat.join("|") || "none"}`;
        Zotero.debug(msg);
        Zotero.logError(msg);
      } catch (e) {
      }
    }
    _logParallelLifecycle(citeproc, stage, args, resultOrError = void 0) {
      try {
        const parallel = citeproc?.opt?.parallel || {};
        const trackRepeat = Object.keys(citeproc?.opt?.track_repeat || {});
        const argSummary = this._summarizeParallelLifecycleArgs(stage, args);
        let tail = "";
        if (stage.endsWith(":error")) {
          tail = ` error=${String(resultOrError)}`;
        } else if (stage.endsWith(":after")) {
          tail = ` result=${this._summarizeParallelLifecycleResult(resultOrError)}`;
        }
        const msg = `[Citation Phoenix] citeproc parallel lifecycle(${stage}): enabled=${String(!!parallel.enable)} parallelKeys=${Object.keys(parallel).join("|") || "none"} trackRepeat=${trackRepeat.join("|") || "none"} ${argSummary}${tail}`;
        Zotero.debug(msg);
        Zotero.logError(msg);
      } catch (e) {
      }
    }
    _summarizeParallelLifecycleArgs(stage, args) {
      try {
        if (stage.startsWith("retrieveAllStyleModules")) {
          return `jurisdictions=${JSON.stringify(args?.[0] || null)}`;
        }
        if (stage.startsWith("loadStyleModule")) {
          const xml = typeof args?.[1] === "string" ? args[1] : "";
          return `jurisdiction=${String(args?.[0] || "")} hasXml=${String(!!xml)} xmlParallelAttrs=${String(/parallel-(first|last|last-to-first|delimiter-override)\s*=/.test(xml))} skipFallback=${String(!!args?.[2])}`;
        }
        if (stage.startsWith("buildTokenLists")) {
          const node = args?.[0];
          const target = args?.[1];
          const nodeName = String(node?.name || node?.nodeName || node?.tokentype || "");
          const targetKeys = target && typeof target === "object" ? Object.keys(target).slice(0, 6).join("|") : "none";
          return `node=${nodeName || "unknown"} targetKeys=${targetKeys}`;
        }
        if (stage.startsWith("configureTokenList")) {
          const tokens = args?.[0];
          const tokenCount = Array.isArray(tokens) ? tokens.length : -1;
          const tokenNames = Array.isArray(tokens) ? tokens.slice(0, 5).map((token) => String(token?.name || token?.tokentype || "")).join("|") : "none";
          return `tokenCount=${String(tokenCount)} tokenNames=${tokenNames || "none"}`;
        }
      } catch (e) {
      }
      return "args=unavailable";
    }
    _summarizeParallelLifecycleResult(result) {
      if (Array.isArray(result)) return `array(${result.length})`;
      if (result && typeof result === "object") return `object(${Object.keys(result).slice(0, 6).join("|")})`;
      return String(result);
    }
    _logJurisdictionModuleLoad(hookName, jurisdiction, variantName, xml) {
      try {
        const hasParallelFirst = /parallel-first\s*=/.test(xml);
        const hasParallelLast = /parallel-last\s*=/.test(xml);
        const hasParallelLastToFirst = /parallel-last-to-first\s*=/.test(xml);
        const hasParallelDelimiter = /parallel-delimiter-override\s*=/.test(xml);
        const msg = `[Citation Phoenix] jurisdiction module(${hookName}): jurisdiction=${String(jurisdiction || "")} variant=${String(variantName || "")} parallel-first=${String(hasParallelFirst)} parallel-last=${String(hasParallelLast)} parallel-last-to-first=${String(hasParallelLastToFirst)} parallel-delimiter=${String(hasParallelDelimiter)}`;
        Zotero.debug(msg);
        Zotero.logError(msg);
      } catch (e) {
      }
    }
    _logCitationBranchProbe(methodName, citation) {
      try {
        const items = this._extractCitationItems(citation);
        if (!Array.isArray(items) || !items.length) return;
        for (const citationItem of items) {
          const itemID = citationItem?.id ?? citationItem?.itemID ?? citationItem?.itemId ?? null;
          const pos = citationItem?.position;
          const nearNote = !!(citationItem?.["near-note"] || citationItem?.nearNote);
          const hasLocator = citationItem?.locator != null && String(citationItem.locator).trim() !== "";
          const label = String(citationItem?.label || "");
          let branch = "full";
          if (pos === 2 || pos === "ibid-with-locator") branch = "ibid-with-locator";
          else if (pos === 1 || pos === "ibid") branch = "ibid";
          else if (nearNote || pos === 3 || pos === "subsequent") branch = "short";
          const msg = `[Citation Phoenix] renderProbe citeproc(${methodName}): branch=${branch} position=${String(pos)} near-note=${String(nearNote)} locator=${String(citationItem?.locator || "")} label=${label} has-locator=${String(hasLocator)} itemID=${String(itemID)}`;
          Zotero.debug(msg);
          Zotero.logError(msg);
        }
      } catch (e) {
      }
    }
    _extractCitationItems(citationArg) {
      if (!citationArg) return [];
      if (Array.isArray(citationArg?.citationItems)) return citationArg.citationItems;
      if (Array.isArray(citationArg)) {
        for (const part of citationArg) {
          if (Array.isArray(part?.citationItems)) return part.citationItems;
        }
      }
      return [];
    }
    _logCiteprocMethodStart(methodName, args) {
      try {
        const items = this._extractCitationItems(args?.[0]);
        this._logCitationRequestPayload(methodName, items, args);
        const ids = items.map((citationItem) => citationItem?.id ?? citationItem?.itemID ?? citationItem?.itemId ?? null).filter((id) => id != null).map((id) => String(id)).join(",");
        Zotero.debug(`[Citation Phoenix] renderProbe citeproc start(${methodName}): args=${String(args?.length || 0)} ids=${ids || "none"}`);
      } catch (e) {
      }
    }
    _logCiteprocMethodEnd(methodName, result) {
      try {
        let shape = typeof result;
        if (Array.isArray(result)) shape = `array(${result.length})`;
        if (result && typeof result === "object" && !Array.isArray(result)) {
          shape = `object(${Object.keys(result).slice(0, 6).join("|")})`;
        }
        Zotero.debug(`[Citation Phoenix] renderProbe citeproc end(${methodName}): result=${shape}`);
      } catch (e) {
      }
    }
    _logCiteprocMethodError(methodName, error) {
      try {
        const msg = `[Citation Phoenix] renderProbe citeproc error(${methodName}): ${String(error)} stack=${String(error?.stack || "")}`;
        Zotero.debug(msg);
        Zotero.logError(msg);
      } catch (e) {
      }
    }
    _instrumentParallelTracker(citeproc) {
      try {
        const startCitation = citeproc?.parallel?.StartCitation;
        if (typeof startCitation !== "function") return;
        if (citeproc.parallel.__indigoStartCitationInstrumented) return;
        citeproc.parallel.__indigoStartCitationInstrumented = true;
        const self = this;
        citeproc.parallel.StartCitation = function(...args) {
          try {
            self._logParallelStartCitation(args?.[0], this?.state);
          } catch (e) {
          }
          return startCitation.apply(this, args);
        };
      } catch (e) {
      }
    }
    _logCitationItemData(cslItem, zotItem, stage) {
      if (this._citationDataLogCount >= this._maxCitationDataLogs) return;
      this._citationDataLogCount += 1;
      try {
        const payload = {
          id: cslItem?.id ?? null,
          zoteroID: zotItem?.id ?? null,
          key: zotItem?.key ?? null,
          type: cslItem?.type ?? null,
          title: cslItem?.title ?? null,
          jurisdiction: cslItem?.jurisdiction ?? null,
          authority: cslItem?.authority ?? null,
          recipient: Array.isArray(cslItem?.recipient) ? cslItem.recipient : [],
          note: cslItem?.note ?? null,
          version: cslItem?.version ?? null,
          edition: cslItem?.edition ?? null,
          "container-title": cslItem?.["container-title"] ?? null,
          "container-title-short": cslItem?.["container-title-short"] ?? null,
          "title-short": cslItem?.["title-short"] ?? null,
          seeAlso: Array.isArray(cslItem?.seeAlso) ? cslItem.seeAlso : []
        };
        const msg = `[Citation Phoenix] citation itemData[${this._citationDataLogCount}] ${stage}: ${JSON.stringify(payload)}`;
        Zotero.debug(msg);
        Zotero.logError(msg);
      } catch (e) {
      }
    }
    _logCitationRequestPayload(methodName, items, args) {
      if (!Array.isArray(items) || !items.length) return;
      if (this._citationDataLogCount >= this._maxCitationDataLogs) return;
      try {
        const payload = items.map((citationItem) => ({
          id: citationItem?.id ?? citationItem?.itemID ?? citationItem?.itemId ?? null,
          locator: citationItem?.locator ?? null,
          label: citationItem?.label ?? null,
          position: citationItem?.position ?? null,
          "near-note": citationItem?.["near-note"] ?? citationItem?.nearNote ?? null,
          prefix: citationItem?.prefix ?? null,
          suffix: citationItem?.suffix ?? null
        }));
        const msg = `[Citation Phoenix] citation request(${methodName}): items=${JSON.stringify(payload)} arg-shape=${String(args?.length || 0)}`;
        Zotero.debug(msg);
        Zotero.logError(msg);
      } catch (e) {
      }
    }
    _logParallelStartCitation(sortedItems, state) {
      if (!Array.isArray(sortedItems) || !sortedItems.length) return;
      try {
        const payload = sortedItems.map((entry) => ({
          item: {
            id: entry?.[0]?.id ?? null,
            title: entry?.[0]?.title ?? null,
            authority: this._summarizeParallelValue(entry?.[0]?.authority),
            number: this._summarizeParallelValue(entry?.[0]?.number),
            seeAlso: Array.isArray(entry?.[0]?.seeAlso) ? entry[0].seeAlso : []
          },
          citationItem: {
            id: entry?.[1]?.id ?? entry?.[1]?.itemID ?? entry?.[1]?.itemId ?? null,
            locator: entry?.[1]?.locator ?? null,
            position: entry?.[1]?.position ?? null,
            parallel: entry?.[1]?.parallel ?? null
          }
        }));
        const suppressRepeats = Array.isArray(state?.tmp?.suppress_repeats) ? state.tmp.suppress_repeats : [];
        const msg = `[Citation Phoenix] parallel StartCitation: sortedItems=${JSON.stringify(payload)} suppressRepeats=${JSON.stringify(suppressRepeats)}`;
        Zotero.debug(msg);
        Zotero.logError(msg);
      } catch (e) {
      }
    }
    _summarizeParallelValue(value) {
      if (value == null) return null;
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return value;
      }
      if (Array.isArray(value)) {
        return value.map((entry) => this._summarizeParallelValue(entry));
      }
      if (typeof value === "object") {
        const out = {};
        for (const key of ["literal", "family", "given", "name", "year"]) {
          if (value[key] != null) out[key] = value[key];
        }
        if (Object.keys(out).length) return out;
        return JSON.stringify(value);
      }
      return String(value);
    }
    _getStyleXMLSync(styleObj) {
      if (styleObj._xml) return styleObj._xml;
      if (styleObj._style) return styleObj._style;
      if (styleObj.file && styleObj.file.exists()) {
        try {
          if (typeof Zotero?.File?.getContents === "function") {
            return Zotero.File.getContents(styleObj.file);
          }
          this._warnNoSyncStyleRead("Zotero.File.getContents is unavailable");
        } catch (e) {
          this._warnNoSyncStyleRead(String(e));
        }
      }
      return null;
    }
    _warnNoSyncStyleRead(reason) {
      if (this._didWarnNoSyncStyleRead) return;
      this._didWarnNoSyncStyleRead = true;
      try {
        Zotero.debug(`[Citation Phoenix] Sync style fallback unavailable: ${reason}. Preload style XML during activation.`);
      } catch (e) {
      }
    }
    _hasEmptyCitationLayout(xml) {
      if (!xml) return false;
      return /<citation>\s*<layout>\s*<\/layout>\s*<\/citation>/i.test(xml);
    }
    _looksLikeJurisStyle(xml) {
      if (!xml) return false;
      return /<macro\s+name="juris-[^"]+"/i.test(xml) || /class="legal"/i.test(xml) || /jurisdiction-preference=/i.test(xml);
    }
    _tempSetXML(styleObj, xml) {
      const prev = { _xml: styleObj._xml, _style: styleObj._style };
      if ("_xml" in styleObj) styleObj._xml = xml;
      if ("_style" in styleObj) styleObj._style = xml;
      return () => {
        if ("_xml" in styleObj) styleObj._xml = prev._xml;
        if ("_style" in styleObj) styleObj._style = prev._style;
      };
    }
  };

  // lib/services/prefsUI.mjs
  var PrefsUI = class {
    constructor({ pluginID, rootURI }) {
      this.pluginID = pluginID;
      this.rootURI = rootURI;
      this._paneID = null;
      this._registerTimer = null;
      this._registerAttempts = 0;
      this._maxRegisterAttempts = 20;
    }
    async register() {
      this._registerAttempts = 0;
      await this._tryRegister();
    }
    async _tryRegister() {
      try {
        if (this._paneID) return;
        if (!Zotero?.PreferencePanes?.register) {
          this._scheduleRetry("PreferencePanes service not ready");
          return;
        }
        const spec = this.rootURI?.spec || String(this.rootURI || "");
        const base = spec.endsWith("/") ? spec : `${spec}/`;
        const pane = await Zotero.PreferencePanes.register({
          pluginID: this.pluginID,
          src: `${base}content/prefs-abbrev.xhtml`,
          scripts: [`${base}content/prefs-abbrev.js`],
          stylesheets: [`${base}content/prefs-abbrev.css`],
          label: "Phoenix",
          image: `${base}content/ui/icon48.svg`
        });
        this._paneID = pane?.id || pane || null;
        try {
          Zotero.debug(`[Citation Phoenix] prefs pane registered: paneID=${String(this._paneID)}`);
        } catch (_) {
        }
      } catch (e) {
        try {
          Zotero.logError(e);
        } catch (_) {
        }
        try {
          Zotero.debug(`[Citation Phoenix] prefs pane register failed: ${String(e)}`);
        } catch (_) {
        }
        this._scheduleRetry(String(e));
      }
    }
    _scheduleRetry(reason) {
      if (this._registerAttempts >= this._maxRegisterAttempts) {
        try {
          Zotero.debug(`[Citation Phoenix] prefs pane registration gave up after ${this._registerAttempts} attempts: ${reason}`);
        } catch (_) {
        }
        return;
      }
      this._registerAttempts += 1;
      if (this._registerTimer) clearTimeout(this._registerTimer);
      this._registerTimer = setTimeout(async () => {
        this._registerTimer = null;
        try {
          await this._tryRegister();
        } catch (e) {
          try {
            Zotero.logError(e);
          } catch (_) {
          }
        }
      }, 1e3);
    }
    unregister() {
      try {
        if (this._registerTimer) {
          clearTimeout(this._registerTimer);
          this._registerTimer = null;
        }
        if (!this._paneID) return;
        if (Zotero?.PreferencePanes?.unregister) {
          try {
            Zotero.debug(`[Citation Phoenix] prefs pane unregistering: paneID=${String(this._paneID)}`);
          } catch (_) {
          }
          Zotero.PreferencePanes.unregister(this._paneID);
          try {
            Zotero.debug(`[Citation Phoenix] prefs pane unregistered: paneID=${String(this._paneID)}`);
          } catch (_) {
          }
        }
      } catch (e) {
        try {
          Zotero.logError(e);
        } catch (_) {
        }
      } finally {
        this._paneID = null;
      }
    }
  };

  // lib/services/caseCourtMapper.mjs
  var CaseCourtMapper = class {
    constructor({ dataStore }) {
      this.dataStore = dataStore;
      this._config = null;
    }
    async preload() {
      this._config = await this.dataStore.loadJSONAny([
        "juris-maps/case-jurisdiction-map.json",
        "data/case-jurisdiction-map.json"
      ]);
    }
    mapCaseCourt(rawCourt) {
      const source = String(rawCourt || "").trim();
      if (!source) return { courtKey: "", jurisdiction: "" };
      const courtLine = source.replace(/\s+/g, " ").replace(/\.$/, "").trim();
      const courtKey = this._mapCourtKey(courtLine);
      const jurisdiction = this._mapJurisdiction(courtLine);
      return { courtKey, jurisdiction };
    }
    _mapCourtKey(courtLine) {
      const haystack = this._normalizeForPattern(courtLine || "");
      const aliases = Array.isArray(this._config?.courtKeyAliases) ? this._config.courtKeyAliases : [];
      for (const alias of aliases) {
        const needle = this._normalizeForPattern(alias?.pattern || "");
        const value = String(alias?.value || "").trim();
        if (!needle || !value) continue;
        if (haystack.includes(needle)) return value;
      }
      const rules = Array.isArray(this._config?.courtKeyRules) ? this._config.courtKeyRules : [];
      for (const rule of rules) {
        const needle = this._normalizeForPattern(rule?.pattern || "");
        const value = String(rule?.value || "").trim();
        if (!needle || !value) continue;
        if (haystack.includes(needle)) return value;
      }
      return "";
    }
    _mapJurisdiction(courtLine) {
      const normalized = String(courtLine || "").replace(/,\s*[a-zA-Z]+\s*Division\.?$/i, "").trim();
      const exactUSSupreme = /^Supreme Court of the United States$/i;
      if (exactUSSupreme.test(normalized)) return "us";
      const circuitMatch = normalized.match(/^United States Court of Appeals,\s+(.+?)\s+Circuit$/i);
      if (circuitMatch) {
        const circuitName = String(circuitMatch[1] || "").trim().toLowerCase();
        const ordinalMap = {
          federal: "federal",
          "district of columbia": "0",
          "d.c.": "0",
          first: "1",
          second: "2",
          third: "3",
          fourth: "4",
          fifth: "5",
          sixth: "6",
          seventh: "7",
          eighth: "8",
          ninth: "9",
          tenth: "10",
          eleventh: "11"
        };
        const token = ordinalMap[circuitName];
        if (token === "federal") return "us:c";
        return token ? `us:c${token}` : "";
      }
      if (/\b(fed|federal)\.?\s+cir(cuit)?\.?\b/i.test(normalized)) {
        return "us:c";
      }
      const numberedCircuit = normalized.match(/\b(1|2|3|4|5|6|7|8|9|10|11)(st|nd|rd|th)?\s+cir(cuit)?\.?\b/i);
      if (numberedCircuit) {
        return `us:c${String(numberedCircuit[1])}`;
      }
      const dcCircuit = /\b(d\.c\.|district of columbia)\s+cir(cuit)?\.?\b/i;
      if (dcCircuit.test(normalized)) {
        return "us:c0";
      }
      const districtMatch = normalized.match(/^United States District Court,\s+(.+)$/i);
      if (districtMatch) {
        return this._mapFederalDistrict(String(districtMatch[1] || "").trim());
      }
      return this._mapStateOrTerritoryJurisdiction(normalized);
    }
    _mapFederalDistrict(rawDistrictText) {
      const districtText = String(rawDistrictText || "").trim();
      if (!districtText) return "";
      let partMatch = districtText.match(/^(N|S|E|W|M|C)\.D\.\s+(.+)$/i);
      let districtToken = "";
      let stateName = "";
      if (partMatch) {
        const part = String(partMatch[1] || "").toUpperCase();
        districtToken = `${part.toLowerCase()}d`;
        stateName = String(partMatch[2] || "").trim();
      } else {
        partMatch = districtText.match(/^D\.\s+(.+)$/i);
        if (!partMatch) return "";
        districtToken = "d";
        stateName = String(partMatch[1] || "").trim();
      }
      const state = this._lookupStateInfo(stateName);
      if (!state?.code) return "";
      if (state.code === "dc") {
        return "us:dc.d";
      }
      if (!state.circuit) {
        return `us:${state.code}.${districtToken}`;
      }
      return `us:c${state.circuit}:${state.code}.${districtToken}`;
    }
    _mapStateOrTerritoryJurisdiction(courtLine) {
      const states = this._config?.states;
      if (!states || typeof states !== "object") return "";
      for (const [name, info] of Object.entries(states)) {
        const pattern = new RegExp(`(?:^|\\s|,)${this._escapeRegex(name)}(?:$|\\s|[.,])`, "i");
        if (!pattern.test(courtLine)) continue;
        const code = String(info?.code || "").trim().toLowerCase();
        if (!code) continue;
        return `us:${code}`;
      }
      return "";
    }
    _lookupStateInfo(rawName) {
      const states = this._config?.states;
      if (!states || typeof states !== "object") return null;
      const name = String(rawName || "").trim().replace(/\.$/, "");
      if (!name) return null;
      if (states[name]) return states[name];
      const synonyms = {
        "D.C.": "District of Columbia",
        DC: "District of Columbia",
        "Virgin Islands": "U.S. Virgin Islands"
      };
      const canonical = synonyms[name] || name;
      return states[canonical] || null;
    }
    _escapeRegex(value) {
      return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
    _normalizeForPattern(value) {
      return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    }
  };

  // lib/services/schemaConfig.mjs
  function humanizeKey(value) {
    const source = String(value || "").trim();
    if (!source) return "";
    return source.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().replace(/\b\w/g, (match) => match.toUpperCase());
  }
  function toKebabCase(value) {
    return String(value || "").trim().replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/[_\s]+/g, "-").replace(/-+/g, "-").toLowerCase();
  }
  var SchemaConfig = class {
    constructor({ dataStore }) {
      this.dataStore = dataStore;
      this.raw = null;
      this.localizationRaw = null;
      this._types = {};
      this._knownItemTypes = /* @__PURE__ */ new Set();
      this._customTypesByBaseItemType = /* @__PURE__ */ new Map();
      this._creatorsByItemType = /* @__PURE__ */ new Map();
      this._fieldDefsByItemType = /* @__PURE__ */ new Map();
      this._fieldDefIndexByItemType = /* @__PURE__ */ new Map();
      this._allFieldNames = /* @__PURE__ */ new Set();
      this._cslFieldSources = /* @__PURE__ */ new Map();
      this._cslDateSources = /* @__PURE__ */ new Map();
      this._extraCreatorTypes = [];
      this._sequenceByItemType = /* @__PURE__ */ new Map();
      this._localizedFieldsByLocale = /* @__PURE__ */ new Map();
      this._localizedCreatorsByLocale = /* @__PURE__ */ new Map();
      this._localizedItemTypesByLocale = /* @__PURE__ */ new Map();
    }
    async preload() {
      this.raw = await this.dataStore.loadJSON("content/schema.json");
      this.localizationRaw = await this.dataStore.loadJSON("content/localization.json").catch(() => null);
      this._types = this.raw?.TYPES || {};
      this._compileItemTypes();
      this._compileCreators();
      this._compileFieldDefinitions();
      this._compileCSLMappings();
      this._compileExtraCreatorTypes();
      this._compileSequence();
      this._compileLocalization();
    }
    getExtraCreatorTypes() {
      return this._extraCreatorTypes.map((entry) => ({ ...entry }));
    }
    getCreatorKeysForItemType(itemTypeName) {
      const key = String(itemTypeName || "").trim();
      const direct = this._creatorsByItemType.get(key);
      if (direct) return Array.from(direct);
      const fallbackKey = this.getBaseItemType(key);
      return Array.from(this._creatorsByItemType.get(fallbackKey) || []);
    }
    getFieldDefinitionsForItemType(itemTypeName) {
      const key = String(itemTypeName || "").trim();
      const direct = this._fieldDefsByItemType.get(key);
      if (direct) return direct.map((entry) => ({ ...entry }));
      const fallbackKey = this.getBaseItemType(key);
      return (this._fieldDefsByItemType.get(fallbackKey) || []).map((entry) => ({ ...entry }));
    }
    getFieldDefinition(itemTypeName, fieldName) {
      const key = String(itemTypeName || "").trim();
      const fieldKey = String(fieldName || "").trim();
      return this._fieldDefIndexByItemType.get(key)?.get(fieldKey) || this._fieldDefIndexByItemType.get(this.getBaseItemType(key))?.get(fieldKey) || null;
    }
    getAllFieldNames() {
      return Array.from(this._allFieldNames.values()).sort((a, b) => a.localeCompare(b));
    }
    getLocalizedFieldLabel(fieldName, rawLocale = null) {
      const key = String(fieldName || "").trim();
      if (!key) return "";
      const localized = this._lookupLocalizedEntry(this._localizedFieldsByLocale, key, rawLocale);
      if (localized) return localized;
      if (/Flag$/.test(key)) {
        return humanizeKey(key.replace(/Flag$/, ""));
      }
      return humanizeKey(key);
    }
    getLocalizedCreatorLabel(creatorType, rawLocale = null) {
      const key = String(creatorType || "").trim();
      if (!key) return "";
      return this._lookupLocalizedEntry(this._localizedCreatorsByLocale, key, rawLocale) || humanizeKey(key);
    }
    getLocalizedItemTypeLabel(itemTypeName, rawLocale = null) {
      const key = String(itemTypeName || "").trim();
      if (!key) return "";
      return this._lookupLocalizedEntry(this._localizedItemTypesByLocale, key, rawLocale) || humanizeKey(key);
    }
    getKnownItemTypeNames() {
      return Array.from(this._knownItemTypes.values()).sort((a, b) => a.localeCompare(b));
    }
    getItemTypeDefinition(itemTypeName) {
      const key = String(itemTypeName || "").trim();
      if (!key) return null;
      const definition = this._types?.[key] || null;
      return {
        itemType: key,
        zotero: String(definition?.zotero || key).trim(),
        csl: String(definition?.csl || key).trim(),
        custom: !!definition
      };
    }
    getBaseItemType(itemTypeName) {
      return this.getItemTypeDefinition(itemTypeName)?.zotero || "";
    }
    getCSLTypeForItemType(itemTypeName) {
      return this.getItemTypeDefinition(itemTypeName)?.csl || "";
    }
    isCustomItemType(itemTypeName) {
      const key = String(itemTypeName || "").trim();
      return !!key && Object.prototype.hasOwnProperty.call(this._types || {}, key);
    }
    getCustomTypesForBaseItemType(baseItemTypeName) {
      const key = String(baseItemTypeName || "").trim();
      return [...this._customTypesByBaseItemType.get(key) || []];
    }
    getCustomItemTypeOptions(rawLocale = null) {
      const locale = rawLocale || null;
      const out = [];
      for (const schemaItemType of this.getKnownItemTypeNames()) {
        if (!this.isCustomItemType(schemaItemType)) continue;
        out.push({
          itemType: schemaItemType,
          baseItemType: this.getBaseItemType(schemaItemType),
          cslType: this.getCSLTypeForItemType(schemaItemType),
          label: this.getLocalizedItemTypeLabel(schemaItemType, locale)
        });
      }
      return out;
    }
    getCSLFieldMappings() {
      return Array.from(this._cslFieldSources.entries()).map(([cslField, fields]) => ({
        cslField,
        fields: [...fields]
      }));
    }
    getCSLDateMappings() {
      return Array.from(this._cslDateSources.entries()).map(([cslField, fields]) => ({
        cslField,
        fields: [...fields]
      }));
    }
    getSequenceForItemType(itemTypeName) {
      const key = String(itemTypeName || "").trim();
      const direct = this._sequenceByItemType.get(key);
      if (direct) return [...direct];
      return [...this._sequenceByItemType.get(this.getBaseItemType(key)) || []];
    }
    _compileItemTypes() {
      this._knownItemTypes.clear();
      this._customTypesByBaseItemType.clear();
      for (const entry of Array.isArray(this.localizationRaw?.itemTypes) ? this.localizationRaw.itemTypes : []) {
        const normalized = this._normalizeItemTypeKey(entry?.itemType);
        if (normalized) this._knownItemTypes.add(normalized);
      }
      for (const schemaItemType of Object.keys(this._types || {})) {
        const normalized = this._normalizeItemTypeKey(schemaItemType);
        if (!normalized) continue;
        this._knownItemTypes.add(normalized);
        const baseItemType = this.getBaseItemType(normalized);
        if (!baseItemType || baseItemType === normalized) continue;
        if (!this._customTypesByBaseItemType.has(baseItemType)) {
          this._customTypesByBaseItemType.set(baseItemType, []);
        }
        const bucket = this._customTypesByBaseItemType.get(baseItemType);
        if (!bucket.includes(normalized)) bucket.push(normalized);
      }
    }
    _compileCreators() {
      const creators = this.raw?.CREATORS || {};
      for (const [schemaItemType, creatorList] of Object.entries(creators)) {
        const itemTypeName = this._normalizeItemTypeKey(schemaItemType);
        if (!itemTypeName) continue;
        if (!this._creatorsByItemType.has(itemTypeName)) {
          this._creatorsByItemType.set(itemTypeName, /* @__PURE__ */ new Set());
        }
        const bucket = this._creatorsByItemType.get(itemTypeName);
        for (const creatorKey of Array.isArray(creatorList) ? creatorList : []) {
          const normalized = String(creatorKey || "").trim();
          if (normalized) bucket.add(normalized);
        }
      }
    }
    _compileFieldDefinitions() {
      const addDefinition = (schemaItemType, definition, kind) => {
        const itemTypeName = this._normalizeItemTypeKey(schemaItemType);
        if (!itemTypeName) return;
        const field = String(definition?.field || definition || "").trim();
        if (!field) return;
        if (!this._fieldDefsByItemType.has(itemTypeName)) {
          this._fieldDefsByItemType.set(itemTypeName, []);
          this._fieldDefIndexByItemType.set(itemTypeName, /* @__PURE__ */ new Map());
        }
        const index = this._fieldDefIndexByItemType.get(itemTypeName);
        if (index.has(field)) return;
        const entry = {
          field,
          baseField: String(definition?.baseField || "").trim() || null,
          kind
        };
        this._fieldDefsByItemType.get(itemTypeName).push(entry);
        index.set(field, entry);
        this._allFieldNames.add(field);
      };
      for (const [schemaItemType, fieldList] of Object.entries(this.raw?.FIELDS || {})) {
        for (const definition of Array.isArray(fieldList) ? fieldList : []) {
          addDefinition(schemaItemType, definition, "field");
        }
      }
      for (const [schemaItemType, fieldList] of Object.entries(this.raw?.DATES || {})) {
        for (const fieldName of Array.isArray(fieldList) ? fieldList : []) {
          addDefinition(schemaItemType, { field: fieldName }, "date");
        }
      }
    }
    _compileCSLMappings() {
      for (const [cslField, fields] of Object.entries(this.raw?.CSL_FIELDS || {})) {
        const normalizedField = String(cslField || "").trim();
        if (!normalizedField) continue;
        this._cslFieldSources.set(
          normalizedField,
          (Array.isArray(fields) ? fields : []).map((field) => String(field || "").trim()).filter(Boolean)
        );
      }
      for (const [cslField, fields] of Object.entries(this.raw?.CSL_DATES || {})) {
        const normalizedField = String(cslField || "").trim();
        if (!normalizedField) continue;
        this._cslDateSources.set(
          normalizedField,
          (Array.isArray(fields) ? fields : []).map((field) => String(field || "").trim()).filter(Boolean)
        );
      }
    }
    _compileExtraCreatorTypes() {
      const allKeys = /* @__PURE__ */ new Set();
      for (const creatorKeys of this._creatorsByItemType.values()) {
        for (const creatorKey of creatorKeys) allKeys.add(creatorKey);
      }
      let nextID = 9001;
      this._extraCreatorTypes = Array.from(allKeys).sort().map((key) => {
        const label = humanizeKey(key);
        const normalizedKey = String(key).trim();
        return {
          key: normalizedKey,
          creatorTypeID: String(nextID++),
          creatorTypeName: `ibcslm-${toKebabCase(normalizedKey)}`,
          label,
          storage: "creator",
          mlzType: normalizedKey,
          cslField: toKebabCase(normalizedKey)
        };
      });
    }
    _compileSequence() {
      for (const [schemaItemType, sequence] of Object.entries(this.raw?.SEQUENCE || {})) {
        const itemTypeName = this._normalizeItemTypeKey(schemaItemType);
        if (!itemTypeName) continue;
        if (!this._sequenceByItemType.has(itemTypeName)) {
          this._sequenceByItemType.set(itemTypeName, []);
        }
        const target = this._sequenceByItemType.get(itemTypeName);
        for (const fieldName of Array.isArray(sequence) ? sequence : []) {
          const normalized = String(fieldName || "").trim();
          if (normalized && !target.includes(normalized)) {
            target.push(normalized);
          }
        }
      }
    }
    _compileLocalization() {
      this._localizedFieldsByLocale.clear();
      this._localizedCreatorsByLocale.clear();
      this._localizedItemTypesByLocale.clear();
      const localeSources = [
        this.raw?.locales || {},
        this.localizationRaw?.locales || {}
      ];
      const allLocales = /* @__PURE__ */ new Set();
      for (const source of localeSources) {
        for (const locale of Object.keys(source || {})) {
          const normalizedLocale = String(locale || "").trim().toLowerCase();
          if (normalizedLocale) allLocales.add(normalizedLocale);
        }
      }
      for (const normalizedLocale of allLocales) {
        const schemaPayload = this._getLocalePayload(this.raw?.locales, normalizedLocale);
        const localizationPayload = this._getLocalePayload(this.localizationRaw?.locales, normalizedLocale);
        const fields = this._mergeLocalizationBuckets(
          schemaPayload?.fields,
          localizationPayload?.fields
        );
        const creatorTypes = this._mergeLocalizationBuckets(
          schemaPayload?.creatorTypes,
          localizationPayload?.creatorTypes
        );
        const itemTypes = this._mergeLocalizationBuckets(
          schemaPayload?.itemTypes,
          localizationPayload?.itemTypes
        );
        this._localizedFieldsByLocale.set(normalizedLocale, fields);
        this._localizedCreatorsByLocale.set(normalizedLocale, creatorTypes);
        this._localizedItemTypesByLocale.set(normalizedLocale, itemTypes);
      }
    }
    _mergeLocalizationBuckets(...sources) {
      const out = /* @__PURE__ */ new Map();
      for (const source of sources) {
        for (const [key, value] of Object.entries(source || {})) {
          const normalizedKey = String(key || "").trim();
          const normalizedValue = String(value || "").trim();
          if (normalizedKey && normalizedValue) {
            out.set(normalizedKey, normalizedValue);
          }
        }
      }
      return out;
    }
    _normalizeLocalizationBucket(source) {
      const out = /* @__PURE__ */ new Map();
      for (const [key, value] of Object.entries(source || {})) {
        const normalizedKey = String(key || "").trim();
        const normalizedValue = String(value || "").trim();
        if (normalizedKey && normalizedValue) {
          out.set(normalizedKey, normalizedValue);
        }
      }
      return out;
    }
    _getLocalePayload(source, normalizedLocale) {
      const target = String(normalizedLocale || "").trim().toLowerCase();
      if (!target || !source || typeof source !== "object") return null;
      for (const [key, payload] of Object.entries(source)) {
        const normalizedKey = String(key || "").trim().replace(/_/g, "-").toLowerCase();
        if (normalizedKey === target) {
          return payload || null;
        }
      }
      return null;
    }
    _lookupLocalizedEntry(store, key, rawLocale = null) {
      const normalizedKey = String(key || "").trim();
      if (!normalizedKey) return "";
      const candidates = this._getLocalizationLocaleCandidates(rawLocale);
      for (const locale of candidates) {
        const bucket = store.get(locale);
        const value = bucket?.get(normalizedKey);
        if (value) return value;
      }
      return "";
    }
    _getLocalizationLocaleCandidates(rawLocale) {
      const candidates = [];
      const push = (value) => {
        const normalized = String(value || "").trim().toLowerCase();
        if (normalized && !candidates.includes(normalized)) {
          candidates.push(normalized);
        }
      };
      for (const candidate of getLocaleCandidates(rawLocale)) {
        push(candidate);
        if (candidate === "us") {
          push("en-us");
          push("en");
        }
      }
      push("en-us");
      push("en");
      return candidates;
    }
    _normalizeItemTypeKey(itemTypeName) {
      return String(itemTypeName || "").trim();
    }
  };

  // lib/main.mjs
  var _ctx;
  var COMMENTER_INFO_ROW_IDS = [
    "citation-phoenix-commenter-row",
    "indigobook-cslm-commenter-row"
  ];
  var BUNDLED_TRANSLATOR_FILES = [
    "Lexis+.js",
    "Westlaw.js"
  ];
  function _extractStyleID(styleXML) {
    if (!styleXML) return "";
    const match = styleXML.match(/<id>\s*([^<]+?)\s*<\/id>/i);
    return match ? String(match[1]).trim() : "";
  }
  function _extractStyleUpdated(styleXML) {
    if (!styleXML) return "";
    const match = styleXML.match(/<updated>\s*([^<]+?)\s*<\/updated>/i);
    return match ? String(match[1]).trim() : "";
  }
  function _styleUpdatedMillis(value) {
    const raw = String(value || "").trim();
    if (!raw) return null;
    const millis = Date.parse(raw);
    return Number.isFinite(millis) ? millis : null;
  }
  function _styleInstallSourceURL(rootURI, relPath) {
    const base = rootURI?.spec || "";
    return base ? `${base}${relPath}` : relPath;
  }
  function _diagnostic(message) {
    try {
      Zotero.debug(message);
    } catch (e) {
    }
    try {
      Zotero.logError(message);
    } catch (e) {
    }
  }
  async function _readInstalledStyleXML(installedStyle) {
    const path = installedStyle?.file?.path || installedStyle?.path || "";
    if (!path) return "";
    try {
      if (typeof IOUtils?.readUTF8 === "function") {
        return await IOUtils.readUTF8(path);
      }
    } catch (e) {
    }
    try {
      if (typeof Zotero?.File?.getContentsAsync === "function") {
        return await Zotero.File.getContentsAsync(path);
      }
    } catch (e) {
    }
    return "";
  }
  async function _getInstalledStyleUpdatedMillis(installedStyle) {
    for (const value of [
      installedStyle?.updated,
      installedStyle?.styleUpdated,
      installedStyle?.data?.updated
    ]) {
      const millis = _styleUpdatedMillis(value);
      if (millis != null) return millis;
    }
    const styleXML = await _readInstalledStyleXML(installedStyle);
    return _styleUpdatedMillis(_extractStyleUpdated(styleXML));
  }
  async function _installStyleFileFallback({ styleXML, styleID, filename, force = false }) {
    const stylesDir = Zotero?.getStylesDirectory?.();
    if (!stylesDir || !filename || !styleXML || typeof IOUtils?.writeUTF8 !== "function") {
      return false;
    }
    const destFile = stylesDir.clone();
    destFile.append(filename);
    if (destFile.exists() && !force) {
      try {
        Zotero.debug(`[Citation Phoenix] style fallback skipped (file exists): ${filename}`);
      } catch (e) {
      }
      return !!Zotero?.Styles?.get?.(styleID);
    }
    await IOUtils.writeUTF8(destFile.path, styleXML);
    await Zotero?.Styles?.reinit?.();
    return !!Zotero?.Styles?.get?.(styleID);
  }
  async function _ensureStylesLoaded() {
    const styles = Zotero?.Styles;
    if (!styles) return false;
    if (typeof styles.initialized === "function" && styles.initialized()) return true;
    if (typeof styles.init === "function") {
      await styles.init();
      return typeof styles.initialized !== "function" || styles.initialized();
    }
    return true;
  }
  function _unregisterCommenterInfoRows() {
    try {
      const manager = Zotero?.ItemPaneManager;
      if (typeof manager?.unregisterInfoRow !== "function") return;
      const rowData = manager.customInfoRowData;
      const optionsCache = manager._infoRowManager?._optionsCache;
      const hasRegistry = !!rowData || !!optionsCache;
      for (const rowID of COMMENTER_INFO_ROW_IDS) {
        const isRegistered = !!rowData?.[rowID] || !!optionsCache?.[rowID];
        if (hasRegistry && !isRegistered) continue;
        manager.unregisterInfoRow(rowID);
      }
    } catch (e) {
    }
  }
  async function _installStyleIfMissing({ rootURI, dataStore, relPath }) {
    const styleXML = await dataStore.loadText(relPath);
    const styleID = _extractStyleID(styleXML);
    const bundledUpdatedMillis = _styleUpdatedMillis(_extractStyleUpdated(styleXML));
    if (!styleID) {
      try {
        Zotero.debug(`[Citation Phoenix] style install skipped (missing id): ${relPath}`);
      } catch (e) {
      }
      return;
    }
    await _ensureStylesLoaded();
    const installedStyle = Zotero?.Styles?.get?.(styleID);
    if (installedStyle) {
      const installedUpdatedMillis = await _getInstalledStyleUpdatedMillis(installedStyle);
      const shouldUpdate = bundledUpdatedMillis != null && (installedUpdatedMillis == null || bundledUpdatedMillis > installedUpdatedMillis);
      if (!shouldUpdate) {
        try {
          Zotero.debug(`[Citation Phoenix] style already up to date: ${styleID}`);
        } catch (e) {
        }
        return;
      }
      try {
        Zotero.debug(`[Citation Phoenix] updating installed style: ${styleID}`);
      } catch (e) {
      }
    }
    const installFn = Zotero?.Styles?.install;
    if (typeof installFn !== "function") {
      try {
        Zotero.debug(`[Citation Phoenix] style install unavailable (no Zotero.Styles.install): ${styleID}`);
      } catch (e) {
      }
      return;
    }
    const sourceURL = _styleInstallSourceURL(rootURI, relPath);
    let installed = false;
    try {
      await installFn.call(Zotero.Styles, styleXML, sourceURL, true);
      installed = !!Zotero?.Styles?.get?.(styleID);
    } catch (e) {
    }
    if (!installed) {
      try {
        installed = await _installStyleFileFallback({
          styleXML,
          styleID,
          filename: relPath.split("/").pop(),
          force: !!installedStyle
        });
      } catch (e) {
      }
    }
    try {
      Zotero.debug(`[Citation Phoenix] style ${installed ? "installed" : "install failed"}: ${styleID}`);
    } catch (e) {
    }
  }
  async function _ensureBundledStylesInstalled({ rootURI, dataStore }) {
    let files = null;
    try {
      files = await dataStore.loadJSON("styles/index.json");
    } catch (e) {
      try {
        Zotero.debug(`[Citation Phoenix] style install skipped (styles/index.json unavailable): ${String(e)}`);
      } catch (_) {
      }
      return;
    }
    if (!Array.isArray(files) || !files.length) {
      try {
        Zotero.debug("[Citation Phoenix] style install skipped (styles/index.json empty or invalid)");
      } catch (e) {
      }
      return;
    }
    try {
      await _ensureStylesLoaded();
    } catch (e) {
      try {
        Zotero.debug(`[Citation Phoenix] style install skipped (Zotero styles unavailable): ${String(e)}`);
      } catch (_) {
      }
      return;
    }
    for (const file of files) {
      const relPath = `styles/${file}`;
      try {
        await _installStyleIfMissing({ rootURI, dataStore, relPath });
      } catch (e) {
        try {
          Zotero.debug(`[Citation Phoenix] style install error (${relPath}): ${String(e)}`);
        } catch (_) {
        }
      }
    }
  }
  function _extractTranslatorMetadata(code) {
    const match = code.match(/^\s*(\{[\s\S]*?\})\s*(?=\n[^}]|\nfunction|\nvar |\nconst |\nlet |\/\*)/m);
    if (!match) return null;
    try {
      return JSON.parse(match[1]);
    } catch (e) {
      return null;
    }
  }
  function _translatorUpdatedMillis(value) {
    const raw = String(value || "").trim();
    if (!raw) return null;
    const normalized = raw.replace(/^(\d{4}-\d{2}-\d{2})\s+/, "$1T");
    const millis = Date.parse(normalized);
    return Number.isFinite(millis) ? millis : null;
  }
  async function _ensureTranslatorsLoaded() {
    const translators = Zotero?.Translators;
    if (!translators) return false;
    if (typeof translators.init === "function") {
      await translators.init();
    }
    return true;
  }
  async function _getInstalledTranslator(translatorID) {
    try {
      await _ensureTranslatorsLoaded();
      const getFn = Zotero?.Translators?.get;
      if (typeof getFn !== "function") return null;
      return await getFn.call(Zotero.Translators, translatorID);
    } catch (e) {
      return null;
    }
  }
  async function _installTranslatorIfMissing({ dataStore, relPath }) {
    const code = await dataStore.loadText(relPath);
    const metadata = _extractTranslatorMetadata(code);
    if (!metadata?.translatorID) {
      try {
        Zotero.debug(`[Citation Phoenix] translator install skipped (missing translatorID): ${relPath}`);
      } catch (e) {
      }
      return;
    }
    const installedTranslator = await _getInstalledTranslator(metadata.translatorID);
    if (installedTranslator) {
      const bundledUpdatedMillis = _translatorUpdatedMillis(metadata.lastUpdated);
      const installedUpdatedMillis = _translatorUpdatedMillis(installedTranslator.lastUpdated);
      const shouldUpdate = bundledUpdatedMillis != null && (installedUpdatedMillis == null || bundledUpdatedMillis > installedUpdatedMillis);
      if (!shouldUpdate) {
        try {
          Zotero.debug(`[Citation Phoenix] translator already up to date: ${metadata.label}`);
        } catch (e) {
        }
        return;
      }
      try {
        Zotero.debug(`[Citation Phoenix] updating installed translator: ${metadata.label}`);
      } catch (e) {
      }
    }
    const saveFn = Zotero?.Translators?.save;
    if (typeof saveFn !== "function") {
      try {
        Zotero.debug(`[Citation Phoenix] translator install unavailable (no Zotero.Translators.save): ${metadata.label}`);
      } catch (e) {
      }
      return;
    }
    let installed = false;
    try {
      await saveFn.call(Zotero.Translators, metadata, code);
      installed = !!await _getInstalledTranslator(metadata.translatorID);
    } catch (e) {
      try {
        Zotero.debug(`[Citation Phoenix] translator install error (${metadata.label}): ${String(e)}`);
      } catch (_) {
      }
    }
    try {
      Zotero.debug(`[Citation Phoenix] translator ${installed ? "installed" : "install failed"}: ${metadata.label}`);
    } catch (e) {
    }
  }
  async function _ensureBundledTranslatorsInstalled({ dataStore }) {
    for (const file of BUNDLED_TRANSLATOR_FILES) {
      const relPath = `translators/${file}`;
      try {
        await _installTranslatorIfMissing({ dataStore, relPath });
      } catch (e) {
        try {
          Zotero.debug(`[Citation Phoenix] translator install error (${relPath}): ${String(e)}`);
        } catch (_) {
        }
      }
    }
  }
  async function activate({ id, version, rootURI }) {
    _diagnostic(`[Citation Phoenix] activate begin id=${String(id)} version=${String(version)}`);
    const locale = Zotero?.locale || "en-US";
    _ctx = {
      id,
      version,
      rootURI,
      data: new DataStore(rootURI),
      modules: null,
      abbrevs: null,
      caseCourtMapper: null,
      schemaConfig: null,
      patcher: null,
      prefsUI: null
    };
    await _ctx.data.init();
    await _ensureBundledStylesInstalled({ rootURI, dataStore: _ctx.data });
    await _ensureBundledTranslatorsInstalled({ dataStore: _ctx.data });
    _ctx.modules = new ModuleLoader({ rootURI, dataStore: _ctx.data, locale });
    await _ctx.modules.preload();
    _ctx.abbrevs = new AbbrevService({ dataStore: _ctx.data, locale });
    await _ctx.abbrevs.preload();
    _ctx.caseCourtMapper = new CaseCourtMapper({ dataStore: _ctx.data, locale });
    await _ctx.caseCourtMapper.preload();
    _ctx.schemaConfig = new SchemaConfig({ dataStore: _ctx.data });
    await _ctx.schemaConfig.preload();
    _ctx.patcher = new Patcher({
      pluginID: id,
      moduleLoader: _ctx.modules,
      abbrevService: _ctx.abbrevs,
      jurisdiction: Jurisdiction,
      caseCourtMapper: _ctx.caseCourtMapper,
      schemaConfig: _ctx.schemaConfig
    });
    _ctx.patcher.patch();
    _ctx.prefsUI = new PrefsUI({
      pluginID: id,
      rootURI
    });
    await _ctx.prefsUI.register();
    _unregisterCommenterInfoRows();
    try {
      delete Zotero.CitationPhoenixCommenterRowID;
    } catch (e) {
    }
    try {
      delete Zotero.IndigoBookCSLMCommenterRowID;
    } catch (e) {
    }
    Zotero.CitationPhoenixBridge = {
      listPrimaryDatasetOptions() {
        return _ctx?.abbrevs?.listPrimaryDatasetOptions?.() || [];
      },
      listSecondaryDatasetOptions() {
        return _ctx?.abbrevs?.listSecondaryDatasetOptions?.() || [];
      },
      listJurisdictionDatasetOptions() {
        return _ctx?.abbrevs?.listJurisdictionDatasetOptions?.() || [];
      },
      listPrimaryAbbreviations(dataset = "primary-us") {
        return _ctx?.abbrevs?.listPrimaryAbbreviations?.(dataset) || [];
      },
      listSecondaryAbbreviations(dataset = "secondary-us-bluebook") {
        return _ctx?.abbrevs?.listSecondaryContainerTitleAbbreviations?.(dataset) || [];
      },
      upsertSecondaryAbbreviation(datasetOrKey, keyOrValue, maybeValue) {
        const hasDataset = typeof maybeValue !== "undefined";
        const dataset = hasDataset ? datasetOrKey : "secondary-us-bluebook";
        const key = hasDataset ? keyOrValue : datasetOrKey;
        const value = hasDataset ? maybeValue : keyOrValue;
        return !!_ctx?.abbrevs?.upsertSecondaryContainerTitleAbbreviation?.(dataset, key, value);
      },
      removeSecondaryAbbreviation(datasetOrKey, maybeKey) {
        const hasDataset = typeof maybeKey !== "undefined";
        const dataset = hasDataset ? datasetOrKey : "secondary-us-bluebook";
        const key = hasDataset ? maybeKey : datasetOrKey;
        return !!_ctx?.abbrevs?.removeSecondaryContainerTitleAbbreviation?.(dataset, key);
      },
      resetSecondaryAbbreviations(dataset = "secondary-us-bluebook") {
        _ctx?.abbrevs?.resetSecondaryContainerTitleOverrides?.(dataset);
        return true;
      },
      upsertPrimaryAbbreviation(dataset, jurisdiction, category, key, value) {
        return !!_ctx?.abbrevs?.upsertPrimaryAbbreviation?.(dataset, jurisdiction, category, key, value);
      },
      removePrimaryAbbreviation(dataset, jurisdiction, category, key) {
        return !!_ctx?.abbrevs?.removePrimaryAbbreviation?.(dataset, jurisdiction, category, key);
      },
      resetPrimaryAbbreviations(dataset = "primary-us") {
        _ctx?.abbrevs?.resetPrimaryAbbreviations?.(dataset);
        return true;
      },
      listJurisdictionPreferenceEntries(dataset = null) {
        return _ctx?.abbrevs?.listJurisdictionPreferenceEntries?.(dataset) || [];
      },
      upsertJurisdictionPreferenceEntry(dataset, jurisdiction, category, key, value) {
        return !!_ctx?.abbrevs?.upsertJurisdictionPreferenceEntry?.(dataset, jurisdiction, category, key, value);
      },
      removeJurisdictionPreferenceEntry(dataset, jurisdiction, category, key) {
        return !!_ctx?.abbrevs?.removeJurisdictionPreferenceEntry?.(dataset, jurisdiction, category, key);
      },
      resetJurisdictionPreferenceOverrides(dataset = null) {
        _ctx?.abbrevs?.resetJurisdictionPreferenceOverrides?.(dataset);
        return true;
      },
      importOverrides(kind, dataset, payload) {
        return _ctx?.abbrevs?.importOverrides?.(kind, dataset, payload) || {
          added: 0,
          updated: 0,
          skipped: 0,
          error: "Import bridge unavailable.",
          skipReasons: []
        };
      }
    };
    Zotero.IndigoBookCSLMBridge = Zotero.CitationPhoenixBridge;
    _diagnostic(`[Citation Phoenix] activated v${version}`);
  }
  async function deactivate() {
    try {
      _diagnostic("[Citation Phoenix] deactivate begin");
      try {
        delete Zotero.CitationPhoenixBridge;
      } catch (e) {
      }
      try {
        delete Zotero.IndigoBookCSLMBridge;
      } catch (e) {
      }
      _unregisterCommenterInfoRows();
      try {
        delete Zotero.CitationPhoenixCommenterRowID;
      } catch (e) {
      }
      try {
        delete Zotero.IndigoBookCSLMCommenterRowID;
      } catch (e) {
      }
      _ctx?.prefsUI?.unregister?.();
      _ctx?.patcher?.unpatch();
    } finally {
      _diagnostic("[Citation Phoenix] deactivate complete");
      _ctx = null;
    }
  }
  return __toCommonJS(main_exports);
})();
