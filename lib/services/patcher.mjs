export class Patcher {
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
    this._itemObserverID = null;
    this._itemPanePatchTimer = null;
    this._itemPanePatchAttempts = 0;
    this._maxItemPanePatchAttempts = 20;
    this._syncInFlight = new Set();
  }

  patch() {
    this._patchRetrieveItem();
    this._patchAbbreviations();
    this._patchLoadJurisdictionStyle();
    this._patchGetCiteProcFallback();
    this._registerCaseReporterSync();
    this._patchItemPaneRender();
  }

  unpatch() {
    this._unregisterCaseReporterSync();
    this._unpatchItemPaneRender();
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

  _registerCaseReporterSync() {
    if (!Zotero?.Notifier?.registerObserver) return;
    if (this._itemObserverID) return;

    const self = this;
    this._itemObserverID = Zotero.Notifier.registerObserver({
      async notify(event, type, ids) {
        try { Zotero.debug(`[IndigoBook CSL-M] case reporter sync notifier: event=${String(event)} type=${String(type)} ids=${Array.isArray(ids) ? ids.length : 0}`); } catch (e) {}
        const isSyncEvent = ['add', 'modify', 'refresh', 'redraw', 'select'].includes(event);
        if (!isSyncEvent) return;

        if (type === 'item' && Array.isArray(ids) && ids.length) {
          for (const id of ids) {
            await self._syncCaseReporterFromFieldsAndMLZ(id);
          }
          return;
        }

        await self._syncCaseReporterFromActiveSelection();
      },
    }, ['item', 'itempane', 'tab'], 'indigobook-cslm-case-reporter-sync');
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
    itemDetails.render = async function (...args) {
      try {
        const itemID = this.item?.id;
        if (itemID != null) {
          try { Zotero.debug(`[IndigoBook CSL-M] case reporter item-pane render sync: item=${String(itemID)}`); } catch (e) {}
          await self._syncCaseReporterFromFieldsAndMLZ(itemID);
        }
      } catch (e) {
        try { Zotero.debug(`[IndigoBook CSL-M] case reporter item-pane render sync failed: ${String(e)}`); } catch (_) {}
      }
      return self._orig.itemDetailsRender.apply(this, args);
    };
  }

  _scheduleItemPaneRenderPatch() {
    if (this._orig.itemDetailsRender && this._orig.itemDetailsOwner) return;
    if (this._itemPanePatchAttempts >= this._maxItemPanePatchAttempts) return;
    if (this._itemPanePatchTimer) return;

    this._itemPanePatchAttempts += 1;
    this._itemPanePatchTimer = setTimeout(() => {
      this._itemPanePatchTimer = null;
      this._patchItemPaneRender();
    }, 500);
  }

  _unpatchItemPaneRender() {
    try {
      if (this._itemPanePatchTimer) {
        clearTimeout(this._itemPanePatchTimer);
        this._itemPanePatchTimer = null;
      }
      if (this._orig.itemDetailsOwner && this._orig.itemDetailsRender) {
        this._orig.itemDetailsOwner.render = this._orig.itemDetailsRender;
      }
    } catch (e) {
    } finally {
      delete this._orig.itemDetailsOwner;
      delete this._orig.itemDetailsRender;
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

  async _syncCaseReporterFromFieldsAndMLZ(itemID) {
    const normalizedID = String(itemID);
    if (this._syncInFlight.has(normalizedID)) return;

    this._syncInFlight.add(normalizedID);
    try {
      const item = this._getZoteroItemByAnyID(itemID);
      if (!item || item.deleted) return;

      const itemTypeName = Zotero?.ItemTypes?.getName?.(item.itemTypeID);
      if (itemTypeName !== 'case') return;

      const reporter = String(item.getField?.('reporter') || '').trim();
      const extra = String(item.getField?.('extra') || '');
      const mlzFields = this.Jurisdiction.getMLZExtraFields?.(extra) || null;
      const mlzReporter = String(mlzFields?.reporter || '').trim();

      // User-facing Zotero field is authoritative when populated.
      if (reporter && reporter !== mlzReporter) {
        const updatedExtra = this.Jurisdiction.updateMLZExtraField?.(extra, 'reporter', reporter) || extra;
        if (updatedExtra !== extra) {
          item.setField('extra', updatedExtra);
          await item.saveTx({ skipDateModifiedUpdate: true });
          try { Zotero.debug(`[IndigoBook CSL-M] case reporter sync: wrote mlz reporter from Zotero field (item ${normalizedID})`); } catch (e) {}
        }
        return;
      }

      // Backfill Zotero field from mlzsync when the field is blank.
      if (!reporter && mlzReporter) {
        item.setField('reporter', mlzReporter);
        await item.saveTx({ skipDateModifiedUpdate: true });
        try { Zotero.debug(`[IndigoBook CSL-M] case reporter sync: backfilled Zotero reporter from mlz (item ${normalizedID})`); } catch (e) {}
      }
    } catch (e) {
      try { Zotero.logError(e); } catch (_) {}
      try { Zotero.debug(`[IndigoBook CSL-M] case reporter sync failed for item ${normalizedID}: ${String(e)}`); } catch (_) {}
    } finally {
      this._syncInFlight.delete(normalizedID);
    }
  }

  async _syncCaseReporterFromActiveSelection() {
    try {
      const pane = Zotero.getActiveZoteroPane?.();
      if (!pane?.getSelectedItems) return;

      const selected = pane.getSelectedItems();
      if (!Array.isArray(selected) || !selected.length) return;

      for (const entry of selected) {
        const id = (typeof entry === 'number' || typeof entry === 'string') ? entry : entry?.id;
        if (id == null) continue;
        await this._syncCaseReporterFromFieldsAndMLZ(id);
      }
    } catch (e) {
      try { Zotero.debug(`[IndigoBook CSL-M] case reporter selection sync failed: ${String(e)}`); } catch (_) {}
    }
  }

  _getActiveItemDetails() {
    try {
      const mainWindow = Zotero.getMainWindow?.();
      const fromMainWindow = mainWindow?.ZoteroPane?.itemPane?._itemDetails;
      if (fromMainWindow) return fromMainWindow;

      const activePane = Zotero.getActiveZoteroPane?.();
      return activePane?.itemPane?._itemDetails || null;
    } catch (e) {}
    return null;
  }

  _patchRetrieveItem() {
    const sysProto = Zotero?.Cite?.System?.prototype;
    if (!sysProto?.retrieveItem) return;
    this._orig.retrieveItem = sysProto.retrieveItem;

    const self = this;
    sysProto.retrieveItem = function (id) {
      const cslItem = self._orig.retrieveItem.call(this, id);

      // Preserve original return contract (sync vs async).
      if (cslItem && typeof cslItem.then === 'function') {
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

    if (!cslItem || typeof cslItem !== 'object') {
      try {
        this._logRetrieveItemDetails(id, null, 'non-object return');
        this._warnRetrieveItem(`retrieveItem returned non-object for id ${id}`);
      } catch (e) {}
      return cslItem;
    }

    // Clone to a plain object so custom getters/setters cannot coerce id types.
    cslItem = { ...cslItem };

    // citeproc registry lookups depend on Item.id matching the requested ID key.
    // Force a stable string key derived from retrieveItem() input to avoid number/string mismatches.
    const normalizedID = this._normalizeItemID(id);
    if (normalizedID != null) cslItem.id = String(normalizedID);

    this._logRetrieveItemDetails(id, cslItem.id, 'ok');

    try {
      const zotItem = this._getZoteroItemByAnyID(id);
      if (zotItem) {
        this._hydrateCSLItemFromZotero(cslItem, zotItem);
        const jur = this.Jurisdiction.fromItem(zotItem);
        cslItem.jurisdiction = jur;
        cslItem.country = jur.split(':')[0];
        this._decorateShortForms(cslItem, jur);
        this._logRenderProbeFromItem(cslItem, jur, 'retrieveItem');
      } else {
        this._logField('missing-zotero-item', `id=${String(id)}`);
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

      if (typeof id === 'string' && /^\d+$/.test(id)) {
        zotItem = Zotero.Items.get(Number(id));
        if (zotItem) return zotItem;
      }

      if (typeof id === 'object' && id && id.id != null) {
        zotItem = Zotero.Items.get(id.id);
        if (zotItem) return zotItem;
      }
    } catch (e) {}
    return null;
  }

  _hydrateCSLItemFromZotero(cslItem, zotItem) {
    try {
      const mlzFields = this.Jurisdiction.getMLZExtraFields?.(zotItem) || null;

      if (!cslItem.title) {
        const title = zotItem.getField?.('title');
        if (title) cslItem.title = title;
      }

      if (!cslItem['container-title']) {
        const containerTitle = zotItem.getField?.('publicationTitle')
          || zotItem.getField?.('reporter')
          || zotItem.getField?.('report')
          || mlzFields?.reporter
          || '';
        if (containerTitle) cslItem['container-title'] = containerTitle;
        else this._logField('missing-container-title-source', `itemType=${String(cslItem.type)} title=${String(cslItem.title || '')}`);
      }

      if (!cslItem.authority) {
        const court = zotItem.getField?.('court') || '';
        if (court) {
          const normalizedCourt = String(court)
            .trim()
            .replace(/[._]+/g, ' ')
            .replace(/\s+/g, ' ')
            .toLowerCase();
          cslItem.authority = [{ literal: normalizedCourt || String(court) }];
        }
      }
    } catch (e) {
      this._warnRetrieveItem(`hydrateCSLItemFromZotero failed: ${String(e)}`);
    }
  }

  _decorateShortForms(cslItem, jur) {
    try {
      if (!cslItem['container-title-short'] && cslItem['container-title']) {
        const hit = this.abbrevService.lookupForCiteProc('container-title', cslItem['container-title'], jur, { noHints: false });
        if (hit?.value) {
          cslItem['container-title-short'] = this.abbrevService.parseDirective(hit.value).value;
          this._logShortForm('container-title', cslItem['container-title'], cslItem['container-title-short'], 'hit');
        } else {
          this._logShortForm('container-title', cslItem['container-title'], null, 'miss');
        }
      }

      if (!cslItem['title-short'] && cslItem.title) {
        const hit = this.abbrevService.lookupForCiteProc('title', cslItem.title, jur, { noHints: false });
        if (hit?.value) {
          cslItem['title-short'] = this.abbrevService.parseDirective(hit.value).value;
          this._logShortForm('title', cslItem.title, cslItem['title-short'], 'hit');
        } else {
          this._logShortForm('title', cslItem.title, null, 'miss');
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
    try { Zotero.debug(msg); } catch (e) {}
  }

  _logField(stage, detail) {
    if (this._fieldLogCount >= this._maxFieldLogs) return;
    this._fieldLogCount += 1;
    const msg = `[IndigoBook CSL-M] field[${this._fieldLogCount}] ${stage}: ${detail}`;
    try { Zotero.debug(msg); } catch (e) {}
  }

  _isHarvardCRCL(text) {
    const normalized = this.abbrevService.normalizeKey(text || '');
    return normalized.includes('harvard civil rights')
      && normalized.includes('civil liberties')
      && normalized.includes('law review');
  }

  _logRenderProbeFromItem(cslItem, jur, stage) {
    try {
      const source = String(cslItem?.['container-title'] || '');
      if (!this._isHarvardCRCL(source)) return;
      const msg = `[IndigoBook CSL-M] renderProbe item(${stage}): jur=${String(jur)} type=${String(cslItem?.type || '')} container-title=${source} container-title-short=${String(cslItem?.['container-title-short'] || '')} title=${String(cslItem?.title || '')} title-short=${String(cslItem?.['title-short'] || '')}`;
      Zotero.debug(msg);
      Zotero.logError(msg);
    } catch (e) {}
  }

  _logRenderProbeFromAbbreviation(category, key, jurisdiction, noHints, stage) {
    try {
      if (category !== 'container-title') return;
      if (!this._isHarvardCRCL(key)) return;
      const normalized = this.abbrevService.normalizeKey(key || '');
      const msg = `[IndigoBook CSL-M] renderProbe abbr(${stage}): category=${String(category)} jur=${String(jurisdiction)} noHints=${String(!!noHints)} key=${String(key)} normalized=${normalized}`;
      Zotero.debug(msg);
      Zotero.logError(msg);
    } catch (e) {}
  }

  _normalizeItemID(id) {
    if (id == null) return null;
    if (Array.isArray(id)) return null;
    if (typeof id === 'object') {
      if ('id' in id) return id.id;
      return String(id);
    }
    return id;
  }

  _logRetrieveItemDetails(inputID, outputID, stage) {
    if (this._retrieveItemLogCount >= this._maxRetrieveItemLogs) return;
    this._retrieveItemLogCount += 1;
    const inType = Array.isArray(inputID) ? 'array' : typeof inputID;
    const outType = Array.isArray(outputID) ? 'array' : typeof outputID;
    const msg = `[IndigoBook CSL-M] retrieveItem[${this._retrieveItemLogCount}] ${stage}: inputID(${inType})=${String(inputID)} => cslItem.id(${outType})=${String(outputID)}`;
    try { Zotero.debug(msg); } catch (e) {}
    try { Zotero.logError(msg); } catch (e) {}
  }

  _warnRetrieveItem(reason) {
    if (this._didWarnRetrieveItem) return;
    this._didWarnRetrieveItem = true;
    try {
      Zotero.debug(`[IndigoBook CSL-M] retrieveItem patch warning: ${reason}`);
    } catch (e) {}
  }

  _patchAbbreviations() {
    const sysProto = Zotero?.Cite?.System?.prototype;
    if (!sysProto) return;
    if (sysProto.getAbbreviation) this._orig.getAbbreviation = sysProto.getAbbreviation;
    if (sysProto.normalizeAbbrevsKey) this._orig.normalizeAbbrevsKey = sysProto.normalizeAbbrevsKey;

    const self = this;
    sysProto.normalizeAbbrevsKey = function (_familyVar, key) {
      return self.abbrevService.normalizeKey(key);
    };

    sysProto.getAbbreviation = function (styleID, obj, jurisdiction, category, key, noHints) {
      let origJurisdiction = jurisdiction || 'default';
      if (self._orig.getAbbreviation) {
        origJurisdiction = self._orig.getAbbreviation.call(this, styleID, obj, jurisdiction, category, key, noHints) || origJurisdiction;
      }

      self._logRenderProbeFromAbbreviation(category, key, jurisdiction || origJurisdiction || 'default', noHints, 'pre');

      try {
        const jur = (jurisdiction || origJurisdiction || 'default').toLowerCase();
        const hit = self.abbrevService.lookupForCiteProc(category, key, jur, { noHints });
        if (hit?.value) {
          const targetJur = hit.jurisdiction || jur || 'default';
          if (!obj[targetJur]) obj[targetJur] = self._newAbbreviationSegments(this);
          if (!obj[targetJur][category]) obj[targetJur][category] = {};
          obj[targetJur][category][key] = self.abbrevService.parseDirective(hit.value).value;
          self._logRenderProbeFromAbbreviation(category, key, targetJur, noHints, 'hit');
          self._logAbbreviation(category, key, targetJur, obj[targetJur][category][key], 'hit');
          return targetJur;
        }
        const resolvedJur = (origJurisdiction || jur || 'default').toLowerCase();
        // Citeproc expects transform.abbrevs[returnedJurisdiction] to exist.
        if (!obj[resolvedJur]) obj[resolvedJur] = self._newAbbreviationSegments(this);
        if (!obj.default) obj.default = self._newAbbreviationSegments(this);
        self._logRenderProbeFromAbbreviation(category, key, resolvedJur, noHints, 'miss');
        self._logAbbreviation(category, key, resolvedJur, null, 'miss');
        return resolvedJur;
      } catch (e) {
        self._logAbbreviation(category, key, origJurisdiction, String(e), 'error');
      }

      const fallbackJur = ((origJurisdiction || jurisdiction || 'default') || 'default').toLowerCase();
      try {
        if (!obj[fallbackJur]) obj[fallbackJur] = self._newAbbreviationSegments(this);
        if (!obj.default) obj.default = self._newAbbreviationSegments(this);
      } catch (e) {}
      return fallbackJur;
    };
  }

  _newAbbreviationSegments(sysObj) {
    if (typeof sysObj?.AbbreviationSegments === 'function') {
      return new sysObj.AbbreviationSegments();
    }

    return {
      'container-title': {},
      'collection-title': {},
      'institution-entire': {},
      'institution-part': {},
      nickname: {},
      number: {},
      title: {},
      place: {},
      hereinafter: {},
      classic: {},
      'container-phrase': {},
      'title-phrase': {},
    };
  }

  _logAbbreviation(category, key, jurisdiction, value, stage) {
    if (this._abbrevLogCount >= this._maxAbbrevLogs) return;
    this._abbrevLogCount += 1;
    const msg = `[IndigoBook CSL-M] getAbbreviation[${this._abbrevLogCount}] ${stage}: category=${category} jurisdiction=${jurisdiction} key=${String(key)} value=${String(value)}`;
    try { Zotero.debug(msg); } catch (e) {}
  }

  _patchLoadJurisdictionStyle() {
    const sysProto = Zotero?.Cite?.System?.prototype;
    if (!sysProto) return;

    // Save originals if present
    if (sysProto.loadJurisdictionStyle) this._orig.loadJurisdictionStyle = sysProto.loadJurisdictionStyle;
    if (sysProto.retrieveStyleModule) this._orig.retrieveStyleModule = sysProto.retrieveStyleModule;

    const self = this;

    // citeproc-js expects sys.loadJurisdictionStyle(jurisdiction, variantName)
    sysProto.loadJurisdictionStyle = function (jurisdiction, variantName) {
      const xml = self.moduleLoader.loadJurisdictionStyleSync(jurisdiction, variantName);
      if (xml) return xml;
      if (self._orig.loadJurisdictionStyle) return self._orig.loadJurisdictionStyle.call(this, jurisdiction, variantName);
      return null;
    };

    // Some builds may call a differently named hook; provide alias
    sysProto.retrieveStyleModule = function (jurisdiction, variantName) {
      const xml = self.moduleLoader.loadJurisdictionStyleSync(jurisdiction, variantName);
      if (xml) return xml;
      if (self._orig.retrieveStyleModule) return self._orig.retrieveStyleModule.call(this, jurisdiction, variantName);
      return null;
    };
  }

  _patchGetCiteProcFallback() {
    // Optional: remove the placeholder warning in juris-title if module loading fails.
    // We inject the base US macros as a safety net; if citeproc loads jurisdiction modules,
    // they will overwrite these later.
    const proto = Zotero?.Style?.prototype;
    if (!proto?.getCiteProc) return;
    this._orig.getCiteProc = proto.getCiteProc;

    const self = this;
    // Zotero 8 expects getCiteProc to be synchronous.
    // Keep this wrapper sync and avoid async I/O in this hot path.
    proto.getCiteProc = function (...args) {
      const styleXML = self._getStyleXMLSync(this);
      if (!styleXML) {
        const citeproc = self._orig.getCiteProc.apply(this, args);
        return self._instrumentCiteProcEngine(citeproc);
      }

      let effectiveXML = styleXML;
      const hasIndigoPref = effectiveXML.includes('jurisdiction-preference="IndigoTemp"');
      const hasEmptyCitation = self._hasEmptyCitationLayout(effectiveXML);
      if (hasEmptyCitation && (hasIndigoPref || self._looksLikeJurisStyle(effectiveXML))) {
        const baseUS = self.moduleLoader?._byFile?.get('juris-us.csl') || null;
        if (baseUS) {
          effectiveXML = baseUS;
          try { Zotero.debug('[IndigoBook CSL-M] Replaced empty IndigoTemp citation layout with base juris-us.csl'); } catch (e) {}
        }
      }

      // Replace the obvious placeholder hint line if present
      let patched = effectiveXML.replace(/\[HINT:[^\]]+\]/g, '');
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
    if (!citeproc || typeof citeproc !== 'object') return citeproc;
    if (citeproc.__indigoRenderProbeInstrumented) return citeproc;
    citeproc.__indigoRenderProbeInstrumented = true;

    try {
      const methodList = [
        'processCitationCluster',
        'previewCitationCluster',
        'appendCitationCluster',
        'makeBibliography',
        'updateItems',
      ];
      const available = methodList.filter((name) => typeof citeproc[name] === 'function').join(',');
      Zotero.debug(`[IndigoBook CSL-M] renderProbe citeproc instrumentation: methods=${available || 'none'}`);
    } catch (e) {}

    const wrap = (methodName) => {
      const orig = citeproc?.[methodName];
      if (typeof orig !== 'function') return;
      const self = this;
      citeproc[methodName] = function (...args) {
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

    wrap('processCitationCluster');
    wrap('previewCitationCluster');
    wrap('appendCitationCluster');
    wrap('makeBibliography');
    wrap('updateItems');
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
        const nearNote = !!(citationItem?.['near-note'] || citationItem?.nearNote);
        const hasLocator = citationItem?.locator != null && String(citationItem.locator).trim() !== '';

        let branch = 'full';
        if (pos === 2 || pos === 'ibid-with-locator') branch = 'ibid-with-locator';
        else if (pos === 1 || pos === 'ibid') branch = 'ibid';
        else if (nearNote || pos === 3 || pos === 'subsequent') branch = 'short';

        const msg = `[IndigoBook CSL-M] renderProbe citeproc(${methodName}): branch=${branch} position=${String(pos)} near-note=${String(nearNote)} locator=${String(citationItem?.locator || '')} itemID=${String(itemID)}`;
        Zotero.debug(msg);
        Zotero.logError(msg);
      }
    } catch (e) {}
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
      const ids = items
        .map((citationItem) => citationItem?.id ?? citationItem?.itemID ?? citationItem?.itemId ?? null)
        .filter((id) => id != null)
        .map((id) => String(id))
        .join(',');
      Zotero.debug(`[IndigoBook CSL-M] renderProbe citeproc start(${methodName}): args=${String(args?.length || 0)} ids=${ids || 'none'}`);
    } catch (e) {}
  }

  _logCiteprocMethodEnd(methodName, result) {
    try {
      let shape = typeof result;
      if (Array.isArray(result)) shape = `array(${result.length})`;
      if (result && typeof result === 'object' && !Array.isArray(result)) {
        shape = `object(${Object.keys(result).slice(0, 6).join('|')})`;
      }
      Zotero.debug(`[IndigoBook CSL-M] renderProbe citeproc end(${methodName}): result=${shape}`);
    } catch (e) {}
  }

  _logCiteprocMethodError(methodName, error) {
    try {
      const msg = `[IndigoBook CSL-M] renderProbe citeproc error(${methodName}): ${String(error)} stack=${String(error?.stack || '')}`;
      Zotero.debug(msg);
      Zotero.logError(msg);
    } catch (e) {}
  }

  _isHarvardCRCLFromItemID(id) {
    try {
      const zotItem = this._getZoteroItemByAnyID(id);
      if (!zotItem) return false;
      const containerTitle = zotItem.getField?.('publicationTitle')
        || zotItem.getField?.('reporter')
        || zotItem.getField?.('report')
        || '';
      return this._isHarvardCRCL(containerTitle);
    } catch (e) {}
    return false;
  }

  _getStyleXMLSync(styleObj) {
    if (styleObj._xml) return styleObj._xml;
    if (styleObj._style) return styleObj._style;
    if (styleObj.file && styleObj.file.exists()) {
      try {
        if (typeof Zotero?.File?.getContents === 'function') {
          return Zotero.File.getContents(styleObj.file);
        }
        this._warnNoSyncStyleRead('Zotero.File.getContents is unavailable');
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
    } catch (e) {}
  }

  _hasEmptyCitationLayout(xml) {
    if (!xml) return false;
    return /<citation>\s*<layout>\s*<\/layout>\s*<\/citation>/i.test(xml);
  }

  _looksLikeJurisStyle(xml) {
    if (!xml) return false;
    return /<macro\s+name="juris-[^"]+"/i.test(xml)
      || /class="legal"/i.test(xml)
      || /jurisdiction-preference=/i.test(xml);
  }

  _tempSetXML(styleObj, xml) {
    const prev = { _xml: styleObj._xml, _style: styleObj._style };
    if ('_xml' in styleObj) styleObj._xml = xml;
    if ('_style' in styleObj) styleObj._style = xml;
    return () => {
      if ('_xml' in styleObj) styleObj._xml = prev._xml;
      if ('_style' in styleObj) styleObj._style = prev._style;
    };
  }
}
