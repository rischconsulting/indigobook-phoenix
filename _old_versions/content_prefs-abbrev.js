(function () {
  let initialized = false;
  let initAttempts = 0;
  const HTML_NS = 'http://www.w3.org/1999/xhtml';

  function byId(id) {
    return document.getElementById(id);
  }

  function createHTML(tagName) {
    return document.createElementNS(HTML_NS, tagName);
  }

  function debug(message) {
    try {
      Zotero.debug(`[IndigoBook CSL-M] ${message}`);
    } catch (_) {}
  }

  function getBridge() {
    return Zotero?.IndigoBookCSLMBridge || null;
  }

  function getDatasetSelection() {
    const raw = (byId('ibcslm-dataset')?.value || '').toString();
    const parts = raw.split(':');
    if (parts.length < 2) return { kind: 'journals', dataset: 'secondary-us-bluebook' };
    const kind = parts[0];
    const dataset = parts.slice(1).join(':');
    return { kind, dataset };
  }

  function isJournalMode() {
    return getDatasetSelection().kind === 'journals';
  }

  function hasPaneDOM() {
    return !!byId('ibcslm-prefpane') && !!byId('ibcslm-body') && !!byId('ibcslm-dataset');
  }

  function setStatus(message, isError) {
    const el = byId('ibcslm-status');
    if (!el) return;
    el.textContent = message || '';
    el.style.color = isError ? '#a40000' : '';
  }

  function applyModeClass() {
    const root = byId('ibcslm-prefpane');
    if (!root) return;
    root.classList.toggle('mode-journal', isJournalMode());

    const search = byId('ibcslm-search');
    if (search) {
      search.placeholder = isJournalMode()
        ? 'Filter journal abbreviations'
        : 'Filter jurisdiction rows';
    }
  }

  function getAllRowsForSelectedDataset() {
    const bridge = getBridge();
    if (!bridge) return [];
    const selection = getDatasetSelection();

    if (selection.kind === 'journals') {
      const rows = bridge.listSecondaryAbbreviations?.() || [];
      return rows.map((row) => ({
        kind: 'journals',
        dataset: selection.dataset,
        jurisdiction: '',
        category: 'container-title',
        key: row.key,
        value: row.value,
        source: row.source,
      }));
    }

    const all = bridge.listJurisdictionPreferenceEntries?.() || [];
    return all
      .filter((row) => row.dataset === selection.dataset)
      .map((row) => ({ ...row, kind: 'jurisdiction' }));
  }

  function getFilteredRows() {
    const all = getAllRowsForSelectedDataset();
    const q = (byId('ibcslm-search')?.value || '').trim().toLowerCase();
    if (!q) return all;
    return all.filter((row) => {
      return String(row.jurisdiction || '').toLowerCase().includes(q)
        || String(row.category || '').toLowerCase().includes(q)
        || String(row.key || '').toLowerCase().includes(q)
        || String(row.value || '').toLowerCase().includes(q)
        || String(row.source || '').toLowerCase().includes(q);
    });
  }

  function getCellCurrentValue(td, fallback) {
    const activeInput = td.querySelector('input');
    if (activeInput) return activeInput.value;
    const activeButton = td.querySelector('button');
    if (activeButton) return activeButton.textContent || '';
    return fallback || '';
  }

  function saveRowValue(row, value) {
    const bridge = getBridge();
    if (!bridge) return false;

    if (row.kind === 'journals') {
      return !!bridge.upsertSecondaryAbbreviation?.(row.key, value);
    }

    return !!bridge.upsertJurisdictionPreferenceEntry?.(
      row.dataset,
      row.jurisdiction,
      row.category,
      row.key,
      value,
    );
  }

  function removeRowOverride(row) {
    const bridge = getBridge();
    if (!bridge) return false;

    if (row.kind === 'journals') {
      return !!bridge.removeSecondaryAbbreviation?.(row.key);
    }

    return !!bridge.removeJurisdictionPreferenceEntry?.(
      row.dataset,
      row.jurisdiction,
      row.category,
      row.key,
    );
  }

  function makeValueEditorCell(row) {
    const tdVal = createHTML('td');
    tdVal.className = 'cell-value';

    const valueButton = createHTML('button');
    valueButton.type = 'button';
    valueButton.className = 'ibcslm-inline-value';
    valueButton.textContent = row.value || '';
    valueButton.title = 'Click to edit value';

    const startEdit = () => {
      tdVal.textContent = '';
      const input = createHTML('input');
      input.type = 'text';
      input.value = row.value || '';
      input.className = 'ibcslm-inline-input';

      const finish = (commit) => {
        if (!tdVal.contains(input)) return;
        if (!commit) {
          tdVal.textContent = '';
          tdVal.appendChild(valueButton);
          return;
        }
        const ok = saveRowValue(row, input.value);
        setStatus(ok ? 'Saved.' : 'Could not save value.', !ok);
        if (ok) refresh();
        if (!ok) {
          input.focus();
          input.select();
        }
      };

      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          finish(true);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          finish(false);
        }
      });
      input.addEventListener('blur', () => finish(true), { once: true });

      tdVal.appendChild(input);
      input.focus();
      input.select();
    };

    valueButton.addEventListener('click', startEdit);
    tdVal.appendChild(valueButton);
    return tdVal;
  }

  function renderRows(rows) {
    const tbody = byId('ibcslm-body');
    if (!tbody) return;
    tbody.textContent = '';

    for (const row of rows) {
      const tr = createHTML('tr');

      const tdJur = createHTML('td');
      tdJur.className = 'cell-jur';
      tdJur.textContent = row.jurisdiction || '';

      const tdCat = createHTML('td');
      tdCat.className = 'cell-cat';
      tdCat.textContent = row.category || '';

      const tdKey = createHTML('td');
      tdKey.className = 'ibcslm-key';
      tdKey.textContent = row.key || '';

      const tdVal = makeValueEditorCell(row);

      const tdActions = createHTML('td');
      const btn = createHTML('button');
      btn.type = 'button';
      btn.textContent = row.source === 'user' ? 'Revert' : 'Override';
      btn.addEventListener('click', () => {
        if (row.source === 'user') {
          const ok = removeRowOverride(row);
          setStatus(ok ? 'Override removed.' : 'Could not remove override.', !ok);
          if (ok) refresh();
          return;
        }

        const currentValue = getCellCurrentValue(tdVal, row.value);
        const ok = saveRowValue(row, currentValue);
        setStatus(ok ? 'Override saved.' : 'Could not save override.', !ok);
        if (ok) refresh();
      });
      tdActions.appendChild(btn);

      tr.appendChild(tdJur);
      tr.appendChild(tdCat);
      tr.appendChild(tdKey);
      tr.appendChild(tdVal);
      tr.appendChild(tdActions);
      tbody.appendChild(tr);
    }

    debug(`prefs pane rendered ${rows.length} rows`);
  }

  function setAddDefaults() {
    const jurEl = byId('ibcslm-j-jur');
    const catEl = byId('ibcslm-j-cat');
    if (!jurEl || !catEl) return;

    const selection = getDatasetSelection();
    if (selection.kind === 'journals') {
      jurEl.value = '';
      catEl.value = '';
      return;
    }

    if (selection.dataset === 'primary-us') {
      if (!jurEl.value) jurEl.value = 'us';
      if (!catEl.value) catEl.value = 'container-title';
      return;
    }

    if (selection.dataset === 'auto-us') {
      if (!jurEl.value) jurEl.value = 'default';
      if (!catEl.value) catEl.value = 'place';
      return;
    }

    if (selection.dataset === 'juris-us-map') {
      if (!jurEl.value) jurEl.value = 'default';
      if (!catEl.value) catEl.value = 'courts';
    }
  }

  function resetOverridesForCurrentDataset() {
    const bridge = getBridge();
    if (!bridge) return false;
    const selection = getDatasetSelection();

    if (selection.kind === 'journals') {
      bridge.resetSecondaryAbbreviations?.();
      return true;
    }

    bridge.resetJurisdictionPreferenceOverrides?.();
    return true;
  }

  function refresh() {
    const bridge = getBridge();
    if (!bridge) {
      renderRows([]);
      setStatus('Bridge unavailable. Restart Zotero after installing/updating the plugin.', true);
      debug('prefs pane refresh failed: bridge unavailable');
      return;
    }

    applyModeClass();
    setAddDefaults();

    const rows = getFilteredRows();
    renderRows(rows);

    const selection = getDatasetSelection();
    const dsLabel = selection.kind === 'journals'
      ? `journals (${selection.dataset})`
      : `jurisdiction (${selection.dataset})`;

    if (!rows.length) {
      setStatus(`No rows matched in ${dsLabel}.`, false);
    } else {
      setStatus(`Loaded ${rows.length} rows from ${dsLabel}.`, false);
    }
  }

  function handleAddOrUpdate() {
    const bridge = getBridge();
    if (!bridge) return;

    const keyEl = byId('ibcslm-j-key');
    const valueEl = byId('ibcslm-j-value');
    const jurEl = byId('ibcslm-j-jur');
    const catEl = byId('ibcslm-j-cat');

    const key = keyEl?.value || '';
    const value = valueEl?.value || '';
    const jurisdiction = jurEl?.value || '';
    const category = catEl?.value || '';

    const selection = getDatasetSelection();
    let ok = false;

    if (selection.kind === 'journals') {
      ok = !!bridge.upsertSecondaryAbbreviation?.(key, value);
      if (!ok) {
        setStatus('Enter both key and value for journal overrides.', true);
        return;
      }
    } else {
      ok = !!bridge.upsertJurisdictionPreferenceEntry?.(
        selection.dataset,
        jurisdiction,
        category,
        key,
        value,
      );
      if (!ok) {
        setStatus('Enter jurisdiction, category, key, and value.', true);
        return;
      }
    }

    if (keyEl) keyEl.value = '';
    if (valueEl) valueEl.value = '';
    if (selection.kind !== 'journals') {
      if (jurEl) jurEl.value = '';
      if (catEl) catEl.value = '';
    }

    setStatus('Value saved.', false);
    refresh();
  }

  function bindEvents() {
    byId('ibcslm-dataset')?.addEventListener('change', refresh);
    byId('ibcslm-search')?.addEventListener('input', refresh);
    byId('ibcslm-add')?.addEventListener('click', handleAddOrUpdate);
    byId('ibcslm-reset')?.addEventListener('click', () => {
      const ok = resetOverridesForCurrentDataset();
      setStatus(ok ? 'Overrides reset.' : 'Could not reset overrides.', !ok);
      if (ok) refresh();
    });
  }

  function init() {
    if (initialized) return;
    if (!hasPaneDOM()) {
      debug(`prefs pane init deferred: DOM not ready (attempt ${initAttempts + 1})`);
      scheduleInit();
      return;
    }
    initialized = true;
    debug('prefs pane init');
    bindEvents();
    refresh();
  }

  function scheduleInit() {
    if (initialized) return;
    initAttempts += 1;
    if (initAttempts > 20) {
      debug('prefs pane init gave up waiting for DOM');
      return;
    }
    setTimeout(init, 50);
  }

  scheduleInit();
})();
