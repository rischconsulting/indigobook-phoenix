export class PrefsUI {
  constructor({ pluginID, rootURI }) {
    this.pluginID = pluginID;
    this.rootURI = rootURI;
    this._paneID = null;
    this._registerTimer = null;
    this._registerAttempts = 0;
    this._maxRegisterAttempts = 20;
  }

  async register() {
    this._registerAttempts = 0;
    await this._tryRegister();
  }

  async _tryRegister() {
    try {
      if (this._paneID) return;

      if (!Zotero?.PreferencePanes?.register) {
        this._scheduleRetry('PreferencePanes service not ready');
        return;
      }

      const spec = this.rootURI?.spec || String(this.rootURI || '');
      const base = spec.endsWith('/') ? spec : `${spec}/`;

      const pane = await Zotero.PreferencePanes.register({
        pluginID: this.pluginID,
        src: `${base}content/prefs-abbrev.xhtml`,
        scripts: [`${base}content/prefs-abbrev.js`],
        stylesheets: [`${base}content/prefs-abbrev.css`],
        label: 'IndigoBook CSL-M',
        image: `${base}content/ui/icon48.svg`,
      });

      this._paneID = pane?.id || pane || null;
      try {
        Zotero.debug(`[IndigoBook CSL-M] prefs pane registered: paneID=${String(this._paneID)}`);
      } catch (_) {}
    } catch (e) {
      try { Zotero.logError(e); } catch (_) {}
      try { Zotero.debug(`[IndigoBook CSL-M] prefs pane register failed: ${String(e)}`); } catch (_) {}
      this._scheduleRetry(String(e));
    }
  }

  _scheduleRetry(reason) {
    if (this._registerAttempts >= this._maxRegisterAttempts) {
      try { Zotero.debug(`[IndigoBook CSL-M] prefs pane registration gave up after ${this._registerAttempts} attempts: ${reason}`); } catch (_) {}
      return;
    }

    this._registerAttempts += 1;
    if (this._registerTimer) clearTimeout(this._registerTimer);
    this._registerTimer = setTimeout(async () => {
      this._registerTimer = null;
      try {
        await this._tryRegister();
      } catch (e) {
        try { Zotero.logError(e); } catch (_) {}
      }
    }, 1000);
  }

  unregister() {
    try {
      if (this._registerTimer) {
        clearTimeout(this._registerTimer);
        this._registerTimer = null;
      }
      if (!this._paneID) return;
      if (Zotero?.PreferencePanes?.unregister) {
        try {
          Zotero.debug(`[IndigoBook CSL-M] prefs pane unregistering: paneID=${String(this._paneID)}`);
        } catch (_) {}
        Zotero.PreferencePanes.unregister(this._paneID);
        try {
          Zotero.debug(`[IndigoBook CSL-M] prefs pane unregistered: paneID=${String(this._paneID)}`);
        } catch (_) {}
      }
    } catch (e) {
      try { Zotero.logError(e); } catch (_) {}
    } finally {
      this._paneID = null;
    }
  }
}
