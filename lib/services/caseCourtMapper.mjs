export class CaseCourtMapper {
  constructor({ dataStore }) {
    this.dataStore = dataStore;
    this._config = null;
  }

  async preload() {
    this._config = await this.dataStore.loadJSON('data/case-jurisdiction-map.json').catch(() => null);
  }

  mapCaseCourt(rawCourt) {
    const source = String(rawCourt || '').trim();
    if (!source) return { courtKey: '', jurisdiction: '' };

    const courtLine = source.replace(/\s+/g, ' ').replace(/\.$/, '').trim();
    const courtKey = this._mapCourtKey(courtLine);
    const jurisdiction = this._mapJurisdiction(courtLine);
    return { courtKey, jurisdiction };
  }

  _mapCourtKey(courtLine) {
    const haystack = this._normalizeForPattern(courtLine || '');
    const aliases = Array.isArray(this._config?.courtKeyAliases) ? this._config.courtKeyAliases : [];
    for (const alias of aliases) {
      const needle = this._normalizeForPattern(alias?.pattern || '');
      const value = String(alias?.value || '').trim();
      if (!needle || !value) continue;
      if (haystack.includes(needle)) return value;
    }

    const rules = Array.isArray(this._config?.courtKeyRules) ? this._config.courtKeyRules : [];
    for (const rule of rules) {
      const needle = this._normalizeForPattern(rule?.pattern || '');
      const value = String(rule?.value || '').trim();
      if (!needle || !value) continue;
      if (haystack.includes(needle)) return value;
    }
    return '';
  }

  _mapJurisdiction(courtLine) {
    const normalized = String(courtLine || '')
      .replace(/,\s*[a-zA-Z]+\s*Division\.?$/i, '')
      .trim();

    const exactUSSupreme = /^Supreme Court of the United States$/i;
    if (exactUSSupreme.test(normalized)) return 'us';

    const circuitMatch = normalized.match(/^United States Court of Appeals,\s+(.+?)\s+Circuit$/i);
    if (circuitMatch) {
      const circuitName = String(circuitMatch[1] || '').trim().toLowerCase();
      const ordinalMap = {
        federal: 'federal',
        'district of columbia': '0',
        'd.c.': '0',
        first: '1',
        second: '2',
        third: '3',
        fourth: '4',
        fifth: '5',
        sixth: '6',
        seventh: '7',
        eighth: '8',
        ninth: '9',
        tenth: '10',
        eleventh: '11',
      };
      const token = ordinalMap[circuitName];
      if (token === 'federal') return 'us:c';
      return token ? `us:c${token}` : '';
    }

    // Common abbreviated citations (Google Scholar and others):
    // - Fed. Cir.
    // - Federal Circuit
    // - 2d Cir. / 9th Cir.
    if (/\b(fed|federal)\.?\s+cir(cuit)?\.?\b/i.test(normalized)) {
      return 'us:c';
    }

    const numberedCircuit = normalized.match(/\b(1|2|3|4|5|6|7|8|9|10|11)(st|nd|rd|th)?\s+cir(cuit)?\.?\b/i);
    if (numberedCircuit) {
      return `us:c${String(numberedCircuit[1])}`;
    }

    const dcCircuit = /\b(d\.c\.|district of columbia)\s+cir(cuit)?\.?\b/i;
    if (dcCircuit.test(normalized)) {
      return 'us:c0';
    }

    const districtMatch = normalized.match(/^United States District Court,\s+(.+)$/i);
    if (districtMatch) {
      return this._mapFederalDistrict(String(districtMatch[1] || '').trim());
    }

    return this._mapStateOrTerritoryJurisdiction(normalized);
  }

  _mapFederalDistrict(rawDistrictText) {
    const districtText = String(rawDistrictText || '').trim();
    if (!districtText) return '';

    // Examples:
    // - N.D. Georgia
    // - D. Maine
    // - D. District of Columbia
    let partMatch = districtText.match(/^(N|S|E|W|M|C)\.D\.\s+(.+)$/i);
    let districtToken = '';
    let stateName = '';

    if (partMatch) {
      const part = String(partMatch[1] || '').toUpperCase();
      districtToken = `${part.toLowerCase()}d`;
      stateName = String(partMatch[2] || '').trim();
    } else {
      partMatch = districtText.match(/^D\.\s+(.+)$/i);
      if (!partMatch) return '';
      districtToken = 'd';
      stateName = String(partMatch[1] || '').trim();
    }

    const state = this._lookupStateInfo(stateName);
    if (!state?.code) return '';

    // D.D.C. is encoded as us:dc.d instead of the c0 chain.
    if (state.code === 'dc') {
      return 'us:dc.d';
    }

    if (!state.circuit) {
      return `us:${state.code}.${districtToken}`;
    }

    return `us:c${state.circuit}:${state.code}.${districtToken}`;
  }

  _mapStateOrTerritoryJurisdiction(courtLine) {
    const states = this._config?.states;
    if (!states || typeof states !== 'object') return '';

    for (const [name, info] of Object.entries(states)) {
      const pattern = new RegExp(`(?:^|\\s|,)${this._escapeRegex(name)}(?:$|\\s|[.,])`, 'i');
      if (!pattern.test(courtLine)) continue;
      const code = String(info?.code || '').trim().toLowerCase();
      if (!code) continue;
      return `us:${code}`;
    }

    return '';
  }

  _lookupStateInfo(rawName) {
    const states = this._config?.states;
    if (!states || typeof states !== 'object') return null;

    const name = String(rawName || '').trim().replace(/\.$/, '');
    if (!name) return null;

    if (states[name]) return states[name];

    // Normalize a few common variants.
    const synonyms = {
      'D.C.': 'District of Columbia',
      DC: 'District of Columbia',
      'Virgin Islands': 'U.S. Virgin Islands',
    };
    const canonical = synonyms[name] || name;
    return states[canonical] || null;
  }

  _escapeRegex(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  _normalizeForPattern(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }
}