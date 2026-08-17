import { getLocaleCandidates } from './locale.mjs';

export class Patcher {
  constructor({ pluginID, moduleLoader, abbrevService, jurisdiction, caseCourtMapper, schemaConfig }) {
    this.pluginID = String(pluginID || 'indigobook-phoenix@risch.example').trim();
    this.moduleLoader = moduleLoader;
    this.abbrevService = abbrevService;
    this.Jurisdiction = jurisdiction;
    this.caseCourtMapper = caseCourtMapper || null;
    this.schemaConfig = schemaConfig || null;
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
    this._citationDataLogCount = 0;
    this._maxCitationDataLogs = 80;
    this._itemObserverID = null;
    this._itemPanePatchTimer = null;
    this._infoPaneRefreshTimer = null;
    this._deferredInfoPaneRefresh = null;
    this._deferredItemSyncTimer = null;
    this._deferredItemSyncIDs = new Set();
    this._schemaSequenceRetryTimer = null;
    this._schemaSequenceRetryKey = '';
    this._schemaSequenceObserver = null;
    this._schemaSequenceObserverTable = null;
    this._schemaSequenceObserverKey = '';
    this._schemaSequenceObserverTimer = null;
    this._schemaSequenceObserverSuppressed = false;
    this._forceFullInfoPaneRefresh = false;
    this._itemPanePatchAttempts = 0;
    this._maxItemPanePatchAttempts = 20;
    this._commenterRowID = 'ibcslm-commenter-row';
    this._extraPersonTypes = this.schemaConfig?.getExtraCreatorTypes?.() || [];
    this._jurisdictionRowID = 'ibcslm-jurisdiction-row';
    this._customCourtRowID = 'ibcslm-custom-court-row';
    this._schemaInfoRowIDPrefix = 'ibcslm-schema-row';
    this._customItemTypeMenuValuePrefix = 'ibcslm-type:';
    this._newItemMenuMarkerAttribute = 'data-ibcslm-new-item-custom';
    this._pendingCustomNewItemTypes = [];
    this._registeredSchemaRowIDs = [];
    this._syncInFlight = new Set();
    this._journalAbbrByContainerTitleKey = new Map();
    this._containerTitleShortByKey = new Map();
    this._containerTitleContextByKey = new Map();
  }

  patch() {
    this._patchCreatorTypes();
    this._patchItemCreators();
    this._patchInfoBoxPrototype();
    this._patchRetrieveItem();
    this._patchAbbreviations();
    this._patchLoadJurisdictionStyle();
    this._patchGetCiteProcFallback();
    this._registerCaseReporterSync();
    this._patchItemPaneRender();
    this._patchInfoBoxRender();
    this._patchNewItemBuilders();
    this._patchNewItemMenus();
  }

  unpatch() {
    this._unpatchNewItemMenus();
    this._unpatchNewItemBuilders();
    this._unregisterCaseReporterSync();
    this._unpatchInfoBoxRender();
    this._unpatchItemPaneRender();
    this._journalAbbrByContainerTitleKey.clear();
    this._containerTitleShortByKey.clear();
    this._containerTitleContextByKey.clear();
    const sysProto = Zotero?.Cite?.System?.prototype;
    if (sysProto) {
      if (this._orig.retrieveItem) sysProto.retrieveItem = this._orig.retrieveItem;
      if (this._orig.getAbbreviation) sysProto.getAbbreviation = this._orig.getAbbreviation;
      if (this._orig.normalizeAbbrevsKey) sysProto.normalizeAbbrevsKey = this._orig.normalizeAbbrevsKey;
      if (this._orig.loadJurisdictionStyle) sysProto.loadJurisdictionStyle = this._orig.loadJurisdictionStyle;
      if (this._orig.retrieveStyleModule) sysProto.retrieveStyleModule = this._orig.retrieveStyleModule;
    }
    const creatorTypes = Zotero?.CreatorTypes;
    if (creatorTypes) {
      if (this._orig.creatorTypesGetID) creatorTypes.getID = this._orig.creatorTypesGetID;
      if (this._orig.creatorTypesGetName) creatorTypes.getName = this._orig.creatorTypesGetName;
      if (this._orig.creatorTypesGetLocalizedString) creatorTypes.getLocalizedString = this._orig.creatorTypesGetLocalizedString;
      if (this._orig.creatorTypesGetTypesForItemType) creatorTypes.getTypesForItemType = this._orig.creatorTypesGetTypesForItemType;
    }
    const itemProto = Zotero?.Item?.prototype;
    if (itemProto && this._orig.itemSetCreator) itemProto.setCreator = this._orig.itemSetCreator;
    const infoBoxProto = this._getInfoBoxPrototype();
    if (infoBoxProto) {
      if (this._orig.infoBoxProtoRender) infoBoxProto.render = this._orig.infoBoxProtoRender;
      if (this._orig.infoBoxProtoModifyCreator) infoBoxProto.modifyCreator = this._orig.infoBoxProtoModifyCreator;
      if (this._orig.infoBoxProtoRemoveCreator) infoBoxProto.removeCreator = this._orig.infoBoxProtoRemoveCreator;
    }
    if (this._orig.getCiteProc) Zotero.Style.prototype.getCiteProc = this._orig.getCiteProc;
  }

  _registerSchemaInfoRows() {
    this._registeredSchemaRowIDs = [];
  }

  _unregisterSchemaInfoRows() {
    this._registeredSchemaRowIDs = [];
  }

  _getSchemaInfoRowID(fieldName) {
    return `${this._schemaInfoRowIDPrefix}-${String(fieldName || '').trim()}`;
  }

  _getSchemaInfoRowDefinition(item, fieldName) {
    if (!item || !fieldName) return null;
    const itemTypeName = this._getItemTypeName(item);
    return this.schemaConfig?.getFieldDefinition?.(itemTypeName, fieldName) || null;
  }

  _shouldUseSchemaInfoRow(item, definition) {
    if (!item || item.deleted || !definition?.field) return false;

    const fieldName = String(definition.field || '').trim();
    if (!fieldName || fieldName === 'jurisdiction') return false;

    const itemTypeName = this._getItemTypeName(item);
    if (itemTypeName === 'case' && fieldName === 'court') return false;

    const nativeFieldName = this._resolveNativeFieldName(item.itemTypeID, fieldName, definition.baseField);
    return nativeFieldName !== fieldName;
  }

  _getSchemaInfoRowDisplayValue(item, fieldName) {
    const definition = this._getSchemaInfoRowDefinition(item, fieldName);
    if (!this._shouldUseSchemaInfoRow(item, definition)) return '';

    const value = this._getSchemaFieldValue(item, fieldName, this.Jurisdiction.getMLZExtraFields?.(item) || null);
    if (this._isSchemaFlagField(fieldName)) {
      return this._coerceSchemaFlagValue(value) ? 'true' : '';
    }
    if (definition?.kind === 'date') {
      return this._formatSchemaDateDisplay(value);
    }
    return String(value || '');
  }

  _patchCreatorTypes() {
    const creatorTypes = Zotero?.CreatorTypes;
    if (!creatorTypes) return;
    if (!this._orig.creatorTypesGetID && creatorTypes.getID) this._orig.creatorTypesGetID = creatorTypes.getID;
    if (!this._orig.creatorTypesGetName && creatorTypes.getName) this._orig.creatorTypesGetName = creatorTypes.getName;
    if (!this._orig.creatorTypesGetLocalizedString && creatorTypes.getLocalizedString) {
      this._orig.creatorTypesGetLocalizedString = creatorTypes.getLocalizedString;
    }
    if (!this._orig.creatorTypesGetTypesForItemType && creatorTypes.getTypesForItemType) {
      this._orig.creatorTypesGetTypesForItemType = creatorTypes.getTypesForItemType;
    }

    const self = this;
    creatorTypes.getID = function (creatorType) {
      const extraPersonType = self._getExtraPersonConfigBySyntheticCreatorType(creatorType);
      if (extraPersonType) return extraPersonType.creatorTypeID;
      return self._orig.creatorTypesGetID?.apply(this, arguments);
    };
    creatorTypes.getName = function (creatorTypeID) {
      const extraPersonType = self._getExtraPersonConfigBySyntheticCreatorType(creatorTypeID);
      if (extraPersonType) return extraPersonType.creatorTypeName;
      return self._orig.creatorTypesGetName?.apply(this, arguments);
    };
    creatorTypes.getLocalizedString = function (creatorType) {
      const extraPersonType = self._getExtraPersonConfigBySyntheticCreatorType(creatorType);
      if (extraPersonType) return self._getExtraPersonLabel(extraPersonType);
      return self._orig.creatorTypesGetLocalizedString?.apply(this, arguments);
    };
    creatorTypes.getTypesForItemType = function (itemTypeID) {
      const result = self._orig.creatorTypesGetTypesForItemType?.apply(this, arguments) || [];
      if (!self._itemTypeSupportsExtraPerson(itemTypeID)) return result;
      const next = [...result];
      for (const extraPersonType of self._getExtraPersonTypesForItemType(itemTypeID)) {
        if (next.some((entry) => self._getExtraPersonConfigBySyntheticCreatorType(entry?.id || entry?.name)?.key === extraPersonType.key)) continue;
        next.push({ id: extraPersonType.creatorTypeID, name: extraPersonType.creatorTypeName });
      }
      return next;
    };
  }

  _getInfoBoxPrototype() {
    try {
      const mainWindow = Zotero.getMainWindow?.();
      const ctor = mainWindow?.customElements?.get?.('info-box');
      return ctor?.prototype || null;
    } catch (e) {}
    return null;
  }

  _patchInfoBoxPrototype(protoOverride = null) {
    const proto = protoOverride || this._getInfoBoxPrototype();
    if (!proto) return;
    if (!this._orig.infoBoxProtoRender && typeof proto.render === 'function') {
      this._orig.infoBoxProtoRender = proto.render;
    }
    if (!this._orig.infoBoxProtoModifyCreator && typeof proto.modifyCreator === 'function') {
      this._orig.infoBoxProtoModifyCreator = proto.modifyCreator;
    }
    if (!this._orig.infoBoxProtoRemoveCreator && typeof proto.removeCreator === 'function') {
      this._orig.infoBoxProtoRemoveCreator = proto.removeCreator;
    }

    const self = this;

    if (this._orig.infoBoxProtoRender) {
      proto.render = function (...args) {
        const result = self._orig.infoBoxProtoRender.apply(this, args);
        try {
          try {
            const itemID = this.item?.id;
            const customRows = this.querySelectorAll?.('[data-custom-row-id]')?.length || 0;
            Zotero.debug(`[Citation Phoenix] info-box proto render: item=${String(itemID || '')} customRows=${String(customRows)}`);
          } catch (e) {}
        self._refreshInfoBoxAfterRender(this);
      } catch (e) {
        try { Zotero.debug(`[Citation Phoenix] info-box commenter render patch failed: ${String(e)}`); } catch (_) {}
      }
        return result;
      };
    }

    if (this._orig.infoBoxProtoModifyCreator) {
      proto.modifyCreator = function (index, fields) {
        const nativeCount = this.item?.numCreators?.() || 0;
        const row = self._getCreatorTypeLabel(this, index)?.closest?.('.meta-row') || null;
        const existingExtraPersonType = self._getExtraPersonConfigByIndex(this, index);
        const hasExplicitCreatorType = fields && Object.prototype.hasOwnProperty.call(fields, 'creatorTypeID')
          && fields.creatorTypeID != null
          && String(fields.creatorTypeID) !== '';
        const requestedExtraPersonType = self._getExtraPersonConfigBySyntheticCreatorType(fields?.creatorTypeID);
        if (hasExplicitCreatorType && !requestedExtraPersonType && existingExtraPersonType) {
          const storageIndex = self._getExtraPersonStorageIndex(row);
          const storedPerson = self._getStoredExtraPeople(this.item, existingExtraPersonType)[storageIndex] || null;
          const nextPerson = self._extraPersonFromCreatorFields(fields);
          if (storedPerson && nextPerson && self._extraPersonLikelySameDraft(storedPerson, nextPerson)) {
            self._removeStoredExtraPersonAtIndex(this.item, existingExtraPersonType, storageIndex);
          }
          self._unmarkExtraPersonCreatorRow(row);
          const nativeIndex = self._getNativeCreatorIndex(this, index);
          return self._orig.infoBoxProtoModifyCreator.call(this, Math.min(nativeIndex, nativeCount), fields);
        }

        const extraPersonType = requestedExtraPersonType
          || existingExtraPersonType
          || self._getExtraPersonConfigByRowCreatorType(row);
        if (extraPersonType) {
          const nextPerson = self._extraPersonFromCreatorFields(fields);
          let storageIndex = self._getExtraPersonStorageIndex(row);
          if (nextPerson) {
            if (storageIndex == null) storageIndex = self._appendStoredExtraPerson(this.item, extraPersonType, nextPerson);
            else storageIndex = self._setStoredExtraPersonAtNearestIndex(this.item, extraPersonType, storageIndex, nextPerson);
          }
          self._markExtraPersonCreatorRow(self._getCreatorTypeLabel(this, index)?.closest?.('.meta-row'), extraPersonType, storageIndex);
          return true;
        }

        if (existingExtraPersonType) {
          const nativeIndex = self._getNativeCreatorIndex(this, index);
          return self._orig.infoBoxProtoModifyCreator.call(this, Math.min(nativeIndex, nativeCount), fields);
        }

        const nativeIndex = self._getNativeCreatorIndex(this, index);
        return self._orig.infoBoxProtoModifyCreator.call(this, nativeIndex, fields);
      };
    }

    if (this._orig.infoBoxProtoRemoveCreator) {
      proto.removeCreator = async function (index) {
        const extraPersonType = self._getExtraPersonConfigByIndex(this, index);
        if (extraPersonType) {
          const row = self._getCreatorTypeLabel(this, index)?.closest?.('.meta-row') || null;
          if (self._consumePendingExtraPersonRemoval(this, index, extraPersonType)) {
            self._removeStoredExtraPersonAtIndex(this.item, extraPersonType, self._getExtraPersonStorageIndex(row));
            if (row?.parentNode) row.parentNode.removeChild(row);
            if (this.saveOnEdit) {
              await this.item.saveTx({ skipDateModifiedUpdate: true });
            }
          }
          return;
        }

        const nativeIndex = self._getNativeCreatorIndex(this, index);
        return self._orig.infoBoxProtoRemoveCreator.call(this, nativeIndex);
      };
    }
  }

  _patchInfoBoxPrototypeFromInstance(infoBox) {
    try {
      const proto = Object.getPrototypeOf(infoBox);
      if (!proto) return;
      this._patchInfoBoxPrototype(proto);
    } catch (e) {}
  }

  _registerCaseReporterSync() {
    if (!Zotero?.Notifier?.registerObserver) return;
    if (this._itemObserverID) return;

    const self = this;
    this._itemObserverID = Zotero.Notifier.registerObserver({
      async notify(event, type, ids) {
        try { Zotero.debug(`[Citation Phoenix] case reporter sync notifier: event=${String(event)} type=${String(type)} ids=${Array.isArray(ids) ? ids.length : 0}`); } catch (e) {}
        const isSyncEvent = ['add', 'modify', 'refresh', 'redraw', 'select'].includes(event);
        if (!isSyncEvent) return;

        if (type === 'item' && Array.isArray(ids) && ids.length) {
          if (self._isEditingInActiveInfoBox()) {
            for (const id of ids) {
              if (event === 'add') {
                await self._applyPendingCustomNewItemType(id);
              }
            }
            self._deferItemSyncUntilInfoBoxIdle(ids);
            return;
          }

          let changed = false;
          for (const id of ids) {
            if (event === 'add') {
              changed = (await self._applyPendingCustomNewItemType(id)) || changed;
            }
            changed = (await self._syncItemFromFieldsAndMLZ(id)) || changed;
          }
          if (changed) {
            self._scheduleActiveInfoPaneRefresh(75, true);
          } else if (['select', 'refresh', 'redraw', 'modify'].includes(event)) {
            self._scheduleActiveInfoPaneRefresh(75);
          }
          return;
        }

        await self._syncCaseReporterFromActiveSelection();
      },
    }, ['item', 'itempane', 'tab'], 'citation-phoenix-case-reporter-sync');
  }

  _patchNewItemMenus() {
    const mainWindow = Zotero.getMainWindow?.();
    const doc = mainWindow?.document;
    if (!doc) {
      this._scheduleItemPaneRenderPatch();
      return;
    }
    if (this._orig.newItemMenuDocument === doc) return;

    this._unpatchNewItemMenus();
    const self = this;
    const onPopupShowing = function (event) {
      try {
        self._augmentAnyNewItemPopup(event?.target || null);
      } catch (e) {
        try { Zotero.debug(`[Citation Phoenix] new item popup patch failed: ${String(e)}`); } catch (_) {}
      }
    };

    // IMPORTANT: use the bubble phase (capture=false), not the capture
    // phase. Zotero populates these menus lazily from an inline
    // `onpopupshowing` attribute handler (e.g. `updateNewItemTypes()` /
    // `buildNewItemMenu()`) on the popup itself. A capturing listener on
    // `document` runs *before* that handler (capture goes document -> target),
    // so it would always see an empty/stale menu. Listening on the bubble
    // phase guarantees this runs after the popup has been populated.
    doc.addEventListener('popupshowing', onPopupShowing, false);
    this._orig.newItemMenuDocument = doc;
    this._orig.newItemMenuPopupShowing = onPopupShowing;
  }

  _patchNewItemBuilders() {
    const mainWindow = Zotero.getMainWindow?.();
    const doc = mainWindow?.document;
    const zoteroPaneLocal = mainWindow?.ZoteroPane_Local || mainWindow?.ZoteroPane;
    let patched = false;
    if (this._orig.updateNewItemTypesOwner === zoteroPaneLocal && this._orig.updateNewItemTypes) {
      patched = true;
    }
    if (zoteroPaneLocal?.updateNewItemTypes && this._orig.updateNewItemTypesOwner !== zoteroPaneLocal) {
      if (this._orig.updateNewItemTypesOwner && this._orig.updateNewItemTypes) {
        this._orig.updateNewItemTypesOwner.updateNewItemTypes = this._orig.updateNewItemTypes;
      }
      this._orig.updateNewItemTypes = zoteroPaneLocal.updateNewItemTypes;
      this._orig.updateNewItemTypesOwner = zoteroPaneLocal;
      const self = this;
      zoteroPaneLocal.updateNewItemTypes = function (...args) {
        const result = self._orig.updateNewItemTypes.apply(this, args);
        try {
          self._augmentKnownNewItemPopups(doc, 'toolbar');
        } catch (e) {
          try { Zotero.debug(`[Citation Phoenix] toolbar new-item patch failed: ${String(e)}`); } catch (_) {}
        }
        return result;
      };
      patched = true;
    }

    const zoteroStandalone = mainWindow?.ZoteroStandalone;
    if (this._orig.buildNewItemMenuOwner === zoteroStandalone && this._orig.buildNewItemMenu) {
      patched = true;
    }
    if (zoteroStandalone?.buildNewItemMenu && this._orig.buildNewItemMenuOwner !== zoteroStandalone) {
      if (this._orig.buildNewItemMenuOwner && this._orig.buildNewItemMenu) {
        this._orig.buildNewItemMenuOwner.buildNewItemMenu = this._orig.buildNewItemMenu;
      }
      this._orig.buildNewItemMenu = zoteroStandalone.buildNewItemMenu;
      this._orig.buildNewItemMenuOwner = zoteroStandalone;
      const self = this;
      zoteroStandalone.buildNewItemMenu = function (...args) {
        const result = self._orig.buildNewItemMenu.apply(this, args);
        try {
          self._augmentKnownNewItemPopups(doc, 'file-menu');
        } catch (e) {
          try { Zotero.debug(`[Citation Phoenix] file-menu new-item patch failed: ${String(e)}`); } catch (_) {}
        }
        return result;
      };
      patched = true;
    }

    if (!patched) {
      this._scheduleItemPaneRenderPatch();
    }
  }

  _unpatchNewItemBuilders() {
    if (this._orig.updateNewItemTypesOwner && this._orig.updateNewItemTypes) {
      this._orig.updateNewItemTypesOwner.updateNewItemTypes = this._orig.updateNewItemTypes;
    }

    if (this._orig.buildNewItemMenuOwner && this._orig.buildNewItemMenu) {
      this._orig.buildNewItemMenuOwner.buildNewItemMenu = this._orig.buildNewItemMenu;
    }

    delete this._orig.updateNewItemTypes;
    delete this._orig.updateNewItemTypesOwner;
    delete this._orig.buildNewItemMenu;
    delete this._orig.buildNewItemMenuOwner;
  }

  _unpatchNewItemMenus() {
    try {
      if (this._orig.newItemMenuDocument && this._orig.newItemMenuPopupShowing) {
        this._orig.newItemMenuDocument.removeEventListener('popupshowing', this._orig.newItemMenuPopupShowing, false);
      }
    } catch (e) {
    } finally {
      delete this._orig.newItemMenuDocument;
      delete this._orig.newItemMenuPopupShowing;
      this._pendingCustomNewItemTypes = [];
    }
  }

