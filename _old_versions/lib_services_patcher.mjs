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
    this._jurisdictionRowID = 'ibcslm-jurisdiction-row';
    this._customCourtRowID = 'ibcslm-custom-court-row';
    this._syncInFlight = new Set();
    this._journalAbbrByContainerTitleKey = new Map();
  }

  patch() {
    this._patchRetrieveItem();
    this._patchAbbreviations();
    this._patchLoadJurisdictionStyle();
    this._patchGetCiteProcFallback();
    this._registerCaseReporterSync();
    this._patchItemPaneRender();
    this._patchInfoBoxRender();
  }

  unpatch() {
    this._unregisterCaseReporterSync();
    this._unpatchInfoBoxRender();
    this._unpatchItemPaneRender();
    this._journalAbbrByContainerTitleKey.clear();
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

  _patchInfoBoxRender() {
    if (this._orig.infoBoxRender && this._orig.infoBoxOwner) return;

    const infoBox = this._getActiveInfoBox();
    if (!infoBox?.render) {
      this._scheduleItemPaneRenderPatch();
      return;
    }

    const self = this;
    this._orig.infoBoxOwner = infoBox;
    this._orig.infoBoxRender = infoBox.render;
    infoBox.render = function (...args) {
      const result = self._orig.infoBoxRender.apply(this, args);
      try {
        self._renderJurisdictionField(this);
        self._renderCourtField(this);
        self._renderCustomCourtField(this);
      } catch (e) {
        try { Zotero.debug(`[IndigoBook CSL-M] custom info row render failed: ${String(e)}`); } catch (_) {}
      }
      return result;
    };
  }

  _scheduleItemPaneRenderPatch() {
    if ((this._orig.itemDetailsRender && this._orig.itemDetailsOwner)
      && (this._orig.infoBoxRender && this._orig.infoBoxOwner)) return;
    if (this._itemPanePatchAttempts >= this._maxItemPanePatchAttempts) return;
    if (this._itemPanePatchTimer) return;

    this._itemPanePatchAttempts += 1;
    this._itemPanePatchTimer = setTimeout(() => {
      this._itemPanePatchTimer = null;
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
      this._removeJurisdictionField(this._getActiveInfoBox());
      this._removeCustomCourtField(this._getActiveInfoBox());
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
      const court = this.abbrevService.normalizeKey(item.getField?.('court') || '');
      const extra = String(item.getField?.('extra') || '');
      const mlzFields = this.Jurisdiction.getMLZExtraFields?.(extra) || null;
      const mlzReporter = String(mlzFields?.reporter || '').trim();
      const mlzCourt = this.abbrevService.normalizeKey(mlzFields?.court || '');
      const mlzJurisdiction = this.Jurisdiction.getMLZJurisdiction?.(extra) || '';
      const derivedJurisdiction = this.Jurisdiction.fromItem(item);

      let nextExtra = extra;
      let changed = false;

      // User-facing Zotero reporter field is authoritative when populated.
      if (reporter && reporter !== mlzReporter) {
        nextExtra = this.Jurisdiction.updateMLZExtraField?.(nextExtra, 'reporter', reporter) || nextExtra;
      }

      // Backfill Zotero reporter field from mlzsync when blank.
      if (!reporter && mlzReporter) {
        item.setField('reporter', mlzReporter);
        changed = true;
      }

      // Keep mlzsync jurisdiction current so new/converted case items persist immediately.
      if (derivedJurisdiction && derivedJurisdiction !== mlzJurisdiction) {
        const displayJurisdiction = this.abbrevService.formatJurisdictionDisplay(derivedJurisdiction);
        nextExtra = this.Jurisdiction.updateMLZJurisdiction?.(nextExtra, derivedJurisdiction, displayJurisdiction) || nextExtra;
      }

      // Keep mlzsync court aligned with the Zotero court field key.
      if (court && court !== mlzCourt) {
        nextExtra = this.Jurisdiction.updateMLZExtraField?.(nextExtra, 'court', court) || nextExtra;
      }

      // Backfill Zotero court field from mlzsync when blank.
      if (!court && mlzCourt) {
        item.setField('court', mlzCourt);
        changed = true;
      }

      if (nextExtra !== extra) {
        item.setField('extra', nextExtra);
        changed = true;
      }

      if (!changed) return;

      await item.saveTx({ skipDateModifiedUpdate: true });
      try {
        Zotero.debug(`[IndigoBook CSL-M] case sync: wrote reporter/jurisdiction/court mlz state (item ${normalizedID})`);
      } catch (e) {}
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

  _getActiveInfoBox() {
    try {
      const itemDetails = this._getActiveItemDetails();
      if (itemDetails?.getPane) {
        const pane = itemDetails.getPane('info');
        if (pane) return pane;
      }

      const mainWindow = Zotero.getMainWindow?.();
      return mainWindow?.document?.getElementById?.('zotero-editpane-info-box') || null;
    } catch (e) {}
    return null;
  }

  _renderJurisdictionField(infoBox) {
    const item = infoBox?.item;
    const itemTypeName = item ? Zotero?.ItemTypes?.getName?.(item.itemTypeID) : null;
    if (!item || item.deleted || itemTypeName !== 'case') {
      this._removeJurisdictionField(infoBox);
      return;
    }

    const table = this._getInfoTable(infoBox);
    if (!table) return;

    const row = this._getOrCreateJurisdictionRow(infoBox);
    const beforeRow = this._findInfoFieldRow(infoBox, 'court');
    if (beforeRow && beforeRow.parentNode === table) {
      table.insertBefore(row, beforeRow);
    } else if (row.parentNode !== table) {
      table.appendChild(row);
    }

    this._updateJurisdictionRow(infoBox, row, item);
  }

  _renderCourtField(infoBox) {
    const item = infoBox?.item;
    const itemTypeName = item ? Zotero?.ItemTypes?.getName?.(item.itemTypeID) : null;
    const row = this._findInfoFieldRow(infoBox, 'court');
    if (!row) return;

    if (!item || item.deleted || itemTypeName !== 'case') {
      this._removeCustomCourtField(infoBox);
      this._restoreCourtField(row, item);
      return;
    }

    this._updateCourtRow(infoBox, row, item);
  }

  _renderCustomCourtField(infoBox) {
    const item = infoBox?.item;
    const itemTypeName = item ? Zotero?.ItemTypes?.getName?.(item.itemTypeID) : null;
    const courtRow = this._findInfoFieldRow(infoBox, 'court');
    if (!courtRow) {
      this._removeCustomCourtField(infoBox);
      return;
    }

    // Keep this helper row focused on editable case items only.
    if (!item || item.deleted || itemTypeName !== 'case' || !infoBox.editable) {
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

  _removeCustomCourtField(infoBox) {
    const row = infoBox?.querySelector?.(`#${this._customCourtRowID}`);
    if (row?.parentNode) row.parentNode.removeChild(row);
  }

  _getInfoTable(infoBox) {
    return infoBox?._infoTable || infoBox?.querySelector?.('#info-table') || null;
  }

  _findInfoFieldRow(infoBox, fieldName) {
    const table = this._getInfoTable(infoBox);
    if (!table) return null;

    for (const row of table.querySelectorAll('.meta-row')) {
      const labelWrapper = row.querySelector('.meta-label');
      if (labelWrapper?.getAttribute('fieldname') === fieldName) return row;
    }
    return null;
  }

  _getOrCreateJurisdictionRow(infoBox) {
    let row = infoBox.querySelector(`#${this._jurisdictionRowID}`);
    if (row) return row;

    const doc = infoBox.ownerDocument;
    row = doc.createElement('div');
    row.id = this._jurisdictionRowID;
    row.className = 'meta-row';

    const labelWrapper = doc.createElement('div');
    labelWrapper.className = 'meta-label';
    labelWrapper.setAttribute('fieldname', 'jurisdiction');

    let label;
    if (typeof infoBox.createLabelElement === 'function') {
      label = infoBox.createLabelElement({
        id: 'itembox-field-jurisdiction-label',
        text: 'Jurisdiction',
      });
    } else {
      label = doc.createElement('label');
      label.id = 'itembox-field-jurisdiction-label';
      label.textContent = 'Jurisdiction';
    }
    labelWrapper.appendChild(label);

    const dataWrapper = doc.createElement('div');
    dataWrapper.className = 'meta-data';

    row.appendChild(labelWrapper);
    row.appendChild(dataWrapper);
    return row;
  }

  _getOrCreateCustomCourtRow(infoBox) {
    let row = infoBox.querySelector(`#${this._customCourtRowID}`);
    if (row) return row;

    const doc = infoBox.ownerDocument;
    row = doc.createElement('div');
    row.id = this._customCourtRowID;
    row.className = 'meta-row';

    const labelWrapper = doc.createElement('div');
    labelWrapper.className = 'meta-label';
    labelWrapper.setAttribute('fieldname', 'custom-court');

    let label;
    if (typeof infoBox.createLabelElement === 'function') {
      label = infoBox.createLabelElement({
        id: 'itembox-field-custom-court-label',
        text: 'Custom Court',
      });
    } else {
      label = doc.createElement('label');
      label.id = 'itembox-field-custom-court-label';
      label.textContent = 'Custom Court';
    }
    labelWrapper.appendChild(label);

    const dataWrapper = doc.createElement('div');
    dataWrapper.className = 'meta-data';

    row.appendChild(labelWrapper);
    row.appendChild(dataWrapper);
    return row;
  }

  _updateCustomCourtRow(row, item) {
    const dataWrapper = row.querySelector('.meta-data');
    if (!dataWrapper) return;
    dataWrapper.textContent = '';

    const doc = row.ownerDocument;
    const container = doc.createElement('div');
    container.style.display = 'flex';
    container.style.alignItems = 'center';
    container.style.gap = '6px';

    const customInput = doc.createElement('input');
    customInput.id = 'itembox-field-court-custom';
    customInput.className = 'value';
    customInput.placeholder = 'Enter custom court key';
    customInput.style.maxWidth = '220px';

    const currentCourt = String(item?.getField?.('court') || '').trim();
    customInput.value = currentCourt;

    const saveCustomCourtValue = async () => {
      const rawCustomValue = String(customInput.value || '').trim();
      if (!rawCustomValue) return;
      await this._saveCourtFromMenu(item, rawCustomValue);
    };

    const setButton = doc.createElement('button');
    setButton.type = 'button';
    setButton.textContent = 'Set';
    setButton.addEventListener('click', () => {
      saveCustomCourtValue();
    });

    customInput.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      saveCustomCourtValue();
    });

    container.appendChild(customInput);
    container.appendChild(setButton);
    dataWrapper.appendChild(container);
  }

  _updateJurisdictionRow(infoBox, row, item) {
    const dataWrapper = row.querySelector('.meta-data');
    if (!dataWrapper) return;

    const currentJurisdiction = this._getDisplayedJurisdictionCode(item);
    const displayValue = this.abbrevService.formatJurisdictionDisplay(currentJurisdiction);
    dataWrapper.textContent = '';

    if (infoBox.editable) {
      dataWrapper.appendChild(this._buildJurisdictionMenuList(infoBox, item, currentJurisdiction, displayValue));
      return;
    }

    if (typeof infoBox.createValueElement === 'function') {
      const valueElem = infoBox.createValueElement({
        editable: false,
        text: displayValue,
        id: 'itembox-field-jurisdiction-value',
        attributes: {
          'aria-labelledby': 'itembox-field-jurisdiction-label',
          fieldname: 'jurisdiction',
          title: currentJurisdiction,
        },
      });
      valueElem.value = displayValue;
      dataWrapper.appendChild(valueElem);
      return;
    }

    const input = row.ownerDocument.createElement('input');
    input.className = 'value';
    input.readOnly = true;
    input.value = displayValue;
    input.title = currentJurisdiction;
    dataWrapper.appendChild(input);
  }

  _updateCourtRow(infoBox, row, item) {
    const dataWrapper = row.querySelector('.meta-data');
    if (!dataWrapper) return;

    const currentJurisdiction = this._getDisplayedJurisdictionCode(item);
    const currentCourtKey = this._getDisplayedCourtKey(item);
    const displayValue = this._formatCourtDisplay(currentCourtKey, currentJurisdiction);
    dataWrapper.textContent = '';

    if (infoBox.editable) {
      dataWrapper.appendChild(this._buildCourtMenuList(infoBox, item, currentJurisdiction, currentCourtKey, displayValue));
      return;
    }

    if (typeof infoBox.createValueElement === 'function') {
      const valueElem = infoBox.createValueElement({
        editable: false,
        text: displayValue,
        id: 'itembox-field-court-value',
        attributes: {
          'aria-labelledby': 'itembox-field-court-label',
          fieldname: 'court',
          title: currentCourtKey,
        },
      });
      valueElem.value = displayValue;
      dataWrapper.appendChild(valueElem);
      return;
    }

    const input = row.ownerDocument.createElement('input');
    input.className = 'value';
    input.readOnly = true;
    input.value = displayValue;
    input.title = currentCourtKey;
    dataWrapper.appendChild(input);
  }

  _restoreCourtField(row, item) {
    const dataWrapper = row?.querySelector('.meta-data');
    if (!dataWrapper) return;
    const courtValue = String(item?.getField?.('court') || '');
    const currentJurisdiction = this._getDisplayedJurisdictionCode(item);
    const displayValue = this._formatCourtDisplay(courtValue, currentJurisdiction);
    dataWrapper.textContent = '';

    const infoBox = row.closest('#zotero-editpane-info-box');
    if (infoBox && typeof infoBox.createValueElement === 'function') {
      const valueElem = infoBox.createValueElement({
        editable: false,
        text: displayValue,
        id: 'itembox-field-court-value',
        attributes: {
          'aria-labelledby': 'itembox-field-court-label',
          fieldname: 'court',
          title: courtValue,
        },
      });
      valueElem.value = displayValue;
      dataWrapper.appendChild(valueElem);
      return;
    }

    const input = row.ownerDocument.createElement('input');
    input.className = 'value';
    input.readOnly = true;
    input.value = displayValue;
    input.title = courtValue;
    dataWrapper.appendChild(input);
  }

  _buildJurisdictionMenuList(infoBox, item, currentJurisdiction, displayValue) {
    const doc = infoBox.ownerDocument;
    const menulist = doc.createXULElement('menulist');
    menulist.id = 'itembox-field-jurisdiction-menu';
    menulist.className = 'zotero-clicky keyboard-clickable';
    menulist.setAttribute('aria-labelledby', 'itembox-field-jurisdiction-label');
    menulist.setAttribute('fieldname', 'jurisdiction');
    menulist.setAttribute('tooltiptext', currentJurisdiction);

    const popup = menulist.appendChild(doc.createXULElement('menupopup'));
    const options = this._getJurisdictionOptions(currentJurisdiction);
    for (const option of options) {
      const menuitem = doc.createXULElement('menuitem');
      menuitem.setAttribute('value', option.code);
      menuitem.setAttribute('label', option.label);
      menuitem.setAttribute('tooltiptext', option.code);
      popup.appendChild(menuitem);
    }

    menulist.value = currentJurisdiction;
    if (!menulist.selectedItem && options.length) {
      menulist.selectedIndex = options.findIndex((option) => option.code === currentJurisdiction);
      if (menulist.selectedIndex < 0) menulist.selectedIndex = 0;
    }

    if (menulist.selectedItem && displayValue) {
      menulist.setAttribute('label', menulist.selectedItem.getAttribute('label'));
    }

    menulist.addEventListener('command', async () => {
      const selectedCode = String(menulist.value || '').trim().toLowerCase();
      if (!selectedCode) return;
      await this._saveJurisdictionFromMenu(item, selectedCode);
    });

    return menulist;
  }

  _buildCourtMenuList(infoBox, item, currentJurisdiction, currentCourtKey, displayValue) {
    const doc = infoBox.ownerDocument;
    const menulist = doc.createXULElement('menulist');
    menulist.id = 'itembox-field-court-menu';
    menulist.className = 'zotero-clicky keyboard-clickable';
    menulist.setAttribute('aria-labelledby', 'itembox-field-court-label');
    menulist.setAttribute('fieldname', 'court');
    menulist.setAttribute('editable', 'true');
    menulist.setAttribute('flex', '1');
    menulist.setAttribute('tooltiptext', currentCourtKey);

    const popup = menulist.appendChild(doc.createXULElement('menupopup'));
    const options = this._getCourtOptions(currentJurisdiction, currentCourtKey);
    // Encode each option as "jurisdiction||courtKey" so saving can update both fields.
    const compoundCurrentValue = `${currentJurisdiction}||${currentCourtKey}`;
    for (const option of options) {
      const menuitem = doc.createXULElement('menuitem');
      menuitem.setAttribute('value', `${option.jurisdiction}||${option.key}`);
      menuitem.setAttribute('label', option.label);
      menuitem.setAttribute('tooltiptext', option.abbreviation || option.key);
      popup.appendChild(menuitem);
    }

    menulist.value = compoundCurrentValue;
    if (!menulist.selectedItem && options.length) {
      const fallbackIndex = options.findIndex((option) => !option.isChild && option.key === currentCourtKey && option.jurisdiction === currentJurisdiction);
      menulist.selectedIndex = fallbackIndex >= 0 ? fallbackIndex : 0;
    }

    if (menulist.selectedItem && displayValue) {
      menulist.setAttribute('label', menulist.selectedItem.getAttribute('label'));
    }

    const saveCourtValue = async () => {
      const selectedValue = String(menulist.value || '').trim();
      if (!selectedValue) return;
      await this._saveCourtFromMenu(item, selectedValue);
    };

    menulist.addEventListener('command', saveCourtValue);
    menulist.addEventListener('change', saveCourtValue);

    return menulist;
  }

  _getJurisdictionOptions(currentJurisdiction) {
    const options = this.abbrevService.listAutoUSPlaceJurisdictions();
    if (!currentJurisdiction) return options;
    if (options.some((option) => option.code === currentJurisdiction)) return options;

    return [{
      code: currentJurisdiction,
      label: this.abbrevService.formatJurisdictionDisplay(currentJurisdiction) || currentJurisdiction,
    }, ...options];
  }

  _getCourtOptions(currentJurisdiction, currentCourtKey) {
    const options = this.abbrevService.listInstitutionPartOptionsForJurisdictionTree(currentJurisdiction);
    if (!currentCourtKey) return options;
    // Check if the current selection is represented in the list (exact jurisdiction, non-child).
    const hasExact = options.some((option) => !option.isChild && option.key === currentCourtKey && option.jurisdiction === currentJurisdiction);
    if (hasExact) return options;

    return [{
      key: currentCourtKey,
      label: this._formatCourtDisplay(currentCourtKey, currentJurisdiction),
      abbreviation: '',
      jurisdiction: currentJurisdiction || 'us',
      isChild: false,
    }, ...options];
  }

  _getDisplayedJurisdictionCode(item) {
    const mlzJurisdiction = this.Jurisdiction.getMLZJurisdiction?.(item) || '';
    if (mlzJurisdiction) return mlzJurisdiction;
    return this.Jurisdiction.fromItem(item);
  }

  _getDisplayedCourtKey(item) {
    return this.abbrevService.normalizeKey(item?.getField?.('court') || '');
  }

  _formatCourtDisplay(courtKey, jurisdiction) {
    const key = this.abbrevService.normalizeKey(courtKey || '');
    if (!key) return '';
    return this.abbrevService.formatInstitutionPartDisplay(key, jurisdiction) || String(courtKey || '');
  }

  async _saveJurisdictionFromMenu(item, selectedCode) {
    try {
      const current = this.Jurisdiction.getMLZJurisdiction?.(item) || '';
      if (current === selectedCode) return;

      const extra = String(item.getField?.('extra') || '');
      const displayValue = this.abbrevService.formatJurisdictionDisplay(selectedCode);
      const updatedExtra = this.Jurisdiction.updateMLZJurisdiction?.(extra, selectedCode, displayValue) || extra;
      if (updatedExtra === extra) return;

      item.setField('extra', updatedExtra);
      await item.saveTx({ skipDateModifiedUpdate: true });
      try { Zotero.debug(`[IndigoBook CSL-M] jurisdiction row saved: item=${String(item.id)} jurisdiction=${selectedCode}`); } catch (e) {}
    } catch (e) {
      try { Zotero.logError(e); } catch (_) {}
      try { Zotero.debug(`[IndigoBook CSL-M] jurisdiction row save failed: ${String(e)}`); } catch (_) {}
    }
  }

  async _saveCourtFromMenu(item, selectedValue) {
    try {
      // selectedValue is "jurisdiction||courtKey" or just "courtKey" for legacy data.
      const sep = selectedValue.indexOf('||');
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
        const extra = String(item.getField?.('extra') || '');
        const displayValue = this.abbrevService.formatJurisdictionDisplay(targetJurisdiction);
        const updatedExtra = this.Jurisdiction.updateMLZJurisdiction?.(extra, targetJurisdiction, displayValue) || extra;
        item.setField('extra', updatedExtra);
      }

      item.setField('court', normalizedKey);
      await item.saveTx({ skipDateModifiedUpdate: true });
      try { Zotero.debug(`[IndigoBook CSL-M] court row saved: item=${String(item.id)} court=${normalizedKey} jurisdiction=${targetJurisdiction || 'unchanged'}`); } catch (e) {}
    } catch (e) {
      try { Zotero.logError(e); } catch (_) {}
      try { Zotero.debug(`[IndigoBook CSL-M] court row save failed: ${String(e)}`); } catch (_) {}
    }
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

      const journalAbbr = String(
        zotItem.getField?.('journalAbbreviation')
          || zotItem.getField?.('journalAbbr')
          || '',
      ).trim();
      if (journalAbbr) {
        const normalizedContainerTitle = this.abbrevService.normalizeKey(cslItem['container-title'] || '');
        if (normalizedContainerTitle) {
          this._journalAbbrByContainerTitleKey.set(normalizedContainerTitle, journalAbbr);
        }
        const hadShort = !!String(cslItem['container-title-short'] || '').trim();
        cslItem['container-title-short'] = journalAbbr;
        this._logShortForm(
          'container-title',
          cslItem['container-title'] || '',
          cslItem['container-title-short'],
          hadShort ? 'journal-abbr-override' : 'journal-abbr',
        );
      }

      if (!cslItem.authority) {
        const court = String(zotItem.getField?.('court') || '').trim();
        if (court) {
          cslItem.authority = [{ literal: this.abbrevService.normalizeKey(court) || court }];
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
        if (category === 'container-title') {
          const normalizedContainerTitle = self.abbrevService.normalizeKey(key);
          const journalAbbr = self._journalAbbrByContainerTitleKey.get(normalizedContainerTitle);
          if (journalAbbr) {
            if (!obj[jur]) obj[jur] = self._newAbbreviationSegments(this);
            if (!obj[jur][category]) obj[jur][category] = {};
            obj[jur][category][key] = journalAbbr;
            self._logRenderProbeFromAbbreviation(category, key, jur, noHints, 'journal-abbr');
            self._logAbbreviation(category, key, jur, journalAbbr, 'journal-abbr');
            return jur;
          }
        }

        const hit = self.abbrevService.lookupForCiteProc(category, key, jur, { noHints });
        if (hit?.value) {
          const targetJur = hit.jurisdiction || jur || 'default';
          if (!obj[targetJur]) obj[targetJur] = self._newAbbreviationSegments(this);
          if (!obj[targetJur][category]) obj[targetJur][category] = {};
          obj[targetJur][category][key] = hit.value;
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
