# IndigoBook-Phoenix (Zotero 8) — v0.2.0

This build bundles the US IndigoTemp jurisdiction modules and implements **dynamic module loading** via
`sys.loadJurisdictionStyle(jurisdiction, variantName)` so that multiple US jurisdictions can appear in a single document.

It also injects `jurisdiction` into CSL JSON based on Juris-M MLZ JSON in Extra, and provides abbreviation lookups.

## Install
Zotero add-ons expect `.xpi`. This package is delivered as a `.zip`; rename it to `.xpi` before installing.

## Files
- style-modules/ contains the CSL-M modules (IndigoTemp)
- data/ contains abbreviation JSON datasets
