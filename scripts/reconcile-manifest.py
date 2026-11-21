#!/usr/bin/env python3
"""Reconcile public/assets/manifests/assets.json with the v3.2 Rift Night purge.

What this does (v3.2.1):
- Drops the `dunpixel-skill-icons` pack: its 13 icons retired in the v3.2
  purge and the shipped v3.1 element icons are project-made art (verified
  byte- and perceptually-distinct from the dunpixel set), so the pack no
  longer ships anything.
- Re-points `archmage-originals` to the shipped v3.1 library files and adds
  a `archmage-v31-sheets` pack row for the animation sheets, so every pack
  file is also an assets[] entry and vice versa.
- Adds provenance-only `icon`-kind entries for the shipped v31 UI art
  (icons/relics/portraits/preview/tilesets) and the animation sheets.
  The runtime loader (src/game3d/assets.ts) skips kind "icon" entries, so
  these add provenance without extra runtime loads; the sheets load via
  v31sheets.ts as before.
- Updates the generator note.

The three third-party CC0 packs (kronbits-particles, kenney-graveyard,
kenney-particles) are untouched. Run: python3 scripts/reconcile-manifest.py
"""

import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST = os.path.join(ROOT, "public", "assets", "manifests", "assets.json")

REVIEWED = "2026-11-21"
ARCHMAGE_LICENSE = {
    "author": "Archmage contributors",
    "sourceUrl": "https://github.com/Pushyanth02/Archmage",
    "licenseId": "MIT",
    "attributionRequired": False,
    "commercialUseVerified": True,
    "licenseStatus": "verified",
    "licenseEvidenceUrl": "https://github.com/Pushyanth02/Archmage/blob/main/LICENSE",
    "licenseEvidenceType": "license-file",
    "licenseReviewer": "v3.2.1 manifest reconciliation",
    "reviewedAt": REVIEWED,
}


def shipped_pngs(subdir: str) -> list[str]:
    d = os.path.join(ROOT, "public", "assets", "v31", subdir)
    return sorted(f"v31/{subdir}/{f}" for f in os.listdir(d) if f.endswith(".png"))


def main() -> None:
    with open(MANIFEST) as f:
        m = json.load(f)

    # 1. assets[] — keep engine-loaded entries; drop nothing (the v3.2 purge
    # already removed the legacy icon/player rows).
    entries = list(m["assets"])
    seen_uris = {e["uri"] for e in entries}

    # 2. Add provenance-only icon entries for the shipped v31 art.
    ui_dirs = ["icons", "relics", "portraits", "preview", "tilesets"]
    sheet_files = shipped_pngs("sprites")
    added = []
    for sub in ui_dirs:
        for uri in shipped_pngs(sub):
            if uri in seen_uris:
                continue
            name = os.path.basename(uri)[:-4]
            entries.append({
                "id": f"icon.v31-{sub}-{name}",
                "kind": "icon",
                "uri": uri,
                "format": "png",
                "byteSize": os.path.getsize(os.path.join(ROOT, "public", "assets", uri)),
                "license": dict(ARCHMAGE_LICENSE),
            })
            seen_uris.add(uri)
            added.append(uri)
    for uri in sheet_files:
        if uri in seen_uris:
            continue
        name = os.path.basename(uri)[:-4]
        entries.append({
            "id": "icon.v31-sheets-" + name,
            "kind": "icon",
            "uri": uri,
            "format": "png",
            "byteSize": os.path.getsize(os.path.join(ROOT, "public", "assets", uri)),
            "license": dict(ARCHMAGE_LICENSE),
        })
        seen_uris.add(uri)
        added.append(uri)

    # 3. packs — drop dunpixel; re-point archmage-originals to the shipped
    # v31 files; add a v31-sheets pack row.
    packs = []
    for p in m["packs"]:
        if p["id"] == "dunpixel-skill-icons":
            continue  # retired in v3.2 — no shipped files remain
        if p["id"] == "archmage-originals":
            p = dict(p)
            p["pack"] = "ARCHMAGE originals — v3.1 pixel library (UI art)"
            p["files"] = [
                uri for uri in added
                if uri.startswith("v31/icons/") or uri.startswith("v31/relics/")
                or uri.startswith("v31/portraits/") or uri.startswith("v31/preview/")
                or uri.startswith("v31/tilesets/")
            ]
            p["reviewedAt"] = REVIEWED
        packs.append(p)

    sheet_pack = {
        "id": "archmage-v31-sheets",
        "pack": "ARCHMAGE originals — v3.1 validated sprite sheets",
        "author": "Archmage contributors",
        "sourceUrl": "https://github.com/Pushyanth02/Archmage",
        "licenseId": "MIT",
        "attributionRequired": False,
        "commercialUseVerified": True,
        "licenseStatus": "verified",
        "licenseEvidenceUrl": "https://github.com/Pushyanth02/Archmage/blob/main/LICENSE",
        "licenseEvidenceType": "license-file",
        "licenseReviewer": "v3.2.1 manifest reconciliation",
        "reviewedAt": REVIEWED,
        "files": sheet_files,
    }
    packs.append(sheet_pack)

    m["assets"] = entries
    m["packs"] = packs
    m["generator"] = (
        "ARCHMAGE: RIFT 3D asset pipeline (task 6-a; supersedes public/assets/manifest.json) "
        "(v3.2.1: packs reconciled with the Rift Night purge — dunpixel pack dropped, "
        "v3.1 library provenance added)"
    )

    with open(MANIFEST, "w") as f:
        json.dump(m, f, indent=2, ensure_ascii=False)
        f.write("\n")

    print(f"assets[]: {len(entries)} entries ({len(added)} added)")
    print(f"packs:    {len(packs)} — {[p['id'] for p in packs]}")


if __name__ == "__main__":
    main()
