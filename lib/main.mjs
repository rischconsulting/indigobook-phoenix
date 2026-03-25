import { DataStore } from './services/dataStore.mjs';
import { ModuleLoader } from './services/moduleLoader.mjs';
import { AbbrevService } from './services/abbrevService.mjs';
import { Jurisdiction } from './services/jurisdiction.mjs';
import { Patcher } from './services/patcher.mjs';
import { PrefsUI } from './services/prefsUI.mjs';
import { CaseCourtMapper } from './services/caseCourtMapper.mjs';

let _ctx;

const BUNDLED_STYLE_FILES = [
  'jm-indigobook.csl',
  'jm-indigobook-law-review.csl',
];

const BUNDLED_TRANSLATOR_FILES = [
  'Lexis+.js',
  'Westlaw.js',
];

function _extractStyleID(styleXML) {
  if (!styleXML) return '';
  const match = styleXML.match(/<id>\s*([^<]+?)\s*<\/id>/i);
  return match ? String(match[1]).trim() : '';
}

function _styleInstallSourceURL(rootURI, relPath) {
  const base = rootURI?.spec || '';
  return base ? `${base}${relPath}` : relPath;
}

async function _installStyleIfMissing({ rootURI, dataStore, relPath }) {
  const styleXML = await dataStore.loadText(relPath);
  const styleID = _extractStyleID(styleXML);
  if (!styleID) {
    try { Zotero.debug(`[IndigoBook CSL-M] style install skipped (missing id): ${relPath}`); } catch (e) {}
    return;
  }

  if (Zotero?.Styles?.get?.(styleID)) {
    try { Zotero.debug(`[IndigoBook CSL-M] style already installed: ${styleID}`); } catch (e) {}
    return;
  }

  const installFn = Zotero?.Styles?.install;
  if (typeof installFn !== 'function') {
    try { Zotero.debug(`[IndigoBook CSL-M] style install unavailable (no Zotero.Styles.install): ${styleID}`); } catch (e) {}
    return;
  }

  const sourceURL = _styleInstallSourceURL(rootURI, relPath);
  let installed = false;

  // Install using XML payload so Zotero never attempts to fetch the bundled URL.
  try {
    await installFn.call(Zotero.Styles, styleXML, sourceURL);
    installed = !!Zotero?.Styles?.get?.(styleID);
  } catch (e) {}

  try {
    Zotero.debug(`[IndigoBook CSL-M] style ${installed ? 'installed' : 'install failed'}: ${styleID}`);
  } catch (e) {}
}

async function _ensureBundledStylesInstalled({ rootURI, dataStore }) {
  for (const file of BUNDLED_STYLE_FILES) {
    const relPath = `styles/${file}`;
    try {
      await _installStyleIfMissing({ rootURI, dataStore, relPath });
    } catch (e) {
      try { Zotero.debug(`[IndigoBook CSL-M] style install error (${relPath}): ${String(e)}`); } catch (_) {}
    }
  }
}

function _extractTranslatorMetadata(code) {
  // Translator files begin with a bare JSON object on its own lines before any JS code.
  const match = code.match(/^\s*(\{[\s\S]*?\})\s*(?=\n[^}]|\nfunction|\nvar |\nconst |\nlet |\/\*)/m);
  if (!match) return null;
  try { return JSON.parse(match[1]); } catch (e) { return null; }
}

async function _installTranslatorIfMissing({ dataStore, relPath }) {
  const code = await dataStore.loadText(relPath);
  const metadata = _extractTranslatorMetadata(code);
  if (!metadata?.translatorID) {
    try { Zotero.debug(`[IndigoBook CSL-M] translator install skipped (missing translatorID): ${relPath}`); } catch (e) {}
    return;
  }

  const saveFn = Zotero?.Translators?.save;
  if (typeof saveFn !== 'function') {
    try { Zotero.debug(`[IndigoBook CSL-M] translator install unavailable (no Zotero.Translators.save): ${metadata.label}`); } catch (e) {}
    return;
  }

  let installed = false;
  try {
    await saveFn.call(Zotero.Translators, metadata, code);
    installed = !!Zotero?.Translators?.get?.(metadata.translatorID);
  } catch (e) {}

  try {
    Zotero.debug(`[IndigoBook CSL-M] translator ${installed ? 'installed' : 'install failed'}: ${metadata.label}`);
  } catch (e) {}
}

