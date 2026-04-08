import { DataStore } from './services/dataStore.mjs';
import { ModuleLoader } from './services/moduleLoader.mjs';
import { AbbrevService } from './services/abbrevService.mjs';
import { Jurisdiction } from './services/jurisdiction.mjs';
import { Patcher } from './services/patcher.mjs';
import { PrefsUI } from './services/prefsUI.mjs';

let _ctx;

const BUNDLED_STYLE_FILES = [
  'jm-indigobook.csl',
  'jm-indigobook-law-review.csl',
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

export async function activate({ id, version, rootURI }) {
  _ctx = {
    id, version, rootURI,
    data: new DataStore(rootURI),
    modules: null,
    abbrevs: null,
    patcher: null,
    prefsUI: null,
  };

  await _ctx.data.init();
  await _ensureBundledStylesInstalled({ rootURI, dataStore: _ctx.data });
  _ctx.modules = new ModuleLoader({ rootURI, dataStore: _ctx.data });
  await _ctx.modules.preload();

  _ctx.abbrevs = new AbbrevService({ dataStore: _ctx.data });
  await _ctx.abbrevs.preload();

  _ctx.patcher = new Patcher({
    moduleLoader: _ctx.modules,
    abbrevService: _ctx.abbrevs,
    jurisdiction: Jurisdiction,
  });
  _ctx.patcher.patch();

  _ctx.prefsUI = new PrefsUI({
    pluginID: id,
    rootURI,
  });
  await _ctx.prefsUI.register();

  Zotero.IndigoBookCSLMBridge = {
    listSecondaryAbbreviations() {
      return _ctx?.abbrevs?.listSecondaryContainerTitleAbbreviations?.() || [];
    },
    upsertSecondaryAbbreviation(key, value) {
      return !!_ctx?.abbrevs?.upsertSecondaryContainerTitleAbbreviation?.(key, value);
    },
    removeSecondaryAbbreviation(key) {
      return !!_ctx?.abbrevs?.removeSecondaryContainerTitleAbbreviation?.(key);
    },
    resetSecondaryAbbreviations() {
      _ctx?.abbrevs?.resetSecondaryContainerTitleOverrides?.();
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
