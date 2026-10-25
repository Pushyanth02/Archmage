import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as skeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { EnemyDef, EnemyType } from "./content";
import { assetPath } from "../lib/asset-path";

export type ModelKind =
  | "mage" | "staff" | "imp" | "puglin" | "slime" | "ghost" | "plant"
  | "skeleton" | "skeletonmage"
  /* 10-c terrain decor (Kenney Graveyard Kit, CC0) — pre-scaled GLBs consumed
   *  by arena.ts per-terrain dressing (10-e). */
  | "terrain-tomb" | "terrain-tomb-round" | "terrain-tomb-broken" | "terrain-cross"
  | "terrain-tree" | "terrain-fence" | "terrain-crypt" | "terrain-sarcophagus"
  | "terrain-pillar" | "terrain-lantern";

export interface ModelTemplate {
  /** Prototype scene — never added to the render scene directly; clone via spawnModel. */
  scene: THREE.Group;
  /** Bounding-box height at scale 1 (for gameplay-size normalization). */
  height: number;
  /** True when the rig has bones → clones need SkeletonUtils + mixer-safe flags. */
  skinned: boolean;
  /** Primary PBR material (single shared material per shipped model). */
  primaryMat: THREE.MeshStandardMaterial | null;
  /** Clips embedded in the model's OWN GLB (9-b/9-e per-model retargeted set). */
  clips: THREE.AnimationClip[];
}

/** Asset kinds recognized by the runtime loader (plan §4 manifest schema). */
export type AssetKind = "model" | "sprite" | "icon" | "clipbank";

/** Per-asset load telemetry (plan §4 loading strategy: record load time + transfer size). */
export interface AssetLoadStats {
  totalBytes: number;
  loadMs: number;
  perAsset: Array<{ id: string; ms: number; bytes: number }>;
}

/** Manifest packs[] row as consumed by the attribution UI (audit P2-6). */
export interface PackCredits {
  id: string;
  pack: string;
  author: string;
  sourceUrl: string;
  licenseId: string;
  attributionRequired: boolean;
  licenseStatus: string;
}

/** Subset of the manifest schema the runtime consumes; provenance fields
 *  (license/budget) live in the file for validation + attribution UI only. */
interface ManifestEntry {
  id: string;
  kind: AssetKind;
  uri: string;
  format?: string;
  byteSize?: number;
  animations?: string[];
}

interface AssetManifest {
  generator?: string;
  version?: string;
  packs?: PackCredits[];
  assets: ManifestEntry[];
}

/* ARCHMAGE: RIFTBOUND (3D Edition) — AssetSystem: manifest-driven itch.io asset pipeline.
   Loads what /assets/manifests/assets.json declares (see docs/AUDITS.md +
   the plan §4 manifest schema): kind "model" → GLTFLoader.parse into the
   models Map, kind "clipbank" → the shared KayKit Rig_Medium clip bank,
   kind "sprite" → TextureLoader into the sprites Map. kind "icon" entries are
   provenance-only (the React UI loads icons directly) and are skipped here.
   The manifest packs[] rows are exposed as PackCredits (AssetSystem.packs +
   the cached module-level fetchPackCredits()) so the attribution UI renders
   from the manifest — the single source of truth (audit P2-6) — with
   FALLBACK_PACKS as the only hard-coded mirror.
   If the manifest fetch fails, a hardcoded FALLBACK list drives the same loads
   so a missing/renamed manifest can never break the game.
   Everything is optional at runtime: a failed load leaves the slot empty and
   the procedural fallback stays in place (load() never rejects). This module
   imports three + content types only (no cycles). */

