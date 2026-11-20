import * as THREE from "three";
import { assetPath } from "../lib/asset-path";

/* ARCHMAGE: RIFTBOUND — V3.1 validated sprite-sheet system.
   The v3.1 asset library (public/assets/v31/sprites) ships grid sheets
   (6 columns × N rows of square frames) + per-asset JSON manifests that
   describe every (state, direction) → row/frameCount/fps/pivot/hitbox.
   This module turns those into runtime billboards with the same surface
   the engine already drives (state/face/flash/update/faceCamera), plus
   directional art selection the old single-row sheets never had.

   Fallback contract: until a sheet finishes loading (or if it fails),
   v31Sheet() returns null and callers keep the procedural v3.0 painters
   from pixelsprites.ts — the game always renders something. */

export type V31Direction = "down" | "up" | "left" | "right";
/** Poses the engine drives; superset of the legacy SpriteState. */
export type V31Pose = "idle" | "walk" | "attack" | "cast" | "hurt" | "hit" | "death" | "blink" | "windup" | "recovery";

export interface V31AnimInfo {
  state: string;
  direction: string;
  row: number;
  frameCount: number;
  fps: number;
  loop: boolean;
  pivot: { x: number; y: number };
  hitbox: { x: number; y: number; w: number; h: number };
}

export interface V31Manifest {
  assetId: string;
  frameWidth: number;
  frameHeight: number;
  columns: number;
  rows: number;
  animations: V31AnimInfo[];
}

export interface V31Sheet {
  assetId: string;
  texture: THREE.Texture;
  manifest: V31Manifest;
  /** fraction of a frame's height occupied by the visible body
   * (pivot.y - hitbox.y) / frameHeight — used to size world planes. */
  bodyFraction: number;
  anim(state: string, direction: string): V31AnimInfo | null;
}

/* ------------------------------------------------------------------ */
/*  loading + cache                                                    */
/* ------------------------------------------------------------------ */

const sheetCache = new Map<string, V31Sheet>();
const pending = new Map<string, Promise<V31Sheet | null>>();
const IS_HEADLESS = typeof document === "undefined";

function manifestFrom(json: unknown): V31Manifest | null {
  const m = json as Partial<V31Manifest> | null;
  if (!m || typeof m.frameWidth !== "number" || typeof m.frameHeight !== "number"
    || typeof m.columns !== "number" || typeof m.rows !== "number" || !Array.isArray(m.animations)) {
    return null;
  }
  return {
    assetId: typeof m.assetId === "string" ? m.assetId : "",
    frameWidth: m.frameWidth,
    frameHeight: m.frameHeight,
    columns: m.columns,
    rows: m.rows,
    animations: m.animations.filter(a => a && typeof a.row === "number" && typeof a.frameCount === "number"),
  };
}

/** Load + cache one V3.1 sheet (PNG + JSON). `folder` selects the deploy
 *  subfolder ("sprites" combatants/vfx, "tilesets" environments). Resolves
 *  null on any failure (fetch error, parse error, headless env) — callers
 *  fall back gracefully. */
export function loadV31Sheet(assetId: string, folder: "sprites" | "tilesets" = "sprites"): Promise<V31Sheet | null> {
  const cacheKey = `${folder}/${assetId}`;
  const hit = sheetCache.get(cacheKey);
  if (hit) return Promise.resolve(hit);
  const inflight = pending.get(cacheKey);
  if (inflight) return inflight;
  if (IS_HEADLESS) return Promise.resolve(null);
  const job = (async (): Promise<V31Sheet | null> => {
    try {
      const [tex, manifestRaw] = await Promise.all([
        new Promise<THREE.Texture>((resolve, reject) => {
          new THREE.TextureLoader().load(
            assetPath(`/assets/v31/${folder}/${assetId}.png`),
            t => resolve(t),
            undefined,
            () => reject(new Error(`${assetId}.png load failed`)),
          );
        }),
        fetch(assetPath(`/assets/v31/${folder}/${assetId}.json`)).then(r => {
          if (!r.ok) throw new Error(`${assetId}.json → ${r.status}`);
          return r.json();
        }),
      ]);
      const manifest = manifestFrom(manifestRaw);
      if (!manifest) throw new Error(`${assetId}: malformed manifest`);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;
      /* body fraction from the first idle — every anim shares pivot+hitbox */
      const probe = manifest.animations.find(a => a.state === "idle") ?? manifest.animations[0];
      const bodyFraction = probe
        ? Math.max(0.25, Math.min(0.95, (probe.pivot.y - probe.hitbox.y) / manifest.frameHeight))
        : 0.6;
      const sheet: V31Sheet = {
        assetId,
        texture: tex,
        manifest,
        bodyFraction,
        anim(state, direction) {
          return manifest.animations.find(a => a.state === state && a.direction === direction)
            ?? manifest.animations.find(a => a.state === state && a.direction === "down")
            ?? null;
        },
      };
      sheetCache.set(cacheKey, sheet);
      return sheet;
    } catch (err) {
      console.warn(`[v31] sheet "${assetId}" unavailable — procedural fallback stays:`, err);
      return null;
    } finally {
      pending.delete(cacheKey);
    }
  })();
  pending.set(cacheKey, job);
  return job;
}

