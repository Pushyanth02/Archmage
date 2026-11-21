#!/usr/bin/env python3
"""Crop pixel-art previews from the deployed v3.1 atlases.

Generates public/assets/v31/preview/*.png — the idle/down frame 0 of every
combatant sheet plus one 128×128 biome ground tile per tileset family —
using integer scales only (2× block density, nearest-neighbor, hard #140E1D
outer ink where a margin exists). These are the Codex / Vault / Runes
preview sprites; gameplay renders from the same atlases, so menu and combat
art are identical by construction.
"""
from PIL import Image
import json
import os

ROOT = os.path.join(os.path.dirname(__file__), "..")
SPRITES = os.path.join(ROOT, "public", "assets", "v31", "sprites")
TILESETS = os.path.join(ROOT, "public", "assets", "v31", "tilesets")
OUT = os.path.join(ROOT, "public", "assets", "v31", "preview")
os.makedirs(OUT, exist_ok=True)

INK = (20, 14, 29, 255)  # #140E1D


def crop_idle(asset_id: str, folder: str, out_name: str, scale: int = 2) -> bool:
    """Crop frame 0 of the idle/down animation, scale it, save."""
    mpath = os.path.join(folder, f"{asset_id}.json")
    ppath = os.path.join(folder, f"{asset_id}.png")
    if not (os.path.exists(mpath) and os.path.exists(ppath)):
        print(f"  MISSING {asset_id}")
        return False
    m = json.load(open(mpath))
    anim = None
    for a in m.get("animations", []):
        if a.get("state") == "idle" and a.get("direction") in ("down", None):
            anim = a
            break
    if anim is None:  # any down-facing anim as fallback
        for a in m.get("animations", []):
            if a.get("direction") in ("down", None):
                anim = a
                break
    if anim is None:
        print(f"  NO ANIM {asset_id}")
        return False
    row = anim.get("row", 0)
    fw, fh = m.get("frameWidth", 64), m.get("frameHeight", 64)
    sheet = Image.open(ppath).convert("RGBA")
    x, y = 0, row * fh
    frame = sheet.crop((x, y, x + fw, y + fh))
    # integer-scale, nearest neighbor
    frame = frame.resize((fw * scale, fh * scale), Image.NEAREST)
    frame.save(os.path.join(OUT, f"{out_name}.png"))
    return True


def crop_tileset(family: str) -> bool:
    """One representative ground tile (row 0, col 1) at 2× for the biome gallery."""
    ppath = os.path.join(TILESETS, f"tileset_{family}.png")
    if not os.path.exists(ppath):
        print(f"  MISSING tileset_{family}")
        return False
    sheet = Image.open(ppath).convert("RGBA")
    fw = fh = 64
    # row 0 "floor_tiles" — column 1 (a plain flagstone variant)
    frame = sheet.crop((fw, 0, fw * 2, fh)).resize((fw * 2, fh * 2), Image.NEAREST)
    frame.save(os.path.join(OUT, f"biome_{family}.png"))
    return True


made = 0
print("== combatant previews (idle/down frame 0, 2x) ==")
enemies = ["skeleton_warrior", "cultist_acolyte", "shieldbone_knight", "necromancer",
           "wraith", "bone_archer", "plaguebearer", "flesh_construct"]
bosses = ["bone_regent", "rift_leviathan", "blight_colossus"]
mages = ["stormcaller", "pyromancer", "cryomancer", "voidweaver", "aethermancer", "chronomancer"]
for e in enemies:
    if crop_idle(f"enemy_{e}", SPRITES, f"enemy_{e}"):
        made += 1
for b in bosses:
    if crop_idle(f"boss_{b}", SPRITES, f"boss_{b}", scale=2):
        made += 1
for mg in mages:
    if crop_idle(f"mage_{mg}", SPRITES, f"mage_{mg}"):
        made += 1
print("== biome tiles ==")
for fam in ["cursed_grove", "undead_crypt", "blighted_marsh"]:
    if crop_tileset(fam):
        made += 1
print(f"done: {made} previews -> {OUT}")