const MANIFEST_URL = "/assets/manifests/assets.json"; // routed through assetPath() at fetch time (R-08 subpath deploys)
/** Model kinds this system can host (manifest entries outside this set are skipped). */
const KNOWN_MODELS: readonly ModelKind[] = ["mage", "staff", "imp", "puglin", "slime", "ghost", "plant", "skeleton", "skeletonmage",
/* 10-c terrain decor (Kenney Graveyard Kit, CC0) — pre-scaled GLBs consumed
*  by arena.ts per-terrain dressing (10-e). */
"terrain-tomb", "terrain-tomb-round", "terrain-tomb-broken", "terrain-cross", "terrain-tree", "terrain-fence", "terrain-crypt", "terrain-sarcophagus", "terrain-pillar", "terrain-lantern"];
export const FALLBACK_PACKS: PackCredits[] = [{
  id: "kaykit-adventurers",
  pack: "KayKit – Character Pack: Adventurers 2.0",
  author: "Kay Lousberg",
  sourceUrl: "https://kaylousberg.itch.io/kaykit-adventurers",
  licenseId: "CC0",
  attributionRequired: false,
  licenseStatus: "verified"
}, {
  id: "kaykit-skeletons",
  pack: "KayKit – Character Pack: Skeletons",
  author: "Kay Lousberg",
  sourceUrl: "https://kaylousberg.itch.io/kaykit-skeletons",
  licenseId: "CC0",
  attributionRequired: false,
  licenseStatus: "verified"
}, {
  id: "quaternius-bestiary",
  pack: "Bestiary – Dungeon Monsters Kit",
  author: "Quaternius",
  sourceUrl: "https://quaternius.itch.io/bestiary-dungeon-monsters-kit",
  licenseId: "QAL-1.0 (Quaternius Asset License, free commercial)",
  attributionRequired: false,
  licenseStatus: "verified"
}, {
  id: "quaternius-animated-monsters",
  pack: "LowPoly Animated Monsters",
  author: "Quaternius",
  sourceUrl: "https://quaternius.itch.io/lowpoly-animated-monsters",
  licenseId: "CC0",
  attributionRequired: false,
  licenseStatus: "verified"
}, {
  id: "augusto-faria-monsters",
  pack: "Low Poly Monsters Pack",
  author: "Augusto Faria",
  sourceUrl: "https://augusto-faria.itch.io/low-poly-monsters-pack-slime-ghost-carnivorous-plant",
  licenseId: "No explicit license found (free download; pending author confirmation)",
  attributionRequired: true,
  licenseStatus: "permission-pending"
}, {
  id: "kronbits-particles",
  pack: "1000 Free Game Assets (Particles)",
  author: "Kronbits",
  sourceUrl: "https://kronbits.itch.io/particle-pack",
  licenseId: "CC0",
  attributionRequired: false,
  licenseStatus: "verified"
}, {
  id: "dunpixel-skill-icons",
  pack: "30 Free Pixel Art Skill Icons",
  author: "Dani Melich (dunpixel)",
  sourceUrl: "https://dunpixel.itch.io/pixel-art-skill-icons-30-free-magic-spell-icons",
  licenseId: "Free commercial",
  attributionRequired: false,
  licenseStatus: "verified"
}, {
  id: "kenney-graveyard",
  pack: "Graveyard Kit",
  author: "Kenney",
  sourceUrl: "https://kenney.nl/assets/graveyard-kit",
  licenseId: "CC0",
  attributionRequired: false,
  licenseStatus: "verified"
}, {
  id: "kenney-particles",
  pack: "Particle Pack",
  author: "Kenney",
  sourceUrl: "https://kenney.nl/assets/particle-pack",
  licenseId: "CC0",
  attributionRequired: false,
  licenseStatus: "verified"
}];
/** Hardcoded mirror of the shipped manifest — the game still runs (procedural
 *  fallbacks) even if the manifest is missing, renamed, or unparseable. */
const FALLBACK: AssetManifest = {
  generator: "fallback (manifest unreachable)",
  version: "0",
  packs: FALLBACK_PACKS,
  assets: [...KNOWN_MODELS.map((k): ManifestEntry => ({
    id: `model.${k}`,
    kind: "model",
    uri: `models/${k}.glb`,
    format: "glb"
  })), {
    id: "clipbank.anims",
    kind: "clipbank",
    uri: "models/anims.glb",
    format: "glb"
  }, ...["glow", "glow-soft", "flare", "ring", "streak", "muzzle", "lightrays", "smoke", "star", "star-hard", "spiral", "kenney-ripple", "kenney-crescent"].map((n): ManifestEntry => ({
    id: `sprite.${n}`,
    kind: "sprite",
    uri: `particles/${n}.png`,
    format: "png"
  }))]
};
/** Normalize manifest packs[] rows into PackCredits; malformed rows are
 *  skipped defensively (the credits UI never crashes on a bad manifest). */