/** Synchronous cache probe — null until the sheet has settled. */
export function v31Sheet(assetId: string, folder: "sprites" | "tilesets" = "sprites"): V31Sheet | null {
  return sheetCache.get(`${folder}/${assetId}`) ?? null;
}

/** Preload a batch (used by the boot/loading veil). Never rejects. */
export function preloadV31(assetIds: string[]): Promise<void> {
  return Promise.all(assetIds.map(id => loadV31Sheet(id, "sprites"))).then(() => undefined);
}

/* ------------------------------------------------------------------ */
/*  game → asset mappings                                              */
/* ------------------------------------------------------------------ */

/** The six playable archmage sheets keyed by damage element. */
export const MAGE_BY_ELEMENT: Record<string, string> = {
  ember: "mage_pyromancer",
  frost: "mage_cryomancer",
  volt: "mage_stormcaller",
  void: "mage_voidweaver",
  arcane: "mage_aethermancer",
  vitality: "mage_chronomancer",
};
/** The brand default (title-screen mage, no element selected yet). */
export const MAGE_DEFAULT = "mage_stormcaller";

/** v3.0 body kinds → V3.1 enemy sheets. "swarmlet" stays procedural (the
 *  library has no micro-unit; the canvas bat reads great at that size). */
export const V31_ENEMY_BY_BODY: Record<string, string | null> = {
  imp: "enemy_skeleton_warrior",
  knight: "enemy_shieldbone_knight",
  wraith: "enemy_wraith",
  orb: "enemy_flesh_construct",
  caster: "enemy_cultist_acolyte",
  brute: "enemy_flesh_construct",
  swarmlet: null,
};

/** enemy TYPE overrides (name-flavored picks beat generic body picks). */
export const V31_ENEMY_BY_TYPE: Record<string, string | null> = {
  archer: "enemy_bone_archer",
  necromancer: "enemy_necromancer",
  bomber: "enemy_plaguebearer",
  goblin: "enemy_plaguebearer",
};

/** tyrant brains → boss sheets (128px frames). */
export const V31_BOSS_BY_BRAIN: Record<string, string> = {
  charger: "boss_bone_regent",
  juggernaut: "boss_blight_colossus",
  dancer: "boss_rift_leviathan",
  fortress: "boss_blight_colossus",
  storm: "boss_rift_leviathan",
};

/** Every sheet the combat bestiary can ask for, for preloading. */
export const V31_COMBAT_SHEETS: string[] = [
  ...Object.values(MAGE_BY_ELEMENT),
  ...new Set([
    ...Object.values(V31_ENEMY_BY_BODY).filter((v): v is string => !!v),
    ...Object.values(V31_ENEMY_BY_TYPE).filter((v): v is string => !!v),
  ]),
  ...Object.values(V31_BOSS_BY_BRAIN),
];

/* ------------------------------------------------------------------ */
/*  environment tilesets                                                */
/* ------------------------------------------------------------------ */

export const V31_TILESETS: string[] = ["tileset_cursed_grove", "tileset_undead_crypt", "tileset_blighted_marsh"];

/** terrain id → tileset family (act palettes still tint on top). */
export const TILESET_FOR_TERRAIN: Record<string, string> = {
  rubble: "tileset_cursed_grove",
  plaza: "tileset_cursed_grove",
  ring: "tileset_cursed_grove",
  lanes: "tileset_cursed_grove",
  chaos: "tileset_cursed_grove",
  astral: "tileset_cursed_grove",
  graveyard: "tileset_undead_crypt",
  glacial: "tileset_undead_crypt",
  caldera: "tileset_blighted_marsh",
  thornwild: "tileset_blighted_marsh",
};

/** Preload the three environment tilesets (used by the arena floor). */
export function preloadV31Tilesets(): Promise<void> {
  return Promise.all(V31_TILESETS.map(id => loadV31Sheet(id, "tilesets"))).then(() => undefined);
}

/* ------------------------------------------------------------------ */
/*  V31Sprite — the entity visual                                      */
/* ------------------------------------------------------------------ */

const WHITE = new THREE.Color(0xffffff);