  _augmentAnyNewItemPopup(node) {
    const popup = this._coerceMenuPopup(node);
    if (!popup) return;
    if (!this._isKnownNewItemMenuPopup(popup)) return;
    this._augmentNewItemPopupWithCustomTypes(popup);
  }

  _coerceMenuPopup(node) {
    if (!node) return null;
    if (node.localName === 'menupopup') return node;
    return node.querySelector?.('menupopup') || null;
  }

  /**
   * Whether `popup` is specifically the toolbar "+" button's popup or the
   * File > New Item submenu's popup -- and NOT some other, unrelated
   * menupopup/submenu/context-menu elsewhere in the app. This check must
   * stay strict (exact known IDs only): a loose structural heuristic (e.g.
   * "looks like a plain list of >=8 menuitems") also matches things like the
   * column-picker or sort submenus, causing custom entries to leak into
   * every menu in the app.
   */
  _isKnownNewItemMenuPopup(popup) {
    if (!popup || popup.localName !== 'menupopup') return false;
    const knownIDs = ['menu_NewItemPopup', 'menu_newItemPopup', 'newItemPopup', 'zotero-tb-add-menu', 'zotero-add-item'];
    if (knownIDs.includes(popup.id)) return true;
    const parentID = popup.parentNode?.id;
    return parentID === 'zotero-tb-add' || knownIDs.includes(parentID);
  }

  _augmentKnownNewItemPopups(doc = Zotero.getMainWindow?.()?.document) {
    if (!doc) return;

    const candidates = new Set();
    for (const id of [
      'zotero-tb-add',
      'zotero-tb-add-menu',
      'zotero-add-item',
      'menu_NewItemPopup',
      'menu_newItemPopup',
      'newItemPopup',
    ]) {
      const node = doc.getElementById?.(id);
      const popup = this._coerceMenuPopup(node);
      if (popup) candidates.add(popup);
      if (node?.localName === 'menupopup') candidates.add(node);
    }

    for (const popup of candidates) {
      this._augmentNewItemPopupWithCustomTypes(popup);
    }
  }

  /**
   * Insert our custom item-type entries into a "New Item" menupopup,
   * interleaved in true alphabetical order among the existing (native)
   * entries -- not just appended as a sorted group at the end.
   *
   * This intentionally does NOT try to detect which native menuitem
   * corresponds to which native base item type. Zotero's own toolbar/File-menu
   * builders (`updateNewItemTypes()` / `buildNewItemMenu()`) only set
   * `label`/`tooltiptext` on their generated `<menuitem>`s -- they carry no
   * `value`/`typeid` attribute we could match against reliably -- so matching
   * by type is fragile and can silently insert nothing at all if it fails.
   * Instead, each custom entry is positioned purely by comparing its label
   * against the labels of the menuitems already in the popup, which both
   * native and custom entries always have.
   */
  _augmentNewItemPopupWithCustomTypes(popup) {
    if (!popup || popup.localName !== 'menupopup') return;
    // Only ever touch the toolbar "+" button's popup or the File > New Item
    // submenu -- never any other menu/context-menu/submenu in the app.
    if (!this._isKnownNewItemMenuPopup(popup)) return;
    // Leave the item pane's own item-type dropdown alone; it's built and
    // maintained separately (see _buildItemTypeMenuList) and already lists
    // custom types correctly.
    if (popup.closest?.('#itembox-field-itemType-menu')) return;
    if (popup.querySelector?.('[data-ibcslm-option-key]')) return;
    // Never mutate a popup that is already fully open. Appending/removing
    // children on an open XUL menupopup doesn't reliably trigger a resize/
    // repaint, so previously-appended entries can appear to "vanish" (or
    // flicker) until the menu is closed and reopened. Only augment while the
    // popup is being (re)built, i.e. during its own `popupshowing` handling.
    if (popup.state && popup.state !== 'closed' && popup.state !== 'showing') return;

    // Remove any entries we previously inserted so repeated popupshowing
    // events (including cases where Zotero doesn't rebuild the menu, e.g.
    // the toolbar button's MRU-cached `updateNewItemTypes()`) stay
    // idempotent instead of duplicating entries.
    for (const node of Array.from(popup.querySelectorAll?.(`[${this._newItemMenuMarkerAttribute}="true"]`) || [])) {
      node.remove();
    }

    const options = this._getSortedCustomItemTypeOptions();
    if (!options.length) return;

    const doc = popup.ownerDocument;
    const seen = new Set();
    for (const option of options) {
      const itemType = String(option?.itemType || '').trim();
      const baseItemType = String(option?.baseItemType || '').trim();
      if (!itemType || !baseItemType || seen.has(itemType)) continue;
      seen.add(itemType);

      const label = String(option?.label || '').trim() || itemType;
      const menuitem = doc.createXULElement('menuitem');
      menuitem.setAttribute(this._newItemMenuMarkerAttribute, 'true');
      menuitem.setAttribute('label', label);
      menuitem.setAttribute('tooltiptext', itemType);
      menuitem.addEventListener('command', (event) => {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        this._createCustomNewItem(itemType, baseItemType);
      });
      this._insertMenuitemInAlphabeticalPosition(popup, menuitem, label);
    }
  }

  /**
   * Insert `menuitem` into `popup` immediately before the first sibling
   * `<menuitem>` whose label sorts after `label`, or at the end if none does.
   *
   * Zotero's native "New Item" menus aren't one single alphabetically sorted
   * list: the toolbar button puts a "recently used" subset of types on top
   * (itself alphabetically sorted, but a small subset), then a separator,
   * then the complete alphabetically sorted list of all types below it. The
   * File menu similarly splits "primary" and "secondary" types across a
   * separator. Comparing a custom entry's label against the *whole* popup
   * would frequently match something early in that small top section,
   * making custom entries appear to jump to the top of the menu. To avoid
   * that, only compare against -- and insert within -- the section *after*
   * the last separator, which is always a complete, non-truncated
   * alphabetically sorted list.
   */
  _insertMenuitemInAlphabeticalPosition(popup, menuitem, label) {
    let collation = null;
    try { collation = Zotero?.getLocaleCollation?.(); } catch (e) {}

    const children = Array.from(popup.children || []);
    let lastSeparatorIndex = -1;
    children.forEach((node, index) => {
      if (node?.localName === 'menuseparator') lastSeparatorIndex = index;
    });

    let referenceNode = null;
    for (let index = lastSeparatorIndex + 1; index < children.length; index += 1) {
      const node = children[index];
      if (node?.localName !== 'menuitem') continue;
      const siblingLabel = String(node.getAttribute('label') || '');
      const comparison = collation?.compareString
        ? collation.compareString(1, label, siblingLabel)
        : label.localeCompare(siblingLabel, undefined, { sensitivity: 'base' });
      if (comparison < 0) {
        referenceNode = node;
        break;
      }
    }
    popup.insertBefore(menuitem, referenceNode);
  }

  /**
   * Custom item-type options, sorted alphabetically by label (locale-aware,
   * matching how Zotero itself sorts native item types in these same menus).
   */
  _getSortedCustomItemTypeOptions() {
    const locale = Zotero?.locale || 'en-US';
    const options = (this.schemaConfig?.getCustomItemTypeOptions?.(locale) || []).slice();

    let collation = null;
    try { collation = Zotero?.getLocaleCollation?.(); } catch (e) {}

    options.sort((a, b) => {
      const labelA = String(a?.label || a?.itemType || '');
      const labelB = String(b?.label || b?.itemType || '');
      if (collation?.compareString) return collation.compareString(1, labelA, labelB);
      return labelA.localeCompare(labelB, undefined, { sensitivity: 'base' });
    });
    return options;
  }

  async _createCustomNewItem(itemType, baseItemType) {
    const customItemType = String(itemType || '').trim();
    const nativeType = String(baseItemType || '').trim();
    if (!customItemType || !nativeType) return null;

    const typeID = Zotero?.ItemTypes?.getID?.(nativeType);
    const mainWindow = Zotero.getMainWindow?.();
    const pane = mainWindow?.ZoteroPane_Local || mainWindow?.ZoteroPane;
    const created = await pane?.newItem?.(typeID ?? nativeType, {}, null, true);
    const item = this._resolveCreatedZoteroItem(created);
    if (!item || item.deleted) return item || null;

    const extra = String(item.getField?.('extra') || '');
    const nextExtra = this.Jurisdiction.updateMLZItemType?.(extra, customItemType) ?? extra;
    if (nextExtra !== extra) {
      item.setField('extra', nextExtra);
      await item.saveTx({ skipDateModifiedUpdate: true });
    }
    this._scheduleActiveInfoPaneRefresh(0, true);
    try {
      Zotero.debug(`[Citation Phoenix] created custom new-item type: item=${String(item.id || '')} native=${nativeType} custom=${customItemType}`);
    } catch (e) {}
    return item;
  }

  _resolveCreatedZoteroItem(created) {
    if (!created) return null;
    if (typeof created.getField === 'function' && typeof created.setField === 'function') return created;
    return this._getZoteroItemByAnyID(created);
  }

  _queuePendingCustomNewItemType(itemType, baseItemType) {
    const customItemType = String(itemType || '').trim();
    const nativeType = String(baseItemType || '').trim();
    if (!customItemType || !nativeType) return;

    this._pendingCustomNewItemTypes = this._pendingCustomNewItemTypes.filter((entry) => {
      return String(entry?.baseItemType || '').trim() !== nativeType;
    });
    this._pendingCustomNewItemTypes.push({
      itemType: customItemType,
      baseItemType: nativeType,
      createdAt: Date.now(),
    });
    while (this._pendingCustomNewItemTypes.length > 8) {
      this._pendingCustomNewItemTypes.shift();
    }
  }