async function _ensureBundledTranslatorsInstalled({ dataStore }) {
  for (const file of BUNDLED_TRANSLATOR_FILES) {
    const relPath = `translators/${file}`;
    try {
      await _installTranslatorIfMissing({ dataStore, relPath });
    } catch (e) {
      try { Zotero.debug(`[IndigoBook CSL-M] translator install error (${relPath}): ${String(e)}`); } catch (_) {}
    }
  }
}

export async function activate({ id, version, rootURI }) {
  _ctx = {
    id, version, rootURI,
    data: new DataStore(rootURI),
    modules: null,
    abbrevs: null,
    caseCourtMapper: null,
    patcher: null,
    prefsUI: null,
  };

  await _ctx.data.init();
  await _ensureBundledStylesInstalled({ rootURI, dataStore: _ctx.data });
  await _ensureBundledTranslatorsInstalled({ dataStore: _ctx.data });
  _ctx.modules = new ModuleLoader({ rootURI, dataStore: _ctx.data });
  await _ctx.modules.preload();

  _ctx.abbrevs = new AbbrevService({ dataStore: _ctx.data });
  await _ctx.abbrevs.preload();

  _ctx.caseCourtMapper = new CaseCourtMapper({ dataStore: _ctx.data });
  await _ctx.caseCourtMapper.preload();

  _ctx.patcher = new Patcher({
    moduleLoader: _ctx.modules,
    abbrevService: _ctx.abbrevs,
    jurisdiction: Jurisdiction,
    caseCourtMapper: _ctx.caseCourtMapper,
  });
  _ctx.patcher.patch();

  _ctx.prefsUI = new PrefsUI({
    pluginID: id,
    rootURI,
  });
  await _ctx.prefsUI.register();

  Zotero.IndigoBookCSLMBridge = {
    listSecondaryAbbreviations(dataset = 'secondary-us-bluebook') {
      return _ctx?.abbrevs?.listSecondaryContainerTitleAbbreviations?.(dataset) || [];
    },
    upsertSecondaryAbbreviation(datasetOrKey, keyOrValue, maybeValue) {
      const hasDataset = typeof maybeValue !== 'undefined';
      const dataset = hasDataset ? datasetOrKey : 'secondary-us-bluebook';
      const key = hasDataset ? keyOrValue : datasetOrKey;
      const value = hasDataset ? maybeValue : keyOrValue;
      return !!_ctx?.abbrevs?.upsertSecondaryContainerTitleAbbreviation?.(dataset, key, value);
    },
    removeSecondaryAbbreviation(datasetOrKey, maybeKey) {
      const hasDataset = typeof maybeKey !== 'undefined';
      const dataset = hasDataset ? datasetOrKey : 'secondary-us-bluebook';
      const key = hasDataset ? maybeKey : datasetOrKey;
      return !!_ctx?.abbrevs?.removeSecondaryContainerTitleAbbreviation?.(dataset, key);
    },
    resetSecondaryAbbreviations(dataset = 'secondary-us-bluebook') {
      _ctx?.abbrevs?.resetSecondaryContainerTitleOverrides?.(dataset);
      return true;
    },
    listJurisdictionPreferenceEntries() {
      return _ctx?.abbrevs?.listJurisdictionPreferenceEntries?.() || [];
    },
    upsertJurisdictionPreferenceEntry(dataset, jurisdiction, category, key, value) {
      return !!_ctx?.abbrevs?.upsertJurisdictionPreferenceEntry?.(dataset, jurisdiction, category, key, value);
    },
    removeJurisdictionPreferenceEntry(dataset, jurisdiction, category, key) {
      return !!_ctx?.abbrevs?.removeJurisdictionPreferenceEntry?.(dataset, jurisdiction, category, key);
    },
    resetJurisdictionPreferenceOverrides() {
      _ctx?.abbrevs?.resetJurisdictionPreferenceOverrides?.();
      return true;
    },
  };

  Zotero.debug(`[IndigoBook CSL-M] activated v${version}`);
}

export async function deactivate() {
  try {
    try { delete Zotero.IndigoBookCSLMBridge; } catch (e) {}
    _ctx?.prefsUI?.unregister?.();
    _ctx?.patcher?.unpatch();
  } finally {
    _ctx = null;
  }
}
