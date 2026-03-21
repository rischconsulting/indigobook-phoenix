export class AbbrevService {
  constructor({ dataStore }) {
    this.dataStore = dataStore;
    this._autoUS = null;
    this._primaryUS = null;
    this._secondaryUS = null;
    this._jurisUSMap = null;
    this._primaryJur = null;
    this._userSecondaryOverrides = {};
    this._secondaryOverridesPref = 'extensions.indigobook-cslm.secondaryContainerTitleOverrides';
    this._userJurisdictionOverrides = {};
    this._jurisdictionOverridesPref = 'extensions.indigobook-cslm.jurisdictionOverrides';
  }

  async preload() {
    this._autoUS = await this.dataStore.loadJSON('data/auto-us.json');
    this._primaryUS = await this.dataStore.loadJSON('data/primary-us.json');
    this._secondaryUS = await this.dataStore.loadJSON('data/secondary-us-bluebook.json');
    this._jurisUSMap = await this.dataStore.loadJSON('data/juris-us-map.json');
    this._primaryJur = await this.dataStore.loadJSON('data/primary-jurisdictions.json');
    this._userSecondaryOverrides = this._loadSecondaryOverrides();
    this._userJurisdictionOverrides = this._loadJurisdictionOverrides();
  }

  normalizeKey(s) {
    return (s || '')
      .toString()
      .trim()
      .toLowerCase()
      .replace(/[“”]/g, '"')
      .replace(/[’]/g, "'")
      .replace(/[^a-z0-9\s\.-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  parseDirective(val) {
    if (!val) return { value: val, directive: null };
    const m = /^!([a-z-]+)\>\>\>(.+)$/.exec(val);
    if (!m) return { value: val, directive: null };
    return { value: m[2], directive: m[1] };
  }

  lookupForCiteProc(category, key, jur, options = {}) {
    const preferredJur = (jur || 'default').toLowerCase();
    const noHints = !!options.noHints;
    const normalizedKey = this.normalizeKey(key);
    let hit = null;

    if (category === 'institution-part') {
      hit = lookupJurChainWithOverrides(
        this._autoUS?.xdata,
        this._userJurisdictionOverrides?.['auto-us'],
        preferredJur === 'default' ? 'us' : preferredJur,
        'institution-part',
        key,
      ) || lookupJurChainWithOverrides(
        this._autoUS?.xdata,
        this._userJurisdictionOverrides?.['auto-us'],
        preferredJur === 'default' ? 'us' : preferredJur,
        'institution-part',
        normalizedKey,
      );
      if (hit?.value) return { jurisdiction: hit.jurisdiction, value: hit.value };
      return null;
    }

    if (category === 'place') {
      const upper = preferredJur.toUpperCase();
      const value = this._primaryJur?.xdata?.default?.place?.[upper]
        || this._autoUS?.xdata?.default?.place?.[upper]
        || null;
      return value ? { jurisdiction: 'default', value } : null;
    }

    if (category === 'container-title') {
      hit = lookupJurChainWithOverrides(
        this._primaryUS?.xdata,
        this._userJurisdictionOverrides?.['primary-us'],
        preferredJur === 'default' ? 'us' : preferredJur,
        'container-title',
        normalizedKey,
      );
      if (hit?.value) return { jurisdiction: hit.jurisdiction || preferredJur, value: hit.value };

      const secondaryValue = this._lookupSecondaryContainerTitle(normalizedKey);
      if (secondaryValue) return { jurisdiction: 'default', value: secondaryValue };

      if (!noHints) {
        const fallback = this.abbreviateContainerTitleFallback(key, preferredJur);
        if (fallback) return { jurisdiction: preferredJur === 'default' ? 'default' : preferredJur, value: fallback };
      }
    }

    if (category === 'title') {
      hit = lookupJurChainWithOverrides(
        this._primaryUS?.xdata,
        this._userJurisdictionOverrides?.['primary-us'],
        preferredJur === 'default' ? 'us' : preferredJur,
        'title',
        normalizedKey,
      );
      if (hit?.value) return { jurisdiction: hit.jurisdiction || preferredJur, value: hit.value };

      if (!noHints) {
        const fallback = this.abbreviateTitleFallback(key, preferredJur);
        if (fallback) return { jurisdiction: preferredJur === 'default' ? 'default' : preferredJur, value: fallback };
      }
    }

    return null;
  }

  lookupSync(listname, key, jur) {
    return this.lookupForCiteProc(listname, key, jur)?.value || null;
  }

  listAutoUSPlaceJurisdictions() {
    const place = this._autoUS?.xdata?.default?.place || {};
    return Object.keys(place)
      .map((key) => {
        const code = String(key || '').trim().toLowerCase();
        return {
          code,
          label: this.formatJurisdictionDisplay(code),
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label) || a.code.localeCompare(b.code));
  }

  formatJurisdictionDisplay(rawJurisdiction) {
    const jurisdiction = (rawJurisdiction || '').toString().trim().toLowerCase();
    if (!jurisdiction) return '';

    const parts = jurisdiction.split(':').filter(Boolean);
    if (!parts.length) return '';
    if (parts[0] !== 'us') return jurisdiction;

    const labels = [String(this._autoUS?.name || 'United States').trim(), 'US'];
    let chain = 'us';

    for (let index = 1; index < parts.length; index += 1) {
      chain = `${chain}:${parts[index]}`;
      const label = this._lookupJurisdictionPlaceLabel(chain) || parts[index].toUpperCase();
      labels.push(this._normalizeJurisdictionDisplayLabel(chain, label));
    }

    return labels.join('|');
  }

  listInstitutionPartOptionsForJurisdiction(rawJurisdiction) {
    const jurisdiction = (rawJurisdiction || 'us').toString().trim().toLowerCase() || 'us';
    const normalizedJurisdiction = jurisdiction === 'default' ? 'us' : jurisdiction;
    const rows = [];

    const entries = this._autoUS?.xdata?.[normalizedJurisdiction]?.['institution-part'];
    if (entries && typeof entries === 'object' && !Array.isArray(entries)) {
      for (const key of Object.keys(entries)) {
        const normalizedKey = this.normalizeKey(key);
        if (!normalizedKey) continue;
        rows.push({
          key: normalizedKey,
          label: this.formatInstitutionPartDisplay(normalizedKey),
          abbreviation: String(entries[key] ?? '').trim(),
          jurisdiction: normalizedJurisdiction,
          isChild: false,
        });
      }
    }

    return rows.sort((a, b) => a.label.localeCompare(b.label) || a.key.localeCompare(b.key));
  }

  listInstitutionPartOptionsForJurisdictionTree(rawJurisdiction) {
    const jurisdiction = (rawJurisdiction || 'us').toString().trim().toLowerCase() || 'us';
    const normalizedJurisdiction = jurisdiction === 'default' ? 'us' : jurisdiction;
    const rows = [];

    // Courts at the exact jurisdiction level — no jurisdiction prefix in label.
    const exactEntries = this._autoUS?.xdata?.[normalizedJurisdiction]?.['institution-part'];
    if (exactEntries && typeof exactEntries === 'object' && !Array.isArray(exactEntries)) {
      for (const key of Object.keys(exactEntries)) {
        const normalizedKey = this.normalizeKey(key);
        if (!normalizedKey) continue;
        rows.push({
          key: normalizedKey,
          label: this.formatInstitutionPartDisplay(normalizedKey),
          abbreviation: String(exactEntries[key] ?? '').trim(),
          jurisdiction: normalizedJurisdiction,
          isChild: false,
        });
      }
    }

    // Courts from every child jurisdiction — labeled "PlaceAbbrev: Court Name".
    const childPrefix = `${normalizedJurisdiction}:`;
    for (const childJur of Object.keys(this._autoUS?.xdata || {}).sort()) {
      if (!childJur.startsWith(childPrefix)) continue;
      const childEntries = this._autoUS.xdata[childJur]?.['institution-part'];
      if (!childEntries || typeof childEntries !== 'object' || Array.isArray(childEntries)) continue;

      const placeLabel = this._lookupJurisdictionPlaceLabel(childJur) || childJur;
      for (const key of Object.keys(childEntries)) {
        const normalizedKey = this.normalizeKey(key);
        if (!normalizedKey) continue;
        rows.push({
          key: normalizedKey,
          label: `${placeLabel}: ${this.formatInstitutionPartDisplay(normalizedKey)}`,
          abbreviation: String(childEntries[key] ?? '').trim(),
          jurisdiction: childJur,
          isChild: true,
        });
      }
    }

    return rows.sort((a, b) => {
      if (!a.isChild && b.isChild) return -1;
      if (a.isChild && !b.isChild) return 1;
      return a.label.localeCompare(b.label) || a.key.localeCompare(b.key);
    });
  }

  formatInstitutionPartDisplay(rawKey) {
    const key = this.normalizeKey(rawKey);
    if (!key) return '';

    const mapped = this._lookupCourtDisplayLabel(key);
    if (mapped) return mapped;

    return key
      .split('.')
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  abbreviateContainerTitleFallback(title, jur) {
    return this._abbreviateByWords(title, jur, ['container-title']);
  }

  abbreviateTitleFallback(title, jur) {
    return this._abbreviateByWords(title, jur, ['title', 'container-title']);
  }

  _abbreviateByWords(title, jur, categories) {
    const source = (title || '').toString().trim();
    if (!source) return null;

    const segments = this._tokenizeWordAndSeparatorSegments(source);
    const hasWord = segments.some((segment) => segment.type === 'word');
    if (!hasWord) return null;

    const output = [];
    for (let index = 0; index < segments.length; ) {
      const segment = segments[index];
      if (segment.type !== 'word') {
        output.push(segment.text);
        index += 1;
        continue;
      }

      const phraseWords = [];
      let bestMatch = null;

      for (let scan = index; scan < segments.length && phraseWords.length < 4; scan += 1) {
        if (segments[scan].type !== 'word') continue;
        phraseWords.push(segments[scan].text);

        const normalized = this.normalizeKey(phraseWords.join(' '));
        const hit = this._lookupFallbackPhrase(normalized, jur, categories);
        if (hit?.value) {
          bestMatch = {
            value: this.parseDirective(hit.value).value,
            endIndex: scan,
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

    const abbreviated = output.join('').trim();
    return abbreviated && abbreviated !== source ? abbreviated : null;
  }

  _tokenizeWordAndSeparatorSegments(source) {
    const segments = [];
    const matcher = /([A-Za-z0-9]+|[^A-Za-z0-9]+)/g;
    let match;
    while ((match = matcher.exec(source)) !== null) {
      const text = match[0];
      segments.push({
        type: /^[A-Za-z0-9]+$/.test(text) ? 'word' : 'sep',
        text,
      });
    }
    return segments;
  }

  _abbreviateSingleToken(token, jur, categories) {
    const parts = token.match(/^([^A-Za-z0-9]*)(.*?)([^A-Za-z0-9]*)$/);
    if (!parts) return token;

    const prefix = parts[1] || '';
    const core = parts[2] || '';
    const suffix = parts[3] || '';
    if (!core) return token;

    // Handle compounds like "Rights-Civil" by abbreviating each side independently.
    const compoundParts = core.split(/([-\u2010-\u2015])/);
    const abbreviatedCore = compoundParts
      .map((part) => (/^[-\u2010-\u2015]$/.test(part) ? part : this._abbreviateCoreWord(part, jur, categories)))
      .join('');

    const safeSuffix = abbreviatedCore.endsWith('.') && suffix.startsWith('.') ? suffix.slice(1) : suffix;
    return `${prefix}${abbreviatedCore}${safeSuffix}`;
  }

  _abbreviateCoreWord(word, jur, categories) {
    const normalized = this.normalizeKey(word);
    if (!normalized) return word;

    const hit = this._lookupFallbackPhrase(normalized, jur, categories)
      || this._lookupSupplementalWord(normalized);
    if (!hit?.value) return word;

    return this.parseDirective(hit.value).value;
  }

  _lookupFallbackPhrase(normalized, jur, categories) {
    const normalizedJur = jur === 'default' ? 'us' : jur;
    for (const category of categories) {
      const primaryHit = lookupJurChainWithOverrides(
        this._primaryUS?.xdata,
        this._userJurisdictionOverrides?.['primary-us'],
        normalizedJur,
        category,
        normalized,
      );
      if (primaryHit?.value) return primaryHit;

      const secondaryValue = (category === 'container-title')
        ? this._lookupSecondaryContainerTitle(normalized)
        : this._secondaryUS?.xdata?.default?.[category]?.[normalized]
          || this._lookupSecondaryContainerTitle(normalized)
          || null;
      if (secondaryValue) return { jurisdiction: 'default', value: secondaryValue };
    }
    return null;
  }

  _lookupJurisdictionPlaceLabel(rawJurisdiction) {
    const jurisdiction = (rawJurisdiction || '').toString().trim().toUpperCase();
    if (!jurisdiction) return null;

    return this._primaryJur?.xdata?.default?.place?.[jurisdiction]
      || this._autoUS?.xdata?.default?.place?.[jurisdiction]
      || null;
  }

  _lookupCourtDisplayLabel(rawKey) {
    const key = this.normalizeKey(rawKey);
    if (!key) return null;

    const courts = this._jurisUSMap?.courts;
    if (!Array.isArray(courts)) return null;

    for (const item of courts) {
      if (!Array.isArray(item) || item.length < 2) continue;
      if (this.normalizeKey(item[0]) !== key) continue;
      const value = String(item[1] ?? '').trim();
      if (value) return value;
    }
    return null;
  }

  _normalizeJurisdictionDisplayLabel(jurisdiction, label) {
    if ((jurisdiction || '').toLowerCase() === 'us') return 'US';
    return String(label || '').trim();
  }

  listSecondaryContainerTitleAbbreviations() {
    const base = this._secondaryUS?.xdata?.default?.['container-title'] || {};
    const merged = { ...base, ...this._userSecondaryOverrides };
    return Object.keys(merged)
      .sort((a, b) => a.localeCompare(b))
      .map((key) => ({
        key,
        value: merged[key],
        source: Object.prototype.hasOwnProperty.call(this._userSecondaryOverrides, key) ? 'user' : 'base',
      }));
  }

  upsertSecondaryContainerTitleAbbreviation(rawKey, rawValue) {
    const key = this.normalizeKey(rawKey);
    const value = (rawValue || '').toString().trim();
    if (!key || !value) return false;
    this._userSecondaryOverrides[key] = value;
    this._saveSecondaryOverrides();
    return true;
  }

  removeSecondaryContainerTitleAbbreviation(rawKey) {
    const key = this.normalizeKey(rawKey);
    if (!key) return false;
    if (!Object.prototype.hasOwnProperty.call(this._userSecondaryOverrides, key)) return false;
    delete this._userSecondaryOverrides[key];
    this._saveSecondaryOverrides();
    return true;
  }

  resetSecondaryContainerTitleOverrides() {
    this._userSecondaryOverrides = {};
    this._saveSecondaryOverrides();
  }

  listJurisdictionPreferenceEntries() {
    const rows = [];
    this._collectXDataRows(rows, 'primary-us', this._primaryUS?.xdata);
    this._collectXDataRows(rows, 'auto-us', this._autoUS?.xdata);
    this._collectJurisMapRows(rows);

    return rows
      .sort((a, b) => {
        return a.dataset.localeCompare(b.dataset)
          || a.jurisdiction.localeCompare(b.jurisdiction)
          || a.category.localeCompare(b.category)
          || a.key.localeCompare(b.key);
      })
      .map((row) => ({
        ...row,
        source: this._getJurisdictionOverrideValue(row.id) != null ? 'user' : 'base',
        value: this._getJurisdictionOverrideValue(row.id) ?? row.value,
      }));
  }

  upsertJurisdictionPreferenceEntry(dataset, jurisdiction, category, key, value) {
    const ds = (dataset || '').toString().trim();
    const id = this._makeJurisdictionDatasetOverrideKey(jurisdiction, category, key);
    const val = (value || '').toString().trim();
    if (!ds || !id || !val) return false;
    if (!this._userJurisdictionOverrides[ds] || typeof this._userJurisdictionOverrides[ds] !== 'object') {
      this._userJurisdictionOverrides[ds] = {};
    }
    this._userJurisdictionOverrides[ds][id] = val;
    this._saveJurisdictionOverrides();
    return true;
  }

  removeJurisdictionPreferenceEntry(dataset, jurisdiction, category, key) {
    const ds = (dataset || '').toString().trim();
    const id = this._makeJurisdictionDatasetOverrideKey(jurisdiction, category, key);
    if (!ds || !id) return false;
    const bucket = this._userJurisdictionOverrides?.[ds];
    if (!bucket || !Object.prototype.hasOwnProperty.call(bucket, id)) return false;
    delete bucket[id];
    this._saveJurisdictionOverrides();
    return true;
  }

  resetJurisdictionPreferenceOverrides() {
    this._userJurisdictionOverrides = {};
    this._saveJurisdictionOverrides();
  }

  _lookupSecondaryContainerTitle(normalizedKey) {
    if (!normalizedKey) return null;
    if (Object.prototype.hasOwnProperty.call(this._userSecondaryOverrides, normalizedKey)) {
      return this._userSecondaryOverrides[normalizedKey];
    }
    return this._secondaryUS?.xdata?.default?.['container-title']?.[normalizedKey] || null;
  }

  _loadSecondaryOverrides() {
    try {
      const raw = Zotero?.Prefs?.get?.(this._secondaryOverridesPref);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      const cleaned = {};
      for (const [k, v] of Object.entries(parsed)) {
        const key = this.normalizeKey(k);
        const value = (v || '').toString().trim();
        if (key && value) cleaned[key] = value;
      }
      return cleaned;
    } catch (e) {
      return {};
    }
  }

  _saveSecondaryOverrides() {
    try {
      Zotero?.Prefs?.set?.(this._secondaryOverridesPref, JSON.stringify(this._userSecondaryOverrides || {}));
    } catch (e) {}
  }

  _makeJurisdictionOverrideID(dataset, jurisdiction, category, key) {
    const ds = (dataset || '').toString().trim();
    const inner = this._makeJurisdictionDatasetOverrideKey(jurisdiction, category, key);
    if (!ds || !inner) return null;
    return `${ds}::${inner}`;
  }

  _makeJurisdictionDatasetOverrideKey(jurisdiction, category, key) {
    const jur = (jurisdiction || '').toString().trim();
    const cat = (category || '').toString().trim();
    const k = (key || '').toString().trim();
    if (!jur || !cat || !k) return null;
    return `${jur}::${cat}::${k}`;
  }

  _getJurisdictionOverrideValue(id) {
    if (!id) return null;
    const parts = id.split('::');
    if (parts.length < 4) return null;
    const ds = parts.shift();
    const inner = parts.join('::');
    const bucket = this._userJurisdictionOverrides?.[ds];
    if (!bucket || !Object.prototype.hasOwnProperty.call(bucket, inner)) return null;
    return bucket[inner];
  }

  _collectXDataRows(rows, dataset, xdata) {
    if (!xdata || typeof xdata !== 'object') return;
    for (const [jurisdiction, byCategory] of Object.entries(xdata)) {
      if (!byCategory || typeof byCategory !== 'object') continue;
      for (const [category, entries] of Object.entries(byCategory)) {
        if (!entries || typeof entries !== 'object' || Array.isArray(entries)) continue;
        for (const [key, value] of Object.entries(entries)) {
          if (value == null) continue;
          const row = {
            dataset,
            jurisdiction: String(jurisdiction),
            category: String(category),
            key: String(key),
            value: String(value),
          };
          row.id = this._makeJurisdictionOverrideID(row.dataset, row.jurisdiction, row.category, row.key);
          rows.push(row);
        }
      }
    }
  }

  _collectJurisMapRows(rows) {
    const courts = this._jurisUSMap?.courts;
    if (Array.isArray(courts)) {
      for (const item of courts) {
        if (!Array.isArray(item) || item.length < 2) continue;
        const code = String(item[0] ?? '').trim();
        const name = String(item[1] ?? '').trim();
        if (!code || !name) continue;
        const row = {
          dataset: 'juris-us-map',
          jurisdiction: 'default',
          category: 'courts',
          key: code,
          value: name,
        };
        row.id = this._makeJurisdictionOverrideID(row.dataset, row.jurisdiction, row.category, row.key);
        rows.push(row);
      }
    }

    const jurisdictions = this._jurisUSMap?.jurisdictions?.default;
    if (Array.isArray(jurisdictions)) {
      for (const item of jurisdictions) {
        if (!Array.isArray(item) || item.length < 2) continue;
        const code = String(item[0] ?? '').trim();
        const name = String(item[1] ?? '').trim();
        if (!code || !name) continue;
        const row = {
          dataset: 'juris-us-map',
          jurisdiction: 'default',
          category: 'jurisdictions',
          key: code,
          value: name,
        };
        row.id = this._makeJurisdictionOverrideID(row.dataset, row.jurisdiction, row.category, row.key);
        rows.push(row);
      }
    }
  }

  _loadJurisdictionOverrides() {
    try {
      const raw = Zotero?.Prefs?.get?.(this._jurisdictionOverridesPref);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      const cleaned = {};
      for (const [dataset, bucket] of Object.entries(parsed)) {
        const ds = (dataset || '').toString().trim();
        if (!ds || !bucket || typeof bucket !== 'object' || Array.isArray(bucket)) continue;
        const outBucket = {};
        for (const [id, value] of Object.entries(bucket)) {
          const key = (id || '').toString().trim();
          const val = (value || '').toString().trim();
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
    } catch (e) {}
  }

  _lookupSupplementalWord(normalized) {
    const supplemental = {
      'association': 'Ass’n',
      'broadcasting': 'Broad.',
      'company': 'Co.',
      'companies': 'Cos.',
      'corporation': 'Corp.',
      'corporations': 'Corps.',
      'incorporated': 'Inc.',
      'international': 'Int’l',
      'limited': 'Ltd.',
      'ltd': 'Ltd.',
      'online': 'Online',
      'production': 'Prod.',
      'productions': 'Prods.',
      'professional': 'Pro.',
      'public': 'Pub.',
      'services': 'Servs.',
      'service': 'Serv.',
      'technology': 'Tech.',
      'technologies': 'Techs.',
      'university': 'U.',
    };

    const value = supplemental[normalized] || null;
    return value ? { jurisdiction: 'default', value } : null;
  }
}

function lookupJurChain(xdata, jur, variable, key) {
  return lookupJurChainWithSource(xdata, jur, variable, key)?.value || null;
}

function lookupJurChainWithSource(xdata, jur, variable, key) {
  if (!xdata) return null;
  const parts = (jur || 'us').toLowerCase().split(':');
  for (let i = parts.length; i >= 1; i--) {
    const jj = parts.slice(0, i).join(':');
    const obj = xdata?.[jj]?.[variable];
    if (obj && obj[key] != null) return { jurisdiction: jj, value: obj[key] };
  }
  const obj = xdata?.['us']?.[variable];
  if (obj && obj[key] != null) return { jurisdiction: 'us', value: obj[key] };
  return null;
}

function lookupJurChainWithOverrides(xdata, overrides, jur, variable, key) {
  if (!xdata) return null;
  const parts = (jur || 'us').toLowerCase().split(':');
  for (let i = parts.length; i >= 1; i--) {
    const jj = parts.slice(0, i).join(':');
    const overrideKey = `${jj}::${variable}::${String(key ?? '')}`;
    if (overrides && Object.prototype.hasOwnProperty.call(overrides, overrideKey)) {
      return { jurisdiction: jj, value: overrides[overrideKey] };
    }
    const obj = xdata?.[jj]?.[variable];
    if (obj && obj[key] != null) return { jurisdiction: jj, value: obj[key] };
  }
  const usOverrideKey = `us::${variable}::${String(key ?? '')}`;
  if (overrides && Object.prototype.hasOwnProperty.call(overrides, usOverrideKey)) {
    return { jurisdiction: 'us', value: overrides[usOverrideKey] };
  }
  const obj = xdata?.['us']?.[variable];
  if (obj && obj[key] != null) return { jurisdiction: 'us', value: obj[key] };
  return null;
}

function trimJurisdictionChain(jurisdiction) {
  const parts = (jurisdiction || 'us').toLowerCase().split(':').filter(Boolean);
  const chain = [];
  for (let i = parts.length; i >= 1; i -= 1) {
    chain.push(parts.slice(0, i).join(':'));
  }
  if (!chain.includes('us')) chain.push('us');
  return chain;
}
