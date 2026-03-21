(function () {
  let initialized = false;
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

  function setStatus(message, isError) {
    const el = byId('ibcslm-status');
    if (!el) return;
    el.textContent = message || '';
    el.style.color = isError ? '#a40000' : '';
  }

  function saveValue(key, value) {
    const bridge = getBridge();
    if (!bridge) {
      setStatus('Bridge unavailable. Restart Zotero after installing/updating the plugin.', true);
      return false;
    }
    const ok = bridge.upsertSecondaryAbbreviation(key, value);
    setStatus(ok ? 'Saved.' : 'Could not save value.', !ok);
    if (ok) refresh();
    return ok;
  }

  function makeValueEditorCell(row) {
    const tdVal = createHTML('td');
    const valueButton = createHTML('button');
    valueButton.type = 'button';
    valueButton.className = 'ibcslm-inline-value';
    valueButton.textContent = row.value || '';
    valueButton.title = 'Click to edit abbreviation';

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
        if (!saveValue(row.key, input.value)) {
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

      const tdKey = createHTML('td');
      tdKey.className = 'ibcslm-key';
      tdKey.textContent = row.key;

      const tdVal = makeValueEditorCell(row);

      const tdSource = createHTML('td');
      tdSource.className = 'ibcslm-source';
      tdSource.textContent = row.source;

      const tdActions = createHTML('td');
      const btn = createHTML('button');
      btn.type = 'button';
      btn.textContent = row.source === 'user' ? 'Revert' : 'Override';
      btn.addEventListener('click', () => {
        const bridge = getBridge();
        if (!bridge) return;
        if (row.source === 'user') {
          bridge.removeSecondaryAbbreviation(row.key);
          setStatus('Override removed.');
          refresh();
          return;
        }
        const ok = bridge.upsertSecondaryAbbreviation(row.key, input.value);
        setStatus(ok ? 'Override saved.' : 'Could not save override.', !ok);
        refresh();
      });
      tdActions.appendChild(btn);

      tr.appendChild(tdKey);
      tr.appendChild(tdVal);
      tr.appendChild(tdSource);
      tr.appendChild(tdActions);
      tbody.appendChild(tr);
    }

    debug(`prefs pane rendered ${rows.length} rows`);
  }

  function getFilteredRows() {
    const bridge = getBridge();
    if (!bridge) return [];
    const all = bridge.listSecondaryAbbreviations() || [];
    const q = (byId('ibcslm-search')?.value || '').trim().toLowerCase();
    if (!q) return all;
    return all.filter((row) => {
      return String(row.key || '').toLowerCase().includes(q)
        || String(row.value || '').toLowerCase().includes(q)
        || String(row.source || '').toLowerCase().includes(q);
    });
  }

  function refresh() {
    const bridge = getBridge();
    if (!bridge) {
      renderRows([]);
      setStatus('Bridge unavailable. Restart Zotero after installing/updating the plugin.', true);
      debug('prefs pane refresh failed: bridge unavailable');
      return;
    }
    const rows = getFilteredRows();
    renderRows(rows);
    if (!rows.length) {
      setStatus('No abbreviations matched the current filter.', false);
    } else {
      setStatus(`Loaded ${rows.length} abbreviations. Click an abbreviation to edit it.`, false);
    }
  }

  function bindEvents() {
    byId('ibcslm-search')?.addEventListener('input', refresh);

    byId('ibcslm-add')?.addEventListener('click', () => {
      const bridge = getBridge();
      if (!bridge) return;

      const keyEl = byId('ibcslm-new-key');
      const valueEl = byId('ibcslm-new-value');
      const key = keyEl?.value || '';
      const value = valueEl?.value || '';

      const ok = bridge.upsertSecondaryAbbreviation(key, value);
      if (!ok) {
        setStatus('Enter both key and abbreviation.', true);
        return;
      }

      if (keyEl) keyEl.value = '';
      if (valueEl) valueEl.value = '';
      setStatus('Abbreviation saved.');
      refresh();
    });

    byId('ibcslm-reset')?.addEventListener('click', () => {
      const bridge = getBridge();
      if (!bridge) return;
      bridge.resetSecondaryAbbreviations();
      setStatus('User overrides reset.');
      refresh();
    });
  }

  function init() {
    if (initialized) return;
    initialized = true;
    debug('prefs pane init');
    bindEvents();
    refresh();
  }

  window.addEventListener('load', init, { once: true });
  if (document.readyState !== 'loading') {
    init();
  }
})();
