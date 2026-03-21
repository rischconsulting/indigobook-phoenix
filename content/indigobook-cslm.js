var IndigoBookCSLM = (() => {
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
        this.loadJSON("data/auto-us.json").catch(() => null),
        this.loadJSON("data/juris-us-map.json").catch(() => null),
        this.loadJSON("data/primary-jurisdictions.json").catch(() => null),
        this.loadJSON("data/primary-us.json").catch(() => null),
        this.loadJSON("data/secondary-us-bluebook.json").catch(() => null),
        this.loadJSON("style-modules/index.json").catch(() => null)
      ]);
    }
    async loadText(relPath) {
      if (this.cache.has(relPath)) return this.cache.get(relPath);
      const url = this.rootURI.spec + relPath;
      const req = await Zotero.HTTP.request("GET", url);
      const text = req.response;
      this.cache.set(relPath, text);
      return text;
    }
    async loadJSON(relPath) {
      if (this.cache.has(relPath)) return this.cache.get(relPath);
      const text = await this.loadText(relPath);
      const obj = JSON.parse(text);
      this.cache.set(relPath, obj);
      return obj;
    }
  };

  // lib/services/jurisdiction.mjs
  var Jurisdiction = class {
    static fromItem(item) {
      const extra = (item.getField?.("extra") || item.extra || "") + "";
      let jur = this._fromMLZ(extra) || this._fromKeyValue(extra);
      if (!jur) jur = "us";
      return this._normalizeJurisdiction(jur);
    }
    static getMLZExtraFields(itemOrExtra) {
      const extra = typeof itemOrExtra === "string" ? itemOrExtra : itemOrExtra?.getField?.("extra") || itemOrExtra?.extra || "";
      const jsonText = this._extractMLZJSON(extra);
      if (!jsonText) return null;
      try {
        const obj = JSON.parse(jsonText);
        return obj?.extrafields || null;
      } catch (e) {
        return null;
      }
    }
    static _fromMLZ(extra) {
      const fields = this.getMLZExtraFields(extra);
      const j = fields?.jurisdiction;
      if (!j) return null;
      return this._decodeLengthPrefixedJurisdiction(j);
    }
    static _extractMLZJSON(extra) {
      const idx = (extra || "").indexOf("mlzsync1:");
      if (idx === -1) return null;
      const braceStart = extra.indexOf("{", idx);
      if (braceStart === -1) return null;
      let depth = 0;
      let inString = false;
      let escaping = false;
      for (let i = braceStart; i < extra.length; i += 1) {
        const ch = extra[i];
        if (inString) {
          if (escaping) {
            escaping = false;
          } else if (ch === "\\") {
            escaping = true;
          } else if (ch === '"') {
            inString = false;
          }
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
            return extra.slice(braceStart, i + 1);
          }
        }
      }
      return null;
    }
    static _decodeLengthPrefixedJurisdiction(s) {
      if (!s || s.length < 4) return null;
      const prefix = s.slice(0, 3);
      if (!/^\d{3}$/.test(prefix)) return s;
      const len = parseInt(prefix, 10);
      const code = s.slice(3, 3 + len);
      return code || null;
    }
    static _fromKeyValue(extra) {
      const m = extra.match(/^\s*jurisdiction\s*:\s*([^\s\n\r]+)\s*$/im);
      return m ? m[1] : null;
    }
    static _normalizeJurisdiction(jur) {
      let value = (jur || "").toString().trim().toLowerCase();
      if (!value) return "us";
      if (/^us(?::[a-z0-9._-]+)*$/.test(value)) return value;
      if (/^[a-z]{2}$/.test(value)) return `us:${value}`;
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
      const compact = value.replace(/[^a-z]/g, "");
      if (byName[compact]) return byName[compact];
      return value;
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
    constructor({ rootURI, dataStore }) {
      this.rootURI = rootURI;
      this.dataStore = dataStore;
      this._availableFiles = [];
      this._byFile = /* @__PURE__ */ new Map();
      this._byJur = /* @__PURE__ */ new Map();
    }
    async preload() {
      const idx = await this.dataStore.loadJSON("style-modules/index.json");
      this._availableFiles = idx?.files || [];
      for (const file of this._availableFiles) {
        const path = "style-modules/" + file;
        const xml = await this.dataStore.loadText(path);
        this._byFile.set(file, xml);
        const jur = this._jurFromFilename(file);
        if (jur) this._byJur.set(jur, xml);
      }
      if (!this._byJur.has("us")) {
        const baseFile = this._availableFiles.find((f) => f === "juris-us-IndigoTemp.csl");
        if (baseFile) this._byJur.set("us", this._byFile.get(baseFile));
      }
    }
    _jurFromFilename(file) {
      const m = file.match(/^juris-us\+(.+)-IndigoTemp\.csl$/);
      if (m) return "us:" + m[1];
      if (file === "juris-us-IndigoTemp.csl") return "us";
      return null;
    }
    hasJurisdiction(jur) {
      return this._byJur.has((jur || "").toLowerCase());
    }
    loadJurisdictionStyleSync(jurisdiction, variantName = "IndigoTemp") {
      const variant = variantName || "IndigoTemp";
      if (variant !== "IndigoTemp") return null;
      let jur = (jurisdiction || "us").toLowerCase();
      if (Jurisdiction.isCircuit(jur)) return this._byJur.get("us") || null;
      for (const j of Jurisdiction.trimChain(jur)) {
        if (this._byJur.has(j)) return this._byJur.get(j);
      }
      return this._byJur.get("us") || null;
    }
  };

  // lib/services/abbrevService.mjs
  var AbbrevService = class {
    constructor({ dataStore }) {
      this.dataStore = dataStore;
      this._autoUS = null;
      this._primaryUS = null;
      this._secondaryUS = null;
      this._primaryJur = null;
    }
    async preload() {
      this._autoUS = await this.dataStore.loadJSON("data/auto-us.json");
      this._primaryUS = await this.dataStore.loadJSON("data/primary-us.json");
      this._secondaryUS = await this.dataStore.loadJSON("data/secondary-us-bluebook.json");
      this._primaryJur = await this.dataStore.loadJSON("data/primary-jurisdictions.json");
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
      const preferredJur = (jur || "default").toLowerCase();
      const noHints = !!options.noHints;
      const normalizedKey = this.normalizeKey(key);
      let hit = null;
      if (category === "institution-part") {
        hit = lookupJurChainWithSource(this._autoUS?.xdata, preferredJur === "default" ? "us" : preferredJur, "institution-part", key) || lookupJurChainWithSource(this._autoUS?.xdata, preferredJur === "default" ? "us" : preferredJur, "institution-part", normalizedKey);
        if (hit?.value) return { jurisdiction: hit.jurisdiction, value: hit.value };
        return null;
      }
      if (category === "place") {
        const upper = preferredJur.toUpperCase();
        const value = this._primaryJur?.xdata?.default?.place?.[upper] || this._autoUS?.xdata?.default?.place?.[upper] || null;
        return value ? { jurisdiction: "default", value } : null;
      }
      if (category === "container-title") {
        hit = lookupJurChainWithSource(this._primaryUS?.xdata, preferredJur === "default" ? "us" : preferredJur, "container-title", normalizedKey);
        if (hit?.value) return { jurisdiction: hit.jurisdiction || preferredJur, value: hit.value };
        const secondaryValue = this._secondaryUS?.xdata?.default?.["container-title"]?.[normalizedKey] || null;
        if (secondaryValue) return { jurisdiction: "default", value: secondaryValue };
        if (!noHints) {
          const fallback = this.abbreviateContainerTitleFallback(key, preferredJur);
          if (fallback) return { jurisdiction: preferredJur === "default" ? "default" : preferredJur, value: fallback };
        }
      }
      if (category === "title") {
        hit = lookupJurChainWithSource(this._primaryUS?.xdata, preferredJur === "default" ? "us" : preferredJur, "title", normalizedKey);
        if (hit?.value) return { jurisdiction: hit.jurisdiction || preferredJur, value: hit.value };
        if (!noHints) {
          const fallback = this.abbreviateTitleFallback(key, preferredJur);
          if (fallback) return { jurisdiction: preferredJur === "default" ? "default" : preferredJur, value: fallback };
        }
      }
      return null;
    }
    lookupSync(listname, key, jur) {
      return this.lookupForCiteProc(listname, key, jur)?.value || null;
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
      const normalizedJur = jur === "default" ? "us" : jur;
      for (const category of categories) {
        const primaryHit = lookupJurChainWithSource(this._primaryUS?.xdata, normalizedJur, category, normalized);
        if (primaryHit?.value) return primaryHit;
        const secondaryValue = this._secondaryUS?.xdata?.default?.[category]?.[normalized] || this._secondaryUS?.xdata?.default?.["container-title"]?.[normalized] || null;
        if (secondaryValue) return { jurisdiction: "default", value: secondaryValue };
      }
      return null;
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
  };
  function lookupJurChainWithSource(xdata, jur, variable, key) {
    if (!xdata) return null;
    const parts = (jur || "us").toLowerCase().split(":");
    for (let i = parts.length; i >= 1; i--) {
      const jj = parts.slice(0, i).join(":");
      const obj2 = xdata?.[jj]?.[variable];
      if (obj2 && obj2[key] != null) return { jurisdiction: jj, value: obj2[key] };
    }
    const obj = xdata?.["us"]?.[variable];
    if (obj && obj[key] != null) return { jurisdiction: "us", value: obj[key] };
    return null;
  }

  // lib/services/patcher.mjs
  var Patcher = class {
    constructor({ moduleLoader, abbrevService, jurisdiction }) {
      this.moduleLoader = moduleLoader;
      this.abbrevService = abbrevService;
      this.Jurisdiction = jurisdiction;
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
    }
    patch() {
      this._patchRetrieveItem();
      this._patchAbbreviations();
      this._patchLoadJurisdictionStyle();
      this._patchGetCiteProcFallback();
    }
    unpatch() {
      const sysProto = Zotero?.Cite?.System?.prototype;
      if (sysProto) {
        if (this._orig.retrieveItem) sysProto.retrieveItem = this._orig.retrieveItem;
        if (this._orig.getAbbreviation) sysProto.getAbbreviation = this._orig.getAbbreviation;
        if (this._orig.normalizeAbbrevsKey) sysProto.normalizeAbbrevsKey = this._orig.normalizeAbbrevsKey;
        if (this._orig.loadJurisdictionStyle) sysProto.loadJurisdictionStyle = this._orig.loadJurisdictionStyle;
        if (this._orig.retrieveStyleModule) sysProto.retrieveStyleModule = this._orig.retrieveStyleModule;
      }
      if (this._orig.getCiteProc) Zotero.Style.prototype.getCiteProc = this._orig.getCiteProc;
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
        if (!cslItem.title) {
          const title = zotItem.getField?.("title");
          if (title) cslItem.title = title;
        }
        if (!cslItem["container-title"]) {
          const containerTitle = zotItem.getField?.("publicationTitle") || zotItem.getField?.("reporter") || zotItem.getField?.("report") || mlzFields?.reporter || "";
          if (containerTitle) cslItem["container-title"] = containerTitle;
          else this._logField("missing-container-title-source", `itemType=${String(cslItem.type)} title=${String(cslItem.title || "")}`);
        }
        if (!cslItem.authority) {
          const court = zotItem.getField?.("court") || "";
          if (court) {
            const normalizedCourt = String(court).trim().replace(/[._]+/g, " ").replace(/\s+/g, " ").toLowerCase();
            cslItem.authority = [{ literal: normalizedCourt || String(court) }];
          }
        }
      } catch (e) {
        this._warnRetrieveItem(`hydrateCSLItemFromZotero failed: ${String(e)}`);
      }
    }
    _decorateShortForms(cslItem, jur) {
      try {
        if (!cslItem["container-title-short"] && cslItem["container-title"]) {
          const hit = this.abbrevService.lookupForCiteProc("container-title", cslItem["container-title"], jur, { noHints: false });
          if (hit?.value) {
            cslItem["container-title-short"] = this.abbrevService.parseDirective(hit.value).value;
            this._logShortForm("container-title", cslItem["container-title"], cslItem["container-title-short"], "hit");
          } else {
            this._logShortForm("container-title", cslItem["container-title"], null, "miss");
          }
        }
        if (!cslItem["title-short"] && cslItem.title) {
          const hit = this.abbrevService.lookupForCiteProc("title", cslItem.title, jur, { noHints: false });
          if (hit?.value) {
            cslItem["title-short"] = this.abbrevService.parseDirective(hit.value).value;
            this._logShortForm("title", cslItem.title, cslItem["title-short"], "hit");
          } else {
            this._logShortForm("title", cslItem.title, null, "miss");
          }
        }
      } catch (e) {
        this._warnRetrieveItem(`decorateShortForms failed: ${String(e)}`);
      }
    }
    _logShortForm(category, source, value, stage) {
      if (this._shortFormLogCount >= this._maxShortFormLogs) return;
      this._shortFormLogCount += 1;
      const msg = `[IndigoBook CSL-M] shortForm[${this._shortFormLogCount}] ${stage}: category=${category} source=${String(source)} value=${String(value)}`;
      try {
        Zotero.debug(msg);
      } catch (e) {
      }
    }
    _logField(stage, detail) {
      if (this._fieldLogCount >= this._maxFieldLogs) return;
      this._fieldLogCount += 1;
      const msg = `[IndigoBook CSL-M] field[${this._fieldLogCount}] ${stage}: ${detail}`;
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
        const msg = `[IndigoBook CSL-M] renderProbe item(${stage}): jur=${String(jur)} type=${String(cslItem?.type || "")} container-title=${source} container-title-short=${String(cslItem?.["container-title-short"] || "")} title=${String(cslItem?.title || "")} title-short=${String(cslItem?.["title-short"] || "")}`;
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
        const msg = `[IndigoBook CSL-M] renderProbe abbr(${stage}): category=${String(category)} jur=${String(jurisdiction)} noHints=${String(!!noHints)} key=${String(key)} normalized=${normalized}`;
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
      const msg = `[IndigoBook CSL-M] retrieveItem[${this._retrieveItemLogCount}] ${stage}: inputID(${inType})=${String(inputID)} => cslItem.id(${outType})=${String(outputID)}`;
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
        Zotero.debug(`[IndigoBook CSL-M] retrieveItem patch warning: ${reason}`);
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
          const hit = self.abbrevService.lookupForCiteProc(category, key, jur, { noHints });
          if (hit?.value) {
            const targetJur = hit.jurisdiction || jur || "default";
            if (!obj[targetJur]) obj[targetJur] = self._newAbbreviationSegments(this);
            if (!obj[targetJur][category]) obj[targetJur][category] = {};
            obj[targetJur][category][key] = self.abbrevService.parseDirective(hit.value).value;
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
      const msg = `[IndigoBook CSL-M] getAbbreviation[${this._abbrevLogCount}] ${stage}: category=${category} jurisdiction=${jurisdiction} key=${String(key)} value=${String(value)}`;
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
        if (xml) return xml;
        if (self._orig.loadJurisdictionStyle) return self._orig.loadJurisdictionStyle.call(this, jurisdiction, variantName);
        return null;
      };
      sysProto.retrieveStyleModule = function(jurisdiction, variantName) {
        const xml = self.moduleLoader.loadJurisdictionStyleSync(jurisdiction, variantName);
        if (xml) return xml;
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
              Zotero.debug("[IndigoBook CSL-M] Replaced empty IndigoTemp citation layout with base juris-us.csl");
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
      try {
        const methodList = [
          "processCitationCluster",
          "previewCitationCluster",
          "appendCitationCluster",
          "makeBibliography",
          "updateItems"
        ];
        const available = methodList.filter((name) => typeof citeproc[name] === "function").join(",");
        Zotero.debug(`[IndigoBook CSL-M] renderProbe citeproc instrumentation: methods=${available || "none"}`);
      } catch (e) {
      }
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
    _logCitationBranchProbe(methodName, citation) {
      try {
        const items = this._extractCitationItems(citation);
        if (!Array.isArray(items) || !items.length) return;
        for (const citationItem of items) {
          const itemID = citationItem?.id ?? citationItem?.itemID ?? citationItem?.itemId ?? null;
          if (!this._isHarvardCRCLFromItemID(itemID)) continue;
          const pos = citationItem?.position;
          const nearNote = !!(citationItem?.["near-note"] || citationItem?.nearNote);
          const hasLocator = citationItem?.locator != null && String(citationItem.locator).trim() !== "";
          let branch = "full";
          if (pos === 2 || pos === "ibid-with-locator") branch = "ibid-with-locator";
          else if (pos === 1 || pos === "ibid") branch = "ibid";
          else if (nearNote || pos === 3 || pos === "subsequent") branch = "short";
          const msg = `[IndigoBook CSL-M] renderProbe citeproc(${methodName}): branch=${branch} position=${String(pos)} near-note=${String(nearNote)} locator=${String(citationItem?.locator || "")} itemID=${String(itemID)}`;
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
        const ids = items.map((citationItem) => citationItem?.id ?? citationItem?.itemID ?? citationItem?.itemId ?? null).filter((id) => id != null).map((id) => String(id)).join(",");
        Zotero.debug(`[IndigoBook CSL-M] renderProbe citeproc start(${methodName}): args=${String(args?.length || 0)} ids=${ids || "none"}`);
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
        Zotero.debug(`[IndigoBook CSL-M] renderProbe citeproc end(${methodName}): result=${shape}`);
      } catch (e) {
      }
    }
    _logCiteprocMethodError(methodName, error) {
      try {
        const msg = `[IndigoBook CSL-M] renderProbe citeproc error(${methodName}): ${String(error)} stack=${String(error?.stack || "")}`;
        Zotero.debug(msg);
        Zotero.logError(msg);
      } catch (e) {
      }
    }
    _isHarvardCRCLFromItemID(id) {
      try {
        const zotItem = this._getZoteroItemByAnyID(id);
        if (!zotItem) return false;
        const containerTitle = zotItem.getField?.("publicationTitle") || zotItem.getField?.("reporter") || zotItem.getField?.("report") || "";
        return this._isHarvardCRCL(containerTitle);
      } catch (e) {
      }
      return false;
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
        Zotero.debug(`[IndigoBook CSL-M] Sync style fallback unavailable: ${reason}. Preload style XML during activation.`);
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

  // lib/main.mjs
  var _ctx;
  async function activate({ id, version, rootURI }) {
    _ctx = {
      id,
      version,
      rootURI,
      data: new DataStore(rootURI),
      modules: null,
      abbrevs: null,
      patcher: null
    };
    await _ctx.data.init();
    _ctx.modules = new ModuleLoader({ rootURI, dataStore: _ctx.data });
    await _ctx.modules.preload();
    _ctx.abbrevs = new AbbrevService({ dataStore: _ctx.data });
    await _ctx.abbrevs.preload();
    _ctx.patcher = new Patcher({
      moduleLoader: _ctx.modules,
      abbrevService: _ctx.abbrevs,
      jurisdiction: Jurisdiction
    });
    _ctx.patcher.patch();
    Zotero.debug(`[IndigoBook CSL-M] activated v${version}`);
  }
  async function deactivate() {
    try {
      _ctx?.patcher?.unpatch();
    } finally {
      _ctx = null;
    }
  }
  return __toCommonJS(main_exports);
})();