export class V31Sprite {
  readonly mesh: THREE.Mesh;
  /** dark underlay sharing the mesh's geometry — the pixel-art rim that
   *  separates sprites from same-hue floors (classic outline trick). */
  private outline: THREE.Mesh;
  private outlineMat: THREE.MeshBasicMaterial;
  private material: THREE.MeshBasicMaterial;
  private sheet: V31Sheet;
  /** frame grid coordinates currently baked into the geometry UVs */
  private curCol = -1;
  private curRow = -1;
  private animT = 0;
  /** legacy surface (engine drives these directly) */
  state: V31Pose = "idle";
  /** 0..1 white flash (hit reaction) */
  flash = 0;
  /** desired world facing for mirrored (up/down) poses: +1 right, -1 left */
  face: 1 | -1 = 1;
  /** mages pose "cast" when the engine asks for "attack" */
  preferCast = false;
  private dir: V31Direction = "down";
  private baseScaleX = 1;
  private baseScaleY = 1;
  private baseColor = new THREE.Color(0xffffff);
  private planeH: number;
  private disposed = false;

  constructor(sheet: V31Sheet, opts: { bodyHeight?: number; planeHeight?: number; direction?: V31Direction } = {}) {
    this.sheet = sheet;
    this.dir = opts.direction ?? "down";
    const m = sheet.manifest;
    /* plane height: either explicit, or derived so the visible BODY matches
     * the requested bodyHeight (feet at the manifest pivot, head at the
     * hitbox top — the same normalization the old chibi heights used). */
    this.planeH = opts.planeHeight ?? (opts.bodyHeight ?? 2.4) / sheet.bodyFraction;
    const w = this.planeH; /* square frames */
    const geo = new THREE.PlaneGeometry(w, this.planeH);
    /* anchor the manifest pivot (e.g. y=54/64) at the ground plane */
    const probe = m.animations.find(a => a.state === "idle") ?? m.animations[0];
    const pv = probe ? Math.max(0.2, Math.min(0.95, probe.pivot.y / m.frameHeight)) : 0.85;
    geo.translate(0, (pv - 0.5) * this.planeH, 0);
    this.material = new THREE.MeshBasicMaterial({
      map: sheet.texture,
      transparent: true,
      alphaTest: 0.08,
      side: THREE.DoubleSide,
      fog: true,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    /* rim/outline underlay — same geometry (shares the live UV writes),
     * black material, slightly scaled, one frame behind in render order */
    this.outlineMat = new THREE.MeshBasicMaterial({
      map: sheet.texture,
      color: 0x120b1f,
      transparent: true,
      opacity: 0.9,
      alphaTest: 0.02,
      side: THREE.DoubleSide,
      fog: true,
    });
    this.outline = new THREE.Mesh(geo, this.outlineMat);
    this.outline.scale.setScalar(1.055);
    this.outline.position.z = -0.015;
    this.outline.renderOrder = -1;
    this.outline.frustumCulled = false;
    this.mesh.add(this.outline);
    this.baseScaleX = 1;
    this.baseScaleY = 1;
    this.writeFrame(0, this.rowFor("idle"));
  }

  /** Retarget to another loaded sheet (boss phase swaps etc.), keeping pose. */
  setSheet(sheet: V31Sheet, opts: { bodyHeight?: number; planeHeight?: number } = {}): void {
    if (this.disposed) return;
    this.sheet = sheet;
    this.planeH = opts.planeHeight ?? (opts.bodyHeight ?? 2.4) / sheet.bodyFraction;
    const w = this.planeH;
    const old = this.mesh.geometry as THREE.PlaneGeometry;
    const oldH = old.parameters.height;
    const oldW = old.parameters.width;
    const m = sheet.manifest;
    const probe = m.animations.find(a => a.state === "idle") ?? m.animations[0];
    const pv = probe ? Math.max(0.2, Math.min(0.95, probe.pivot.y / m.frameHeight)) : 0.85;
    const geo = new THREE.PlaneGeometry(w, this.planeH);
    geo.translate(0, (pv - 0.5) * this.planeH, 0);
    this.mesh.geometry = geo;
    this.outline.geometry = geo;
    old.dispose();
    this.material.map = sheet.texture;
    this.outlineMat.map = sheet.texture;
    this.material.needsUpdate = true;
    this.outlineMat.needsUpdate = true;
    this.baseScaleX = w / oldW;
    this.baseScaleY = this.planeH / oldH;
    this.curCol = -1;
    this.writeFrame(0, this.rowFor(this.state));
  }

  /** One-shot named pose (blink/windup/...) with an auto-return timer. */
  pose(name: V31Pose, dur: number): void {
    this.state = name;
    this.poseT = dur;
  }
  private poseT = 0;

  /** directional locomotion intent — picks the 4-dir row + persists. */
  setMotion(vx: number, vz: number): void {
    if (vx === 0 && vz === 0) return; /* keep last facing while idle */
    if (Math.abs(vx) > Math.abs(vz) * 0.9) {
      this.dir = vx > 0 ? "right" : "left";
      this.face = vx > 0 ? 1 : -1;
    } else {
      this.dir = vz > 0 ? "down" : "up";
    }
  }
  setDirection(dir: V31Direction): void {
    this.dir = dir;
  }
  get direction(): V31Direction {
    return this.dir;
  }

  tint(color: THREE.ColorRepresentation | THREE.Color): void {
    if (color instanceof THREE.Color) this.baseColor.copy(color);
    else this.baseColor.set(color);
  }

  private rowFor(state: V31Pose): number {
    let st = state;
    if (st === "hurt") st = "hit";
    if (st === "attack" && this.preferCast) st = "cast";
    const a = this.sheet.anim(st, this.dir)
      ?? this.sheet.anim(st === "hit" ? "hurt" : st, "down");
    return a ? a.row : 0;
  }
  private animFor(state: V31Pose): V31AnimInfo | null {
    let st = state;
    if (st === "hurt") st = "hit";
    if (st === "attack" && this.preferCast) st = "cast";
    return this.sheet.anim(st, this.dir)
      ?? this.sheet.anim(st === "hit" ? "hurt" : st, "down");
  }

  /** advance the animation; call once per frame with dt. */
  update(dt: number): void {
    if (this.disposed) return;
    if (this.poseT > 0) {
      this.poseT -= dt;
      if (this.poseT <= 0 && this.state !== "death") this.state = "idle";
    }
    const a = this.animFor(this.state);
    if (!a) return;
    this.animT += dt * Math.max(1, a.fps);
    const span = Math.max(1, a.frameCount);
    let col = Math.floor(this.animT) % span;
    if (this.state === "death") col = Math.min(span - 1, Math.floor(this.animT)); /* play once, hold */
    this.writeFrame(col, a.row);
    /* tint: base color lerped toward white by the hit flash */
    this.material.color.copy(this.baseColor);
    if (this.flash > 0) this.material.color.lerp(WHITE, Math.min(1, this.flash));
  }

  private writeFrame(col: number, row: number): void {
    if (col === this.curCol && row === this.curRow) return;
    this.curCol = col;
    this.curRow = row;
    const m = this.sheet.manifest;
    const u0 = col / m.columns;
    const u1 = (col + 1) / m.columns;
    const v1 = 1 - row / m.rows;
    const v0 = 1 - (row + 1) / m.rows;
    const uv = (this.mesh.geometry as THREE.PlaneGeometry).attributes.uv as THREE.BufferAttribute;
    /* PlaneGeometry (1 segment) default UV corners: TL(0,1) TR(1,1) BL(0,0) BR(1,0) */
    uv.setXY(0, u0, v1);
    uv.setXY(1, u1, v1);
    uv.setXY(2, u0, v0);
    uv.setXY(3, u1, v0);
    uv.needsUpdate = true;
  }

  /** cylinder billboard toward the camera + facing mirror. Horizontal art
   *  rows already face their side; up/down rows mirror by `face`. */
  faceCamera(camPos: THREE.Vector3, meshPos: THREE.Vector3): void {
    const yaw = Math.atan2(camPos.x - meshPos.x, camPos.z - meshPos.z);
    this.mesh.rotation.set(0, yaw, 0);
    const axisX = Math.cos(yaw) || 1; /* world-X component of local +X */
    let mirror: 1 | -1;
    if (this.dir === "left") mirror = axisX > 0 ? -1 : 1;
    else if (this.dir === "right") mirror = axisX > 0 ? 1 : -1;
    else mirror = this.face * axisX < 0 ? -1 : 1;
    this.mesh.scale.set(this.baseScaleX * mirror, this.baseScaleY, 1);
  }

  /** extra squash/stretch composes with the flip. */
  setSquash(x: number, y: number): void {
    this.baseScaleX = Math.abs(this.baseScaleX) * x;
    this.baseScaleY = Math.abs(this.baseScaleY) * y;
  }

  setOpacity(o: number): void {
    this.material.opacity = o;
    this.material.transparent = true;
    this.outlineMat.opacity = Math.min(1, o * 0.95);
  }

  dispose(): void {
    this.disposed = true;
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.outlineMat.dispose();
  }
}

/* ------------------------------------------------------------------ */
/*  sheet disposal (context teardown)                                  */
/* ------------------------------------------------------------------ */

export function disposeV31Sheets(): void {
  for (const s of sheetCache.values()) s.texture.dispose();
  sheetCache.clear();
}
