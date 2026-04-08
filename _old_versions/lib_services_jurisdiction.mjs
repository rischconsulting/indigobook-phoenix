export class Jurisdiction {
  static fromItem(item) {
    const extra = (item.getField?.('extra') || item.extra || '') + '';
    let jur = this._fromMLZ(extra) || this._fromKeyValue(extra);
    if (!jur) jur = 'us';
    return this._normalizeJurisdiction(jur);
  }

  static getMLZExtraFields(itemOrExtra) {
    const extra = typeof itemOrExtra === 'string'
      ? itemOrExtra
      : (itemOrExtra?.getField?.('extra') || itemOrExtra?.extra || '');
    const jsonText = this._extractMLZJSON(extra);
    if (!jsonText) return null;
    try {
      const obj = JSON.parse(jsonText);
      return obj?.extrafields || null;
    } catch (e) {
      return null;
    }
  }

  static getMLZJurisdiction(itemOrExtra) {
    const fields = this.getMLZExtraFields(itemOrExtra);
    const value = fields?.jurisdiction;
    if (!value) return '';
    return this._normalizeJurisdiction(this._decodeLengthPrefixedJurisdiction(String(value)) || '');
  }

  static updateMLZJurisdiction(itemOrExtra, jurisdiction, displayValue = '') {
    const normalized = this._normalizeJurisdiction(jurisdiction || '');
    const encoded = normalized ? this._encodeLengthPrefixedJurisdiction(normalized, displayValue) : '';
    return this.updateMLZExtraField(itemOrExtra, 'jurisdiction', encoded);
  }

  static updateMLZExtraField(itemOrExtra, fieldName, fieldValue) {
    const extra = typeof itemOrExtra === 'string'
      ? itemOrExtra
      : (itemOrExtra?.getField?.('extra') || itemOrExtra?.extra || '');

    const field = (fieldName || '').toString().trim();
    if (!field) return extra;

    const parsed = this._getMLZPayloadAndRange(extra);
    if (!parsed.payload && (fieldValue == null || String(fieldValue).trim() === '')) {
      return extra;
    }

    const payload = parsed.payload || {};
    if (!payload.extrafields || typeof payload.extrafields !== 'object' || Array.isArray(payload.extrafields)) {
      payload.extrafields = {};
    }

    const value = fieldValue == null ? '' : String(fieldValue).trim();
    if (value) payload.extrafields[field] = value;
    else delete payload.extrafields[field];

    const mlzBlock = `mlzsync1:${JSON.stringify(payload)}`;
    if (parsed.start != null && parsed.end != null) {
      return `${extra.slice(0, parsed.start)}${mlzBlock}${extra.slice(parsed.end)}`;
    }

    const base = String(extra || '').trimEnd();
    return base ? `${base}\n${mlzBlock}` : mlzBlock;
  }

  static _fromMLZ(extra) {
    const fields = this.getMLZExtraFields(extra);
    const j = fields?.jurisdiction;
    if (!j) return null;
    return this._decodeLengthPrefixedJurisdiction(j);
  }

  static _extractMLZJSON(extra) {
    const idx = (extra || '').indexOf('mlzsync1:');
    if (idx === -1) return null;

    const braceStart = extra.indexOf('{', idx);
    if (braceStart === -1) return null;

    let depth = 0;
    let inString = false;
    let escaping = false;

    for (let i = braceStart; i < extra.length; i += 1) {
      const ch = extra[i];
      if (inString) {
        if (escaping) {
          escaping = false;
        } else if (ch === '\\') {
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
      if (ch === '{') {
        depth += 1;
        continue;
      }
      if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          return extra.slice(braceStart, i + 1);
        }
      }
    }
    return null;
  }

  static _getMLZPayloadAndRange(extra) {
    const source = String(extra || '');
    const marker = 'mlzsync1:';
    const markerIndex = source.indexOf(marker);
    if (markerIndex === -1) {
      return { payload: null, start: null, end: null };
    }

    const braceStart = source.indexOf('{', markerIndex);
    if (braceStart === -1) {
      return { payload: null, start: null, end: null };
    }

    let depth = 0;
    let inString = false;
    let escaping = false;

    for (let i = braceStart; i < source.length; i += 1) {
      const ch = source[i];
      if (inString) {
        if (escaping) escaping = false;
        else if (ch === '\\') escaping = true;
        else if (ch === '"') inString = false;
        continue;
      }

      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === '{') {
        depth += 1;
        continue;
      }
      if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          const jsonText = source.slice(braceStart, i + 1);
          try {
            return {
              payload: JSON.parse(jsonText),
              start: markerIndex,
              end: i + 1,
            };
          } catch (e) {
            return { payload: null, start: markerIndex, end: i + 1 };
          }
        }
      }
    }

    return { payload: null, start: markerIndex, end: source.length };
  }

  static _decodeLengthPrefixedJurisdiction(s) {
    if (!s || s.length < 4) return null;
    const prefix = s.slice(0, 3);
    if (!/^\d{3}$/.test(prefix)) return s;
    const len = parseInt(prefix, 10);
    const code = s.slice(3, 3 + len);
    return code || null;
  }

  static _encodeLengthPrefixedJurisdiction(value, displayValue = '') {
    const jurisdiction = (value || '').toString().trim();
    if (!jurisdiction) return '';
    const display = (displayValue || '').toString().trim();
    return `${String(jurisdiction.length).padStart(3, '0')}${jurisdiction}${display}`;
  }

  static _fromKeyValue(extra) {
    const m = extra.match(/^\s*jurisdiction\s*:\s*([^\s\n\r]+)\s*$/im);
    return m ? m[1] : null;
  }

  static _normalizeJurisdiction(jur) {
    let value = (jur || '').toString().trim().toLowerCase();
    if (!value) return 'us';

    // Preserve already-normalized jurisdiction chains.
    if (/^us(?::[a-z0-9._-]+)*$/.test(value)) return value;

    // Handle plain US state tokens (e.g., "oh").
    if (/^[a-z]{2}$/.test(value)) return `us:${value}`;

    // If a state name leaked through fallback parsing, map the common ones.
    const byName = {
      ohio: 'us:oh',
      california: 'us:ca',
      newyork: 'us:ny',
      texas: 'us:tx',
      florida: 'us:fl',
      illinois: 'us:il',
      pennsylvania: 'us:pa',
      virginia: 'us:va',
      massachusetts: 'us:ma',
      michigan: 'us:mi',
    };
    const compact = value.replace(/[^a-z]/g, '');
    if (byName[compact]) return byName[compact];

    return value;
  }

  static trimChain(jur) {
    const parts = (jur || 'us').toLowerCase().split(':');
    const chain = [];
    for (let i = parts.length; i >= 1; i--) chain.push(parts.slice(0, i).join(':'));
    return chain;
  }

  static isCircuit(jur) {
    const parts = (jur || '').toLowerCase().split(':');
    return parts[0] === 'us' && /^c\d+$/.test(parts[1] || '');
  }

  static topToken(jur) {
    const parts = (jur || '').toLowerCase().split(':');
    return parts[1] || null;
  }
}
