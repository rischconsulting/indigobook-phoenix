export class AbbrevService {
  constructor({ dataStore }) {
    this.dataStore = dataStore;
    this._autoUS = null;
    this._primaryUS = null;
    this._secondaryUS = null;
    this._primaryJur = null;
  }

  async preload() {
    this._autoUS = await this.dataStore.loadJSON('data/auto-us.json');
    this._primaryUS = await this.dataStore.loadJSON('data/primary-us.json');
    this._secondaryUS = await this.dataStore.loadJSON('data/secondary-us-bluebook.json');
    this._primaryJur = await this.dataStore.loadJSON('data/primary-jurisdictions.json');
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
      hit = lookupJurChainWithSource(this._autoUS?.xdata, preferredJur === 'default' ? 'us' : preferredJur, 'institution-part', key)
        || lookupJurChainWithSource(this._autoUS?.xdata, preferredJur === 'default' ? 'us' : preferredJur, 'institution-part', normalizedKey);
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
      hit = lookupJurChainWithSource(this._primaryUS?.xdata, preferredJur === 'default' ? 'us' : preferredJur, 'container-title', normalizedKey);
      if (hit?.value) return { jurisdiction: hit.jurisdiction || preferredJur, value: hit.value };

      const secondaryValue = this._secondaryUS?.xdata?.default?.['container-title']?.[normalizedKey] || null;
      if (secondaryValue) return { jurisdiction: 'default', value: secondaryValue };

      if (!noHints) {
        const fallback = this.abbreviateContainerTitleFallback(key, preferredJur);
        if (fallback) return { jurisdiction: preferredJur === 'default' ? 'default' : preferredJur, value: fallback };
      }
    }

    if (category === 'title') {
      hit = lookupJurChainWithSource(this._primaryUS?.xdata, preferredJur === 'default' ? 'us' : preferredJur, 'title', normalizedKey);
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
      const primaryHit = lookupJurChainWithSource(this._primaryUS?.xdata, normalizedJur, category, normalized);
      if (primaryHit?.value) return primaryHit;

      const secondaryValue = this._secondaryUS?.xdata?.default?.[category]?.[normalized]
        || this._secondaryUS?.xdata?.default?.['container-title']?.[normalized]
        || null;
      if (secondaryValue) return { jurisdiction: 'default', value: secondaryValue };
    }
    return null;
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
