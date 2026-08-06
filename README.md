# Citation-Phoenix (Zotero 8, 9, 10) - v0.8.3

Now multi-jurisdictional.

This plugin bundles Juris-M style modules and uses dynamic module loading via
`sys.loadJurisdictionStyle(jurisdiction, variantName)` so multiple jurisdictions and module variants can appear in one document.

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

### Bundled translators
New in version 0.4.0, working Westlaw and Lexis+ translators. These have not been merged into Zotero 8 or 9 for a variety of reasons, including my laziness in getting them compliant.

### Synchronization Rules

On item add/modify/select/render events, the plugin syncs case fields and MLZ payload values:

- `reporter` field <-> `mlzsync1.extrafields.reporter`
- `court` field <-> `mlzsync1.extrafields.court` (normalized key)
- derived jurisdiction -> `mlzsync1.extrafields.jurisdiction`

The Zotero-facing `reporter` and `court` fields are treated as authoritative when populated. Blank fields are backfilled
from MLZ data when available.

For `case` items, the creator-type dropdown is extended with a plugin-managed `Commenter` option. Commenter names are stored in `Extra` -> `mlzsync1.extracreators` using Juris-M creator payloads, for example:

- `{"firstName":"I.","lastName":"Karollus","creatorType":"commenter"}`
- `{"name":"Wilhelm","creatorType":"commenter"}`

The same dropdown also includes a plugin-managed `Translator` option. Translator names are stored in `Extra` -> `mlzsync1.extracreators` using Juris-M creator payloads, for example:

- `{"firstName":"Jane","lastName":"Doe","creatorType":"translator"}`
- `{"name":"Jane Doe","creatorType":"translator"}`

### Citation Pipeline Effects

During citeproc item retrieval, the plugin decorates CSL JSON with:

- `jurisdiction` from the case item/MLZ data
- `country` derived from the jurisdiction root token
- `authority` based on the Zotero `court` field (normalized)
- `commenter` from `mlzsync1.extracreators`
- `translator` from `mlzsync1.extracreators`

This is what drives jurisdiction-specific legal style module behavior at render time.

## Journal Abbreviations And Preferences Panel

### Journal Abbreviation Resolution

Journal abbreviations are primarily resolved from `container-title` values.

Lookup order is:

1. Primary abbreviation table (`juris-abbrevs/primary-us.json`).
2. Secondary journal table (`juris-abbrevs/secondary-us-bluebook.json` and any other `secondary-*.json` files).
3. User journal overrides saved from the Preferences panel.
4. Fallback word-based abbreviation logic when no table hit is found.

Normalization behavior:

- Keys are normalized (trimmed, lowercased, punctuation-normalized) before lookup.
- Canonical dotted initialisms (for example, `U.S.C.`) are preserved and not rewritten by fallback logic.

### Preferences Panel Overview

The plugin registers a Zotero preferences pane labeled `Citation Phoenix`.

Pane location and assets:

- `content/prefs-abbrev.xhtml`
- `content/prefs-abbrev.js`
- `content/prefs-abbrev.css`

The panel supports two working modes via dataset selection:

- Journals mode (`journals:secondary-us-bluebook`)
- Jurisdiction mode (`juris-abbrevs/auto-us`, `juris-maps/juris-us-map`, and any other loaded jurisdiction datasets)

### What You Can Do In The Panel

- Filter rows with the search box.
- Click any Value cell to edit inline.
- Save an override for a base row.
- Revert a user override back to base data.
- Add or update entries with the Add/Update row.
- Reset overrides for the active mode/dataset.

### How Overrides Are Stored

- Journal overrides are persisted in pref key:
	- `extensions.citation-phoenix.secondaryContainerTitleOverrides`
- Jurisdiction overrides are persisted in pref key:
	- `extensions.citation-phoenix.jurisdictionOverrides`

These persisted overrides are exposed through `Zotero.CitationPhoenixBridge` and are applied at citation time by the abbreviation service.

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

- `content/citation-phoenix.js`

### Canonical Build + Package

Use this as the main workflow:

```powershell
./package-xpi.ps1
```

What it does:

1. Builds `content/citation-phoenix.js` with esbuild.
2. Creates a package name from `manifest.json` (`name` + `version`) when available.
3. Archives plugin files while excluding helper scripts (`.ps1`, `.bat`) and VCS output artifacts.
4. Produces a final `.xpi` in the project root.

Typical output files:

- `<slug>-<version>.xpi`

Optional custom output base name:

```powershell
./package-xpi.ps1 -OutputBaseName "my-build-name"
```

### Refresh Jurisdiction Assets

Use this when you want to import or refresh the Juris-M-style asset folders from their upstream source repositories:

```powershell
./scripts/sync-juris-assets.ps1
```

By default the script keeps shallow cached clones under `juris-source-cache/`, updates them, and syncs assets from:

- `Juris-M/style-modules`
- `Juris-M/legal-resource-registry` (compiled into compact `juris-maps` output and generated `auto-*.json` abbreviation datasets)
- `fbennett/mlz-abbreviations` (layered in only for hand-maintained `secondary-*` and related static abbrev files)
- `Juris-M/styles` (currently syncing `jm-*.csl`)

The repo-local `juris-abbrevs/primary-us.json` is preserved as-is for now; it does not appear to come from either
LRR or `mlz-abbreviations`.

The sync is intentionally cautious:

- missing upstream files are added
- LRR-generated `juris-maps` and `juris-abbrevs/auto-*.json` files are treated as canonical by default
- when one of those canonical generated files differs locally, the local file is backed up under `scripts/sync-juris-assets-backup/` and then replaced with the LRR-generated version
- differing files from other upstream sources are reported in `scripts/sync-juris-assets-report.json` instead of overwriting local copies

It then refreshes the generated/local metadata files and syncs content into:

- `style-modules/`
- `juris-abbrevs/`
- `juris-maps/`
- `styles/`

It accepts `-SourceCacheRoot` and `-DestinationRoot` arguments if you want to use a different cache location or sync
into another workspace. Pass `-UpdateSourceCheckout:$false` if you want to reuse the cached clones and build outputs
without refreshing them first. Pass `-PreferCanonicalGenerated:$false` if you want LRR-generated conflicts to remain
preservation-only for a run.

### Regression Harness

Use this to verify module resolution behavior after loader changes or Juris-M asset refreshes:

```powershell
node .\scripts\test-module-loader.mjs
```

The harness checks:

- exact jurisdiction + exact variant resolution
- child-to-parent fallback within a jurisdiction chain
- fallback from variant requests to plain jurisdiction modules
- default-root fallback for unknown jurisdictions

### PowerShell Execution Policy Note

If script execution is blocked, run with a process-scoped bypass:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass; ./package-xpi.ps1
```

## Install In Zotero

Install the generated `.xpi` in Zotero's add-ons UI.

## Project Files

- `style-modules/` contains CSL-M IndigoTemp modules.
- `juris-abbrevs/` contains abbreviation datasets.
- `juris-maps/` contains jurisdiction datasets.
- `data/` remains as a compatibility fallback for older path references.
- `lib/` contains source modules.
- `scripts/sync-juris-assets.ps1` keeps the folder layout aligned with Juris-M-style sources.
- `content/citation-phoenix.js` is the bundled runtime script loaded by `bootstrap.js`.
### Lightweight Regression Harnesses

Run these from the repository root with Node:

- `node .\scripts\test-module-loader.mjs`
- `node .\scripts\test-abbrev-service.mjs`

The abbreviation harness also verifies domain-sensitive auto datasets such as
French Canadian `auto-ca-fr`.
