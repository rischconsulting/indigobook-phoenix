// Services is available as a global in the Zotero extension bootstrap context.

function logError(prefix, e) {
  try { Zotero.logError(e); } catch (_) {}
  try { Zotero.debug(prefix + ": " + e); } catch (_) {}
}

async function startup({ id, version, rootURI }, reason) {
  try {
    // 1) Normalize rootURI into a string base
    var base = (rootURI && typeof rootURI === "object" && rootURI.spec)
      ? rootURI.spec
      : String(rootURI);

    // Ensure trailing slash
    if (base.slice(-1) !== "/") base += "/";

    // 2) Provide an object with .spec so your DataStore works unchanged
    var root = { spec: base };

    // 3) Load your bundled classic script
    var scope = { Zotero, rootURI: root };
    Services.scriptloader.loadSubScript(base + "content/indigobook-cslm.js", scope);

    // 4) Grab the global produced by esbuild --global-name
    Zotero.IndigoBookCSLM = scope.IndigoBookCSLM;

    if (!Zotero.IndigoBookCSLM || typeof Zotero.IndigoBookCSLM.activate !== "function") {
      throw new Error("Bundle loaded but IndigoBookCSLM.activate not found");
    }

    // 5) Activate using the root object (with .spec)
    await Zotero.IndigoBookCSLM.activate({ id, version, rootURI: root });
  } catch (e) {
    logError("IndigoBook CSL-M plugin startup failed", e);
  }
}



async function shutdown({ id }, reason) {
  try {
    if (Zotero?.IndigoBookCSLM?.deactivate) {
      await Zotero.IndigoBookCSLM.deactivate();
    }
  } catch (e) {
    logError("IndigoBook CSL-M plugin shutdown failed", e);
  } finally {
    try { delete Zotero.IndigoBookCSLM; } catch (_) {}
  }
}



function install() {}
function uninstall() {}
