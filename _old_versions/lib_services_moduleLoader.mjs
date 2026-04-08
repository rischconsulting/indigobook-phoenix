import { Jurisdiction } from './jurisdiction.mjs';

export class ModuleLoader {
  constructor({ rootURI, dataStore }) {
    this.rootURI = rootURI;
    this.dataStore = dataStore;
    this._availableFiles = [];
    this._byFile = new Map();
    this._byJur = new Map();
  }

  async preload() {
    const idx = await this.dataStore.loadJSON('style-modules/index.json');
    this._availableFiles = idx?.files || [];

    // Load all module XML now so sys.loadJurisdictionStyle can be sync
    for (const file of this._availableFiles) {
      const path = 'style-modules/' + file;
      const xml = await this.dataStore.loadText(path);
      this._byFile.set(file, xml);
      const jur = this._jurFromFilename(file);
      if (jur) this._byJur.set(jur, xml);
    }

    // Ensure base module exists
    if (!this._byJur.has('us')) {
      // Try default base file
      const baseFile = this._availableFiles.find(f => f === 'juris-us-IndigoTemp.csl');
      if (baseFile) this._byJur.set('us', this._byFile.get(baseFile));
    }
  }

  _jurFromFilename(file) {
    // juris-us+ny-IndigoTemp.csl -> us:ny
    // juris-us-IndigoTemp.csl -> us
    const m = file.match(/^juris-us\+(.+)-IndigoTemp\.csl$/);
    if (m) return 'us:' + m[1];
    if (file === 'juris-us-IndigoTemp.csl') return 'us';
    return null;
  }

  hasJurisdiction(jur) {
    return this._byJur.has((jur || '').toLowerCase());
  }

  loadJurisdictionStyleSync(jurisdiction, variantName='IndigoTemp') {
    const variant = variantName || 'IndigoTemp';
    if (variant !== 'IndigoTemp') return null;

    let jur = (jurisdiction || 'us').toLowerCase();

    // circuits have no dedicated module in your set
    if (Jurisdiction.isCircuit(jur)) return this._byJur.get('us') || null;

    // Walk down chain: us:ny:nyc -> us:ny -> us
    for (const j of Jurisdiction.trimChain(jur)) {
      if (this._byJur.has(j)) return this._byJur.get(j);
      // Also try state token module if j is us:ny:...
      // (our map key already supports us:ny)
    }
    return this._byJur.get('us') || null;
  }
}