function parsePacks(m: { packs?: unknown }): PackCredits[] {
  if (!Array.isArray(m.packs)) return [];
  const out: PackCredits[] = [];
  for (const p of m.packs) {
    if (!p || typeof p.pack !== "string" || p.pack.length === 0) continue;
    out.push({
      id: typeof p.id === "string" && p.id.length > 0 ? p.id : p.pack,
      pack: p.pack,
      author: typeof p.author === "string" && p.author.length > 0 ? p.author : "unknown",
      sourceUrl: typeof p.sourceUrl === "string" ? p.sourceUrl : "",
      licenseId: typeof p.licenseId === "string" && p.licenseId.length > 0 ? p.licenseId : "unspecified",
      attributionRequired: p.attributionRequired === true,
      licenseStatus: typeof p.licenseStatus === "string" && p.licenseStatus.length > 0 ? p.licenseStatus : "unknown"
    });
  }
  return out;
}
/** Cached module-level pack-credits fetch (audit P2-6): lets the credits UI
 *  consume packs[] WITHOUT an engine instance (the menu renders before any
 *  run). Falls back to FALLBACK_PACKS on any error; caches the promise so the
 *  menu dialog + victory credits share one request. */
let packCreditsPromise: Promise<PackCredits[]> | null = null;
export function fetchPackCredits(): Promise<PackCredits[]> {
  if (!packCreditsPromise) {
    packCreditsPromise = fetch(assetPath(MANIFEST_URL)).then(r => {
      if (!r.ok) throw new Error(`${MANIFEST_URL} → ${r.status}`);
      return r.json();
    }).then(m => {
      const packs = parsePacks(m);
      if (packs.length === 0) throw new Error("manifest has no packs[]");
      return packs;
    }).catch(e => {
      console.warn("[assets] pack credits unavailable — using hardcoded fallback list:", e);
      return FALLBACK_PACKS;
    });
  }
  return packCreditsPromise;
}
/** Enemy body kind → acquired model. Unmapped bodies keep their procedural kits. */
const BODY_MODEL: Partial<Record<EnemyDef["body"], ModelKind>> = {
  imp: "imp",
  brute: "puglin",
  wraith: "ghost",
  swarmlet: "slime",
  knight: "skeleton",
  caster: "skeletonmage"
};
/** Per-enemy-type overrides (Corpseweaver = rooted corpse-flower healer). */
const TYPE_MODEL: Partial<Record<EnemyType, ModelKind>> = {
  mender: "plant"
};
export class AssetSystem {
  readonly models = new Map<ModelKind, ModelTemplate>();
  /** Retarget clips (KayKit Rig_Medium — shares the mage skeleton 1:1). */
  clips: THREE.AnimationClip[] = [];
  /** Kronbits particle sprite textures by name. */
  sprites = new Map<string, THREE.Texture>();
  /** Resolves when every load attempt has settled (success or fallback). */
  ready = false;
  /** 0..1 — v2.2: BYTE-weighted (loadedBytes / totalBytes) when the
   *  manifest carries byteSize (it does — 46/46 entries), falling back to
   *  settled-jobs/total-jobs. Bytes stream in DURING each fetch, so the
   *  loading bar moves continuously instead of jumping per settled file. */
  progress = 0;
  /** v2.2 staged loading: tier 1 (sprites + the player's own models + the
   *  shared clip bank) has settled — the menu can reveal, the mage can
   *  hot-swap in; the bestiary + terrain decor keep streaming behind it. */
  essentialsReady = false;
  /** Byte counters behind `progress` (MB-scale integers for the veil). */
  loadedBytes = 0;
  totalBytes = 0;
  /** Per-model arrival hook (v2.2): fires once for every model that
   *  parses successfully — the engine rebuilds the player the moment its
   *  own models land instead of waiting for the whole manifest. */
  onModel: ((kind: ModelKind) => void) | null = null;
  /** Asset ids (or urls) whose load failed — slots stay empty, procedural fallbacks stay. */
  failed: string[] = [];
  /** Measured load telemetry (wall time via performance.now, bytes via
  *  arrayBuffer.byteLength for GLBs / manifest byteSize for textures). */
  stats: AssetLoadStats = {
    totalBytes: 0,
    loadMs: 0,
    perAsset: []
  };
  /** Pack credits from the manifest packs[] (audit P2-6) — mirrors
  *  fetchPackCredits() for engine-side consumers; FALLBACK_PACKS on manifest
  * failure. */
  packs: PackCredits[] = [];
  private loader = new GLTFLoader();
  private texLoader = new THREE.TextureLoader();
  private disposed = false;
  private progressSettled = 0;
  private progressTotal = 0;
  /** Fire-and-forget: fetch the manifest, then kick every declared load in
  *  parallel; resolve(AssetSystem) when all attempts have settled. */
  load(): Promise<AssetSystem> {
    const t0 = performance.now();
    this.progress = 0;
    this.failed = [];
    this.stats = { totalBytes: 0, loadMs: 0, perAsset: [] };
    return this.resolveManifest().then(manifest => this.loadManifest(manifest)).then(() => {
      this.ready = true;
      this.progress = 1;
      this.stats.loadMs = performance.now() - t0;
      return this;
    });
  }
  /** Fetch the per-asset manifest; any failure falls back to the hardcoded list. */
  private resolveManifest(): Promise<AssetManifest> {
    return fetch(assetPath(MANIFEST_URL)).then(r => {
      if (!r.ok) throw new Error(`${MANIFEST_URL} → ${r.status}`);
      return r.json();
    }).then(m => {
      if (!m || !Array.isArray(m.assets) || m.assets.length === 0) {
        throw new Error("manifest has no assets[]");
      }
      this.packs = parsePacks(m);
      return m;
    }).catch(e => {
      console.warn("[assets] manifest unavailable — using hardcoded fallback list:", e);
      this.packs = FALLBACK_PACKS;
      return FALLBACK;
    });
  }
  /** Dispatch every runtime-relevant manifest entry as a staged, pooled job
   *  (v2.2). Icons are provenance-only (the UI loads them directly); unknown
   *  kinds (future manifest extensions) are skipped the same way.
   *
   *  TIER 1 "essentials" — sprites + the mage/staff/imp trio + the shared
   *  clip bank, pooled at 4: the menu reveals and the player hot-swaps as
   *  soon as this tier settles.
   *  TIER 2 "the rest" — bestiary + terrain decor, pooled at 2 so weak
   *  devices never fight a main-thread parse storm behind the menu. */
  private async loadManifest(manifest: AssetManifest): Promise<void> {
    const entries: ManifestEntry[] = [];
    for (const e of manifest.assets) {
      if (!e || typeof e.uri !== "string" || e.uri.length === 0) continue;
      if (e.kind !== "model" && e.kind !== "clipbank" && e.kind !== "sprite") continue;
      entries.push(e);
    }
    this.progressTotal = entries.length;
    this.progressSettled = 0;
    this.progress = 0;
    this.loadedBytes = 0;
    this.totalBytes = entries.reduce((n, e) => n + (e.byteSize ?? 0), 0);
    const ESSENTIAL_MODELS = new Set(["mage", "staff", "imp"]);
    const isEssential = (e: ManifestEntry) =>
      e.kind === "sprite" || e.kind === "clipbank" ||
      (e.kind === "model" && ESSENTIAL_MODELS.has(e.id.replace(/^model\./, "")));
    const tier1 = entries.filter(isEssential);
    const tier2 = entries.filter(e => !isEssential(e));
    await this.runPooled(tier1, 4);
    this.essentialsReady = true;
    await this.runPooled(tier2, 2);
  }
  /** Run jobs with at most `limit` in flight; preserves input order. */
  private async runPooled(jobs: ManifestEntry[], limit: number): Promise<void> {
    let next = 0;
    const worker = async () => {
      while (next < jobs.length) {
        const e = jobs[next++];
        await this.loadEntry(e);
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, jobs.length)) }, worker));
  }
  /** Streaming fetch with byte-count progress (v2.2): resolves the body as
   *  an ArrayBuffer while ticking loadedBytes as bytes arrive on the wire. */
  private async fetchBytes(url: string): Promise<ArrayBuffer> {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url} → ${r.status}`);
    if (!r.body) return r.arrayBuffer(); // no stream support — one-shot
    const reader = r.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        received += value.byteLength;
        this.loadedBytes += value.byteLength;
        this.tickProgress();
      }
    }
    const out = new Uint8Array(received);
    let off = 0;
    for (const c of chunks) {
      out.set(c, off);
      off += c.byteLength;
    }
    return out.buffer;
  }
  /** progress = bytes when the manifest declares sizes, else settled jobs. */
  private tickProgress(): void {
    this.progress = this.totalBytes > 0
      ? Math.min(0.999, this.loadedBytes / this.totalBytes)
      : this.progressTotal > 0 ? this.progressSettled / this.progressTotal : 0;
  }
  /** One job: load + record telemetry + advance progress. Never rejects —
  *  failures are logged, recorded in `failed`, and leave the slot empty. */
  private async loadEntry(e: ManifestEntry): Promise<void> {
    const id = e.id || e.uri;
    const url = assetPath(`/assets/${e.uri.replace(/^\/+/, "")}`);
    const t0 = performance.now();
    let bytes = 0;
    try {
      if (e.kind === "model") {
        const kind = id.startsWith("model.") ? id.slice("model.".length) : "";
        if ((KNOWN_MODELS as readonly string[]).includes(kind)) {
          bytes = await this.loadModel(kind as ModelKind, url);
        } else {
          console.warn(`[assets] manifest model "${id}" is not a known ModelKind — skipped`);
        }
      } else if (e.kind === "clipbank") {
        bytes = await this.loadClipbank(url);
      } else if (e.kind === "sprite") {
        const name = id.startsWith("sprite.") ? id.slice("sprite.".length) : (e.uri.split("/").pop() ?? "").replace(/\.[^.]+$/, "");
        bytes = await this.loadSprite(name, url, e.byteSize ?? 0);
      }
    } catch (err) {
      console.warn(`[assets] ${e.kind} "${id}" unavailable (procedural fallback):`, err);
      this.failed.push(id);
    } finally {
      const ms = performance.now() - t0;
      this.progressSettled++;
      this.tickProgress();
      this.stats.perAsset.push({
        id,
        ms,
        bytes
      });
      this.stats.totalBytes += bytes;
    }
  }
  /** Parse a GLB into the models Map; resolves with the transfer size. */
  private loadModel(kind: ModelKind, url: string): Promise<number> {
    return this.fetchBytes(url).then(buf => new Promise<number>((res, rej) => {
      this.loader.parse(buf, "", gltf => {
        if (this.disposed) return res(0);
        try {
          const scene = gltf.scene as THREE.Group;
          const box = new THREE.Box3().setFromObject(scene);
          const height = Math.max(0.01, box.max.y - box.min.y);
          let primaryMat: THREE.MeshStandardMaterial | null = null;
          scene.traverse(o => {
            const m = o as THREE.Mesh;
            if ((m as unknown as { isSkinnedMesh?: boolean }).isSkinnedMesh) {
              /* bind-pose bounds would cull mid-animation */m.frustumCulled = false;
            }
            if (!primaryMat && m.isMesh) {
              const mat = Array.isArray(m.material) ? m.material[0] : m.material;
              if (mat && (mat as THREE.Material).type === "MeshStandardMaterial") {
                primaryMat = mat as THREE.MeshStandardMaterial;
              }
            }
          });
          /* 9-b/9-e: retain clips embedded in the model's own GLB per template
          (previously discarded — the loader read gltf.scene only). The
          shared KayKit bank (this.clips) is untouched: it still feeds the
          mage + skeleton family exactly as before. */
          this.models.set(kind, {
            scene,
            height,
            skinned: primaryMat !== null && sceneHasBones(scene),
            primaryMat,
            clips: gltf.animations ?? []
          });
          try { this.onModel?.(kind); } catch { /* subscriber errors never break a load */ }
          res(buf.byteLength);
        } catch (e) {
          rej(e);
        }
      }, rej);
    }));
  }
  /** Parse the shared clip bank; resolves with the transfer size. */
  private loadClipbank(url: string): Promise<number> {
    return this.fetchBytes(url).then(buf => new Promise<number>((res, rej) => {
      this.loader.parse(buf, "", gltf => {
        if (this.disposed) return res(0);
        this.clips = gltf.animations ?? [];
        res(buf.byteLength);
      }, rej);
    }));
  }
  /** Load one particle sprite texture (missing sprite = non-fatal slot skip). */
  private loadSprite(name: string, url: string, byteSize: number): Promise<number> {
    if (!name) return Promise.resolve(0);
    return new Promise<number>((res, rej) => {
      this.texLoader.load(url, t => {
        if (this.disposed) {
          t.dispose();
          return res(0);
        }
        t.colorSpace = THREE.SRGBColorSpace;
        this.sprites.set(name, t);
        /* v2.2: textures don't stream — credit their manifest byteSize to
         * the byte-weighted progress on completion. */
        this.loadedBytes += byteSize;
        this.tickProgress();
        res(byteSize);
      }, undefined, () => rej(new Error(`${url} → texture load failed`)));
    });
  }
  clip(name: string): THREE.AnimationClip | null {
    return this.clips.find(c => c.name === name) ?? null;
  }
  /** Clip embedded in the model's OWN GLB, by model kind + name (9-b's
    per-model retargeted set — the imp/puglin 8-clip bank). Returns null for
    models without embedded clips or a missing clip name, exactly like
    clip() does for the shared KayKit bank. */
  modelClip(kind: ModelKind, name: string): THREE.AnimationClip | null {
    return this.models.get(kind)?.clips.find(c => c.name === name) ?? null;
  }
  /** Which model (if any) should render this enemy definition. */
  modelFor(def: EnemyDef, isBoss: boolean): ModelKind | null {
    if (isBoss) {
      /* brute-brained tyrants wear the puglin colossus; Sylthara the blade
      dancer wears the skeleton knight (her regalia rides on top); the rest
      keep their kits */
      if (def.body === "brute") return "puglin";
      if (def.body === "wraith") return "ghost";
      if (def.body === "knight") return "skeleton";
      return null;
    }
    return TYPE_MODEL[def.type] ?? BODY_MODEL[def.body] ?? null;
  }
  /**
  * Clone a template for the arena. Skinned models are cloned with SkeletonUtils
  * (geometry + textures stay shared with the template); the caller owns disposal
  * of the returned group and any materials it chooses to clone.
  */
  spawnModel(kind: ModelKind): THREE.Group | null {
    const t = this.models.get(kind);
    if (!t) return null;
    const g = skeletonClone(t.scene) as THREE.Group;
    g.traverse(o => {
      const m = o as THREE.Mesh;
      if ((m as unknown as { isSkinnedMesh?: boolean }).isSkinnedMesh) m.frustumCulled = false;
    });
    return g;
  }
  /** Clone the primary material so a foe can tint + hit-flash independently. */
  clonePrimaryMat(kind: ModelKind, tint: THREE.Color, emissiveStrength: number): THREE.MeshStandardMaterial | null {
    const t = this.models.get(kind);
    if (!t?.primaryMat) return null;
    const mat = t.primaryMat.clone();
    /* authored texture stays recognizable: a light mix keeps identity, the strong
    emissive tint (fog:false philosophy) makes the foe read against any biome */
    mat.color.copy(tint).lerp(new THREE.Color(1, 1, 1), 0.68);
    mat.emissive = new THREE.Color(tint);
    mat.emissiveIntensity = 1; // per-frame flash strength is driven by emissive COLOR (syncVisual)
    mat.fog = false;
    return mat;
  }
  dispose(): void {
    this.disposed = true;
    for (const t of this.models.values()) {
      t.scene.traverse(o => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.geometry.dispose();
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          for (const x of mats) x.dispose();
        }
      });
    }
    this.models.clear();
    for (const s of this.sprites.values()) s.dispose();
    this.sprites.clear();
    this.clips = [];
  }
}
function sceneHasBones(root: THREE.Object3D): boolean {
  let found = false;
  root.traverse(o => {
    if ((o as THREE.Bone).isBone) found = true;
  });
  return found;
}