  async _applyPendingCustomNewItemType(itemID) {
    if (!this._pendingCustomNewItemTypes.length) return false;

    const item = this._getZoteroItemByAnyID(itemID);
    if (!item || item.deleted) return false;

    const now = Date.now();
    this._pendingCustomNewItemTypes = this._pendingCustomNewItemTypes.filter(
      (entry) => entry && (now - Number(entry.createdAt || 0) < 15000),
    );
    if (!this._pendingCustomNewItemTypes.length) return false;

    const nativeItemType = this._getItemTypeNameByID(item.itemTypeID);
    let matchIndex = -1;
    for (let idx = this._pendingCustomNewItemTypes.length - 1; idx >= 0; idx -= 1) {
      if (String(this._pendingCustomNewItemTypes[idx]?.baseItemType || '').trim() === nativeItemType) {
        matchIndex = idx;
        break;
      }
    }
    if (matchIndex === -1) return false;

    const [match] = this._pendingCustomNewItemTypes.splice(matchIndex, 1);
    const extra = String(item.getField?.('extra') || '');
    const nextExtra = this.Jurisdiction.updateMLZItemType?.(extra, match.itemType) ?? extra;
    if (nextExtra === extra) return false;

    item.setField('extra', nextExtra);
    await item.saveTx({ skipDateModifiedUpdate: true });
    try {
      Zotero.debug(`[Citation Phoenix] applied custom new-item type: item=${String(item.id || '')} native=${nativeItemType} custom=${match.itemType}`);
    } catch (e) {}
    return true;
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
          try { Zotero.debug(`[Citation Phoenix] item-pane render sync: item=${String(itemID)}`); } catch (e) {}
          if (self._isEditingInActiveInfoBox()) {
            self._deferItemSyncUntilInfoBoxIdle([itemID]);
          } else {
            await self._syncItemFromFieldsAndMLZ(itemID);
          }
        }
      } catch (e) {
        try { Zotero.debug(`[Citation Phoenix] item-pane render sync failed: ${String(e)}`); } catch (_) {}
      }
      return self._orig.itemDetailsRender.apply(this, args);
    };

    this._patchNewItemMenus();
  }

  _patchInfoBoxRender() {
    if (this._orig.infoBoxRender && this._orig.infoBoxOwner) return;

    const infoBox = this._getActiveInfoBox();
    if (!infoBox?.render) {
      this._scheduleItemPaneRenderPatch();
      return;
    }

    this._patchInfoBoxPrototypeFromInstance(infoBox);

    const self = this;
    this._orig.infoBoxOwner = infoBox;
    this._orig.infoBoxRender = infoBox.render;
    infoBox.render = function (...args) {
      const result = self._orig.infoBoxRender.apply(this, args);
      try {
        try {
          const itemID = this.item?.id;
          const customRows = this.querySelectorAll?.('[data-custom-row-id]')?.length || 0;
          Zotero.debug(`[Citation Phoenix] info-box instance render: item=${String(itemID || '')} customRows=${String(customRows)}`);
        } catch (e) {}
        self._refreshInfoBoxAfterRender(this);
      } catch (e) {
        try { Zotero.debug(`[Citation Phoenix] custom info row render failed: ${String(e)}`); } catch (_) {}
      }
      return result;
    };

    this._patchNewItemMenus();
  }

  _scheduleItemPaneRenderPatch() {
    if ((this._orig.itemDetailsRender && this._orig.itemDetailsOwner)
      && (this._orig.infoBoxRender && this._orig.infoBoxOwner)) return;
    if (this._itemPanePatchAttempts >= this._maxItemPanePatchAttempts) return;
    if (this._itemPanePatchTimer) return;

    this._itemPanePatchAttempts += 1;
    this._itemPanePatchTimer = setTimeout(() => {
      this._itemPanePatchTimer = null;
      this._patchNewItemBuilders();
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
      if (this._infoPaneRefreshTimer) {
        clearTimeout(this._infoPaneRefreshTimer);
        this._infoPaneRefreshTimer = null;
      }
      this._clearDeferredInfoPaneRefresh();
      if (this._deferredItemSyncTimer) {
        clearTimeout(this._deferredItemSyncTimer);
        this._deferredItemSyncTimer = null;
      }
      if (this._schemaSequenceRetryTimer) {
        clearTimeout(this._schemaSequenceRetryTimer);
        this._schemaSequenceRetryTimer = null;
      }
      this._disconnectSchemaSequenceObserver();
      this._schemaSequenceRetryKey = '';
      this._deferredItemSyncIDs.clear();
      this._forceFullInfoPaneRefresh = false;
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
      this._removeExtraPersonCreatorRows(this._getActiveInfoBox());
      this._removeCommenterField(this._getActiveInfoBox());
      this._removeJurisdictionField(this._getActiveInfoBox());
      this._removeCustomCourtField(this._getActiveInfoBox());
      this._cleanupRegisteredSchemaInfoRows(this._getActiveInfoBox());
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
      if (this._deferredItemSyncTimer) {
        clearTimeout(this._deferredItemSyncTimer);
        this._deferredItemSyncTimer = null;
      }
      if (this._schemaSequenceRetryTimer) {
        clearTimeout(this._schemaSequenceRetryTimer);
        this._schemaSequenceRetryTimer = null;
      }
      this._disconnectSchemaSequenceObserver();
      this._schemaSequenceRetryKey = '';
      this._deferredItemSyncIDs.clear();
    }
  }

  _scheduleActiveInfoPaneRefresh(delay = 0, forceFullRender = false) {
    if (this._infoPaneRefreshTimer) {
      clearTimeout(this._infoPaneRefreshTimer);
    }

    this._forceFullInfoPaneRefresh = this._forceFullInfoPaneRefresh || !!forceFullRender;

    this._infoPaneRefreshTimer = setTimeout(() => {
      this._infoPaneRefreshTimer = null;
      const shouldForceFullRender = this._forceFullInfoPaneRefresh;
      this._forceFullInfoPaneRefresh = false;
      this._refreshActiveInfoPane(shouldForceFullRender);
    }, Math.max(0, Number(delay) || 0));
  }

  _refreshActiveInfoPane(forceFullRender = false) {
    try {
      const infoBox = this._getActiveInfoBox?.();
      if (!infoBox) return;
      if (this._isEditingInInfoBox(infoBox)) {
        this._deferActiveInfoPaneRefreshUntilBlur(infoBox, forceFullRender);
        return;
      }
      if (forceFullRender && typeof infoBox.render === 'function') {
        infoBox.render();
        return;
      }
      this._refreshCustomInfoRows(infoBox);
    } catch (e) {}
  }

  _refreshInfoBoxAfterRender(infoBox) {
    if (!infoBox) return;
    if (this._isEditingInInfoBox(infoBox)) {
      try { Zotero.debug('[Citation Phoenix] info-box render augmentation deferred while editor is active'); } catch (e) {}
      // Zotero's render can remove plugin-owned rows after the native editor
      // has been installed. Restore only those rows on the next turn so the
      // active native editor is not replaced or moved during its event.
      setTimeout(() => {
        const activeInfoBox = this._getActiveInfoBox?.();
        if (activeInfoBox !== infoBox) return;
        if (this._isEditingInInfoBox(infoBox)) {
          try {
            this._ensureExtraPersonMenuItems(infoBox);
            this._removeCommenterField(infoBox);
            this._renderExtraPersonCreatorRows(infoBox);
            this._refreshCustomInfoRows(infoBox, { preserveLayout: true });
          } catch (e) {}
          return;
        }
        this._refreshInfoBoxAfterRender(infoBox);
      }, 0);
      return;
    }

    this._ensureExtraPersonMenuItems(infoBox);
    this._removeCommenterField(infoBox);
    this._renderExtraPersonCreatorRows(infoBox);
    this._refreshCustomInfoRows(infoBox);
  }

  _isEditingInInfoBox(infoBox) {
    const activeElement = infoBox?.ownerDocument?.activeElement || null;
    if (!activeElement || !infoBox?.contains?.(activeElement)) return false;

    const localName = String(activeElement.localName || activeElement.nodeName || '').toLowerCase();
    if (['input', 'textarea', 'select', 'menulist', 'textbox'].includes(localName)) return true;
    if (activeElement.isContentEditable) return true;
    if (activeElement.getAttribute?.('contenteditable') === 'true') return true;
    if (activeElement.matches?.('[editable="true"], [role="textbox"], .editable, .value')) return true;
    return false;
  }

  _isEditingInActiveInfoBox() {
    return this._isEditingInInfoBox(this._getActiveInfoBox?.());
  }

  _deferItemSyncUntilInfoBoxIdle(ids) {
    for (const id of Array.isArray(ids) ? ids : []) {
      if (id != null) this._deferredItemSyncIDs.add(String(id));
    }
    if (!this._deferredItemSyncIDs.size) return;

    if (this._deferredItemSyncTimer) {
      clearTimeout(this._deferredItemSyncTimer);
    }

    this._deferredItemSyncTimer = setTimeout(async () => {
      this._deferredItemSyncTimer = null;

      if (this._isEditingInActiveInfoBox()) {
        this._deferItemSyncUntilInfoBoxIdle([]);
        return;
      }

      const pendingIDs = Array.from(this._deferredItemSyncIDs);
      this._deferredItemSyncIDs.clear();
      let changed = false;
      for (const id of pendingIDs) {
        changed = (await this._syncItemFromFieldsAndMLZ(id)) || changed;
      }

      if (changed) {
        this._scheduleActiveInfoPaneRefresh(75, true);
      }
    }, 250);
  }

  _deferActiveInfoPaneRefreshUntilBlur(infoBox, forceFullRender = false) {
    const activeElement = infoBox?.ownerDocument?.activeElement || null;
    if (!activeElement) return;

    const existing = this._deferredInfoPaneRefresh;
    if (existing?.element === activeElement) {
      existing.forceFullRender = existing.forceFullRender || !!forceFullRender;
      return;
    }

    this._clearDeferredInfoPaneRefresh();
    const state = {
      element: activeElement,
      forceFullRender: !!forceFullRender,
      handler: null,
    };

    state.handler = () => {
      const shouldForceFullRender = !!state.forceFullRender;
      this._clearDeferredInfoPaneRefresh();
      this._scheduleActiveInfoPaneRefresh(50, shouldForceFullRender);
    };

    this._deferredInfoPaneRefresh = state;
    activeElement.addEventListener?.('blur', state.handler, { once: true });
  }

  _clearDeferredInfoPaneRefresh() {
    const state = this._deferredInfoPaneRefresh;
    this._deferredInfoPaneRefresh = null;
    if (!state?.element || !state.handler) return;
    try {
      state.element.removeEventListener?.('blur', state.handler);
    } catch (e) {}
  }

  _refreshRegisteredInfoRows() {
    // Schema rows are rendered directly into the DOM info box.
  }

  _refreshCustomInfoRows(infoBox, options = {}) {
    if (!infoBox) return;
    const preserveLayout = !!options.preserveLayout;
    this._renderItemTypeField(infoBox);
    this._renderJurisdictionField(infoBox);
    this._renderCourtField(infoBox);
    this._renderSchemaFieldRows(infoBox, { preserveLayout });
    this._renderCustomCourtField(infoBox, { preserveLayout });
    if (preserveLayout) return;
    this._watchSchemaSequence(infoBox);
    this._scheduleInitialSchemaSequenceRetry(infoBox);
  }

  async _syncCaseReporterFromFieldsAndMLZ(itemID) {
    const item = this._getZoteroItemByAnyID(itemID);
    if (!item || item.deleted) return false;

    const itemTypeName = this._getItemTypeName(item);
    if (itemTypeName !== 'case') return false;

    const reporter = String(item.getField?.('reporter') || '').trim();
    const rawCourt = String(item.getField?.('court') || '').trim();
    const hasCourtKeyAlready = this._looksLikeCourtKey(rawCourt);
    const parsedCourt = hasCourtKeyAlready ? null : (this.caseCourtMapper?.mapCaseCourt?.(rawCourt) || null);
    const mappedCourt = this.abbrevService.normalizeKey(parsedCourt?.courtKey || '');
    const mappedJurisdiction = String(parsedCourt?.jurisdiction || '').trim().toLowerCase();
    const court = this.abbrevService.normalizeKey(rawCourt || '');
    const extra = String(item.getField?.('extra') || '');
    const mlzFields = this.Jurisdiction.getMLZExtraFields?.(extra) || null;
    const mlzReporter = String(mlzFields?.reporter || '').trim();
    const mlzCourt = this.abbrevService.normalizeKey(mlzFields?.court || '');
    const mlzJurisdiction = this.Jurisdiction.getMLZJurisdiction?.(extra) || '';
    const derivedJurisdiction = this.Jurisdiction.fromItem(item);
    const inferredJurisdiction = mappedJurisdiction || derivedJurisdiction;
    const upgradedCourt = this._upgradeGenericCourtKey(court, inferredJurisdiction);

    try {
      Zotero.debug(`[Citation Phoenix] case court mapping: raw="${rawCourt}" mappedCourt="${mappedCourt}" mappedJurisdiction="${mappedJurisdiction}" derivedJurisdiction="${derivedJurisdiction}" inferredJurisdiction="${inferredJurisdiction}" upgradedCourt="${upgradedCourt}"`);
    } catch (e) {}

    let nextExtra = extra;
    let changed = false;

    const targetCourt = mappedCourt || upgradedCourt;
    if (targetCourt && (!hasCourtKeyAlready || court !== targetCourt)) {
      item.setField('court', targetCourt);
      changed = true;
    }

    const effectiveCourt = targetCourt || court;
    const effectiveJurisdiction = inferredJurisdiction;
    const canRewriteJurisdiction = !mlzJurisdiction || /^us(?::|$)/.test(mlzJurisdiction);

    if (reporter && reporter !== mlzReporter) {
      nextExtra = this.Jurisdiction.updateMLZExtraField?.(nextExtra, 'reporter', reporter) ?? nextExtra;
    }

    if (!reporter && mlzReporter) {
      item.setField('reporter', mlzReporter);
      changed = true;
    }

    if (canRewriteJurisdiction && effectiveJurisdiction && effectiveJurisdiction !== mlzJurisdiction) {
      const displayJurisdiction = this.abbrevService.formatJurisdictionDisplay(effectiveJurisdiction);
      nextExtra = this.Jurisdiction.updateMLZJurisdiction?.(nextExtra, effectiveJurisdiction, displayJurisdiction) ?? nextExtra;
    }

    if (effectiveCourt && effectiveCourt !== mlzCourt) {
      nextExtra = this.Jurisdiction.updateMLZExtraField?.(nextExtra, 'court', effectiveCourt) ?? nextExtra;
    }

    if (!effectiveCourt && mlzCourt) {
      item.setField('court', mlzCourt);
      changed = true;
    }

    if (nextExtra !== extra) {
      item.setField('extra', nextExtra);
      changed = true;
    }

    if (!changed) return false;

    await item.saveTx({ skipDateModifiedUpdate: true });
    try {
      Zotero.debug(`[Citation Phoenix] case sync: wrote reporter/jurisdiction/court mlz state (item ${String(itemID)})`);
    } catch (e) {}
    return true;
  }

  async _syncItemFromFieldsAndMLZ(itemID) {
    const normalizedID = String(itemID);
    if (this._syncInFlight.has(normalizedID)) return false;

    this._syncInFlight.add(normalizedID);
    try {
      const itemTypeChanged = await this._syncStoredCustomItemType(itemID);
      const caseChanged = await this._syncCaseReporterFromFieldsAndMLZ(itemID);
      const schemaChanged = await this._syncSchemaConfiguredFields(itemID);
      return !!(itemTypeChanged || caseChanged || schemaChanged);
    } catch (e) {
      try { Zotero.logError(e); } catch (_) {}
      try { Zotero.debug(`[Citation Phoenix] item sync failed for item ${normalizedID}: ${String(e)}`); } catch (_) {}
      return false;
    } finally {
      this._syncInFlight.delete(normalizedID);
    }
  }

  async _syncStoredCustomItemType(itemID) {
    const item = this._getZoteroItemByAnyID(itemID);
    if (!item || item.deleted) return false;

    const nativeItemType = this._getItemTypeNameByID(item.itemTypeID);
    const storedItemType = this._getStoredCustomItemTypeName(item);
    if (!storedItemType) return false;

    const expectedNativeType = this.schemaConfig?.getBaseItemType?.(storedItemType) || '';
    if (!expectedNativeType || expectedNativeType === nativeItemType) return false;

    const extra = String(item.getField?.('extra') || '');
    const nextExtra = this.Jurisdiction.updateMLZItemType?.(extra, '') ?? extra;
    if (nextExtra === extra) return false;

    item.setField('extra', nextExtra);
    await item.saveTx({ skipDateModifiedUpdate: true });
    try {
      Zotero.debug(`[Citation Phoenix] cleared stale custom item type: item=${String(item.id || '')} native=${nativeItemType} stale=${storedItemType}`);
    } catch (e) {}
    return true;
  }

  async _syncSchemaConfiguredFields(itemID) {
    const item = this._getZoteroItemByAnyID(itemID);
    if (!item || item.deleted) return false;

    const itemTypeName = this._getItemTypeName(item);
    const fieldDefinitions = this.schemaConfig?.getFieldDefinitionsForItemType?.(itemTypeName) || [];
    if (!fieldDefinitions.length) return false;

    const extra = String(item.getField?.('extra') || '');
    const mlzFields = this.Jurisdiction.getMLZExtraFields?.(extra) || null;
    let nextExtra = extra;
    let changed = false;

    for (const definition of fieldDefinitions) {
      if (!definition?.field) continue;
      if (itemTypeName === 'case' && ['reporter', 'court', 'jurisdiction'].includes(definition.field)) continue;

      const nativeFieldName = this._resolveNativeFieldName(item.itemTypeID, definition.field, definition.baseField);
      const nativeValue = nativeFieldName ? String(item.getField?.(nativeFieldName) || '').trim() : '';

      if (definition.field === 'jurisdiction') {
        const normalizedNative = nativeValue ? this._normalizeJurisdictionValue(nativeValue) : '';
        const mlzJurisdiction = this.Jurisdiction.getMLZJurisdiction?.(extra) || '';
        if (nativeFieldName && normalizedNative && normalizedNative !== mlzJurisdiction) {
          const displayJurisdiction = this.abbrevService.formatJurisdictionDisplay(normalizedNative);
          nextExtra = this.Jurisdiction.updateMLZJurisdiction?.(nextExtra, normalizedNative, displayJurisdiction) ?? nextExtra;
        }
        if (nativeFieldName && !normalizedNative && mlzJurisdiction) {
          item.setField(nativeFieldName, mlzJurisdiction);
          changed = true;
        }
        continue;
      }

      const mlzValue = String(mlzFields?.[definition.field] || '').trim();
      if (nativeFieldName && nativeValue && nativeValue !== mlzValue) {
        nextExtra = this.Jurisdiction.updateMLZExtraField?.(nextExtra, definition.field, nativeValue) ?? nextExtra;
      }
      if (nativeFieldName && !nativeValue && mlzValue) {
        item.setField(nativeFieldName, mlzValue);
        changed = true;
      }
    }

    if (nextExtra !== extra) {
      item.setField('extra', nextExtra);
      changed = true;
    }

    if (!changed) return false;
    await item.saveTx({ skipDateModifiedUpdate: true });
    return true;
  }

  _looksLikeCourtKey(value) {
    const normalized = this.abbrevService.normalizeKey(value || '');
    if (!normalized) return false;
    return /^[a-z0-9]+(?:\.[a-z0-9]+)*$/.test(normalized);
  }

  _upgradeGenericCourtKey(courtKey, jurisdiction) {
    const key = this.abbrevService.normalizeKey(courtKey || '');
    const jur = String(jurisdiction || '').trim().toLowerCase();
    if (!key) return '';

    if ((key === 'court.appeal' || key === 'court.appeals') && jur === 'us:c') {
      return 'court.appeals.federal.circuit';
    }
    if (key === 'court.appeal') {
      return 'court.appeals';
    }
    return '';
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
        await this._syncItemFromFieldsAndMLZ(id);
      }
    } catch (e) {
      try { Zotero.debug(`[Citation Phoenix] case reporter selection sync failed: ${String(e)}`); } catch (_) {}
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
    const itemTypeName = this._getItemTypeName(item);
    const definition = item ? this.schemaConfig?.getFieldDefinition?.(itemTypeName, 'jurisdiction') : null;
    if (!item || item.deleted || !definition) {
      this._removeJurisdictionField(infoBox);
      return;
    }

    const table = this._getInfoTable(infoBox);
    if (!table) return;

    const row = this._getOrCreateJurisdictionRow(infoBox);
    if (row.parentNode !== table) {
      table.appendChild(row);
    }

    this._updateJurisdictionRow(infoBox, row, item, definition);
  }

  _renderExtraPersonCreatorRows(infoBox) {
    const allowed = this._getExtraPersonTypesForItem(infoBox?.item);
    const allowedKeys = new Set(allowed.map((entry) => entry.key));
    for (const extraPersonType of this._extraPersonTypes) {
      if (!allowedKeys.has(extraPersonType.key)) {
        this._removeExtraPersonCreatorRows(infoBox, extraPersonType);
      }
    }
    for (const extraPersonType of allowed) {
      this._renderExtraPersonCreatorRow(infoBox, extraPersonType);
    }
  }

  _renderExtraPersonCreatorRow(infoBox, extraPersonType) {
    const item = infoBox?.item;
    if (!item || item.deleted || !this._itemTypeSupportsExtraPerson(item)) {
      this._removeExtraPersonCreatorRows(infoBox, extraPersonType);
      return;
    }

    const extraPeople = this._getStoredExtraPeople(item, extraPersonType);
    if (!extraPeople.length) {
      const activeRow = this._getActiveExtraPersonCreatorRow(infoBox, extraPersonType);
      if (activeRow) {
        this._markExtraPersonCreatorRow(activeRow, extraPersonType, this._getExtraPersonStorageIndex(activeRow));
        return;
      }
      this._removeExtraPersonCreatorRows(infoBox, extraPersonType);
      try { Zotero.debug(`[Citation Phoenix] ${extraPersonType.key} creator row skipped: item=${String(item?.id || '')} no stored value`); } catch (e) {}
      return;
    }
    if (typeof infoBox.addCreatorRow !== 'function') {
      try { Zotero.debug(`[Citation Phoenix] ${extraPersonType.key} creator row skipped: item=${String(item?.id || '')} addCreatorRow unavailable`); } catch (e) {}
      return;
    }

    const existingRows = this._getExtraPersonCreatorRows(infoBox, extraPersonType);
    if (existingRows.length >= extraPeople.length) {
      existingRows.forEach((row, idx) => this._markExtraPersonCreatorRow(row, extraPersonType, idx));
      return;
    }

    this._removeEmptyDefaultCreatorRows(infoBox);
    for (let storageIndex = existingRows.length; storageIndex < extraPeople.length; storageIndex += 1) {
      const creatorData = this._extraPersonToCreatorData(extraPeople[storageIndex]);
      const rowIndex = infoBox._creatorCount;
      infoBox.addCreatorRow(creatorData, extraPersonType.creatorTypeID, false, infoBox._firstRowBeforeCreators || null);

      const label = this._getCreatorTypeLabel(infoBox, rowIndex);
      const row = label?.closest('.meta-row') || null;
      if (!row) continue;

      this._markExtraPersonCreatorRow(row, extraPersonType, storageIndex);
      row.setAttribute('data-ibcslm-rendered-extra-person-row', extraPersonType.key);
      try {
        Zotero.debug(`[Citation Phoenix] ${extraPersonType.key} creator row rendered: item=${String(item?.id || '')} rowIndex=${String(rowIndex)} storageIndex=${String(storageIndex)}`);
      } catch (e) {}
    }
  }

  _getCreatorTypeLabel(infoBox, rowIndex) {
    return infoBox?.querySelector?.(`.meta-label[fieldname="creator-${rowIndex}-typeID"]`)
      || infoBox?.querySelector?.(`.meta-label[fieldname="creator-${rowIndex}"]`)
      || null;
  }

  _getCreatorRowIndex(row) {
    const fieldName = String(row?.querySelector?.('.meta-label')?.getAttribute?.('fieldname') || '');
    const match = fieldName.match(/^creator-(\d+)(?:-|$)/);
    return match ? Number(match[1]) : null;
  }

  _getCreatorRows(infoBox) {
    if (!infoBox?.querySelectorAll) return [];
    const labels = Array.from(infoBox.querySelectorAll('.meta-label[fieldname^="creator-"]'));
    const rows = [];
    for (const label of labels) {
      const row = label.closest?.('.meta-row') || null;
      if (row && !rows.includes(row)) rows.push(row);
    }
    return rows;
  }

  _getExtraPersonCreatorRows(infoBox, extraPersonType = null) {
    return this._getCreatorRows(infoBox).filter((row) => {
      const rowTypeKey = row.getAttribute?.('data-ibcslm-extra-person-type') || '';
      if (rowTypeKey) return !extraPersonType || rowTypeKey === extraPersonType.key;
      if (!extraPersonType && row.getAttribute?.('data-ibcslm-commenter-row') === 'true') return true;
      return false;
    });
  }

  _patchItemCreators() {
    const itemProto = Zotero?.Item?.prototype;
    if (!itemProto || this._orig.itemSetCreator || typeof itemProto.setCreator !== 'function') return;

    this._orig.itemSetCreator = itemProto.setCreator;
    const self = this;
    itemProto.setCreator = function (index, creator, creatorTypeID, ...rest) {
      const extraPersonType = self._getExtraPersonConfigBySyntheticCreatorType(
        creatorTypeID ?? creator?.creatorTypeID ?? creator?.creatorType ?? creator?.creatorTypeName,
      );
      if (!extraPersonType) {
        return self._orig.itemSetCreator.call(this, index, creator, creatorTypeID, ...rest);
      }

      const person = self._extraPersonFromCreatorFields(creator);
      if (person) {
        const nativeCount = this.numCreators?.() || 0;
        const numericIndex = Number(index);
        const storageIndex = Number.isInteger(numericIndex) ? Math.max(0, numericIndex - nativeCount) : null;
        self._setStoredExtraPersonAtNearestIndex(this, extraPersonType, storageIndex, person);
      }
      try {
        Zotero.debug(`[Citation Phoenix] synthetic creator diverted to mlzsync1: type=${extraPersonType.key} index=${String(index || 0)}`);
      } catch (e) {}
      return true;
    };
  }

  _getExtraPersonConfigByIndex(infoBox, rowIndex) {
    const row = this._getCreatorTypeLabel(infoBox, rowIndex)?.closest?.('.meta-row') || null;
    if (!row) return null;
    const rowTypeKey = row.getAttribute?.('data-ibcslm-extra-person-type') || '';
    if (rowTypeKey) return this._extraPersonTypes.find((config) => config.key === rowTypeKey) || null;
    if (row.getAttribute?.('data-ibcslm-commenter-row') === 'true') {
      return this._extraPersonTypes.find((config) => config.key === 'commenter') || null;
    }
    return null;
  }

  _getExtraPersonConfigByRowCreatorType(row) {
    const label = row?.querySelector?.('.meta-label') || null;
    return this._getExtraPersonConfigBySyntheticCreatorType(label?.getAttribute?.('typeid'));
  }

  _getNativeCreatorIndex(infoBox, rowIndex) {
    let nativeIndex = Number(rowIndex) || 0;
    for (const row of this._getExtraPersonCreatorRows(infoBox)) {
      const extraIndex = this._getCreatorRowIndex(row);
      if (extraIndex != null && extraIndex < rowIndex) nativeIndex -= 1;
    }
    return Math.max(0, nativeIndex);
  }

  _getDefaultNativeCreatorTypeID(itemTypeID) {
    const nativeTypes = this._orig.creatorTypesGetTypesForItemType?.call(Zotero.CreatorTypes, itemTypeID) || [];
    const firstNative = nativeTypes.find((entry) => !this._getExtraPersonConfigBySyntheticCreatorType(entry?.id || entry?.name));
    return firstNative?.id || firstNative?.name || this._orig.creatorTypesGetID?.call(Zotero.CreatorTypes, 'author') || 'author';
  }

  _getActiveExtraPersonCreatorRow(infoBox, extraPersonType) {
    const activeElement = infoBox?.ownerDocument?.activeElement || null;
    return this._getExtraPersonCreatorRows(infoBox, extraPersonType).find((row) => {
      return activeElement && row.contains?.(activeElement);
    }) || null;
  }

  _markExtraPersonCreatorRow(row, extraPersonType, storageIndex = null) {
    if (!row) return;
    row.setAttribute('data-ibcslm-extra-person-type', extraPersonType.key);
    if (storageIndex != null) row.setAttribute('data-ibcslm-extra-person-index', String(storageIndex));
    if (extraPersonType.key === 'commenter') row.setAttribute('data-ibcslm-commenter-row', 'true');
    const labelNode = row.querySelector?.('.meta-label label');
    if (labelNode) {
      labelNode.textContent = this._getExtraPersonLabel(extraPersonType);
    }
    const plusButton = row.querySelector('.zotero-clicky-plus');
    const minusButton = row.querySelector('.zotero-clicky-minus');
    const optionsButton = row.querySelector('.zotero-clicky-options');
    const grippy = row.querySelector('.zotero-clicky-grippy');
    if (plusButton) plusButton.hidden = false;
    if (minusButton && !minusButton._ibcslmExtraPersonRemovalBound) {
      minusButton._ibcslmExtraPersonRemovalBound = true;
      minusButton.addEventListener('mousedown', () => {
        const infoBox = row.closest?.('info-box') || row.closest?.('#zotero-editpane-info-box') || row.parentNode?.closest?.('info-box') || null;
        if (!infoBox) return;
        infoBox._ibcslmPendingExtraPersonRemoval = {
          key: extraPersonType.key,
          index: this._getCreatorRowIndex(row),
          storageIndex: this._getExtraPersonStorageIndex(row),
          at: Date.now(),
        };
      }, true);
    }
    if (optionsButton) optionsButton.hidden = false;
    if (grippy) {
      grippy.hidden = true;
      grippy.disabled = true;
    }
  }

  _removeEmptyDefaultCreatorRows(infoBox) {
    const item = infoBox?.item;
    if (item?.numCreators?.()) return;
    for (const row of this._getCreatorRows(infoBox)) {
      if (this._getExtraPersonCreatorRows(infoBox).includes(row)) continue;
      const values = Array.from(row.querySelectorAll('input, textarea, editable-text')).map((node) => {
        return String(node.value ?? node.getAttribute?.('value') ?? '').trim();
      });
      if (values.some(Boolean)) continue;
      row.parentNode?.removeChild(row);
      if (typeof infoBox._creatorCount === 'number' && infoBox._creatorCount > 0) {
        infoBox._creatorCount -= 1;
      }
    }
  }

  _ensureExtraPersonMenuItems(infoBox) {
    const item = infoBox?.item;
    if (!item || !this._itemTypeSupportsExtraPerson(item) || !infoBox.editable) return;
    const menu = infoBox._creatorTypeMenu;
    if (!menu) return;

    const doc = menu.ownerDocument || infoBox.ownerDocument;
    for (const extraPersonType of this._getExtraPersonTypesForItem(item)) {
      const existing = Array.from(menu.children || []).some((node) => {
        return String(node?.getAttribute?.('typeid') || '') === extraPersonType.creatorTypeID;
      });
      if (existing) continue;

      const menuitem = doc.createXULElement('menuitem');
      menuitem.setAttribute('label', this._getExtraPersonLabel(extraPersonType));
      menuitem.setAttribute('typeid', extraPersonType.creatorTypeID);
      menu.appendChild(menuitem);
    }
  }

  _removeExtraPersonCreatorRows(infoBox, extraPersonType = null) {
    for (const row of this._getExtraPersonCreatorRows(infoBox, extraPersonType)) {
      row.parentNode?.removeChild(row);
      if (typeof infoBox._creatorCount === 'number' && infoBox._creatorCount > 0) {
        infoBox._creatorCount -= 1;
      }
    }
  }

  _unmarkExtraPersonCreatorRow(row) {
    if (!row) return;
    row.removeAttribute?.('data-ibcslm-extra-person-type');
    row.removeAttribute?.('data-ibcslm-extra-person-index');
    row.removeAttribute?.('data-ibcslm-rendered-extra-person-row');
    row.removeAttribute?.('data-ibcslm-commenter-row');
  }

  _consumePendingExtraPersonRemoval(infoBox, rowIndex, extraPersonType) {
    const pending = infoBox?._ibcslmPendingExtraPersonRemoval || null;
    try { delete infoBox._ibcslmPendingExtraPersonRemoval; } catch (e) {}
    if (!pending) return false;
    if (Date.now() - Number(pending.at || 0) > 1500) return false;
    if (String(pending.key || '') !== extraPersonType.key) return false;
    return Number(pending.index) === Number(rowIndex);
  }

  _getExtraPersonStorageIndex(row) {
    const raw = row?.getAttribute?.('data-ibcslm-extra-person-index');
    const index = Number(raw);
    return Number.isInteger(index) && index >= 0 ? index : null;
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

  _renderCustomCourtField(infoBox, options = {}) {
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
    if (options.preserveLayout) {
      if (row.parentNode !== table) table.appendChild(row);
    } else if (courtRow.parentNode === table) {
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

  _removeCommenterField(infoBox) {
    const row = infoBox?.querySelector?.(`#${this._commenterRowID}`);
    if (row?.parentNode) row.parentNode.removeChild(row);
    for (const customRow of infoBox?.querySelectorAll?.('[data-custom-row-id$="citation-phoenix-commenter-row"]') || []) {
      customRow.parentNode?.removeChild(customRow);
    }
  }

  _removeCustomCourtField(infoBox) {
    const row = infoBox?.querySelector?.(`#${this._customCourtRowID}`);
    if (row?.parentNode) row.parentNode.removeChild(row);
  }

  _removeSchemaFieldRows(infoBox) {
    for (const row of infoBox?.querySelectorAll?.('[data-ibcslm-schema-field-row="true"]') || []) {
      row.parentNode?.removeChild(row);
    }
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
        text: this._getLocalizedBuiltinLabel('jurisdiction'),
      });
    } else {
      label = doc.createElement('label');
      label.id = 'itembox-field-jurisdiction-label';
      label.textContent = this._getLocalizedBuiltinLabel('jurisdiction');
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
        text: this._getLocalizedBuiltinLabel('customCourt'),
      });
    } else {
      label = doc.createElement('label');
      label.id = 'itembox-field-custom-court-label';
      label.textContent = this._getLocalizedBuiltinLabel('customCourt');
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
    customInput.placeholder = this._getLocalizedBuiltinLabel('customCourtPlaceholder');
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
    setButton.textContent = this._getLocalizedBuiltinLabel('setButton');
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

  _updateJurisdictionRow(infoBox, row, item, definition = null) {
    const dataWrapper = row.querySelector('.meta-data');
    if (!dataWrapper) return;

    const currentJurisdiction = this._getDisplayedJurisdictionCode(item);
    const displayValue = this.abbrevService.formatJurisdictionDisplay(currentJurisdiction);
    dataWrapper.textContent = '';

    if (infoBox.editable) {
      const itemTypeName = this._getItemTypeName(item);
      if (itemTypeName === 'case') {
        dataWrapper.appendChild(this._buildJurisdictionMenuList(infoBox, item, currentJurisdiction, displayValue));
      } else {
        const effectiveDefinition = definition || this.schemaConfig?.getFieldDefinition?.(itemTypeName, 'jurisdiction') || { field: 'jurisdiction' };
        dataWrapper.appendChild(this._buildSchemaJurisdictionMenuList(infoBox, item, effectiveDefinition, currentJurisdiction, displayValue));
      }
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
    return this._buildFilteredPickerControl(doc, {
      fieldName: 'jurisdiction',
      inputId: 'itembox-field-jurisdiction-input',
      listId: 'itembox-field-jurisdiction-list',
      currentValue: currentJurisdiction,
      displayValue,
      options: this._getJurisdictionOptions(currentJurisdiction),
      minChars: 2,
      onSelect: async (option) => {
        await this._saveJurisdictionFromMenu(item, option.code);
      },
      formatOptionText: (option) => option.label,
    });
  }

  _buildSchemaJurisdictionMenuList(infoBox, item, definition, currentJurisdiction, displayValue) {
    const doc = infoBox.ownerDocument;
    return this._buildFilteredPickerControl(doc, {
      fieldName: definition.field,
      inputId: `itembox-field-${definition.field}-input`,
      listId: `itembox-field-${definition.field}-list`,
      currentValue: currentJurisdiction,
      displayValue,
      options: this._getJurisdictionOptions(currentJurisdiction),
      minChars: 2,
      onSelect: async (option) => {
        await this._saveSchemaFieldValue(item, definition, option.code);
      },
      formatOptionText: (option) => option.label,
    });
  }

  _buildCourtMenuList(infoBox, item, currentJurisdiction, currentCourtKey, displayValue) {
    const doc = infoBox.ownerDocument;
    const menulist = doc.createXULElement('menulist');
    menulist.id = 'itembox-field-court-menu';
    menulist.className = 'zotero-clicky keyboard-clickable';
    menulist.setAttribute('aria-labelledby', 'itembox-field-court-label');
    menulist.setAttribute('fieldname', 'court');
    menulist.setAttribute('tooltiptext', currentCourtKey);
    menulist.style.flex = '1';

    const popup = menulist.appendChild(doc.createXULElement('menupopup'));
    const options = this._getCourtOptions(currentJurisdiction, currentCourtKey);
    const hasCourt = !!String(currentCourtKey || '').trim();
    const noEntryValue = `${currentJurisdiction}||__no_entry__`;
    const compoundCurrentValue = hasCourt ? `${currentJurisdiction}||${currentCourtKey}` : noEntryValue;

    if (!hasCourt) {
      const placeholder = doc.createXULElement('menuitem');
      placeholder.setAttribute('value', noEntryValue);
      placeholder.setAttribute('label', 'no entry');
      placeholder.setAttribute('tooltiptext', 'no entry');
      popup.appendChild(placeholder);
    }

    for (const option of options) {
      const menuitem = doc.createXULElement('menuitem');
      menuitem.setAttribute('value', `${option.jurisdiction}||${option.key}`);
      menuitem.setAttribute('label', option.label);
      menuitem.setAttribute('tooltiptext', option.abbreviation || option.key);
      popup.appendChild(menuitem);
    }

    menulist.value = compoundCurrentValue;
    if (!hasCourt && menulist.selectedItem) {
      menulist.setAttribute('label', 'no entry');
    } else if (!menulist.selectedItem && options.length) {
      const fallbackIndex = options.findIndex((option) => !option.isChild && option.key === currentCourtKey && option.jurisdiction === currentJurisdiction);
      menulist.selectedIndex = fallbackIndex >= 0 ? fallbackIndex : 0;
    }

    if (menulist.selectedItem && displayValue) {
      menulist.setAttribute('label', menulist.selectedItem.getAttribute('label'));
    }

    const saveCourtValue = async () => {
      const selectedValue = String(menulist.value || '').trim();
      if (!selectedValue) return;
      if (selectedValue.endsWith('||__no_entry__')) {
        const extra = String(item.getField?.('extra') || '');
        let nextExtra = this.Jurisdiction.updateMLZExtraField?.(extra, 'court', '') ?? extra;
        if (nextExtra === extra && String(item.getField?.('court') || '').trim() === '') return;
        item.setField('extra', nextExtra);
        item.setField('court', '');
        await item.saveTx({ skipDateModifiedUpdate: true });
        this._scheduleActiveInfoPaneRefresh(75, true);
        return;
      }
      await this._saveCourtFromMenu(item, selectedValue);
    };

    menulist.addEventListener('command', saveCourtValue);
    menulist.addEventListener('change', saveCourtValue);

    return menulist;
  }

  _buildFilteredPickerControl(doc, {
    fieldName,
    inputId,
    listId,
    currentValue,
    displayValue,
    options,
    minChars = 2,
    onSelect,
    formatOptionText,
  }) {
    let currentDisplayValue = String(displayValue || '');
    let currentRawValue = String(currentValue || '');

    const wrapper = doc.createElement('div');
    wrapper.style.display = 'flex';
    wrapper.style.alignItems = 'center';
    wrapper.style.gap = '0';
    wrapper.style.width = '100%';
    wrapper.style.position = 'relative';
    if (fieldName === 'jurisdiction') {
      wrapper.style.maxWidth = '22em';
    }

    const input = doc.createElement('input');
    input.id = inputId;
    input.className = 'value';
    input.setAttribute('fieldname', fieldName);
    input.setAttribute('aria-labelledby', `itembox-field-${fieldName}-label`);
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.style.flex = '1';
    input.style.minWidth = '0';
    input.value = currentDisplayValue;
    input.title = currentRawValue;
    input.style.boxSizing = 'border-box';
    input.style.width = '100%';
    input.style.maxWidth = fieldName === 'jurisdiction' ? '22em' : '100%';
    input.style.whiteSpace = 'nowrap';
    input.style.overflow = 'hidden';
    input.style.textOverflow = 'ellipsis';

    const normalizedOptions = Array.isArray(options)
      ? options.map((option) => ({
        ...option,
        displayText: String(typeof formatOptionText === 'function' ? formatOptionText(option) : option.label || option.code || '').trim(),
        searchText: this._normalizeMenuSearchText(`${String(option.label || '')} ${String(option.code || '')} ${String(option.abbreviation || '')}`),
      })).filter((option) => option.displayText)
      : [];

    const popup = doc.createElement('div');
    popup.id = listId;
    popup.style.position = 'absolute';
    popup.style.left = '0';
    popup.style.right = '0';
    popup.style.top = '100%';
    popup.style.zIndex = '2000';
    popup.style.maxHeight = '220px';
    popup.style.overflowY = 'auto';
    popup.style.border = '1px solid ThreeDShadow';
    popup.style.background = 'Field';
    popup.style.color = 'FieldText';
    popup.style.display = 'none';
    popup.style.boxShadow = '0 2px 8px rgba(0,0,0,0.2)';
    popup.style.marginTop = '2px';

    const hidePopup = () => {
      popup.style.display = 'none';
      while (popup.firstChild) popup.removeChild(popup.firstChild);
    };

    const renderOptions = () => {
      const query = this._normalizeMenuSearchText(String(input.value || ''));
      hidePopup();

      if (query.length < Math.max(1, Number(minChars) || 2)) return;

      const matches = normalizedOptions.filter((option) => option.searchText.includes(query));
      if (!matches.length) {
        const empty = doc.createElement('div');
        empty.textContent = 'No matches';
        empty.style.padding = '4px 8px';
        empty.style.opacity = '0.7';
        popup.appendChild(empty);
        popup.style.display = 'block';
        return;
      }

      for (const option of matches.slice(0, 100)) {
        const row = doc.createElement('button');
        row.type = 'button';
        row.textContent = option.displayText;
        row.title = option.displayText;
        row.style.display = 'block';
        row.style.width = '100%';
        row.style.boxSizing = 'border-box';
        row.style.textAlign = 'left';
        row.style.padding = '2px 8px';
        row.style.border = '0';
        row.style.margin = '0';
        row.style.background = 'transparent';
        row.style.color = 'inherit';
        row.style.whiteSpace = 'nowrap';
        row.style.overflow = 'hidden';
        row.style.textOverflow = 'ellipsis';
        row.style.lineHeight = '1.2';
        row.addEventListener('mousedown', (event) => {
          event.preventDefault();
          event.stopPropagation();
        });
      row.addEventListener('click', async () => {
          input.value = option.displayText;
          input.title = option.displayText;
          currentDisplayValue = option.displayText;
          currentRawValue = option.code;
          hidePopup();
          await onSelect?.(option);
        });
        popup.appendChild(row);
      }

      popup.style.display = 'block';
    };

    const resolveSelectedOption = async () => {
      const raw = String(input.value || '').trim();
      if (!raw) return;

      const normalizedRaw = this._normalizeMenuSearchText(raw);
      const exact = normalizedOptions.find((option) => {
        return this._normalizeMenuSearchText(option.displayText) === normalizedRaw
          || this._normalizeMenuSearchText(option.code) === normalizedRaw;
      });
      const uniquePrefix = !exact
        ? normalizedOptions.filter((option) => option.searchText.includes(normalizedRaw))
        : [];
      const match = exact || (uniquePrefix.length === 1 ? uniquePrefix[0] : null);

      if (!match) {
        input.value = currentDisplayValue;
        input.title = currentRawValue;
        hidePopup();
        return;
      }

      input.value = match.displayText;
      input.title = match.code;
      currentDisplayValue = match.displayText;
      currentRawValue = match.code;
      hidePopup();
      await onSelect?.(match);
    };

    input.addEventListener('input', renderOptions);
    input.addEventListener('focus', () => {
      if (typeof input.select === 'function') input.select();
      renderOptions();
    });
    input.addEventListener('change', resolveSelectedOption);
    input.addEventListener('blur', resolveSelectedOption);
    input.addEventListener('keydown', (event) => {
      const key = String(event.key || '');
      if (key === 'Escape') {
        hidePopup();
        return;
      }
      if (key !== 'Enter') return;
      event.preventDefault();
      resolveSelectedOption();
    });

    wrapper.appendChild(input);
    wrapper.appendChild(popup);
    return wrapper;
  }

  _attachMenuSearchFilter(menulist, popup, { minChars = 2, displayValue = '' } = {}) {
    if (!menulist || !popup) return;
    const searchField = menulist.inputField || menulist;

    const state = {
      timer: null,
      minChars: Math.max(1, Number(minChars) || 2),
    };

    const clearTimer = () => {
      if (!state.timer) return;
      clearTimeout(state.timer);
      state.timer = null;
    };

    const setAllVisible = () => {
      this._removeMenuNoResultsItem(popup);
      for (const node of Array.from(popup.children || [])) {
        if (node?.localName !== 'menuitem') continue;
        node.hidden = false;
      }
    };

    const applyFilter = (rawQuery = '') => {
      const normalizedQuery = this._normalizeMenuSearchText(rawQuery);
      if (!normalizedQuery || normalizedQuery.length < state.minChars) {
        setAllVisible();
        return;
      }

      let visibleCount = 0;
      for (const node of Array.from(popup.children || [])) {
        if (node?.localName !== 'menuitem') continue;
        const haystack = String(node._ibcslmSearchText || node.getAttribute('label') || node.getAttribute('value') || '').trim();
        const matches = this._normalizeMenuSearchText(haystack).includes(normalizedQuery);
        node.hidden = !matches;
        if (matches) visibleCount += 1;
      }

      if (!visibleCount) {
        this._showMenuNoResultsItem(popup);
        return;
      }

      this._removeMenuNoResultsItem(popup);
    };

    const resetSearch = () => {
      clearTimer();
      if (searchField && 'value' in searchField) searchField.value = '';
      applyFilter('');
    };

    const onInput = () => {
      clearTimer();
      const query = String(searchField?.value || '');
      applyFilter(query);
    };

    const onKeyDown = (event) => {
      if (!event || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      if (String(event.key || '') === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        resetSearch();
      }
    };

    if (searchField?.addEventListener) {
      searchField.addEventListener('input', onInput);
      searchField.addEventListener('keydown', onKeyDown, true);
    } else {
      menulist.addEventListener('keydown', onKeyDown, true);
    }
    popup.addEventListener('popuphidden', resetSearch);
    popup.addEventListener('popupshown', onInput);
    popup.addEventListener('command', resetSearch);

    if (displayValue) {
      menulist.setAttribute('label', displayValue);
      if (searchField && 'value' in searchField) {
        searchField.value = '';
      }
    }
    setAllVisible();
  }

  _normalizeMenuSearchText(value) {
    return this.abbrevService.normalizeKey(value || '');
  }

  _showMenuNoResultsItem(popup) {
    if (!popup) return;
    this._removeMenuNoResultsItem(popup);
    const doc = popup.ownerDocument;
    const item = doc.createXULElement('menuitem');
    item.setAttribute('label', 'No matches');
    item.setAttribute('disabled', 'true');
    item.hidden = false;
    item._ibcslmNoResults = true;
    popup.appendChild(item);
    popup._ibcslmNoResultsItem = item;
  }

  _removeMenuNoResultsItem(popup) {
    const item = popup?._ibcslmNoResultsItem;
    if (item?.parentNode) item.parentNode.removeChild(item);
    if (popup?._ibcslmNoResultsItem) delete popup._ibcslmNoResultsItem;
  }

  _getJurisdictionOptions(currentJurisdiction) {
    const options = this.abbrevService.listJurisdictionMenuOptions(currentJurisdiction);
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

  _getStoredExtraPeople(item, extraPersonType) {
    return this.Jurisdiction.getMLZExtraCreatorsByType?.(item, extraPersonType.mlzType) || [];
  }

  _setStoredExtraPeople(item, extraPersonType, people) {
    if (!item?.setField) return;
    const extra = String(item.getField?.('extra') || '');
    const nextExtra = this.Jurisdiction.updateMLZExtraCreators?.call(
      this.Jurisdiction,
      extra,
      extraPersonType.mlzType,
      Array.isArray(people) ? people : [],
    ) ?? extra;
    if (nextExtra !== extra) {
      item.setField('extra', nextExtra);
    }
  }

  _appendStoredExtraPerson(item, extraPersonType, person) {
    if (!person) return null;
    const people = this._getStoredExtraPeople(item, extraPersonType);
    people.push(person);
    this._setStoredExtraPeople(item, extraPersonType, people);
    return people.length - 1;
  }

  _setStoredExtraPersonAtIndex(item, extraPersonType, index, person) {
    if (!person) return;
    const people = this._getStoredExtraPeople(item, extraPersonType);
    const normalizedIndex = Number.isInteger(index) && index >= 0 ? index : people.length;
    people[normalizedIndex] = person;
    this._setStoredExtraPeople(item, extraPersonType, people.filter(Boolean));
  }

  _setStoredExtraPersonAtNearestIndex(item, extraPersonType, index, person) {
    if (!person) return null;
    const people = this._getStoredExtraPeople(item, extraPersonType);
    let normalizedIndex = Number.isInteger(index) && index >= 0 ? index : people.length;
    if (normalizedIndex > people.length) {
      const lastIndex = people.length - 1;
      normalizedIndex = lastIndex >= 0 && this._extraPersonLikelySameDraft(people[lastIndex], person)
        ? lastIndex
        : people.length;
    } else if (people[normalizedIndex] && !this._extraPersonLikelySameDraft(people[normalizedIndex], person)) {
      normalizedIndex = people.length;
    }
    people[normalizedIndex] = person;
    this._setStoredExtraPeople(item, extraPersonType, people.filter(Boolean));
    return normalizedIndex;
  }

  _extraPersonLikelySameDraft(left, right) {
    if (!left || !right) return false;
    const leftName = String(left.name || '').trim();
    const rightName = String(right.name || '').trim();
    if (leftName && rightName) return leftName === rightName;
    const leftLastName = String(left.lastName || '').trim();
    const rightLastName = String(right.lastName || '').trim();
    if (leftLastName && rightLastName) return leftLastName === rightLastName;
    const leftFirstName = String(left.firstName || '').trim();
    const rightFirstName = String(right.firstName || '').trim();
    return Boolean(leftFirstName && rightFirstName && leftFirstName === rightFirstName);
  }

  _removeStoredExtraPersonAtIndex(item, extraPersonType, index) {
    const people = this._getStoredExtraPeople(item, extraPersonType);
    if (!people.length) return;
    if (!Number.isInteger(index) || index < 0 || index >= people.length) return;
    people.splice(index, 1);
    this._setStoredExtraPeople(item, extraPersonType, people);
  }

  _formatStoredExtraPerson(person) {
    if (!person || typeof person !== 'object') return '';
    if (person.name) return String(person.name).trim();
    const firstName = String(person.firstName || '').trim();
    const lastName = String(person.lastName || '').trim();
    return `${firstName}${firstName && lastName ? ' ' : ''}${lastName}`.trim();
  }

  _extraPersonFromCreatorFields(fields) {
    if (!fields || typeof fields !== 'object') return null;
    const fieldMode = Number(fields.fieldMode) || 0;
    const name = String(fields.name || '').trim();
    const firstName = String(fields.firstName || '').trim();
    const lastName = String(fields.lastName || '').trim();
    if (name) return { name };
    if (!firstName && !lastName) return null;
    if (fieldMode === 1) {
      return { name: lastName || firstName };
    }
    return { firstName, lastName };
  }

  _extraPersonToCreatorData(person) {
    if (!person || typeof person !== 'object') return null;
    if (person.name) {
      return {
        firstName: '',
        lastName: String(person.name || '').trim(),
        fieldMode: 1,
      };
    }
    return {
      firstName: String(person.firstName || '').trim(),
      lastName: String(person.lastName || '').trim(),
      fieldMode: 0,
    };
  }

  _getExtraPersonConfigByCreatorType(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return null;
    return this._extraPersonTypes.find((config) => {
      if (normalized === String(config.creatorTypeID).toLowerCase()) return true;
      if (normalized === String(config.creatorTypeName).toLowerCase()) return true;
      if (normalized === String(config.key).toLowerCase()) return true;
      if (normalized === String(config.label).toLowerCase()) return true;
      return normalized === String(this._getExtraPersonLabel(config)).toLowerCase();
    }) || null;
  }

  _getExtraPersonConfigBySyntheticCreatorType(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return null;
    return this._extraPersonTypes.find((config) => {
      if (normalized === String(config.creatorTypeID).toLowerCase()) return true;
      return normalized === String(config.creatorTypeName).toLowerCase();
    }) || null;
  }

  _getExtraPersonLabel(extraPersonType) {
    if (!extraPersonType?.key) return '';
    return this.schemaConfig?.getLocalizedCreatorLabel?.(extraPersonType.key, Zotero?.locale || 'en-US')
      || extraPersonType.label
      || String(extraPersonType.key || '');
  }

  _getLocalizedItemTypeLabel(itemTypeName, locale = Zotero?.locale || 'en-US') {
    const key = String(itemTypeName || '').trim();
    if (!key) return '';
    return this.schemaConfig?.getLocalizedItemTypeLabel?.(key, locale) || key;
  }

  _itemTypeSupportsExtraPerson(itemOrTypeID) {
    return this._getExtraPersonTypesForItemType(itemOrTypeID).length > 0;
  }

  _getExtraPersonTypesForItem(item) {
    return this._getExtraPersonTypesForItemType(item?.itemTypeID, item);
  }

  _getExtraPersonTypesForItemType(itemOrTypeID, item = null) {
    const itemTypeID = typeof itemOrTypeID === 'object' ? itemOrTypeID?.itemTypeID : itemOrTypeID;
    const itemTypeName = item ? this._getItemTypeName(item) : this._getItemTypeNameByID(itemTypeID);
    if (!itemTypeName) return [];
    const creatorKeys = new Set(this.schemaConfig?.getCreatorKeysForItemType?.(itemTypeName) || []);
    if (!creatorKeys.size) return [];
    return this._extraPersonTypes.filter((config) => {
      return creatorKeys.has(config.key) && !this._itemTypeHasNativeCreator(itemTypeID, config.key);
    });
  }

  _itemTypeHasNativeCreator(itemTypeID, creatorKey) {
    const normalize = (value) => String(value || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
    const target = normalize(creatorKey);
    if (!target) return false;

    const creatorTypes = this._orig.creatorTypesGetTypesForItemType?.call(Zotero.CreatorTypes, itemTypeID)
      || Zotero?.CreatorTypes?.getTypesForItemType?.(itemTypeID)
      || [];
    for (const entry of creatorTypes) {
      if (normalize(entry?.name) === target) return true;
      const resolvedName = this._orig.creatorTypesGetName?.call(Zotero.CreatorTypes, entry?.id);
      if (normalize(resolvedName) === target) return true;
    }
    return false;
  }

  _getItemTypeName(item) {
    const nativeItemType = this._getItemTypeNameByID(item?.itemTypeID);
    const storedItemType = this._getStoredCustomItemTypeName(item);
    if (!storedItemType || !this.schemaConfig?.isCustomItemType?.(storedItemType)) {
      return nativeItemType;
    }

    const expectedNativeType = this.schemaConfig?.getBaseItemType?.(storedItemType) || '';
    return expectedNativeType === nativeItemType ? storedItemType : nativeItemType;
  }

  _getItemTypeNameByID(itemTypeID) {
    try {
      return Zotero?.ItemTypes?.getName?.(itemTypeID) || '';
    } catch (e) {}
    return '';
  }

  _getStoredCustomItemTypeName(item) {
    return String(this.Jurisdiction.getMLZItemType?.(item) || '').trim();
  }

  async _saveJurisdictionFromMenu(item, selectedCode) {
    try {
      const current = this.Jurisdiction.getMLZJurisdiction?.(item) || '';
      if (current === selectedCode) return;

      const extra = String(item.getField?.('extra') || '');
      const displayValue = this.abbrevService.formatJurisdictionDisplay(selectedCode);
      let nextExtra = this.Jurisdiction.updateMLZJurisdiction?.(extra, selectedCode, displayValue) ?? extra;
      nextExtra = this.Jurisdiction.updateMLZExtraField?.(nextExtra, 'court', '') ?? nextExtra;
      if (nextExtra === extra && String(item.getField?.('court') || '').trim() === '') return;

      item.setField('extra', nextExtra);
      item.setField('court', '');
      await item.saveTx({ skipDateModifiedUpdate: true });
      this._scheduleActiveInfoPaneRefresh(75, true);
      try { Zotero.debug(`[Citation Phoenix] jurisdiction row saved: item=${String(item.id)} jurisdiction=${selectedCode}`); } catch (e) {}
    } catch (e) {
      try { Zotero.logError(e); } catch (_) {}
      try { Zotero.debug(`[Citation Phoenix] jurisdiction row save failed: ${String(e)}`); } catch (_) {}
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
        const updatedExtra = this.Jurisdiction.updateMLZJurisdiction?.(extra, targetJurisdiction, displayValue) ?? extra;
        item.setField('extra', updatedExtra);

        const targetOptions = this.abbrevService.listInstitutionPartOptionsForJurisdictionTree(targetJurisdiction);
        if (!targetOptions.length) {
          item.setField('court', '');
          await item.saveTx({ skipDateModifiedUpdate: true });
          this._scheduleActiveInfoPaneRefresh(75, true);
          try { Zotero.debug(`[Citation Phoenix] court row cleared for jurisdiction with no institution-part: item=${String(item.id)} jurisdiction=${targetJurisdiction}`); } catch (e) {}
          return;
        }
      }

      item.setField('court', normalizedKey);
      await item.saveTx({ skipDateModifiedUpdate: true });
      this._scheduleActiveInfoPaneRefresh(75, true);
      try { Zotero.debug(`[Citation Phoenix] court row saved: item=${String(item.id)} court=${normalizedKey} jurisdiction=${targetJurisdiction || 'unchanged'}`); } catch (e) {}
    } catch (e) {
      try { Zotero.logError(e); } catch (_) {}
      try { Zotero.debug(`[Citation Phoenix] court row save failed: ${String(e)}`); } catch (_) {}
    }
  }

  _resolveNativeFieldName(itemTypeID, fieldName, baseField = null) {
    const direct = this._getNativeFieldNameForType(itemTypeID, fieldName);
    if (direct) return direct;
    if (!baseField) return null;
    return this._getFieldNameFromBaseForType(itemTypeID, baseField)
      || this._getNativeFieldNameForType(itemTypeID, baseField);
  }

  _getNativeFieldNameForType(itemTypeID, fieldName) {
    const name = String(fieldName || '').trim();
    if (!name) return null;
    try {
      const fieldID = Zotero?.ItemFields?.getID?.(name);
      if (!fieldID) return null;
      if (Zotero?.ItemFields?.isValidForType?.(fieldID, itemTypeID)) {
        return name;
      }
    } catch (e) {}
    return null;
  }

  _renderItemTypeField(infoBox) {
    const item = infoBox?.item;
    const row = this._findItemTypeRow(infoBox);
    if (!row || !item || item.deleted) return;

    const dataWrapper = row.querySelector('.meta-data');
    if (!dataWrapper) return;

    const displayedItemType = this._getItemTypeName(item);
    const displayedLabel = this._getLocalizedItemTypeLabel(displayedItemType);
    if (!displayedLabel) return;

    if (infoBox.editable) {
      const nativeOptions = this._getNativeItemTypeOptions(infoBox, row, item);
      if (!nativeOptions.length) return;
      dataWrapper.textContent = '';
      dataWrapper.appendChild(this._buildItemTypeMenuList(infoBox, item, nativeOptions));
      return;
    }

    if (!this.schemaConfig?.isCustomItemType?.(displayedItemType)) return;
    dataWrapper.textContent = '';

    if (typeof infoBox.createValueElement === 'function') {
      const valueElem = infoBox.createValueElement({
        editable: false,
        text: displayedLabel,
        id: 'itembox-field-item-type-value',
        attributes: {
          'aria-labelledby': 'itembox-field-itemType-label',
          fieldname: 'itemType',
          title: displayedItemType,
        },
      });
      valueElem.value = displayedLabel;
      dataWrapper.appendChild(valueElem);
      return;
    }

    const input = row.ownerDocument.createElement('input');
    input.className = 'value';
    input.readOnly = true;
    input.value = displayedLabel;
    input.title = displayedItemType;
    dataWrapper.appendChild(input);
  }

  _findItemTypeRow(infoBox) {
    return this._findInfoFieldRow(infoBox, 'itemType')
      || this._findInfoFieldRow(infoBox, 'itemTypeID')
      || infoBox?.querySelector?.('.meta-label[fieldname="itemType"]')?.closest?.('.meta-row')
      || infoBox?.querySelector?.('.meta-label[fieldname="itemTypeID"]')?.closest?.('.meta-row')
      || infoBox?.querySelector?.('#itembox-field-itemType-label')?.closest?.('.meta-row')
      || null;
  }

  _getNativeItemTypeOptions(infoBox, row, item) {
    const fromRow = this._extractNativeItemTypeOptionsFromRow(row, item);
    if (fromRow.length) return fromRow;

    const locale = Zotero?.locale || 'en-US';
    const fallback = [];
    for (const itemTypeName of this.schemaConfig?.getKnownItemTypeNames?.() || []) {
      if (this.schemaConfig?.isCustomItemType?.(itemTypeName)) continue;
      fallback.push({
        kind: 'native',
        value: this._getNativeItemTypeMenuValue(itemTypeName),
        label: this._getLocalizedItemTypeLabel(itemTypeName, locale),
        nativeType: itemTypeName,
      });
    }
    return this._dedupeAndSortItemTypeOptions(fallback);
  }

  _extractNativeItemTypeOptionsFromRow(row, item) {
    const popup = row?.querySelector?.('menupopup');
    const out = [];
    for (const node of Array.from(popup?.children || [])) {
      if (node?.localName !== 'menuitem') continue;
      if (node.hasAttribute?.('data-ibcslm-custom-item-type')) continue;
      const label = String(node.getAttribute('label') || '').trim();
      if (!label) continue;
      const value = String(
        node.getAttribute('value')
          || node.getAttribute('typeid')
          || node.value
          || '',
      ).trim();
      const nativeType = this._resolveNativeItemTypeName(value, label) || '';
      if (!nativeType) continue;
      out.push({
        kind: 'native',
        value: value || this._getNativeItemTypeMenuValue(nativeType),
        label,
        nativeType,
      });
    }

    if (out.length) return this._dedupeAndSortItemTypeOptions(out);

    const currentNativeType = this._getItemTypeNameByID(item?.itemTypeID);
    const currentLabel = this._getLocalizedItemTypeLabel(currentNativeType);
    if (!currentNativeType || !currentLabel) return [];
    return this._dedupeAndSortItemTypeOptions([{
      kind: 'native',
      value: this._getNativeItemTypeMenuValue(currentNativeType),
      label: currentLabel,
      nativeType: currentNativeType,
    }]);
  }

  _buildItemTypeMenuList(infoBox, item, nativeOptions) {
    const doc = infoBox.ownerDocument;
    const menulist = doc.createXULElement('menulist');
    menulist.id = 'itembox-field-itemType-menu';
    menulist.className = 'zotero-clicky keyboard-clickable';
    menulist.setAttribute('aria-labelledby', 'itembox-field-itemType-label');
    menulist.setAttribute('fieldname', 'itemType');
    menulist.style.flex = '1';

    const popup = menulist.appendChild(doc.createXULElement('menupopup'));
    const options = this._buildFullItemTypeOptions(nativeOptions);
    const optionIndex = new Map();
    for (const option of options) {
      const optionKey = this._getItemTypeOptionKey(option);
      optionIndex.set(optionKey, option);
      const menuitem = doc.createXULElement('menuitem');
      menuitem.setAttribute('value', option.value);
      menuitem.setAttribute('label', option.label);
      menuitem.setAttribute('tooltiptext', option.kind === 'custom' ? option.itemType : option.nativeType);
      menuitem.setAttribute('data-ibcslm-option-key', optionKey);
      if (option.kind === 'custom') {
        menuitem.setAttribute('data-ibcslm-custom-item-type', option.itemType);
      }
      menuitem.addEventListener('command', async () => {
        menulist.value = option.value;
        menulist.setAttribute('label', option.label);
        menulist.setAttribute('data-ibcslm-option-key', optionKey);
        await this._saveItemTypeSelection(item, option);
      });
      popup.appendChild(menuitem);
    }

    const currentOption = this._getCurrentItemTypeOption(item, nativeOptions);
    if (currentOption) {
      menulist.value = currentOption.value;
      menulist.setAttribute('label', currentOption.label);
      menulist.setAttribute('data-ibcslm-option-key', this._getItemTypeOptionKey(currentOption));
    }

    const saveSelection = async () => {
      const selectedKey = String(
        menulist.selectedItem?.getAttribute?.('data-ibcslm-option-key')
          || menulist.getAttribute?.('data-ibcslm-option-key')
          || '',
      ).trim();
      const selectedOption = optionIndex.get(selectedKey);
      if (!selectedOption) return;
      menulist.value = selectedOption.value;
      menulist.setAttribute('label', selectedOption.label);
      menulist.setAttribute('data-ibcslm-option-key', selectedKey);
      await this._saveItemTypeSelection(item, selectedOption);
    };

    popup.addEventListener('command', saveSelection);
    return menulist;
  }

  _buildFullItemTypeOptions(nativeOptions) {
    const locale = Zotero?.locale || 'en-US';
    const customByBase = new Map();
    for (const option of this.schemaConfig?.getCustomItemTypeOptions?.(locale) || []) {
      const baseType = String(option.baseItemType || '').trim();
      if (!baseType) continue;
      if (!customByBase.has(baseType)) customByBase.set(baseType, []);
      customByBase.get(baseType).push({
        kind: 'custom',
        value: this._getCustomItemTypeMenuValue(option.itemType),
        label: option.label,
        itemType: option.itemType,
        nativeType: baseType,
        zoteroValue: this._getNativeItemTypeMenuValue(baseType),
      });
    }

    const out = [];
    const seenCustom = new Set();
    for (const nativeOption of nativeOptions) {
      out.push(nativeOption);
      const customOptions = customByBase.get(nativeOption.nativeType) || [];
      for (const customOption of customOptions) {
        if (seenCustom.has(customOption.itemType)) continue;
        seenCustom.add(customOption.itemType);
        out.push(customOption);
      }
    }

    for (const options of customByBase.values()) {
      for (const customOption of options) {
        if (seenCustom.has(customOption.itemType)) continue;
        seenCustom.add(customOption.itemType);
        out.push(customOption);
      }
    }
    return this._dedupeAndSortItemTypeOptions(out);
  }

  _dedupeAndSortItemTypeOptions(options) {
    const byValue = new Map();
    for (const option of Array.isArray(options) ? options : []) {
      const value = String(this._getItemTypeOptionKey(option) || '').trim();
      const label = String(option?.label || '').trim();
      if (!value || !label) continue;

      const existing = byValue.get(value);
      if (!existing) {
        byValue.set(value, { ...option, value, label });
        continue;
      }

      const existingLabel = String(existing.label || '').trim();
      if (label.length > existingLabel.length) {
        byValue.set(value, { ...existing, ...option, value, label });
      }
    }

    return Array.from(byValue.values()).sort((a, b) => {
      const labelCompare = String(a.label || '').localeCompare(String(b.label || ''), undefined, { sensitivity: 'base' });
      if (labelCompare) return labelCompare;
      return String(a.value || '').localeCompare(String(b.value || ''), undefined, { sensitivity: 'base' });
    });
  }

  _getItemTypeOptionKey(option) {
    if (!option) return '';
    if (option.kind === 'custom') {
      return this._getCustomItemTypeMenuValue(option.itemType);
    }
    return String(option.nativeType || option.value || '').trim();
  }

  _getCurrentItemTypeOption(item, nativeOptions) {
    const itemTypeName = this._getItemTypeName(item);
    if (this.schemaConfig?.isCustomItemType?.(itemTypeName)) {
      const baseItemType = this.schemaConfig?.getBaseItemType?.(itemTypeName) || '';
      return {
        kind: 'custom',
        itemType: itemTypeName,
        nativeType: baseItemType,
        value: this._getCustomItemTypeMenuValue(itemTypeName),
        zoteroValue: this._getNativeItemTypeMenuValue(baseItemType),
        label: this._getLocalizedItemTypeLabel(itemTypeName),
      };
    }

    const nativeItemType = this._getItemTypeNameByID(item?.itemTypeID);
    const direct = nativeOptions.find((option) => option.nativeType === nativeItemType);
    return direct || {
      kind: 'native',
      nativeType: nativeItemType,
      value: this._getNativeItemTypeMenuValue(nativeItemType),
      zoteroValue: this._getNativeItemTypeMenuValue(nativeItemType),
      label: this._getLocalizedItemTypeLabel(nativeItemType),
    };
  }

  _getNativeItemTypeMenuValue(itemTypeName) {
    const key = String(itemTypeName || '').trim();
    if (!key) return '';
    try {
      const itemTypeID = Zotero?.ItemTypes?.getID?.(key);
      if (itemTypeID != null && itemTypeID !== '') return String(itemTypeID);
    } catch (e) {}
    return key;
  }

  _getCustomItemTypeMenuValue(itemTypeName) {
    const key = String(itemTypeName || '').trim();
    return key ? `${this._customItemTypeMenuValuePrefix}${key}` : '';
  }

  _parseCustomItemTypeMenuValue(value) {
    const raw = String(value || '').trim();
    if (!raw.startsWith(this._customItemTypeMenuValuePrefix)) return '';
    return raw.slice(this._customItemTypeMenuValuePrefix.length).trim();
  }

  _resolveNativeItemTypeName(value, label = '') {
    const rawValue = String(value || '').trim();
    if (rawValue) {
      try {
        const byNumericID = /^\d+$/.test(rawValue) ? Zotero?.ItemTypes?.getName?.(Number(rawValue)) : null;
        if (byNumericID) return String(byNumericID).trim();
      } catch (e) {}

      try {
        const byDirectName = Zotero?.ItemTypes?.getID?.(rawValue) != null ? rawValue : '';
        if (byDirectName) return String(byDirectName).trim();
      } catch (e) {}
    }

    const normalizedLabel = String(label || '').trim().toLowerCase();
    if (!normalizedLabel) return '';
    try {
      for (const itemType of Zotero?.ItemTypes?.getTypes?.() || []) {
        const itemTypeName = String(itemType?.name || '').trim();
        const itemTypeID = itemType?.id;
        const candidateLabel = String(Zotero?.ItemTypes?.getLocalizedString?.(itemTypeID) || '').trim().toLowerCase();
        if (itemTypeName && candidateLabel && candidateLabel === normalizedLabel) {
          return itemTypeName;
        }
      }
    } catch (e) {}

    for (const itemTypeName of this.schemaConfig?.getKnownItemTypeNames?.() || []) {
      if (this.schemaConfig?.isCustomItemType?.(itemTypeName)) continue;
      const candidateLabel = this._getLocalizedItemTypeLabel(itemTypeName).trim().toLowerCase();
      if (candidateLabel && candidateLabel === normalizedLabel) {
        return itemTypeName;
      }
    }
    return '';
  }

  async _saveItemTypeSelection(item, option) {
    if (!item || !option) return;

    const targetNativeType = String(option.nativeType || '').trim();
    const targetCustomType = option.kind === 'custom' ? String(option.itemType || '').trim() : '';
    const currentNativeType = this._getItemTypeNameByID(item.itemTypeID);
    const currentCustomType = this._getStoredCustomItemTypeName(item);

    if (currentNativeType === targetNativeType && currentCustomType === targetCustomType) return;

    try {
      if (targetNativeType && currentNativeType !== targetNativeType) {
        await this._setNativeItemType(item, targetNativeType);
      }

      const extra = String(item.getField?.('extra') || '');
      const nextExtra = this.Jurisdiction.updateMLZItemType?.(extra, targetCustomType) ?? extra;
      if (nextExtra !== extra) {
        item.setField('extra', nextExtra);
      }

      await item.saveTx({ skipDateModifiedUpdate: true });
      this._scheduleActiveInfoPaneRefresh(75, true);
      try {
        Zotero.debug(`[Citation Phoenix] item type saved: item=${String(item.id || '')} native=${targetNativeType} custom=${targetCustomType || '(none)'}`);
      } catch (e) {}
    } catch (e) {
      try { Zotero.logError(e); } catch (_) {}
      try { Zotero.debug(`[Citation Phoenix] item type save failed: ${String(e)}`); } catch (_) {}
    }
  }

  async _setNativeItemType(item, targetItemTypeName) {
    const target = String(targetItemTypeName || '').trim();
    if (!item || !target) return;

    const targetID = Zotero?.ItemTypes?.getID?.(target);
    if (typeof item.setType === 'function') {
      const result = item.setType(targetID ?? target);
      if (result && typeof result.then === 'function') {
        await result;
      }
      return;
    }

    if (targetID != null && 'itemTypeID' in item) {
      item.itemTypeID = targetID;
      return;
    }

    throw new Error(`Unable to set native item type to ${target}`);
  }

  _renderSchemaFieldRows(infoBox, options = {}) {
    const item = infoBox?.item;
    if (!item || item.deleted) {
      this._cleanupRegisteredSchemaInfoRows(infoBox);
      return;
    }

    if (!options.preserveLayout) {
      this._removeSchemaFieldRows(infoBox);
      this._resetSchemaHiddenBaseRows(infoBox);
    }

    const table = this._getInfoTable(infoBox);
    if (!table) return;

    const itemTypeName = this._getItemTypeName(item);
    const definitions = this.schemaConfig?.getFieldDefinitionsForItemType?.(itemTypeName) || [];
    for (const definition of definitions) {
      if (!this._shouldUseSchemaInfoRow(item, definition)) continue;
      if (options.preserveLayout && this._findSchemaInfoRow(infoBox, definition.field)) continue;
      const row = this._buildSchemaFieldRow(infoBox, item, definition, !!infoBox.editable);
      if (!row) continue;
      table.appendChild(row);
      this._hideSchemaBaseFieldRow(infoBox, item, definition);
    }

  }

  _cleanupRegisteredSchemaInfoRows(infoBox) {
    this._removeSchemaFieldRows(infoBox);
    this._resetSchemaHiddenBaseRows(infoBox);
  }

  _resetRegisteredSchemaInfoRows(infoBox) {
    this._removeSchemaFieldRows(infoBox);
  }

  _findSchemaInfoRow(infoBox, fieldName) {
    return infoBox?.querySelector?.(
      `[data-ibcslm-schema-field-row="true"][data-ibcslm-schema-field="${String(fieldName || '').trim()}"]`,
    ) || null;
  }

  _buildSchemaFieldRow(infoBox, item, definition, editable) {
    const fieldName = String(definition?.field || '').trim();
    if (!fieldName) return null;

    const doc = infoBox?.ownerDocument;
    if (!doc) return null;

    const row = doc.createElement('div');
    row.id = this._getSchemaInfoRowID(fieldName);
    row.className = 'meta-row';
    row.setAttribute('data-ibcslm-schema-field-row', 'true');
    row.setAttribute('data-ibcslm-schema-field', fieldName);

    const labelWrapper = doc.createElement('div');
    labelWrapper.className = 'meta-label';
    labelWrapper.setAttribute('fieldname', fieldName);

    let label;
    if (typeof infoBox.createLabelElement === 'function') {
      label = infoBox.createLabelElement({
        id: `itembox-field-${fieldName}-label`,
        text: this._getSchemaFieldLabel(fieldName),
      });
    } else {
      label = doc.createElement('label');
      label.id = `itembox-field-${fieldName}-label`;
      label.textContent = this._getSchemaFieldLabel(fieldName);
    }
    labelWrapper.appendChild(label);

    const valueWrapper = doc.createElement('div');
    valueWrapper.className = 'meta-data';
    const storedValue = this._getSchemaFieldValue(item, fieldName, this.Jurisdiction.getMLZExtraFields?.(item) || null);

    if (this._isSchemaFlagField(fieldName)) {
      valueWrapper.appendChild(this._buildSchemaCheckboxValueControl(
        doc,
        item,
        definition,
        storedValue,
        editable,
      ));
    } else {
      const displayValue = definition?.kind === 'date'
        ? this._formatSchemaDateDisplay(storedValue)
        : String(storedValue || '');

      if (editable) {
        valueWrapper.appendChild(this._buildSchemaValueControl(infoBox, item, definition, storedValue, displayValue));
      } else if (typeof infoBox.createValueElement === 'function') {
        const valueElem = infoBox.createValueElement({
          editable: false,
          text: displayValue,
          id: `itembox-field-${fieldName}-value`,
          attributes: {
            'aria-labelledby': `itembox-field-${fieldName}-label`,
            fieldname: fieldName,
            title: String(storedValue || ''),
          },
        });
        valueElem.value = displayValue;
        valueWrapper.appendChild(valueElem);
      } else {
        const input = doc.createElement('input');
        input.className = 'value';
        input.readOnly = true;
        input.value = displayValue;
        input.title = String(storedValue || '');
        valueWrapper.appendChild(input);
      }
    }

    row.appendChild(labelWrapper);
    row.appendChild(valueWrapper);
    return row;
  }

  _hideSchemaBaseFieldRow(infoBox, item, definition) {
    const fieldName = String(definition?.field || '').trim();
    if (!fieldName || !definition?.baseField) return;
    if (definition.kind !== 'field') return;

    const nativeFieldName = this._resolveNativeFieldName(item.itemTypeID, fieldName, definition.baseField);
    if (!nativeFieldName || nativeFieldName === fieldName) return;
    if (['title', 'caseName'].includes(nativeFieldName)) return;

    const row = this._findInfoFieldRow(infoBox, nativeFieldName);
    if (!row) return;
    row.hidden = true;
    row.setAttribute('data-ibcslm-schema-hidden-base-row', 'true');
  }

  _resetSchemaHiddenBaseRows(infoBox) {
    for (const row of infoBox?.querySelectorAll?.('[data-ibcslm-schema-hidden-base-row="true"]') || []) {
      row.hidden = false;
      row.removeAttribute('data-ibcslm-schema-hidden-base-row');
    }
  }

  _applySchemaSequence(infoBox, options = {}) {
    const table = this._getInfoTable(infoBox);
    if (!table) return;

    const forceNativeRows = !!options.forceNativeRows;
    const markInitialized = options.markInitialized !== false;
    const sequenceState = this._getSchemaSequenceState(infoBox);
    const shouldResequenceNativeRows = forceNativeRows || !sequenceState.initialized;
    const sequence = this.schemaConfig?.getSequenceForItemType?.(this._getItemTypeName(infoBox?.item)) || [];
    const itemTypeRow = this._findItemTypeRow(infoBox);
    if (!itemTypeRow || itemTypeRow.parentNode !== table) return;

    this._placeCreatorRowsAfterTitle(infoBox, table, itemTypeRow);

    const rows = [];
    for (const fieldName of sequence) {
      if (this._isSchemaTitleField(fieldName)) continue;
      const row = this._findSchemaSequenceRow(infoBox, fieldName);
      if (!row || row.hidden || row.parentNode !== table) continue;
      const canMoveRow = shouldResequenceNativeRows || this._isPluginManagedInfoRow(row);
      if (!canMoveRow || rows.includes(row)) continue;
      rows.push(row);
      this._appendSchemaCompanionRows(infoBox, table, rows, fieldName);
    }

    let cursor = this._getSchemaSequenceStart(infoBox, table, itemTypeRow);
    for (const row of rows) {
      if (row !== cursor) {
        table.insertBefore(row, cursor);
      }
      cursor = row.nextSibling;
    }

    this._placeCustomCourtAfterCourt(infoBox, table);

    if (markInitialized) {
      this._setSchemaSequenceState(infoBox);
    }
  }

  _scheduleInitialSchemaSequenceRetry(infoBox) {
    const sequenceState = this._getSchemaSequenceState(infoBox);
    if (!sequenceState.key) return;
    if (sequenceState.initialized && this._isSchemaSequenceSatisfied(infoBox)) return;

    if (this._schemaSequenceRetryTimer && this._schemaSequenceRetryKey === sequenceState.key) return;
    if (this._schemaSequenceRetryTimer) {
      clearTimeout(this._schemaSequenceRetryTimer);
    }

    this._schemaSequenceRetryKey = sequenceState.key;
    this._schemaSequenceRetryTimer = setTimeout(() => {
      this._schemaSequenceRetryTimer = null;
      this._schemaSequenceRetryKey = '';
      const activeInfoBox = this._getActiveInfoBox?.();
      if (!activeInfoBox || this._getSchemaSequenceState(activeInfoBox).key !== sequenceState.key) return;
      if (this._isEditingInInfoBox(activeInfoBox)) {
        this._scheduleInitialSchemaSequenceRetry(activeInfoBox);
        return;
      }
      this._applySchemaSequence(activeInfoBox, { forceNativeRows: true, markInitialized: false });
      const sequenceStatus = this._getSchemaSequenceStatus(activeInfoBox);
      if (sequenceStatus.satisfied) {
        this._setSchemaSequenceState(activeInfoBox, true);
        try { Zotero.debug(`[Citation Phoenix] initial schema field order applied after idle render: found=${sequenceStatus.foundFields.join(',')}`); } catch (e) {}
        return;
      }

      this._setSchemaSequenceState(activeInfoBox, false, Number(sequenceState.attempts || 0) + 1);
      if (Number(sequenceState.attempts || 0) < 5) {
        this._scheduleInitialSchemaSequenceRetry(activeInfoBox);
      } else {
        try {
          Zotero.debug(`[Citation Phoenix] initial schema field order incomplete after retries: item=${String(activeInfoBox?.item?.id || '')} type=${this._getItemTypeName(activeInfoBox?.item)} reason=${sequenceStatus.reason} found=${sequenceStatus.foundFields.join(',')}`);
        } catch (e) {}
      }
    }, 300);
  }

  _watchSchemaSequence(infoBox) {
    const table = this._getInfoTable(infoBox);
    const sequenceState = this._getSchemaSequenceState(infoBox);
    if (!table || !sequenceState.key) {
      this._disconnectSchemaSequenceObserver();
      return;
    }

    if (
      this._schemaSequenceObserver
      && this._schemaSequenceObserverTable === table
      && this._schemaSequenceObserverKey === sequenceState.key
    ) {
      return;
    }

    this._disconnectSchemaSequenceObserver();

    const MutationObserverCtor = table.ownerDocument?.defaultView?.MutationObserver;
    if (typeof MutationObserverCtor !== 'function') return;

    this._schemaSequenceObserverTable = table;
    this._schemaSequenceObserverKey = sequenceState.key;
    this._schemaSequenceObserver = new MutationObserverCtor((mutations) => {
      if (this._schemaSequenceObserverSuppressed) return;
      if (!Array.isArray(mutations) || !mutations.some((mutation) => mutation?.type === 'childList')) return;
      this._scheduleObservedSchemaSequenceApply(sequenceState.key);
    });
    this._schemaSequenceObserver.observe(table, { childList: true });
  }

  _scheduleObservedSchemaSequenceApply(sequenceKey) {
    const key = String(sequenceKey || '');
    if (!key) return;
    if (this._schemaSequenceObserverTimer) {
      clearTimeout(this._schemaSequenceObserverTimer);
    }

    this._schemaSequenceObserverTimer = setTimeout(() => {
      this._schemaSequenceObserverTimer = null;
      const activeInfoBox = this._getActiveInfoBox?.();
      if (!activeInfoBox || this._getSchemaSequenceState(activeInfoBox).key !== key) return;
      if (this._isEditingInInfoBox(activeInfoBox)) {
        this._scheduleInitialSchemaSequenceRetry(activeInfoBox);
        return;
      }

      const beforeStatus = this._getSchemaSequenceStatus(activeInfoBox);
      if (beforeStatus.satisfied) return;

      this._schemaSequenceObserverSuppressed = true;
      try {
        this._applySchemaSequence(activeInfoBox, { forceNativeRows: true, markInitialized: false });
      } finally {
        setTimeout(() => {
          this._schemaSequenceObserverSuppressed = false;
        }, 0);
      }

      const afterStatus = this._getSchemaSequenceStatus(activeInfoBox);
      if (afterStatus.satisfied) {
        this._setSchemaSequenceState(activeInfoBox, true);
        try { Zotero.debug(`[Citation Phoenix] schema field order restored after Zotero DOM mutation: found=${afterStatus.foundFields.join(',')}`); } catch (e) {}
      } else {
        this._setSchemaSequenceState(activeInfoBox, false);
        try { Zotero.debug(`[Citation Phoenix] schema field order unresolved after Zotero DOM mutation: reason=${afterStatus.reason} found=${afterStatus.foundFields.join(',')}`); } catch (e) {}
      }
    }, 50);
  }

  _disconnectSchemaSequenceObserver() {
    if (this._schemaSequenceObserverTimer) {
      clearTimeout(this._schemaSequenceObserverTimer);
      this._schemaSequenceObserverTimer = null;
    }
    if (this._schemaSequenceObserver) {
      try { this._schemaSequenceObserver.disconnect(); } catch (e) {}
    }
    this._schemaSequenceObserver = null;
    this._schemaSequenceObserverTable = null;
    this._schemaSequenceObserverKey = '';
    this._schemaSequenceObserverSuppressed = false;
  }

  _isSchemaSequenceSatisfied(infoBox) {
    return this._getSchemaSequenceStatus(infoBox).satisfied;
  }

  _getSchemaSequenceStatus(infoBox) {
    const table = this._getInfoTable(infoBox);
    if (!table) return { satisfied: true, reason: 'no-table', foundFields: [] };

    const sequence = this.schemaConfig?.getSequenceForItemType?.(this._getItemTypeName(infoBox?.item)) || [];
    const rows = [];
    const foundFields = [];
    for (const fieldName of sequence) {
      if (this._isSchemaTitleField(fieldName)) continue;
      const row = this._findSchemaSequenceRow(infoBox, fieldName);
      if (!row || row.hidden || row.parentNode !== table || rows.includes(row)) continue;
      rows.push(row);
      foundFields.push(String(fieldName || '').trim());
      this._appendSchemaCompanionRows(infoBox, table, rows, fieldName, foundFields);
    }
    const minimumUsefulRows = Math.min(4, Math.max(1, sequence.length - 1));
    if (rows.length < minimumUsefulRows) {
      return { satisfied: false, reason: `too-few-rows:${rows.length}/${minimumUsefulRows}`, foundFields };
    }

    const itemTypeRow = this._findItemTypeRow(infoBox);
    const schemaStart = this._getSchemaSequenceStart(infoBox, table, itemTypeRow);
    if (itemTypeRow?.parentNode === table && schemaStart !== rows[0]) {
      return { satisfied: false, reason: 'first-row-not-after-item-type', foundFields };
    }

    for (let idx = 0; idx < rows.length - 1; idx += 1) {
      if (rows[idx].nextSibling !== rows[idx + 1]) {
        return { satisfied: false, reason: 'rows-not-contiguous', foundFields };
      }
    }
    return { satisfied: true, reason: 'ok', foundFields };
  }

  _getSchemaSequenceStart(infoBox, table, itemTypeRow) {
    if (!itemTypeRow || itemTypeRow.parentNode !== table) return null;

    const titleRow = this._getSchemaTitleRow(infoBox);
    let cursor = titleRow?.parentNode === table
      ? titleRow.nextSibling
      : itemTypeRow.nextSibling;
    const creatorRows = new Set(this._getCreatorRows(infoBox));
    while (cursor && creatorRows.has(cursor) && cursor.parentNode === table) {
      cursor = cursor.nextSibling;
    }
    return cursor;
  }

  _isSchemaTitleField(fieldName) {
    return ['title', 'caseName', 'nameOfAct', 'subject'].includes(String(fieldName || '').trim());
  }

  _getSchemaTitleRow(infoBox) {
    return this._findInfoFieldRow(infoBox, 'title')
      || this._findInfoFieldRow(infoBox, 'caseName')
      || this._findInfoFieldRow(infoBox, 'nameOfAct')
      || this._findInfoFieldRow(infoBox, 'subject');
  }

  _placeCreatorRowsAfterTitle(infoBox, table, itemTypeRow) {
    const titleRow = this._getSchemaTitleRow(infoBox);
    if (!titleRow || titleRow.parentNode !== table) return;

    const creatorRows = this._getCreatorRows(infoBox)
      .filter((row) => row.parentNode === table);
    if (!creatorRows.length) return;

    let cursor = titleRow.nextSibling;
    for (const row of creatorRows) {
      if (row === cursor) {
        cursor = row.nextSibling;
        continue;
      }
      table.insertBefore(row, cursor);
      cursor = row.nextSibling;
    }
  }

  _placeCustomCourtAfterCourt(infoBox, table) {
    const courtRow = this._findInfoFieldRow(infoBox, 'court');
    const customCourtRow = infoBox?.querySelector?.(`#${this._customCourtRowID}`);
    if (!courtRow || !customCourtRow) return;
    if (courtRow.parentNode !== table || customCourtRow.parentNode !== table) return;
    if (courtRow.nextSibling !== customCourtRow) {
      table.insertBefore(customCourtRow, courtRow.nextSibling);
    }
  }

  _findSchemaSequenceRow(infoBox, fieldName) {
    const field = String(fieldName || '').trim();
    if (!field) return null;

    const direct = this._findInfoFieldRow(infoBox, field);
    if (direct) return direct;

    const item = infoBox?.item;
    const definition = this.schemaConfig?.getFieldDefinition?.(this._getItemTypeName(item), field) || null;
    const candidates = [];
    const nativeFieldName = item ? this._resolveNativeFieldName(item.itemTypeID, field, definition?.baseField) : null;
    if (nativeFieldName && nativeFieldName !== field) candidates.push(nativeFieldName);
    if (definition?.baseField && definition.baseField !== field) candidates.push(definition.baseField);

    for (const candidate of candidates) {
      const row = this._findInfoFieldRow(infoBox, candidate);
      if (row) return row;
    }
    return null;
  }

  _appendSchemaCompanionRows(infoBox, table, rows, fieldName, foundFields = null) {
    if (String(fieldName || '').trim() !== 'court') return;
    const customCourtRow = infoBox?.querySelector?.(`#${this._customCourtRowID}`);
    if (!customCourtRow || customCourtRow.hidden || customCourtRow.parentNode !== table) return;
    if (rows.includes(customCourtRow)) return;
    rows.push(customCourtRow);
    foundFields?.push?.('custom-court');
  }

  _getSchemaSequenceState(infoBox) {
    const itemID = String(infoBox?.item?.id || '');
    const itemTypeName = this._getItemTypeName(infoBox?.item);
    const currentKey = `${itemID}::${itemTypeName}`;
    const existing = infoBox?._ibcslmSchemaSequenceState || null;
    if (existing?.key === currentKey) return existing;
    return { key: currentKey, initialized: false, attempts: 0 };
  }

  _setSchemaSequenceState(infoBox, initialized = true, attempts = 0) {
    if (!infoBox) return;
    const itemID = String(infoBox?.item?.id || '');
    const itemTypeName = this._getItemTypeName(infoBox?.item);
    infoBox._ibcslmSchemaSequenceState = {
      key: `${itemID}::${itemTypeName}`,
      initialized: !!initialized,
      attempts: Math.max(0, Number(attempts) || 0),
    };
  }

  _isPluginManagedInfoRow(row) {
    if (!row) return false;
    if (row.getAttribute?.('data-ibcslm-schema-field-row') === 'true') return true;
    const rowID = String(row.id || '');
    return [
      this._jurisdictionRowID,
      this._customCourtRowID,
      this._commenterRowID,
    ].includes(rowID);
  }

  _getFieldNameFromBaseForType(itemTypeID, baseField) {
    const name = String(baseField || '').trim();
    if (!name) return null;
    try {
      const baseFieldID = Zotero?.ItemFields?.getID?.(name);
      if (!baseFieldID) return null;
      const typeFieldID = Zotero?.ItemFields?.getFieldIDFromTypeAndBase?.(itemTypeID, baseFieldID);
      if (!typeFieldID) return null;
      return Zotero?.ItemFields?.getName?.(typeFieldID) || null;
    } catch (e) {}
    return null;
  }

  _getLocalizedBuiltinLabel(key) {
    if (key === 'jurisdiction') {
      return this._getSchemaFieldLabel('jurisdiction');
    }

    const locale = Zotero?.locale || 'en-US';
    const candidates = getLocaleCandidates(locale);
    const translations = {
      customCourt: {
        de: 'Benutzerdefiniertes Gericht',
        'de-de': 'Benutzerdefiniertes Gericht',
        'de-at': 'Benutzerdefiniertes Gericht',
        'de-ch': 'Benutzerdefiniertes Gericht',
        en: 'Custom Court',
        us: 'Custom Court',
      },
      customCourtPlaceholder: {
        de: 'Benutzerdefinierten Gerichtsschluessel eingeben',
        'de-de': 'Benutzerdefinierten Gerichtsschluessel eingeben',
        'de-at': 'Benutzerdefinierten Gerichtsschluessel eingeben',
        'de-ch': 'Benutzerdefinierten Gerichtsschluessel eingeben',
        en: 'Enter custom court key',
        us: 'Enter custom court key',
      },
      setButton: {
        de: 'Setzen',
        'de-de': 'Setzen',
        'de-at': 'Setzen',
        'de-ch': 'Setzen',
        en: 'Set',
        us: 'Set',
      },
    };

    const table = translations[key] || {};
    for (const candidate of candidates) {
      if (table[candidate]) return table[candidate];
    }
    return table.en || String(key || '');
  }

  _normalizeJurisdictionValue(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    return this.Jurisdiction?._normalizeJurisdiction?.(raw) || raw.toLowerCase();
  }

  _getSchemaFieldValue(item, fieldName, mlzFields = null) {
    if (!item) return '';
    const itemTypeName = this._getItemTypeName(item);
    const definition = this.schemaConfig?.getFieldDefinition?.(itemTypeName, fieldName) || null;
    const nativeFieldName = this._resolveNativeFieldName(item.itemTypeID, fieldName, definition?.baseField);

    if (fieldName === 'jurisdiction') {
      const nativeValue = nativeFieldName ? this._normalizeJurisdictionValue(item.getField?.(nativeFieldName)) : '';
      if (nativeValue) return nativeValue;
      return this.Jurisdiction.getMLZJurisdiction?.(item) || '';
    }

    const nativeValue = nativeFieldName ? String(item.getField?.(nativeFieldName) || '').trim() : '';
    if (nativeValue) return nativeValue;

    if (fieldName === 'court') {
      return this.abbrevService.normalizeKey(mlzFields?.court || '');
    }

    return String(mlzFields?.[fieldName] || '').trim();
  }

  _hasCSLValue(value) {
    if (value == null) return false;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'string') return value.trim() !== '';
    if (typeof value === 'object') return Object.keys(value).length > 0;
    return true;
  }

  _getFirstSchemaFieldValue(item, fieldNames, mlzFields = null) {
    for (const fieldName of Array.isArray(fieldNames) ? fieldNames : []) {
      const value = this._getSchemaFieldValue(item, fieldName, mlzFields);
      if (this._hasCSLValue(value)) return value;
    }
    return '';
  }

  _assignCSLFieldValue(cslItem, cslField, value) {
    if (!this._hasCSLValue(value)) return;
    if (cslField === 'authority') {
      cslItem.authority = [{ literal: String(value).trim() }];
      return;
    }
    cslItem[cslField] = value;
  }

  _parseRawDateToCSL(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;

    const isoMatch = raw.match(/^(\d{4})(?:[-/](\d{1,2})(?:[-/](\d{1,2}))?)?$/);
    if (isoMatch) {
      const year = Number(isoMatch[1]);
      const month = isoMatch[2] ? Number(isoMatch[2]) : null;
      const day = isoMatch[3] ? Number(isoMatch[3]) : null;
      const parts = [year];
      if (month) parts.push(month);
      if (day) parts.push(day);
      return { 'date-parts': [parts], raw };
    }

    return { raw };
  }

  _getSchemaFieldLabel(fieldName) {
    const raw = String(fieldName || '').trim();
    if (!raw) return '';
    return this.schemaConfig?.getLocalizedFieldLabel?.(raw, Zotero?.locale || 'en-US') || raw;
  }

  _isSchemaFlagField(fieldName) {
    return /Flag$/.test(String(fieldName || '').trim());
  }

  _coerceSchemaFlagValue(value) {
    const normalized = String(value == null ? '' : value).trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
  }

  _serializeSchemaFlagValue(checked) {
    return checked ? 'true' : '';
  }

  _formatSchemaDateDisplay(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';

    const ymd = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (ymd) {
      const date = new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));
      return new Intl.DateTimeFormat(this._getSchemaLocale()).format(date);
    }

    const ym = raw.match(/^(\d{4})-(\d{1,2})$/);
    if (ym) {
      const date = new Date(Number(ym[1]), Number(ym[2]) - 1, 1);
      return new Intl.DateTimeFormat(this._getSchemaLocale(), {
        year: 'numeric',
        month: 'numeric',
      }).format(date);
    }

    const y = raw.match(/^(\d{4})$/);
    if (y) return y[1];

    return raw;
  }

  _normalizeSchemaDateInput(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';

    const isoLike = raw.match(/^(\d{4})(?:[-/.\s](\d{1,2})(?:[-/.\s](\d{1,2}))?)?$/);
    if (isoLike) {
      return this._serializeSchemaDateParts(isoLike[1], isoLike[2] || '', isoLike[3] || '');
    }

    const localizedNumeric = this._parseSchemaNumericDate(raw);
    if (localizedNumeric) return localizedNumeric;

    const monthNameDate = this._parseSchemaMonthNameDate(raw);
    if (monthNameDate) return monthNameDate;

    return raw;
  }

  _getSchemaLocale() {
    return Zotero?.locale || 'en-US';
  }

  _getSchemaLocaleDateOrder() {
    try {
      const parts = new Intl.DateTimeFormat(this._getSchemaLocale())
        .formatToParts(new Date(2001, 10, 22))
        .filter((part) => ['day', 'month', 'year'].includes(part.type))
        .map((part) => part.type);
      return parts.length ? parts : ['month', 'day', 'year'];
    } catch (e) {}
    return ['month', 'day', 'year'];
  }

  _getSchemaDatePlaceholder() {
    const order = this._getSchemaLocaleDateOrder();
    const mapping = {
      day: 'DD',
      month: 'MM',
      year: 'YYYY',
    };
    return order.map((part) => mapping[part] || part.toUpperCase()).join('/');
  }

  _serializeSchemaDateParts(year, month = '', day = '') {
    const yyyy = String(year || '').trim();
    const mm = String(month || '').trim();
    const dd = String(day || '').trim();
    if (!/^\d{4}$/.test(yyyy)) return '';
    if (!mm) return yyyy;
    const monthNumber = Number(mm);
    if (!(monthNumber >= 1 && monthNumber <= 12)) return '';
    if (!dd) return `${yyyy}-${String(monthNumber).padStart(2, '0')}`;
    const dayNumber = Number(dd);
    if (!(dayNumber >= 1 && dayNumber <= 31)) return '';
    return `${yyyy}-${String(monthNumber).padStart(2, '0')}-${String(dayNumber).padStart(2, '0')}`;
  }

  _parseSchemaNumericDate(raw) {
    const parts = raw.split(/[\/.\-\s]+/).map((part) => String(part || '').trim()).filter(Boolean);
    if (parts.length < 2 || parts.length > 3) return '';

    const tryOrders = [];
    const localeOrder = this._getSchemaLocaleDateOrder();
    if (parts.length === 3) {
      tryOrders.push(localeOrder);
      tryOrders.push(['month', 'day', 'year']);
      tryOrders.push(['day', 'month', 'year']);
      tryOrders.push(['year', 'month', 'day']);
    } else if (parts.length === 2) {
      tryOrders.push(['year', 'month']);
      tryOrders.push(['month', 'year']);
    }

    for (const order of tryOrders) {
      const parsed = this._tryParseSchemaDateWithOrder(parts, order);
      if (parsed) return parsed;
    }
    return '';
  }

  _tryParseSchemaDateWithOrder(parts, order) {
    const values = {};
    for (let idx = 0; idx < Math.min(parts.length, order.length); idx += 1) {
      values[order[idx]] = parts[idx];
    }

    const year = String(values.year || '').trim();
    const month = String(values.month || '').trim();
    const day = String(values.day || '').trim();

    if (!year || !/^\d{4}$/.test(year)) return '';
    if (!month || !/^\d{1,2}$/.test(month)) return '';
    if (day && !/^\d{1,2}$/.test(day)) return '';

    return this._serializeSchemaDateParts(year, month, day);
  }

  _parseSchemaMonthNameDate(raw) {
    const monthMap = {
      january: '01', jan: '01',
      february: '02', feb: '02',
      march: '03', mar: '03',
      april: '04', apr: '04',
      may: '05',
      june: '06', jun: '06',
      july: '07', jul: '07',
      august: '08', aug: '08',
      september: '09', sept: '09', sep: '09',
      october: '10', oct: '10',
      november: '11', nov: '11',
      december: '12', dec: '12',
    };

    const normalized = raw
      .replace(/,/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

    let match = normalized.match(/^([a-z]+)\s+(\d{1,2})\s+(\d{4})$/);
    if (match) {
      const month = monthMap[match[1]];
      if (month) return this._serializeSchemaDateParts(match[3], month, match[2]);
    }

    match = normalized.match(/^(\d{1,2})\s+([a-z]+)\s+(\d{4})$/);
    if (match) {
      const month = monthMap[match[2]];
      if (month) return this._serializeSchemaDateParts(match[3], month, match[1]);
    }

    match = normalized.match(/^([a-z]+)\s+(\d{4})$/);
    if (match) {
      const month = monthMap[match[1]];
      if (month) return this._serializeSchemaDateParts(match[2], month, '');
    }

    return '';
  }

  _readSchemaControlValue(node) {
    if (!node) return '';
    if (typeof node.value !== 'undefined') return String(node.value || '').trim();
    return String(node.textContent || '').trim();
  }

  _buildSchemaValueControl(infoBox, item, definition, value, displayValue) {
    const fieldName = String(definition?.field || '').trim();
    if (typeof infoBox?.createValueElement === 'function') {
      const valueElem = infoBox.createValueElement({
        editable: true,
        text: displayValue,
        id: `itembox-field-${fieldName}-input`,
        attributes: {
          'aria-labelledby': `itembox-field-${fieldName}-label`,
          fieldname: fieldName,
          title: displayValue,
        },
      });
      valueElem.value = displayValue;
      if (definition?.kind === 'date') {
        valueElem.setAttribute?.('placeholder', this._getSchemaDatePlaceholder());
      }

      const saveValue = async () => {
        let nextValue = this._readSchemaControlValue(valueElem);
        if (definition?.kind === 'date') {
          nextValue = this._normalizeSchemaDateInput(nextValue);
        }
        await this._saveSchemaFieldValue(item, definition, nextValue);
      };

      valueElem.addEventListener?.('change', saveValue);
      valueElem.addEventListener?.('blur', saveValue);
      valueElem.addEventListener?.('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        saveValue();
      });
      return valueElem;
    }

    const doc = infoBox?.ownerDocument;
    const input = doc.createElement('input');
    input.className = 'value';
    input.id = `itembox-field-${fieldName}-input`;
    input.setAttribute('fieldname', fieldName);
    input.setAttribute('aria-labelledby', `itembox-field-${fieldName}-label`);
    input.value = displayValue;
    if (definition?.kind === 'date') {
      input.placeholder = this._getSchemaDatePlaceholder();
    }
    input.style.maxWidth = '22em';

    const saveValue = async () => {
      let nextValue = String(input.value || '').trim();
      if (definition?.kind === 'date') {
        nextValue = this._normalizeSchemaDateInput(nextValue);
      }
      await this._saveSchemaFieldValue(item, definition, nextValue);
    };

    input.addEventListener('change', saveValue);
    input.addEventListener('blur', saveValue);
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      saveValue();
    });
    return input;
  }

  _buildSchemaCheckboxValueControl(doc, item, definition, value, editable) {
    const fieldName = String(definition?.field || '').trim();
    if (typeof doc.createXULElement === 'function') {
      const checkbox = doc.createXULElement('checkbox');
      checkbox.id = `itembox-field-${fieldName}-input`;
      checkbox.checked = this._coerceSchemaFlagValue(value);
      checkbox.disabled = !editable;
      checkbox.addEventListener('command', async () => {
        if (checkbox.disabled) return;
        await this._saveSchemaFieldValue(item, definition, this._serializeSchemaFlagValue(!!checkbox.checked));
      });
      return checkbox;
    }

    const input = doc.createElement('input');
    input.type = 'checkbox';
    input.id = `itembox-field-${fieldName}-input`;
    input.checked = this._coerceSchemaFlagValue(value);
    input.disabled = !editable;

    input.addEventListener('change', async () => {
      if (input.disabled) return;
      await this._saveSchemaFieldValue(item, definition, this._serializeSchemaFlagValue(input.checked));
    });
    return input;
  }

  async _saveSchemaFieldValue(item, definition, rawValue) {
    if (!item?.setField || !definition?.field) return;

    const fieldName = String(definition.field || '').trim();
    const nativeFieldName = this._resolveNativeFieldName(item.itemTypeID, fieldName, definition.baseField);
    const value = String(rawValue == null ? '' : rawValue).trim();
    const extra = String(item.getField?.('extra') || '');
    let nextExtra = extra;
    let changed = false;

    if (fieldName === 'jurisdiction') {
      const normalized = this._normalizeJurisdictionValue(value);
      const displayValue = this.abbrevService.formatJurisdictionDisplay(normalized);
      nextExtra = this.Jurisdiction.updateMLZJurisdiction?.(extra, normalized, displayValue) ?? extra;
      if (nativeFieldName) {
        item.setField(nativeFieldName, normalized);
        changed = true;
      }
    } else {
      if (nativeFieldName) {
        item.setField(nativeFieldName, value);
        changed = true;
      }
      nextExtra = this.Jurisdiction.updateMLZExtraField?.(nextExtra, fieldName, value) ?? nextExtra;
    }

    if (nextExtra !== extra) {
      item.setField('extra', nextExtra);
      changed = true;
    }

    if (!changed) return;
    await item.saveTx({ skipDateModifiedUpdate: true });

    try {
      this._scheduleActiveInfoPaneRefresh(75, !!nativeFieldName);
    } catch (e) {}
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
        this._sanitizeCSLControlFields(cslItem);
        this._logCitationItemData(cslItem, zotItem, 'retrieveItem');
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
      const schemaItemType = this._getItemTypeName(zotItem);
      const mappedCSLType = this.schemaConfig?.getCSLTypeForItemType?.(schemaItemType) || '';
      const isCustomSchemaItemType = this.schemaConfig?.isCustomItemType?.(schemaItemType) || false;

      // Preserve Zotero's native CSL type for ordinary item types like bookSection -> chapter.
      // Only force a CSL type remap for plugin-defined custom item types.
      if (mappedCSLType && isCustomSchemaItemType) {
        cslItem.type = mappedCSLType;
      }

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

      this._applySchemaCreatorMappings(cslItem, zotItem);
      this._applySchemaCSLFieldMappings(cslItem, zotItem, mlzFields);
      this._applySchemaCSLDateMappings(cslItem, zotItem, mlzFields);
      this._rememberContainerTitleContext(cslItem, zotItem);

      const seeAlso = this._collectSeeAlsoURIs(cslItem, zotItem);
      if (seeAlso.length) {
        cslItem.seeAlso = seeAlso;
      }
    } catch (e) {
      this._warnRetrieveItem(`hydrateCSLItemFromZotero failed: ${String(e)}`);
    }
  }

  _applySchemaCreatorMappings(cslItem, zotItem) {
    for (const extraPersonType of this._extraPersonTypes) {
      const cslField = extraPersonType.cslField;
      if (!cslField || this._hasCSLValue(cslItem[cslField])) continue;
      const creators = this.Jurisdiction.getMLZExtraCreatorsByType?.(zotItem, extraPersonType.mlzType) || [];
      if (!creators.length) continue;
      const mapped = creators
        .map((creator) => this._extraPersonToCSLCreator(creator))
        .filter((creator) => creator.literal || creator.given || creator.family);
      if (mapped.length) cslItem[cslField] = mapped;
    }
  }

  _applySchemaCSLFieldMappings(cslItem, zotItem, mlzFields) {
    const mappings = this.schemaConfig?.getCSLFieldMappings?.() || [];
    for (const mapping of mappings) {
      if (!mapping?.cslField || this._hasCSLValue(cslItem[mapping.cslField])) continue;
      const value = this._getFirstSchemaFieldValue(zotItem, mapping.fields, mlzFields);
      this._assignCSLFieldValue(cslItem, mapping.cslField, value);
    }
  }

  _applySchemaCSLDateMappings(cslItem, zotItem, mlzFields) {
    const mappings = this.schemaConfig?.getCSLDateMappings?.() || [];
    for (const mapping of mappings) {
      if (!mapping?.cslField || this._hasCSLValue(cslItem[mapping.cslField])) continue;
      const rawValue = this._getFirstSchemaFieldValue(zotItem, mapping.fields, mlzFields);
      const parsed = this._parseRawDateToCSL(rawValue);
      if (parsed) cslItem[mapping.cslField] = parsed;
    }
  }

  _collectSeeAlsoURIs(cslItem, zotItem) {
    const out = [];
    const seen = new Set();
    const selfURI = this._getItemURI(zotItem);

    const add = (value) => {
      const normalized = this._resolveSeeAlsoEntryToURI(value, zotItem?.libraryID);
      if (!normalized) return;
      if (selfURI && normalized === selfURI) return;
      if (seen.has(normalized)) return;
      seen.add(normalized);
      out.push(normalized);
    };

    try {
      const existingSeeAlso = Array.isArray(cslItem?.seeAlso) ? cslItem.seeAlso : [];
      for (const entry of existingSeeAlso) {
        add(entry);
      }

      const relatedKeys = Array.isArray(zotItem?.relatedItems) ? zotItem.relatedItems : [];
      for (const key of relatedKeys) {
        const relatedItem = Zotero.Items.getByLibraryAndKey?.(zotItem.libraryID, key);
        add(relatedItem);
      }

      const relatedPredicate = Zotero.Relations?.relatedItemPredicate;
      const relatedURIs = relatedPredicate ? (zotItem?.getRelationsByPredicate?.(relatedPredicate) || []) : [];
      for (const uri of relatedURIs) {
        add(uri);
      }
    } catch (e) {
      this._warnRetrieveItem(`collectSeeAlsoURIs failed: ${String(e)}`);
    }

    return out;
  }

  _sanitizeCSLControlFields(cslItem) {
    if (!cslItem || typeof cslItem !== 'object') return;

    const rawNote = cslItem.note;
    const parsed = this.Jurisdiction?._getMLZPayloadAndRange?.(rawNote) || null;
    const sanitizedNote = this._stripEmbeddedControlText(rawNote);
    try {
      const payload = {
        type: cslItem?.type ?? null,
        title: cslItem?.title ?? null,
        rawNote: rawNote ?? null,
        mlzStart: parsed?.start ?? null,
        mlzEnd: parsed?.end ?? null,
        sanitizedNote: sanitizedNote ?? null,
      };
      const msg = `[Citation Phoenix] sanitize note: ${JSON.stringify(payload)}`;
      Zotero.debug(msg);
      Zotero.logError(msg);
    } catch (e) {}
    if (sanitizedNote == null) {
      delete cslItem.note;
    } else {
      cslItem.note = sanitizedNote;
    }
  }

  _stripEmbeddedControlText(value) {
    let text = String(value || '');
    if (!text.trim()) return null;

    const parsed = this.Jurisdiction?._getMLZPayloadAndRange?.(text);
    if (parsed?.start != null && parsed?.end != null) {
      const stripped = this.Jurisdiction._removeMLZBlock?.(text, parsed.start, parsed.end);
      if (stripped != null) {
        text = stripped;
      }
    }

    text = text.replace(/\b(container-title-short|title-short|hereinafter)\s*:\s*.*$/i, '');
    text = text.replace(/^[\s"'`]+|[\s"'`]+$/g, '').trim();
    return text || null;
  }

  _resolveSeeAlsoEntryToURI(value, libraryID = null) {
    if (value == null) return null;
    if (typeof value === 'object') {
      const directURI = this._getItemURI(value);
      if (directURI) return directURI;
      if ('key' in value && libraryID != null) {
        const relatedItem = Zotero.Items.getByLibraryAndKey?.(libraryID, value.key);
        return this._getItemURI(relatedItem);
      }
      return null;
    }

    const raw = String(value).trim();
    if (!raw) return null;

    if (/^https?:\/\/zotero\.org\//i.test(raw)) return raw;
    if (/^\d+$/.test(raw)) return this._getItemURI(Zotero.Items.get?.(Number(raw)));
    if (/^[A-Z0-9]{8}$/i.test(raw) && libraryID != null) return this._getItemURI(Zotero.Items.getByLibraryAndKey?.(libraryID, raw));

    return raw;
  }

  _getItemURI(item) {
    if (!item) return null;
    try {
      return Zotero.URI?.getItemURI?.(item) || null;
    } catch (e) {}
    return null;
  }

  _extraPersonToCSLCreator(person) {
    const literalName = String(person?.name || '').trim();
    if (literalName) return { literal: literalName };
    return {
      given: String(person?.firstName || '').trim(),
      family: String(person?.lastName || '').trim(),
    };
  }

  _rememberContainerTitleContext(cslItem, zotItem = null) {
    const containerTitle = String(cslItem?.['container-title'] || '').trim();
    if (!containerTitle) return;

    const key = this.abbrevService.normalizeKey(containerTitle);
    if (!key) return;

    const shortTitle = String(cslItem?.['container-title-short'] || '').trim();
    if (shortTitle) {
      this._containerTitleShortByKey.set(key, shortTitle);
    }

    const type = String(cslItem?.type || '').trim();
    const language = String(
      cslItem?.language
      || zotItem?.getField?.('language')
      || zotItem?.getField?.('languageCode')
      || zotItem?.language
      || '',
    ).trim();
    const prior = this._containerTitleContextByKey.get(key) || {
      journal: false,
      englishBook: false,
    };

    if (['article-journal', 'article-magazine', 'article-newspaper'].includes(type)) {
      prior.journal = true;
    }
    if (type === 'chapter' && this._isEnglishLanguage(language)) {
      prior.englishBook = true;
    }

    this._containerTitleContextByKey.set(key, prior);
  }

  _shouldAllowContainerTitleFallback(containerTitle, styleID = '') {
    if (!this._styleAllowsContainerTitleFallback(styleID)) return false;
    const key = this.abbrevService.normalizeKey(containerTitle || '');
    if (!key) return false;
    const context = this._containerTitleContextByKey.get(key);
    return !!(context?.journal || context?.englishBook);
  }

  _styleAllowsContainerTitleFallback(styleID) {
    const key = String(styleID || '').trim().toLowerCase();
    return key === 'http://juris-m.github.io/styles/jm-indigobook'
      || key === 'http://juris-m.github.io/styles/jm-indigobook-law-review';
  }

  _isEnglishLanguage(language) {
    const value = String(language || '').trim().toLowerCase();
    return value === 'en' || value.startsWith('en-') || value.startsWith('eng');
  }

  _protectAbbreviationValue(value) {
    const text = String(value || '').trim();
    if (!text || /<span\s+class=["']nocase["']>/i.test(text)) return text;
    return `<span class="nocase">${this._escapeNoCaseText(text)}</span>`;
  }

  _escapeNoCaseText(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  _decorateShortForms(cslItem, jur) {
    try {
      if (!cslItem['container-title-short'] && cslItem['container-title']) {
        const hit = this.abbrevService.lookupForCiteProc('container-title', cslItem['container-title'], jur, { noHints: true });
        if (hit?.value) {
          cslItem['container-title-short'] = this._protectAbbreviationValue(this.abbrevService.parseDirective(hit.value).value);
          this._logShortForm('container-title', cslItem['container-title'], cslItem['container-title-short'], 'hit');
        } else {
          this._logShortForm('container-title', cslItem['container-title'], null, 'miss');
        }
      }

      if (!cslItem['title-short'] && cslItem.title) {
        // Only use explicit title abbreviations/short forms for title-short.
        // Word-by-word fallback abbreviation is appropriate for journals but
        // can mangle ordinary work titles and interfere with style logic for
        // subsequent citations.
        const hit = this.abbrevService.lookupForCiteProc('title', cslItem.title, jur, { noHints: true });
        if (hit?.value) {
          cslItem['title-short'] = this._protectAbbreviationValue(this.abbrevService.parseDirective(hit.value).value);
          this._logShortForm('title', cslItem.title, cslItem['title-short'], 'hit');
        } else {
          this._logShortForm('title', cslItem.title, null, 'miss');
        }
      }
      this._rememberContainerTitleContext(cslItem);
    } catch (e) {
      this._warnRetrieveItem(`decorateShortForms failed: ${String(e)}`);
    }
  }

  _logShortForm(category, source, value, stage) {
    if (this._shortFormLogCount >= this._maxShortFormLogs) return;
    this._shortFormLogCount += 1;
    const msg = `[Citation Phoenix] shortForm[${this._shortFormLogCount}] ${stage}: category=${category} source=${String(source)} value=${String(value)}`;
    try { Zotero.debug(msg); } catch (e) {}
  }

  _logField(stage, detail) {
    if (this._fieldLogCount >= this._maxFieldLogs) return;
    this._fieldLogCount += 1;
    const msg = `[Citation Phoenix] field[${this._fieldLogCount}] ${stage}: ${detail}`;
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
      const msg = `[Citation Phoenix] renderProbe item(${stage}): jur=${String(jur)} type=${String(cslItem?.type || '')} container-title=${source} container-title-short=${String(cslItem?.['container-title-short'] || '')} title=${String(cslItem?.title || '')} title-short=${String(cslItem?.['title-short'] || '')}`;
      Zotero.debug(msg);
      Zotero.logError(msg);
    } catch (e) {}
  }

  _logRenderProbeFromAbbreviation(category, key, jurisdiction, noHints, stage) {
    try {
      if (category !== 'container-title') return;
      if (!this._isHarvardCRCL(key)) return;
      const normalized = this.abbrevService.normalizeKey(key || '');
      const msg = `[Citation Phoenix] renderProbe abbr(${stage}): category=${String(category)} jur=${String(jurisdiction)} noHints=${String(!!noHints)} key=${String(key)} normalized=${normalized}`;
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
    const msg = `[Citation Phoenix] retrieveItem[${this._retrieveItemLogCount}] ${stage}: inputID(${inType})=${String(inputID)} => cslItem.id(${outType})=${String(outputID)}`;
    try { Zotero.debug(msg); } catch (e) {}
    try { Zotero.logError(msg); } catch (e) {}
  }

  _warnRetrieveItem(reason) {
    if (this._didWarnRetrieveItem) return;
    this._didWarnRetrieveItem = true;
    try {
      Zotero.debug(`[Citation Phoenix] retrieveItem patch warning: ${reason}`);
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
          const storedShort = self._containerTitleShortByKey.get(normalizedContainerTitle);
          if (storedShort) {
            if (!obj[jur]) obj[jur] = self._newAbbreviationSegments(this);
            if (!obj[jur][category]) obj[jur][category] = {};
            obj[jur][category][key] = self._protectAbbreviationValue(storedShort);
            self._logRenderProbeFromAbbreviation(category, key, jur, noHints, 'container-title-short');
            self._logAbbreviation(category, key, jur, obj[jur][category][key], 'container-title-short');
            return jur;
          }

          const journalAbbr = self._journalAbbrByContainerTitleKey.get(normalizedContainerTitle);
          if (journalAbbr) {
            if (!obj[jur]) obj[jur] = self._newAbbreviationSegments(this);
            if (!obj[jur][category]) obj[jur][category] = {};
            obj[jur][category][key] = self._protectAbbreviationValue(journalAbbr);
            self._logRenderProbeFromAbbreviation(category, key, jur, noHints, 'journal-abbr');
            self._logAbbreviation(category, key, jur, journalAbbr, 'journal-abbr');
            return jur;
          }
        }

        const lookupNoHints = category === 'title'
          ? true
          : category === 'container-title'
            ? !self._shouldAllowContainerTitleFallback(key, styleID)
            : noHints;
        const hit = self.abbrevService.lookupForCiteProc(category, key, jur, { noHints: lookupNoHints });
        if (hit?.value) {
          const targetJur = hit.jurisdiction || jur || 'default';
          if (!obj[targetJur]) obj[targetJur] = self._newAbbreviationSegments(this);
          if (!obj[targetJur][category]) obj[targetJur][category] = {};
          obj[targetJur][category][key] = (category === 'title' || category === 'container-title')
            ? self._protectAbbreviationValue(hit.value)
            : hit.value;
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
    const msg = `[Citation Phoenix] getAbbreviation[${this._abbrevLogCount}] ${stage}: category=${category} jurisdiction=${jurisdiction} key=${String(key)} value=${String(value)}`;
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
      if (xml) {
        self._logJurisdictionModuleLoad('loadJurisdictionStyle', jurisdiction, variantName, xml);
        return xml;
      }
      if (self._orig.loadJurisdictionStyle) return self._orig.loadJurisdictionStyle.call(this, jurisdiction, variantName);
      return null;
    };

    // Some builds may call a differently named hook; provide alias
    sysProto.retrieveStyleModule = function (jurisdiction, variantName) {
      const xml = self.moduleLoader.loadJurisdictionStyleSync(jurisdiction, variantName);
      if (xml) {
        self._logJurisdictionModuleLoad('retrieveStyleModule', jurisdiction, variantName, xml);
        return xml;
      }
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
          try { Zotero.debug('[Citation Phoenix] Replaced empty IndigoTemp citation layout with base juris-us.csl'); } catch (e) {}
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

    this._logCiteprocEngineDetails(citeproc);
    this._instrumentParallelLifecycle(citeproc);

    try {
      const availableAbbrevDomains = this.abbrevService?.getAvailableAbbrevDomains?.();
      if (citeproc.opt && availableAbbrevDomains && Object.keys(availableAbbrevDomains).length) {
        citeproc.opt.availableAbbrevDomains = {
          ...(citeproc.opt.availableAbbrevDomains || {}),
          ...availableAbbrevDomains,
        };
      }
    } catch (e) {}

    try {
      const methodList = [
        'processCitationCluster',
        'previewCitationCluster',
        'appendCitationCluster',
        'makeBibliography',
        'updateItems',
      ];
      const available = methodList.filter((name) => typeof citeproc[name] === 'function').join(',');
      Zotero.debug(`[Citation Phoenix] renderProbe citeproc instrumentation: methods=${available || 'none'}`);
    } catch (e) {}

    this._instrumentParallelTracker(citeproc);

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

  _instrumentParallelLifecycle(citeproc) {
    const wrap = (methodName) => {
      const orig = citeproc?.[methodName];
      if (typeof orig !== 'function') return;
      const marker = `__indigoParallelLifecycle_${methodName}`;
      if (citeproc[marker]) return;
      citeproc[marker] = true;

      const self = this;
      citeproc[methodName] = function (...args) {
        self._logParallelLifecycle(citeproc, `${methodName}:before`, args);
        try {
          const result = orig.apply(this, args);
          self._logParallelLifecycle(citeproc, `${methodName}:after`, args, result);
          return result;
        } catch (e) {
          self._logParallelLifecycle(citeproc, `${methodName}:error`, args, e);
          throw e;
        }
      };
    };

    wrap('retrieveAllStyleModules');
    wrap('loadStyleModule');
    wrap('buildTokenLists');
    wrap('configureTokenList');
  }

  _logCiteprocEngineDetails(citeproc) {
    try {
      const ctorName = String(citeproc?.constructor?.name || 'unknown');
      const prefRs = Zotero.Prefs?.get?.('cite.useCiteprocRs');
      const parallelEnabled = citeproc?.opt?.parallel?.enable;
      const trackRepeat = Object.keys(citeproc?.opt?.track_repeat || {});
      const hasParallelTracker = !!citeproc?.parallel;
      const msg = `[Citation Phoenix] citeproc engine: ctor=${ctorName} citeprocRsPref=${String(!!prefRs)} hasParallelTracker=${String(hasParallelTracker)} parallelEnabled=${String(!!parallelEnabled)} trackRepeat=${trackRepeat.join('|') || 'none'}`;
      Zotero.debug(msg);
      Zotero.logError(msg);
    } catch (e) {}
  }

  _logParallelLifecycle(citeproc, stage, args, resultOrError = undefined) {
    try {
      const parallel = citeproc?.opt?.parallel || {};
      const trackRepeat = Object.keys(citeproc?.opt?.track_repeat || {});
      const argSummary = this._summarizeParallelLifecycleArgs(stage, args);
      let tail = '';
      if (stage.endsWith(':error')) {
        tail = ` error=${String(resultOrError)}`;
      } else if (stage.endsWith(':after')) {
        tail = ` result=${this._summarizeParallelLifecycleResult(resultOrError)}`;
      }
      const msg = `[Citation Phoenix] citeproc parallel lifecycle(${stage}): enabled=${String(!!parallel.enable)} parallelKeys=${Object.keys(parallel).join('|') || 'none'} trackRepeat=${trackRepeat.join('|') || 'none'} ${argSummary}${tail}`;
      Zotero.debug(msg);
      Zotero.logError(msg);
    } catch (e) {}
  }

  _summarizeParallelLifecycleArgs(stage, args) {
    try {
      if (stage.startsWith('retrieveAllStyleModules')) {
        return `jurisdictions=${JSON.stringify(args?.[0] || null)}`;
      }
      if (stage.startsWith('loadStyleModule')) {
        const xml = typeof args?.[1] === 'string' ? args[1] : '';
        return `jurisdiction=${String(args?.[0] || '')} hasXml=${String(!!xml)} xmlParallelAttrs=${String(/parallel-(first|last|last-to-first|delimiter-override)\s*=/.test(xml))} skipFallback=${String(!!args?.[2])}`;
      }
      if (stage.startsWith('buildTokenLists')) {
        const node = args?.[0];
        const target = args?.[1];
        const nodeName = String(node?.name || node?.nodeName || node?.tokentype || '');
        const targetKeys = target && typeof target === 'object' ? Object.keys(target).slice(0, 6).join('|') : 'none';
        return `node=${nodeName || 'unknown'} targetKeys=${targetKeys}`;
      }
      if (stage.startsWith('configureTokenList')) {
        const tokens = args?.[0];
        const tokenCount = Array.isArray(tokens) ? tokens.length : -1;
        const tokenNames = Array.isArray(tokens) ? tokens.slice(0, 5).map((token) => String(token?.name || token?.tokentype || '')).join('|') : 'none';
        return `tokenCount=${String(tokenCount)} tokenNames=${tokenNames || 'none'}`;
      }
    } catch (e) {}
    return 'args=unavailable';
  }

  _summarizeParallelLifecycleResult(result) {
    if (Array.isArray(result)) return `array(${result.length})`;
    if (result && typeof result === 'object') return `object(${Object.keys(result).slice(0, 6).join('|')})`;
    return String(result);
  }

  _logJurisdictionModuleLoad(hookName, jurisdiction, variantName, xml) {
    try {
      const hasParallelFirst = /parallel-first\s*=/.test(xml);
      const hasParallelLast = /parallel-last\s*=/.test(xml);
      const hasParallelLastToFirst = /parallel-last-to-first\s*=/.test(xml);
      const hasParallelDelimiter = /parallel-delimiter-override\s*=/.test(xml);
      const msg = `[Citation Phoenix] jurisdiction module(${hookName}): jurisdiction=${String(jurisdiction || '')} variant=${String(variantName || '')} parallel-first=${String(hasParallelFirst)} parallel-last=${String(hasParallelLast)} parallel-last-to-first=${String(hasParallelLastToFirst)} parallel-delimiter=${String(hasParallelDelimiter)}`;
      Zotero.debug(msg);
      Zotero.logError(msg);
    } catch (e) {}
  }

  _logCitationBranchProbe(methodName, citation) {
    try {
      const items = this._extractCitationItems(citation);
      if (!Array.isArray(items) || !items.length) return;

      for (const citationItem of items) {
        const itemID = citationItem?.id ?? citationItem?.itemID ?? citationItem?.itemId ?? null;
        const pos = citationItem?.position;
        const nearNote = !!(citationItem?.['near-note'] || citationItem?.nearNote);
        const hasLocator = citationItem?.locator != null && String(citationItem.locator).trim() !== '';
        const label = String(citationItem?.label || '');

        let branch = 'full';
        if (pos === 2 || pos === 'ibid-with-locator') branch = 'ibid-with-locator';
        else if (pos === 1 || pos === 'ibid') branch = 'ibid';
        else if (nearNote || pos === 3 || pos === 'subsequent') branch = 'short';

        const msg = `[Citation Phoenix] renderProbe citeproc(${methodName}): branch=${branch} position=${String(pos)} near-note=${String(nearNote)} locator=${String(citationItem?.locator || '')} label=${label} has-locator=${String(hasLocator)} itemID=${String(itemID)}`;
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
      this._logCitationRequestPayload(methodName, items, args);
      const ids = items
        .map((citationItem) => citationItem?.id ?? citationItem?.itemID ?? citationItem?.itemId ?? null)
        .filter((id) => id != null)
        .map((id) => String(id))
        .join(',');
      Zotero.debug(`[Citation Phoenix] renderProbe citeproc start(${methodName}): args=${String(args?.length || 0)} ids=${ids || 'none'}`);
    } catch (e) {}
  }

  _logCiteprocMethodEnd(methodName, result) {
    try {
      let shape = typeof result;
      if (Array.isArray(result)) shape = `array(${result.length})`;
      if (result && typeof result === 'object' && !Array.isArray(result)) {
        shape = `object(${Object.keys(result).slice(0, 6).join('|')})`;
      }
      Zotero.debug(`[Citation Phoenix] renderProbe citeproc end(${methodName}): result=${shape}`);
    } catch (e) {}
  }

  _logCiteprocMethodError(methodName, error) {
    try {
      const msg = `[Citation Phoenix] renderProbe citeproc error(${methodName}): ${String(error)} stack=${String(error?.stack || '')}`;
      Zotero.debug(msg);
      Zotero.logError(msg);
    } catch (e) {}
  }

  _instrumentParallelTracker(citeproc) {
    try {
      const startCitation = citeproc?.parallel?.StartCitation;
      if (typeof startCitation !== 'function') return;
      if (citeproc.parallel.__indigoStartCitationInstrumented) return;
      citeproc.parallel.__indigoStartCitationInstrumented = true;

      const self = this;
      citeproc.parallel.StartCitation = function (...args) {
        try {
          self._logParallelStartCitation(args?.[0], this?.state);
        } catch (e) {}
        return startCitation.apply(this, args);
      };
    } catch (e) {}
  }

  _logCitationItemData(cslItem, zotItem, stage) {
    if (this._citationDataLogCount >= this._maxCitationDataLogs) return;
    this._citationDataLogCount += 1;
    try {
      const payload = {
        id: cslItem?.id ?? null,
        zoteroID: zotItem?.id ?? null,
        key: zotItem?.key ?? null,
        type: cslItem?.type ?? null,
        title: cslItem?.title ?? null,
        jurisdiction: cslItem?.jurisdiction ?? null,
        authority: cslItem?.authority ?? null,
        recipient: Array.isArray(cslItem?.recipient) ? cslItem.recipient : [],
        note: cslItem?.note ?? null,
        version: cslItem?.version ?? null,
        edition: cslItem?.edition ?? null,
        'container-title': cslItem?.['container-title'] ?? null,
        'container-title-short': cslItem?.['container-title-short'] ?? null,
        'title-short': cslItem?.['title-short'] ?? null,
        seeAlso: Array.isArray(cslItem?.seeAlso) ? cslItem.seeAlso : [],
      };
      const msg = `[Citation Phoenix] citation itemData[${this._citationDataLogCount}] ${stage}: ${JSON.stringify(payload)}`;
      Zotero.debug(msg);
      Zotero.logError(msg);
    } catch (e) {}
  }

  _logCitationRequestPayload(methodName, items, args) {
    if (!Array.isArray(items) || !items.length) return;
    if (this._citationDataLogCount >= this._maxCitationDataLogs) return;
    try {
      const payload = items.map((citationItem) => ({
        id: citationItem?.id ?? citationItem?.itemID ?? citationItem?.itemId ?? null,
        locator: citationItem?.locator ?? null,
        label: citationItem?.label ?? null,
        position: citationItem?.position ?? null,
        'near-note': citationItem?.['near-note'] ?? citationItem?.nearNote ?? null,
        prefix: citationItem?.prefix ?? null,
        suffix: citationItem?.suffix ?? null,
      }));
      const msg = `[Citation Phoenix] citation request(${methodName}): items=${JSON.stringify(payload)} arg-shape=${String(args?.length || 0)}`;
      Zotero.debug(msg);
      Zotero.logError(msg);
    } catch (e) {}
  }

  _logParallelStartCitation(sortedItems, state) {
    if (!Array.isArray(sortedItems) || !sortedItems.length) return;
    try {
      const payload = sortedItems.map((entry) => ({
        item: {
          id: entry?.[0]?.id ?? null,
          title: entry?.[0]?.title ?? null,
          authority: this._summarizeParallelValue(entry?.[0]?.authority),
          number: this._summarizeParallelValue(entry?.[0]?.number),
          seeAlso: Array.isArray(entry?.[0]?.seeAlso) ? entry[0].seeAlso : [],
        },
        citationItem: {
          id: entry?.[1]?.id ?? entry?.[1]?.itemID ?? entry?.[1]?.itemId ?? null,
          locator: entry?.[1]?.locator ?? null,
          position: entry?.[1]?.position ?? null,
          parallel: entry?.[1]?.parallel ?? null,
        },
      }));
      const suppressRepeats = Array.isArray(state?.tmp?.suppress_repeats) ? state.tmp.suppress_repeats : [];
      const msg = `[Citation Phoenix] parallel StartCitation: sortedItems=${JSON.stringify(payload)} suppressRepeats=${JSON.stringify(suppressRepeats)}`;
      Zotero.debug(msg);
      Zotero.logError(msg);
    } catch (e) {}
  }

  _summarizeParallelValue(value) {
    if (value == null) return null;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }
    if (Array.isArray(value)) {
      return value.map((entry) => this._summarizeParallelValue(entry));
    }
    if (typeof value === 'object') {
      const out = {};
      for (const key of ['literal', 'family', 'given', 'name', 'year']) {
        if (value[key] != null) out[key] = value[key];
      }
      if (Object.keys(out).length) return out;
      return JSON.stringify(value);
    }
    return String(value);
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
      Zotero.debug(`[Citation Phoenix] Sync style fallback unavailable: ${reason}. Preload style XML during activation.`);
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
