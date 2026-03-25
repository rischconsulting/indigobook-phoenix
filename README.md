# IndigoBook-Phoenix (Zotero 8) - v0.4.0

This plugin bundles US IndigoTemp jurisdiction modules and uses dynamic module loading via
`sys.loadJurisdictionStyle(jurisdiction, variantName)` so multiple US jurisdictions can appear in one document.

It also patches citeproc item retrieval/abbreviation behavior and keeps case metadata synchronized with Juris-M-style
`mlzsync1` data stored in Extra.

## How Jurisdiction And Court Fields Work

The jurisdiction/court logic is focused on Zotero items of type `case`.

### Jurisdiction Source And Storage

- Jurisdiction is read first from `Extra` -> `mlzsync1` JSON (`extrafields.jurisdiction`).
- If no MLZ jurisdiction is present, fallback parsing checks `jurisdiction: ...` key/value lines in Extra.
- If nothing is found, jurisdiction defaults to `us`.
- Jurisdiction values are normalized to lowercase chain form (for example, `us`, `us:ca`, `us:ny`).
- When saved to MLZ, jurisdiction is written in length-prefixed format expected by Juris-M sync payloads.

### Case Item Pane Behavior

- A custom `Jurisdiction` row is rendered in the Info pane for case items.
- The existing `Court` row is also patched for case items.
- Jurisdiction options come from the auto-US place map and are shown in display form.
- Court options are built from institution-part abbreviations for the selected jurisdiction, including child jurisdictions.
- Choosing a child-jurisdiction court updates both:
	- MLZ jurisdiction in `Extra`
	- Zotero `court` field key

### Jurisdiction and Court Matching on Import
New in version 0.3.0, the plugin will attempt to discern the jurisdiction and court and assign proper jurisdiction and court codes to them to reduce time spent recoding.

### Synchronization Rules

On item add/modify/select/render events, the plugin syncs case fields and MLZ payload values:

- `reporter` field <-> `mlzsync1.extrafields.reporter`
- `court` field <-> `mlzsync1.extrafields.court` (normalized key)
- derived jurisdiction -> `mlzsync1.extrafields.jurisdiction`

The Zotero-facing `reporter` and `court` fields are treated as authoritative when populated. Blank fields are backfilled
from MLZ data when available.

### Citation Pipeline Effects

During citeproc item retrieval, the plugin decorates CSL JSON with:

- `jurisdiction` from the case item/MLZ data
- `country` derived from the jurisdiction root token
- `authority` based on the Zotero `court` field (normalized)

This is what drives jurisdiction-specific legal style module behavior at render time.

## Journal Abbreviations And Preferences Panel

### Journal Abbreviation Resolution

Journal abbreviations are primarily resolved from `container-title` values.

Lookup order is:

1. Primary jurisdiction data (`data/primary-us.json`) for the current jurisdiction chain.
2. Secondary journal table (`data/secondary-us-bluebook.json`).
3. User journal overrides saved from the Preferences panel.
4. Fallback word-based abbreviation logic when no table hit is found.

Normalization behavior:

- Keys are normalized (trimmed, lowercased, punctuation-normalized) before lookup.
- Canonical dotted initialisms (for example, `U.S.C.`) are preserved and not rewritten by fallback logic.

### Preferences Panel Overview

The plugin registers a Zotero preferences pane labeled `IndigoBook CSL-M`.

Pane location and assets:

- `content/prefs-abbrev.xhtml`
- `content/prefs-abbrev.js`
- `content/prefs-abbrev.css`

The panel supports two working modes via dataset selection:

- Journals mode (`journals:secondary-us-bluebook`, `journals:secondary-science`)
- Jurisdiction mode (`primary-us`, `auto-us`, `juris-us-map`)

### What You Can Do In The Panel

- Filter rows with the search box.
- Click any Value cell to edit inline.
- Save an override for a base row.
- Revert a user override back to base data.
- Add or update entries with the Add/Update row.
- Reset overrides for the active mode/dataset.

### How Overrides Are Stored

- Journal overrides are persisted in pref key:
	- `extensions.indigobook-cslm.secondaryContainerTitleOverrides`
- Jurisdiction overrides are persisted in pref key:
	- `extensions.indigobook-cslm.jurisdictionOverrides`

These persisted overrides are exposed through `Zotero.IndigoBookCSLMBridge` and are applied at citation time by the abbreviation service.

## Build And Package

### Prerequisite

Install `esbuild` at the path used by the scripts:

- `c:\esbuild\esbuild.exe`

### Bundle Only

Use this to regenerate only the runtime bundle:

```powershell
./build.ps1
```

This rebuilds:

- `content/indigobook-cslm.js`

### Canonical Build + Package

Use this as the main workflow:

```powershell
./package-xpi.ps1
```

What it does:

1. Builds `content/indigobook-cslm.js` with esbuild.
2. Creates a package name from `manifest.json` (`name` + `version`) when available.
3. Archives plugin files while excluding helper scripts (`.ps1`, `.bat`) and VCS output artifacts.
4. Produces a final `.xpi` in the project root.

Typical output files:

- `<slug>-<version>.xpi`

Optional custom output base name:

```powershell
./package-xpi.ps1 -OutputBaseName "my-build-name"
```

### PowerShell Execution Policy Note

If script execution is blocked, run with a process-scoped bypass:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass; ./package-xpi.ps1
```

## Install In Zotero

Install the generated `.xpi` in Zotero's add-ons UI.

## Project Files

- `style-modules/` contains CSL-M IndigoTemp modules.
- `data/` contains abbreviation and jurisdiction datasets.
- `lib/` contains source modules.
- `content/indigobook-cslm.js` is the bundled runtime script loaded by `bootstrap.js`.
