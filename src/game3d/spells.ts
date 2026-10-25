import * as THREE from "three";
import { SPELLS, hexNum, comboKey, COMBOS, elementColor, MERCY_ATTACK, type ElementId, type SpellDef } from "./content";
import type { Enemy, Hazard, Projectile, SimContext } from "./sim";

/* ARCHMAGE: RIFTBOUND (3D Edition) — SpellSystem: the 13 element behaviors, arcane volley,
   the resonance weave, hazards (wards / void wells / blight clouds / time
   shrouds / boss shockrings / boss rifts) and all projectile flight.
   Pure simulation + visuals; economy/cooldowns live in engine.ts.

   Visual language (task 2-b): every projectile is layered — bright emissive
   core mesh + billboard halo sprite + per-element particle trail; hazards are
   pooled visual skeletons animated per-frame; impacts use vfx.impact
   (spark + flash + ripple). All gameplay numbers are untouched. */

const MAX_PROJ = 320;
const MAX_HAZ = 40;
const MAX_BEAM = 24;
/* ---------------------------- shared resources --------------------------- */
const projGeos = {
  orb: new THREE.SphereGeometry(0.34, 10, 8),
  shard: new THREE.ConeGeometry(0.16, 0.9, 6),
  seeker: new THREE.SphereGeometry(0.22, 8, 6),
  javelin: new THREE.ConeGeometry(0.24, 1.5, 6),
  crescent: new THREE.TorusGeometry(0.5, 0.09, 4, 10, Math.PI * 1.25),
  pod: new THREE.SphereGeometry(0.32, 10, 8),
  volley: new THREE.SphereGeometry(0.18, 8, 6),
  ebolt: new THREE.SphereGeometry(0.26, 8, 6)
};
const wardGeo = new THREE.BoxGeometry(1.7, 2.6, 0.45);
const cloudGeo = new THREE.SphereGeometry(1, 12, 10);
const wellGeo = new THREE.CylinderGeometry(1, 1, 0.5, 20, 1, true);
/* hazard skeleton geometries (module lifetime, shared by pooled instances) */
const wardRingGeo = new THREE.RingGeometry(2.3, 2.72, 32);
const wardRailGeo = new THREE.BoxGeometry(5.5, 0.08, 0.08);
const discGeo = new THREE.CircleGeometry(1, 28);
const rimGeo = new THREE.RingGeometry(0.94, 1, 48);
const rippleGeo = new THREE.RingGeometry(0.96, 1, 48);
const riftRingGeo = new THREE.RingGeometry(4.6, 5, 40);
const shockTorusGeo = new THREE.TorusGeometry(1, 0.14, 8, 44);
const shockGhostGeo = new THREE.TorusGeometry(1, 0.05, 6, 44);
/** 12 radial tick marks on a unit circle (timefield clock ring). */
const tickGeo = (() => {
  const pts: number[] = [];
  for (let k = 0; k < 12; k++) {
    const a = k / 12 * Math.PI * 2;
    pts.push(Math.cos(a) * 1.02, 0, Math.sin(a) * 1.02, Math.cos(a) * 1.14, 0, Math.sin(a) * 1.14);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  return g;
})();
const matCache = new Map<number, THREE.MeshBasicMaterial>();
function glowMat(color: number): THREE.MeshBasicMaterial {
  let m = matCache.get(color);
  if (!m) {
    m = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    matCache.set(color, m);
  }
  return m;
}
/** Per-instance additive material for pooled hazard skeletons.
    userData.rc: 1 = retint to glow color, 2 = MeshStandard (base+emissive retint).
    userData.op: base opacity, restored on every obtain. */
function mkAdditive(color: number, opacity: number, rc = 1): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  m.userData.rc = rc;
  m.userData.op = opacity;
  return m;
}
/** Billboard halo sprite scale per projectile kind (world units). */
const HALO_SCALE = {
  orb: 2.3,
  shard: 1.5,
  seeker: 1.7,
  javelin: 1.9,
  crescent: 1.5,
  pod: 2.0,
  volley: 1.25,
  ebolt: 1.45
};
/* Preallocated vfx option records — the per-frame trail/hazard-stream calls
   below pass these by reference (vfx reads them synchronously, never stores),
   so steady-state flight allocates NOTHING. Dynamic fields are mutated in
   place right before the call. */
const T_FIRE_EMBER = {
  jitter: 0.55,
  vy: 0.7,
  gravity: -1.6,
  size: 0.5,
  life: 0.45,
  drag: 1.1
};
const T_FIRE_SMOKE = {
  size: 1.5,
  life: 0.9,
  alpha: 0.26,
  vy: 0.4,
  jitter: 0.4,
  drag: 1.2
};
const T_ICE_GLINT = {
  jitter: 0.3,
  size: 0.34,
  life: 0.26
};
const T_ICE_MIST = {
  size: 1.35,
  life: 0.85,
  alpha: 0.2,
  vy: 0.15,
  jitter: 0.55,
  drag: 1.4
};
const T_RIBBON = {
  size: 0.5,
  life: 0.55,
  alpha: 0.9,
  jitter: 0.15,
  drag: 0.8,
  swayA: 0.45,
  swayF: 5.5,
  ox: 0,
  oz: 0
};
const T_WHITE_SPARK = {
  size: 0.42,
  life: 0.2,
  jitter: 0.2
};
const T_STEER_SPARK = {
  size: 0.4,
  life: 0.2,
  jitter: 0.15
};
const T_BLOOD_DROP = {
  jitter: 0.4,
  vy: -0.6,
  gravity: 7,
  size: 0.42,
  life: 0.5,
  drag: 0.3
};
const T_BLOOD_MIST = {
  size: 1.1,
  life: 0.7,
  alpha: 0.3,
  jitter: 0.35,
  drag: 1
};
const T_SPORE = {
  jitter: 0.5,
  size: 0.42,
  life: 0.9,
  gravity: -0.5,
  drag: 0.8,
  swayA: 0.35,
  swayF: 3
};
const T_BUBBLE = {
  jitter: 0.22,
  vy: 1.4,
  size: 0.3,
  life: 0.42,
  drag: 2
};
const T_WIND_STREAK = {
  vx: 0,
  vz: 0,
  jitter: 0.28,
  size: 0.48,
  life: 0.32,
  drag: 2.4
};
const T_VOLLEY = {
  jitter: 0.2,
  size: 0.4,
  life: 0.3
};
const T_EBOLT = {
  jitter: 0.25,
  size: 0.55,
  life: 0.35,
  alpha: 0.7
};
const T_GENERIC = {
  jitter: 0.3,
  size: 0.6,
  life: 0.35,
  alpha: 0.8
};
const T_FIZZLE = {
  jitter: 0.8,
  size: 0.5,
  life: 0.3,
  alpha: 0.8
};
const T_POD_SPORES = {
  jitter: 2.5,
  vy: 1.5,
  size: 0.6,
  life: 0.9,
  gravity: -1,
  drag: 1.5,
  swayA: 0.4,
  swayF: 3
};
const T_WELL_SPIRAL = {
  vx: 0,
  vz: 0,
  vy: -0.25,
  size: 0.42,
  life: 0.7,
  alpha: 0.85,
  drag: 0.15,
  jitter: 0.08
};
const T_CLOUD_BUBBLE = {
  vy: 1.2,
  size: 0.3,
  life: 0.55,
  alpha: 0.8,
  drag: 1.6,
  jitter: 0.12
};
const T_CLOUD_SPORE = {
  size: 0.5,
  life: 1.1,
  alpha: 0.55,
  gravity: -0.35,
  drag: 0.7,
  swayA: 0.4,
  swayF: 2.6,
  jitter: 0.3
};
const T_RIM_SPARK = {
  vx: 0,
  vz: 0,
  vy: 0.8,
  size: 0.38,
  life: 0.32,
  alpha: 0.9,
  drag: 1.2,
  jitter: 0.2
};
const T_RIFT_SPIRAL = {
  vx: 0,
  vz: 0,
  vy: -0.4,
  size: 0.4,
  life: 0.6,
  alpha: 0.85,
  drag: 0.1,
  jitter: 0.1
};
const R_WELL_RIPPLE = {
  life: 0.8,
  contract: true,
  thickness: 0.35
};
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const WHITE_C = new THREE.Color(0xffffff);
export interface ResonanceResult {
  key: string;
  name: string;
  damageDealt: number;
}

interface Beam {
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
}

export class SpellSystem {
  private scene: THREE.Scene;
  projectiles: Projectile[] = [];
  hazards: Hazard[] = [];
  private beams: Beam[] = [];
  private projPool = new Map<string, THREE.Group[]>();
  private beamPool: THREE.Mesh[] = [];
  /** Pooled per-kind hazard visual skeletons (never disposed mid-run). */
  private hazVis = new Map<string, THREE.Group[]>();
  /** Soft radial sprite texture for projectile halos (client-only). */
  private readonly haloTex: THREE.CanvasTexture;
  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.haloTex = SpellSystem.makeHaloTexture();
  }
  /** Soft round radial gradient on a 64px canvas (halo sprites). */
  private static makeHaloTexture(): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0.0, "rgba(255,255,255,0.85)");
      g.addColorStop(0.35, "rgba(255,255,255,0.4)");
      g.addColorStop(0.7, "rgba(255,255,255,0.12)");
      g.addColorStop(1.0, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 64, 64);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  /* ------------------------------ pooling -------------------------------- */ /* Projectile groups: children[0] = core mesh (shared glowMat, retinted by
                                                                                ref-swap), children[1] = billboard halo Sprite (per-instance material). */
  obtainMesh(kind: string, color: number): THREE.Group {
    const pool = this.projPool.get(kind) ?? [];
    let g = pool.pop();
    if (!g) {
      g = new THREE.Group();
      const geo = (projGeos as Record<string, THREE.BufferGeometry>)[kind] ?? projGeos.orb;
      const core = new THREE.Mesh(geo, glowMat(color));
      core.name = "core";
      core.renderOrder = 6;
      g.add(core);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        color,
        map: this.haloTex,
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      }));
      halo.name = "halo";
      halo.renderOrder = 5;
      const base = HALO_SCALE[kind] ?? 1.8;
      halo.scale.setScalar(base);
      halo.userData.base = base;
      g.add(halo);
      this.projPool.set(kind, pool);
    }
    /* retint: core materials are shared per color (swap refs); the halo's
    per-instance material is tinted directly toward white for heat */
    const core = g.children[0] as THREE.Mesh;
    const halo = g.children[1] as THREE.Sprite;
    core.material = glowMat(color);
    (halo.material as THREE.SpriteMaterial).color.setHex(color).lerp(WHITE_C, 0.25);
    (halo.material as THREE.SpriteMaterial).opacity = 0.55;
    halo.scale.setScalar((halo.userData.base as number) ?? 1.8);
    halo.position.set(0, 0, 0);
    g.visible = true;
    return g;
  }
  releaseMesh(kind: string, g: THREE.Group): void {
    g.visible = false;
    const pool = this.projPool.get(kind) ?? [];
    if (pool.length < 64) pool.push(g);
    this.projPool.set(kind, pool);
  }
  obtainBeam(color: number): THREE.Mesh {
    let m = this.beamPool.pop();
    if (!m) {
      m = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 8, 1, true), new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide
      }));
      m.rotation.x = Math.PI / 2; // lie along Z
    }
    (m.material as THREE.MeshBasicMaterial).color.setHex(color);
    m.visible = true;
    return m;
  }
  spawnBeam(x1: number, z1: number, x2: number, z2: number, y: number, color: number, width: number, life = 0.18): void {
    if (this.beams.length >= MAX_BEAM) {
      const old = this.beams.shift();
      if (old) {
        this.scene.remove(old.mesh);
        this.beamPool.push(old.mesh);
      }
    }
    const mesh = this.obtainBeam(color);
    const dx = x2 - x1,
      dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    mesh.scale.set(width, len, width);
    mesh.position.set((x1 + x2) / 2, y, (z1 + z2) / 2);
    mesh.rotation.set(Math.PI / 2, 0, 0);
    mesh.rotation.z = 0;
    /* orient: cylinder axis is Y; rotate to lie along the (dx,dz) direction */
    mesh.quaternion.setFromUnitVectors(tmpV.set(0, 1, 0), tmpV2.set(dx, 0.0001, dz).normalize());
    this.scene.add(mesh);
    this.beams.push({
      mesh,
      life,
      maxLife: life
    });
  }
  /* ------------------------------ spawning ------------------------------- */
  spawnProjectile(p: Partial<Projectile> & { kind: Projectile["kind"]; x: number; z: number; color: number }): Projectile {
    if (this.projectiles.length >= MAX_PROJ) {
      const oldest = this.projectiles.shift();
      if (oldest) {
        this.scene.remove(oldest.mesh);
        this.releaseMesh(oldest.kind, oldest.mesh);
      }
    }
    const mesh = this.obtainMesh(p.kind, p.color);
    this.scene.add(mesh);
    const proj = {
      kind: p.kind,
      x: p.x,
      y: p.y ?? 1.1,
      z: p.z,
      vx: p.vx ?? 0,
      vy: p.vy ?? 0,
      vz: p.vz ?? 0,
      life: p.life ?? 2.5,
      dmg: p.dmg ?? 10,
      radius: p.radius ?? 0.4,
      color: p.color,
      fromPlayer: p.fromPlayer ?? true,
      pierce: p.pierce ?? 0,
      homing: p.homing ?? 0,
      targetId: p.targetId ?? -1,
      knock: p.knock ?? 0,
      slowF: p.slowF ?? 1,
      slowT: p.slowT ?? 0,
      burnDps: p.burnDps ?? 0,
      burnT: p.burnT ?? 0,
      explodeRadius: p.explodeRadius ?? 0,
      element: p.element ?? "arcane",
      mesh,
      spinPhase: Math.random() * Math.PI * 2,
      arcT: p.arcT ?? 0,
      arcH: p.arcH ?? 0,
      startX: p.startX ?? p.x,
      startZ: p.startZ ?? p.z,
      targetX: p.targetX ?? p.x,
      targetZ: p.targetZ ?? p.z,
      hitIds: new Set<number>()
    };
    this.projectiles.push(proj);
    return proj;
  }
  addHazardToScene(h: Hazard): void {
    if (this.hazards.length >= MAX_HAZ) {
      const old = this.hazards.shift();
      if (old) this.disposeHazard(old);
    }
    this.hazards.push(h);
    this.scene.add(h.group);
  }
  disposeHazard(h: Hazard): void {
    /* visuals are pooled skeletons — remove from scene, hide, return to pool */this.scene.remove(h.group);
    h.group.visible = false;
    const pool = this.hazVis.get(h.kind) ?? [];
    if (pool.length < 12) pool.push(h.group);
    this.hazVis.set(h.kind, pool);
  }
  /* ------------------------------- casting ------------------------------- */
  power(def: { baseDamage: number }, ctx: SimContext): number {
    const p = ctx.player;
    return def.baseDamage * ctx.attunementMult * p.dmgMult * (p.surgeActive > 0 ? 1.5 : 1) * (1 + ctx.mercyF * MERCY_ATTACK);
  }
  /** Fire the selected spell toward (aimX, aimZ). Returns true if cast happened. */
  cast(element: ElementId, ctx: SimContext, defOverride?: SpellDef): boolean {
    /* v2.2 evolutions: the engine may pass an EVOLVED def (multipliers
    already applied by content.evolvedSpellDef). Everything downstream —
    power(), radius reads, colors — flows from this one def. */
    const def = defOverride ?? SPELLS[element];
    const p = ctx.player;
    const color = hexNum(defOverride ? def.color : elementColor(element));
    const ax = p.aimX,
      az = p.aimZ;
    let dx = ax - p.x,
      dz = az - p.z;
    const d = Math.hypot(dx, dz) || 1;
    dx /= d;
    dz /= d;
    const dmg = this.power(def, ctx);
    ctx.vfx.muzzleFlash(new THREE.Vector3(p.x + dx * 1.2, 1.3, p.z + dz * 1.2), color);
    /* cast feedback: ground telegraph at the aim point + player aura pulse */
    ctx.vfx.castGround(tmpV.set(ax, 0, az), color, (def.radius ?? 3) * 0.55);
    ctx.vfx.auraPulse(tmpV2.set(p.x, 0, p.z), color, 0.85);
    switch (def.behavior) {
      case "orb":
        {
          const range = Math.min(d, 17);
          this.spawnProjectile({
            kind: "orb",
            x: p.x + dx * 1.0,
            z: p.z + dz * 1.0,
            y: 1.3,
            vx: dx * 16,
            vz: dz * 16,
            dmg,
            color,
            radius: 0.42,
            life: range / 16 + 0.05,
            explodeRadius: def.radius ?? 3.2,
            element,
            burnDps: dmg * 0.16,
            burnT: 2.4
          });
          ctx.sfx.play("cast", {
            intensity: 0.55
          });
          break;
        }
      case "shards":
        {
          for (let i = -1; i <= 1; i++) {
            const a = Math.atan2(dx, dz) + i * 0.11;
            this.spawnProjectile({
              kind: "shard",
              x: p.x + dx * 0.8,
              z: p.z + dz * 0.8,
              y: 1.1,
              vx: Math.sin(a) * 24,
              vz: Math.cos(a) * 24,
              dmg: dmg * 0.55,
              color,
              radius: 0.35,
              pierce: 3,
              life: 0.9,
              element,
              slowF: 0.55,
              slowT: 1.4
            });
          }
          ctx.sfx.play("cast", {
            intensity: 0.4
          });
          break;
        }
      case "chain":
        {
          /* instant chain-lightning: nearest to aim, leaps outward */let src = { x: ax, z: az };
          const hit: Enemy[] = [];
          let curDmg = dmg;
          let prev = { x: p.x, z: p.z };
          for (let jump = 0; jump < 5; jump++) {
            let best: Enemy | null = null;
            let bestD = jump === 0 ? 9 : 10;
            for (const e of ctx.enemies) {
              if (e.dead || hit.includes(e)) continue;
              const dist = Math.hypot(e.x - src.x, e.z - src.z);
              if (dist < bestD) {
                bestD = dist;
                best = e;
              }
            }
            if (!best) break;
            /* jagged crackling arc + thin core beam between hops */
            this.spawnBeam(prev.x, prev.z, best.x, best.z, 1.4, color, jump === 0 ? 0.08 : 0.05, 0.15);
            ctx.vfx.arcFlash(tmpV.set(prev.x, 1.4, prev.z), tmpV2.set(best.x, 1.4, best.z), color, {
              life: 0.2
            });
            ctx.vfx.impact(tmpV.set(best.x, 1.2, best.z), color, undefined, 0.9);
            ctx.damageEnemy(best, curDmg, {
              color,
              isSpell: true
            });
            hit.push(best);
            prev = {
              x: best.x,
              z: best.z
            };
            src = {
              x: best.x,
              z: best.z
            };
            curDmg *= 0.85;
          }
          if (hit.length > 0) {
            ctx.shake(0.12);
            ctx.sfx.play("cast", {
              intensity: 0.8
            });
          } else ctx.sfx.play("deny", {
            intensity: 0.3
          });
          break;
        }
      case "ward":
        {
          const wx = p.x + dx * 3.4,
            wz = p.z + dz * 3.4;
          this.createWard(wx, wz, dx, dz, ctx);
          ctx.sfx.play("cast", {
            intensity: 0.6
          });
          break;
        }
      case "blink":
        {
          const dist = Math.min(d, 8.5);
          const ox = p.x,
            oz = p.z;
          let txp = p.x + dx * dist,
            tzp = p.z + dz * dist;
          const rd = Math.hypot(txp, tzp);
          if (rd > ctx.arenaRadius - 1) {
            txp *= (ctx.arenaRadius - 1) / rd;
            tzp *= (ctx.arenaRadius - 1) / rd;
          }
          p.x = txp;
          p.z = tzp;
          p.iframe = Math.max(p.iframe, 0.45);
          ctx.vfx.burst(new THREE.Vector3(ox, 1.2, oz), color, 22, {
            speed: 7
          });
          ctx.vfx.burst(new THREE.Vector3(txp, 1.2, tzp), color, 26, {
            speed: 8
          });
          ctx.vfx.ring(new THREE.Vector3(txp, 0, tzp), color, def.radius ?? 4);
          /* arrival strike: vertical light pillar + lingering scar + a curved
          crescent slash (10-d, kenney-crescent) sweeping out of the step */
          ctx.vfx.lightPillar(tmpV.set(txp, 0, tzp), color, {
            height: 5.5,
            width: 1.35,
            life: 0.45
          });
          ctx.vfx.groundDecal(tmpV, color, 3, {
            life: 1.2,
            intensity: 0.45
          });
          ctx.vfx.slashArc(tmpV.set(txp, 1.1, tzp), color, {
            size: 1.5,
            roll: Math.atan2(dx, dz) * 0.22 - 0.5,
            spin: 4.5,
            life: 0.32
          });
          for (const e of ctx.enemies) {
            if (e.dead) continue;
            if (Math.hypot(e.x - ox, e.z - oz) < (def.radius ?? 4)) ctx.damageEnemy(e, dmg, {
              color,
              isSpell: true
            });else if (Math.hypot(e.x - txp, e.z - tzp) < (def.radius ?? 4)) ctx.damageEnemy(e, dmg, {
              color,
              isSpell: true
            });
          }
          ctx.sfx.play("blink", {
            intensity: 0.9
          });
          break;
        }
      case "lance":
        {
          const len = 26;
          const ex = p.x + dx * len,
            ez = p.z + dz * len;
          this.spawnBeam(p.x, p.z, ex, ez, 1.3, color, 0.5, 0.22);
          this.spawnBeam(p.x, p.z, ex, ez, 1.3, 0xffffff, 0.24, 0.14);
          /* lens-flare glints marching along the shaft */
          for (let k = 1; k <= 3; k++) {
            const u = 0.14 + k * 0.22;
            ctx.vfx.glint(tmpV.set(p.x + dx * len * u, 1.3, p.z + dz * len * u), color, 0.7 + Math.random() * 0.3);
          }
          for (const e of ctx.enemies) {
            if (e.dead) continue;
            /* point-to-segment distance */
            const t = Math.max(0, Math.min(1, ((e.x - p.x) * dx + (e.z - p.z) * dz) / len));
            const cx = p.x + dx * t * len,
              cz = p.z + dz * t * len;
            if (Math.hypot(e.x - cx, e.z - cz) < 1.15 + e.radius) {
              ctx.damageEnemy(e, dmg, {
                color,
                isSpell: true
              });
              ctx.vfx.impact(tmpV.set(e.x, 1.2, e.z), color, undefined, 1.3);
              ctx.vfx.glint(tmpV.set(e.x, 1.5, e.z), 0xffffff, 1.1);
            }
          }
          ctx.shake(0.18);
          ctx.sfx.play("cast", {
            intensity: 1
          });
          break;
        }
      case "timenova":
        {
          this.createTimefield(ax, az, def.radius ?? 7, 3.2, ctx);
          /* frozen-hour beacon over the shroud */
          ctx.vfx.lightPillar(tmpV.set(ax, 0, az), color, {
            height: 6.5,
            width: 1.8,
            life: 0.55,
            intensity: 0.7
          });
          for (const e of ctx.enemies) {
            if (!e.dead && Math.hypot(e.x - ax, e.z - az) < (def.radius ?? 7)) {
              ctx.damageEnemy(e, dmg, {
                color,
                isSpell: true
              });
            }
          }
          ctx.sfx.play("slowmo", {
            intensity: 0.8
          });
          break;
        }
      case "well":
        {
          this.createWell(ax, az, def.radius ?? 5, 3.4, dmg * 0.5, ctx);
          ctx.sfx.play("offer", {
            intensity: 0.7
          });
          break;
        }
      case "fan":
        {
          for (let i = -2; i <= 2; i++) {
            const a = Math.atan2(dx, dz) + i * 0.24;
            const target = ctx.enemies.find(e => !e.dead);
            this.spawnProjectile({
              kind: "seeker",
              x: p.x + Math.sin(a) * 0.9,
              z: p.z + Math.cos(a) * 0.9,
              y: 1.25,
              vx: Math.sin(a) * 13,
              vz: Math.cos(a) * 13,
              dmg: dmg * 0.34,
              color,
              radius: 0.3,
              life: 2.4,
              homing: 7,
              targetId: target ? target.id : -1,
              element
            });
          }
          ctx.sfx.play("cast", {
            intensity: 0.5
          });
          break;
        }
      case "javelin":
        {
          this.spawnProjectile({
            kind: "javelin",
            x: p.x + dx * 1.1,
            z: p.z + dz * 1.1,
            y: 1.2,
            vx: dx * 24,
            vz: dz * 24,
            dmg,
            color,
            radius: 0.55,
            pierce: 99,
            life: 1.4,
            element
          });
          ctx.sfx.play("cast", {
            intensity: 0.9
          });
          break;
        }
      case "pod":
        {
          const range = Math.min(d, 14);
          this.spawnProjectile({
            kind: "pod",
            x: p.x,
            z: p.z,
            y: 1.2,
            arcT: 0,
            arcH: 4.5,
            startX: p.x,
            startZ: p.z,
            targetX: p.x + dx * range,
            targetZ: p.z + dz * range,
            life: 0.85,
            dmg,
            color,
            radius: 0.4,
            element,
            explodeRadius: 0.01
          });
          ctx.sfx.play("cast", {
            intensity: 0.45
          });
          break;
        }
      case "crescents":
        {
          for (let i = -1; i <= 1; i++) {
            const a = Math.atan2(dx, dz) + i * 0.18;
            this.spawnProjectile({
              kind: "crescent",
              x: p.x + dx,
              z: p.z + dz,
              y: 1.1,
              vx: Math.sin(a) * 19,
              vz: Math.cos(a) * 19,
              dmg: dmg * 0.45,
              color,
              radius: 0.55,
              pierce: 99,
              life: 0.8,
              knock: 7,
              element
            });
          }
          ctx.sfx.play("cast", {
            intensity: 0.5
          });
          break;
        }
      case "nova":
        {
          const r = def.radius ?? 6;
          ctx.vfx.ring(new THREE.Vector3(p.x, 0, p.z), color, r * 1.6);
          ctx.vfx.ring(new THREE.Vector3(p.x, 0, p.z), color, r * 1.15, {
            life: 0.45,
            thickness: 0.5
          });
          ctx.vfx.explosion(new THREE.Vector3(p.x, 1, p.z), color, r * 0.5);
          /* banshee cry pillar + lingering ground scar at the mage */
          ctx.vfx.lightPillar(tmpV.set(p.x, 0, p.z), color, {
            height: 7,
            width: 2,
            life: 0.5,
            intensity: 0.8
          });
          ctx.vfx.groundDecal(tmpV, color, r, {
            life: 1.4,
            intensity: 0.5
          });
          for (const e of ctx.enemies) {
            if (e.dead) continue;
            const ed = Math.hypot(e.x - p.x, e.z - p.z);
            if (ed < r + e.radius) {
              ctx.damageEnemy(e, dmg, {
                color,
                isSpell: true,
                knock: 10,
                sourceX: p.x,
                sourceZ: p.z
              });
              e.slowT = Math.max(e.slowT, 1.1);
              e.slowF = 0.6;
            }
          }
          ctx.shake(0.25);
          ctx.sfx.play("nova", {
            intensity: 0.8
          });
          break;
        }
    }
    return true;
  }
  /** Arcane volley — homing bolts while RMB held. */
  volley(ctx: SimContext): void {
    const p = ctx.player;
    const color = 0xf5c96b;
    const dmg = 12 * ctx.attunementMult * p.dmgMult * p.volleyDmg * (p.surgeActive > 0 ? 1.5 : 1) * (1 + ctx.mercyF * MERCY_ATTACK);
    const target = ctx.enemies.find(e => !e.dead);
    /* shared launch flash at the staff + small bloom ring at the mage */
    const aimA = Math.atan2(p.aimX - p.x, p.aimZ - p.z);
    ctx.vfx.muzzleFlash(tmpV.set(p.x + Math.sin(aimA) * 1.1, 1.5, p.z + Math.cos(aimA) * 1.1), color);
    ctx.vfx.ring(tmpV2.set(p.x, 0, p.z), color, 1.7, {
      life: 0.35,
      thickness: 0.35
    });
    for (let i = 0; i < p.volleyCount; i++) {
      const a = Math.atan2(p.aimX - p.x, p.aimZ - p.z) + (i - (p.volleyCount - 1) / 2) * 0.3;
      this.spawnProjectile({
        kind: "volley",
        x: p.x + Math.sin(a) * 0.8,
        z: p.z + Math.cos(a) * 0.8,
        y: 1.5,
        vx: Math.sin(a) * 15,
        vz: Math.cos(a) * 15,
        dmg,
        color,
        radius: 0.25,
        life: 2.2,
        homing: 10,
        targetId: target ? target.id : -1
      });
    }
    ctx.sfx.play("volley", {
      intensity: 0.5
    });
  }
  /** The resonance weave — two different elements within the window. */
  triggerResonance(a: ElementId, b: ElementId, ctx: SimContext): ResonanceResult | null {
    const key = comboKey(a, b);
    const combo = COMBOS[key];
    if (!combo) return null;
    const defA = SPELLS[a],
      defB = SPELLS[b];
    const p = ctx.player;
    const dmg = (defA.baseDamage + defB.baseDamage) * ctx.attunementMult * p.dmgMult * 1.6 * (p.surgeActive > 0 ? 1.5 : 1) * (1 + ctx.mercyF * MERCY_ATTACK);
    const colorA = hexNum(defA.color),
      colorB = hexNum(defB.color);
    const x = p.aimX,
      z = p.aimZ;
    const radius = 7.5;
    /* THE SIGNATURE MOMENT — crossed dual-color ring pair + vertical light
    pillar + double ground rings + radial burst + lingering dual scar */
    ctx.vfx.crossRings(tmpV.set(x, 1.5, z), colorA, colorB, 2.6, {
      life: 0.7
    });
    ctx.vfx.lightPillar(tmpV2.set(x, 0, z), colorA, {
      height: 12,
      width: 2.6,
      life: 0.85,
      intensity: 0.95
    });
    ctx.vfx.groundDecal(tmpV2, colorB, radius * 1.5, {
      life: 1.8,
      intensity: 0.6
    });
    ctx.vfx.ring(new THREE.Vector3(x, 0, z), colorA, radius * 1.5, {
      life: 0.7
    });
    ctx.vfx.ring(new THREE.Vector3(x, 0, z), colorB, radius * 1.15, {
      life: 0.55,
      thickness: 0.5
    });
    ctx.vfx.explosion(new THREE.Vector3(x, 1.2, z), colorA, radius * 0.55);
    ctx.vfx.burst(new THREE.Vector3(x, 1.4, z), colorB, 40, {
      speed: 12,
      life: 1
    });
    ctx.vfx.burst(new THREE.Vector3(x, 1.4, z), colorA, 40, {
      speed: 12,
      life: 1
    });
    ctx.vfx.glint(tmpV.set(x, 1.8, z), 0xffffff, 1.7);
    ctx.shake(0.5);
    ctx.slowmo(0.22, 0.35);
    ctx.sfx.play("resonance", {
      intensity: 1
    });
    let dealt = 0;
    for (const e of ctx.enemies) {
      if (e.dead) continue;
      const d = Math.hypot(e.x - x, e.z - z);
      if (d < radius + e.radius) {
        const falloff = 1 - Math.min(0.45, d / radius * 0.45);
        dealt += dmg * falloff;
        ctx.damageEnemy(e, dmg * falloff, {
          color: colorA,
          isSpell: true,
          knock: 5,
          sourceX: x,
          sourceZ: z
        });
      }
    }
    return {
      key,
      name: combo.name,
      damageDealt: dealt
    };
  }
  /* ------------------------------- hazards ------------------------------- */ /* Pooled per-kind visual skeletons (built once, reused forever). Child
                                                                                indices are load-bearing — updateHazards() animates by index:
                                                                                ward:      [0..2] slabs, [3] rune ring, [4] top rail, [5] bottom rail
                                                                                well:      [0] funnel shell, [1] core, [2] dark disc, [3] rim ring
                                                                                cloud:     [0] mist shell, [1] ground stain, [2] inner mist
                                                                                timefield: [0] dome, [1] rim ring, [2] ripple A, [3] ripple B, [4] tick ring
                                                                                shockring: [0] main torus, [1] after-image torus
                                                                                rift:      [0] core, [1] ground ring, [2] dark disc                            */
  buildWardVis(): THREE.Group {
    const g = new THREE.Group();
    const slabMat = new THREE.MeshStandardMaterial({
      color: 0xc9955a,
      roughness: 0.8,
      emissive: 0x5a3c1a,
      emissiveIntensity: 0.9
    });
    slabMat.userData.rc = 2;
    slabMat.userData.op = 1;
    for (let i = -1; i <= 1; i++) {
      const slab = new THREE.Mesh(wardGeo, slabMat);
      slab.position.set(i * 1.75, 1.3, 0);
      slab.rotation.z = (i === 0 ? 0 : 0.06) * i;
      g.add(slab);
    }
    /* pulsing rune ring under the wall + glowing edge rails */
    const rune = new THREE.Mesh(wardRingGeo, mkAdditive(0xeec390, 0.75));
    rune.rotation.x = -Math.PI / 2;
    rune.position.y = 0.06;
    rune.renderOrder = 8;
    g.add(rune);
    const railTop = new THREE.Mesh(wardRailGeo, mkAdditive(0xeec390, 0.45));
    railTop.position.set(0, 2.62, 0);
    railTop.renderOrder = 8;
    g.add(railTop);
    const railBot = new THREE.Mesh(wardRailGeo, mkAdditive(0xeec390, 0.3));
    railBot.position.set(0, 0.14, 0);
    railBot.renderOrder = 8;
    g.add(railBot);
    return g;
  }
  buildWellVis(): THREE.Group {
    const g = new THREE.Group();
    const shell = new THREE.Mesh(wellGeo, mkAdditive(0xd05bff, 0.3));
    shell.position.y = 0.3;
    shell.renderOrder = 8;
    g.add(shell);
    const core = new THREE.Mesh(projGeos.orb, mkAdditive(0xd05bff, 0.95));
    core.position.y = 0.85;
    core.renderOrder = 8;
    g.add(core);
    /* dark heart disc (normal blending — reads as absence) */
    const disc = new THREE.Mesh(discGeo, new THREE.MeshBasicMaterial({
      color: 0x070312,
      transparent: true,
      opacity: 0.55,
      depthWrite: false
    }));
    disc.material.userData.op = 0.55;
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.045;
    disc.renderOrder = 7;
    g.add(disc);
    /* bright violet rim */
    const rim = new THREE.Mesh(rimGeo, mkAdditive(0xecb3ff, 0.7));
    rim.rotation.x = -Math.PI / 2;
    rim.position.y = 0.07;
    rim.renderOrder = 8;
    g.add(rim);
    return g;
  }
  buildCloudVis(): THREE.Group {
    const g = new THREE.Group();
    const mist = new THREE.Mesh(cloudGeo, mkAdditive(0x7ed957, 0.16));
    mist.position.y = 0.8;
    mist.renderOrder = 8;
    g.add(mist);
    /* faint ground stain */
    const stain = new THREE.Mesh(discGeo, mkAdditive(0x4e8f38, 0.12, 0));
    stain.rotation.x = -Math.PI / 2;
    stain.position.y = 0.04;
    stain.renderOrder = 7;
    g.add(stain);
    const inner = new THREE.Mesh(cloudGeo, mkAdditive(0x9ee670, 0.1));
    inner.position.y = 0.55;
    inner.renderOrder = 8;
    g.add(inner);
    return g;
  }
  buildTimefieldVis(): THREE.Group {
    const g = new THREE.Group();
    const domeMat = mkAdditive(0x6bf0c2, 0.14);
    domeMat.wireframe = true;
    const dome = new THREE.Mesh(cloudGeo, domeMat);
    dome.position.y = 0.5;
    dome.renderOrder = 8;
    g.add(dome);
    const rim = new THREE.Mesh(rimGeo, mkAdditive(0xc0ffe6, 0.6));
    rim.rotation.x = -Math.PI / 2;
    rim.position.y = 0.07;
    rim.renderOrder = 8;
    g.add(rim);
    const ripA = new THREE.Mesh(rippleGeo, mkAdditive(0x6bf0c2, 0.4));
    ripA.rotation.x = -Math.PI / 2;
    ripA.position.y = 0.06;
    ripA.renderOrder = 8;
    g.add(ripA);
    const ripB = new THREE.Mesh(rippleGeo, mkAdditive(0x6bf0c2, 0.4));
    ripB.rotation.x = -Math.PI / 2;
    ripB.position.y = 0.06;
    ripB.renderOrder = 8;
    g.add(ripB);
    /* counter-rotating clock-tick ring (12 marks) */
    const ticks = new THREE.LineSegments(tickGeo, new THREE.LineBasicMaterial({
      color: 0xc0ffe6,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    }));
    ticks.position.y = 0.06;
    ticks.renderOrder = 8;
    g.add(ticks);
    return g;
  }
  buildShockringVis(): THREE.Group {
    const g = new THREE.Group();
    const main = new THREE.Mesh(shockTorusGeo, mkAdditive(0xffffff, 0.95));
    main.rotation.x = -Math.PI / 2;
    main.position.y = 0.35;
    main.renderOrder = 8;
    g.add(main);
    /* after-image ring trailing the shockfront */
    const ghost = new THREE.Mesh(shockGhostGeo, mkAdditive(0xffffff, 0.3));
    ghost.rotation.x = -Math.PI / 2;
    ghost.position.y = 0.35;
    ghost.renderOrder = 8;
    g.add(ghost);
    return g;
  }
  buildRiftVis(): THREE.Group {
    const g = new THREE.Group();
    const core = new THREE.Mesh(projGeos.orb, mkAdditive(0xd05bff, 0.95));
    core.scale.setScalar(1.6);
    core.position.y = 1.0;
    core.renderOrder = 8;
    g.add(core);
    const ring = new THREE.Mesh(riftRingGeo, mkAdditive(0xd05bff, 0.7));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.08;
    ring.renderOrder = 8;
    g.add(ring);
    const disc = new THREE.Mesh(discGeo, new THREE.MeshBasicMaterial({
      color: 0x070312,
      transparent: true,
      opacity: 0.5,
      depthWrite: false
    }));
    disc.material.userData.op = 0.5;
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.045;
    disc.renderOrder = 7;
    g.add(disc);
    return g;
  }
  /** Fetch a hazard visual skeleton from the pool (building on first use),
    reset its transform, retint it and restore base opacities/scales. */
  obtainHazardVis(kind: Hazard["kind"], baseColor: number, glowColor: number, radius: number): THREE.Group {
    const pool = this.hazVis.get(kind) ?? [];
    let g = pool.pop();
    if (!g) {
      g = kind === "ward" ? this.buildWardVis() : kind === "well" ? this.buildWellVis() : kind === "cloud" ? this.buildCloudVis() : kind === "timefield" ? this.buildTimefieldVis() : kind === "shockring" ? this.buildShockringVis() : this.buildRiftVis();
      this.hazVis.set(kind, pool);
    }
    g.visible = true;
    g.position.set(0, 0, 0);
    g.rotation.set(0, 0, 0);
    g.scale.setScalar(1);
    g.userData.color = glowColor;
    /* retint + restore base opacity (the fade-out clamped these last life) */
    g.traverse(o => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (!m) return;
      const rc = m.userData?.rc;
      if (rc === 1) (m as THREE.MeshBasicMaterial).color.setHex(glowColor);else if (rc === 2) {
        const sm = m as unknown as THREE.MeshStandardMaterial;
        sm.color.setHex(baseColor);
        sm.emissive.setHex(glowColor).multiplyScalar(0.35);
        sm.emissiveIntensity = 0.9;
      }
      const op = m.userData?.op;
      if (typeof op === "number") (m as THREE.MeshBasicMaterial).opacity = op;
    });
    /* per-kind scale resets */
    switch (kind) {
      case "well":
        {
          const c = g.children;
          c[0].scale.set(radius, 1, radius);
          c[1].scale.setScalar(radius * 0.32);
          c[2].scale.setScalar(radius * 0.62);
          c[3].scale.setScalar(radius * 0.98);
          break;
        }
      case "cloud":
        {
          const c = g.children;
          c[0].scale.set(radius, radius * 0.5, radius);
          c[1].scale.setScalar(radius * 0.92);
          c[2].scale.set(radius * 0.6, radius * 0.34, radius * 0.6);
          break;
        }
      case "timefield":
        {
          const c = g.children;
          c[0].scale.set(radius, radius * 0.6, radius);
          c[1].scale.setScalar(radius);
          c[2].scale.setScalar(radius);
          c[3].scale.setScalar(radius);
          c[4].scale.setScalar(radius);
          break;
        }
      case "rift":
        {
          g.children[0].scale.setScalar(1.6);
          g.children[2].scale.setScalar(4.2);
          break;
        }
      case "shockring":
        g.scale.setScalar(1.5); // sim re-scales to ringR every frame
        break;
      default:
        break;
      // ward: fixed size; caller sets position + facing
    }
    return g;
  }
  createWard(x: number, z: number, dx: number, dz: number, ctx: SimContext): void {
    const group = this.obtainHazardVis("ward", 0xc9955a, 0xeec390, 0);
    group.position.set(x, 0, z);
    /* orient the wall so its long axis runs perpendicular to the cast dir */
    group.rotation.y = Math.atan2(-dx, -dz);
    this.addHazardToScene({
      kind: "ward",
      x,
      z,
      y: 0,
      radius: 2.7,
      life: 6,
      maxLife: 6,
      friendly: true,
      group,
      dx,
      dz
    });
    ctx.vfx.burst(new THREE.Vector3(x, 1, z), 0xc9955a, 14, {
      speed: 4,
      up: 4
    });
    ctx.vfx.ring(new THREE.Vector3(x, 0, z), 0xeec390, 2.9, {
      life: 0.45
    });
  }
  createWell(x: number, z: number, radius: number, life: number, dps: number, ctx: SimContext): void {
    const color = 0xd05bff;
    const group = this.obtainHazardVis("well", color, color, radius);
    group.position.set(x, 0, z);
    this.addHazardToScene({
      kind: "well",
      x,
      z,
      y: 0,
      radius,
      life,
      maxLife: life,
      friendly: true,
      group,
      dps,
      pull: 9
    });
    ctx.vfx.ring(new THREE.Vector3(x, 0, z), color, radius * 1.2);
    /* implosion telegraph — the wound swallows inward */
    ctx.vfx.ring(new THREE.Vector3(x, 0, z), color, radius, {
      life: 0.7,
      contract: true,
      thickness: 0.35
    });
  }
  createCloud(x: number, z: number, radius: number, life: number, dps: number, ctx: SimContext): void {
    const color = 0x7ed957;
    const group = this.obtainHazardVis("cloud", 0x4e8f38, color, radius);
    group.position.set(x, 0, z);
    this.addHazardToScene({
      kind: "cloud",
      x,
      z,
      y: 0,
      radius,
      life,
      maxLife: life,
      friendly: true,
      group,
      dps,
      slowF: 0.7
    });
    ctx.vfx.explosion(new THREE.Vector3(x, 0.6, z), color, radius * 0.4);
  }
  createTimefield(x: number, z: number, radius: number, life: number, ctx: SimContext): void {
    const color = 0x6bf0c2;
    const group = this.obtainHazardVis("timefield", color, 0xc0ffe6, radius);
    group.position.set(x, 0, z);
    this.addHazardToScene({
      kind: "timefield",
      x,
      z,
      y: 0,
      radius,
      life,
      maxLife: life,
      friendly: true,
      group,
      slowF: 0.1
    });
    ctx.vfx.ring(new THREE.Vector3(x, 0, z), color, radius);
    ctx.slowmo(0.12, 0.5);
  }
  /** Boss shockwave — expanding ring that damages the mage as it passes. */
  createBossShockring(x: number, z: number, color: number, dmg: number, speed: number, ctx: SimContext): void {
    const group = this.obtainHazardVis("shockring", color, color, 0);
    group.position.set(x, 0, z);
    group.scale.setScalar(1.5);
    this.addHazardToScene({
      kind: "shockring",
      x,
      z,
      y: 0,
      radius: 15,
      life: 15 / speed,
      maxLife: 15 / speed,
      friendly: false,
      group,
      ringSpeed: speed,
      ringR: 1.5,
      hitPlayer: false,
      dps: dmg
    });
    ctx.vfx.ring(new THREE.Vector3(x, 0, z), color, 6);
  }
  /** Boss gravity rift — drags the mage in, then detonates. */
  createBossRift(x: number, z: number, color: number, dmg: number, ctx: SimContext): void {
    const group = this.obtainHazardVis("rift", color, color, 0);
    group.position.set(x, 0, z);
    this.addHazardToScene({
      kind: "rift",
      x,
      z,
      y: 0,
      radius: 5,
      life: 2.3,
      maxLife: 2.3,
      friendly: false,
      group,
      pullPlayer: 7.5,
      dps: dmg,
      armed: false
    });
    /* opening tear telegraph */
    ctx.vfx.lightPillar(tmpV.set(x, 0, z), color, {
      height: 7,
      width: 1.7,
      life: 0.5,
      intensity: 0.7
    });
    ctx.vfx.ring(new THREE.Vector3(x, 0, z), color, 5.4, {
      life: 0.5
    });
    ctx.banner("A VORTEX OPENS", "Break free before it collapses", "#d05bff");
  }
  /* ------------------------------ enemy bolts ---------------------------- */
  spawnEnemyBolt(x: number, y: number, z: number, tx: number, tz: number, speed: number, dmg: number, color: number, radius = 0.3): void {
    const dx = tx - x,
      dz = tz - z;
    const d = Math.hypot(dx, dz) || 1;
    this.spawnProjectile({
      kind: "ebolt",
      x,
      y,
      z,
      vx: dx / d * speed,
      vz: dz / d * speed,
      dmg,
      color,
      radius,
      life: 4,
      fromPlayer: false,
      element: "enemy"
    });
  }
  /* ------------------------------- update -------------------------------- */
  update(dt: number, ctx: SimContext): void {
    this.updateProjectiles(dt, ctx);
    this.updateHazards(dt, ctx);
    this.updateBeams(dt);
  }
  updateBeams(dt: number): void {
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      b.life -= dt;
      const f = Math.max(0, b.life / b.maxLife);
      (b.mesh.material as THREE.MeshBasicMaterial).opacity = f * 0.9;
      b.mesh.scale.x = b.mesh.scale.z = Math.max(0.01, b.mesh.scale.x * (1 - dt * 2));
      if (b.life <= 0) {
        this.scene.remove(b.mesh);
        this.beamPool.push(b.mesh);
        this.beams.splice(i, 1);
      }
    }
  }
  updateProjectiles(dt: number, ctx: SimContext): void {
    const p = ctx.player;
    const q = ctx.quality * (ctx.vfx.reduced ? 0.5 : 1);
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      pr.life -= dt;
      pr.spinPhase += dt * 9;
      /* homing steer */
      if (pr.homing > 0 && pr.fromPlayer) {
        let target: Enemy | null = null;
        for (const e of ctx.enemies) {
          if (e.dead) continue;
          if (pr.targetId >= 0 && e.id !== pr.targetId) continue;
          target = e;
          break;
        }
        if (!target || target.dead) {
          pr.targetId = -1;
          target = ctx.enemies.find(e => !e.dead) ?? null;
        }
        if (target) {
          const dx = target.x - pr.x,
            dz = target.z - pr.z;
          const d = Math.hypot(dx, dz) || 1;
          const sp = Math.hypot(pr.vx, pr.vz) || 1;
          pr.vx += (dx / d * sp - pr.vx) * Math.min(1, pr.homing * dt);
          pr.vz += (dz / d * sp - pr.vz) * Math.min(1, pr.homing * dt);
          const ns = Math.hypot(pr.vx, pr.vz) || 1;
          pr.vx = pr.vx / ns * sp;
          pr.vz = pr.vz / ns * sp;
          /* steering sparkle — the seeker writes its correction in light */
          if (Math.random() < dt * 9 * q) {
            ctx.vfx.trailPuff(tmpV.set(pr.x, pr.y, pr.z), 0xffffff, 1, T_STEER_SPARK);
          }
        }
      }
      /* flight */
      if (pr.kind === "pod") {
        pr.arcT = Math.min(1, pr.arcT + dt / 0.85);
        const t = pr.arcT;
        pr.x = pr.startX + (pr.targetX - pr.startX) * t;
        pr.z = pr.startZ + (pr.targetZ - pr.startZ) * t;
        pr.y = 1.0 + Math.sin(t * Math.PI) * pr.arcH;
        if (t >= 1) {
          /* lands → blight cloud */this.createCloud(pr.targetX, pr.targetZ, 4.5, 4, pr.dmg * 0.22, ctx);
          ctx.vfx.explosion(new THREE.Vector3(pr.x, 0.5, pr.z), pr.color, 2);
          ctx.sfx.play("explode", {
            intensity: 0.4
          });
          this.killProjectile(i, false);
          continue;
        }
      } else {
        pr.x += pr.vx * dt;
        pr.z += pr.vz * dt;
        pr.y += pr.vy * dt;
        pr.y = Math.max(0.4, pr.y - dt * 2.2); /* gentle fall */
      }
      /* per-element particle trail */
      this.emitTrail(pr, ctx, dt);
      /* visuals */
      pr.mesh.position.set(pr.x, pr.y, pr.z);
      const dirA = Math.atan2(pr.vx, pr.vz);
      pr.mesh.rotation.set(pr.kind === "crescent" ? Math.PI / 2 : 0, dirA, pr.spinPhase * (pr.kind === "crescent" ? 1 : 0.2));
      if (pr.kind === "shard" || pr.kind === "javelin") pr.mesh.rotation.x = Math.PI / 2;
      /* layered halo: flicker + heat-shimmer wobble on fat cores, gentle
      breathing on seekers/volleys (children[1] is the billboard sprite) */
      const halo = pr.mesh.children[1];
      if (halo) {
        const base = halo.userData.base ?? 1.8;
        if (pr.kind === "orb" || pr.kind === "pod") {
          halo.scale.setScalar(base * (1 + 0.15 * Math.sin(pr.spinPhase * 2.6) + 0.05 * Math.sin(pr.spinPhase * 9.7)));
          halo.position.set(Math.sin(pr.spinPhase * 3.1) * 0.07, Math.cos(pr.spinPhase * 2.3) * 0.05, 0);
          pr.mesh.children[0].scale.setScalar(1 + 0.07 * Math.sin(pr.spinPhase * 2.2));
        } else if (pr.kind === "seeker" || pr.kind === "volley") {
          halo.scale.setScalar(base * (1 + 0.1 * Math.sin(pr.spinPhase * 3.3)));
        }
      }
      /* out of bounds */
      if (pr.life <= 0 || Math.hypot(pr.x, pr.z) > ctx.arenaRadius + 4) {
        if (pr.explodeRadius > 0.1 && pr.fromPlayer) this.explode(pr, ctx);else {
          /* quiet expire fizzle */ctx.vfx.trailPuff(tmpV.set(pr.x, pr.y, pr.z), pr.color, 3, T_FIZZLE);
        }
        this.killProjectile(i, true);
        continue;
      }
      /* ward blocks enemy bolts */
      if (!pr.fromPlayer && this.boltBlockedByWard(pr, ctx)) {
        ctx.vfx.impact(tmpV.set(pr.x, pr.y, pr.z), 0xeec390, undefined, 0.8);
        this.killProjectile(i, true);
        continue;
      }
      /* collisions */
      if (pr.fromPlayer) {
        let hitSomething = false;
        for (const e of ctx.enemies) {
          if (e.dead || pr.hitIds.has(e.id)) continue;
          const dy = Math.abs(e.y + 1 - pr.y);
          const d = Math.hypot(e.x - pr.x, e.z - pr.z);
          if (d < e.radius + pr.radius && dy < 2.2) {
            pr.hitIds.add(e.id);
            ctx.damageEnemy(e, pr.dmg, {
              color: pr.color,
              isSpell: true,
              knock: pr.knock,
              sourceX: pr.x - pr.vx * 0.05,
              sourceZ: pr.z - pr.vz * 0.05
            });
            if (pr.slowT > 0) {
              e.slowT = Math.max(e.slowT, pr.slowT);
              e.slowF = Math.min(e.slowF === 1 ? 9 : e.slowF, pr.slowF);
            }
            if (pr.burnT > 0) {
              e.burnT = Math.max(e.burnT, pr.burnT);
              e.burnDps = Math.max(e.burnDps, pr.burnDps);
              e.burnColor = pr.color;
            }
            ctx.vfx.impact(tmpV.set(pr.x, pr.y, pr.z), pr.color, tmpV2.set(pr.vx, 0, pr.vz).normalize(), 1);
            if (pr.explodeRadius > 0.1) {
              this.explode(pr, ctx);
              this.killProjectile(i, true);
              hitSomething = true;
              break;
            }
            if (pr.pierce <= 0) {
              this.killProjectile(i, true);
              hitSomething = true;
              break;
            }
            pr.pierce--;
          }
        }
        if (hitSomething) continue;
      } else {
        const d = Math.hypot(p.x - pr.x, p.z - pr.z);
        if (d < 0.65 + pr.radius && Math.abs(pr.y - 1) < 1.6) {
          ctx.damagePlayer(pr.dmg, pr.x, pr.z, "a hostile bolt");
          ctx.vfx.impact(tmpV.set(pr.x, pr.y, pr.z), pr.color, undefined, 1.2);
          this.killProjectile(i, true);
          continue;
        }
      }
    }
  }
  /** Per-element projectile trails — each element's signature in the air.
    Rates scale with ctx.quality and vfx reduced-motion; all option records
    are module-scope constants (zero steady-state allocation). */
  emitTrail(pr: Projectile, ctx: SimContext, dt: number): void {
    const q = ctx.quality * (ctx.vfx.reduced ? 0.5 : 1);
    const vfx = ctx.vfx;
    const px = pr.x,
      py = pr.y,
      pz = pr.z;
    if (pr.kind === "volley") {
      /* arcane volley: golden glint sparks */if (Math.random() < dt * 22 * q) vfx.trailPuff(tmpV.set(px, py, pz), 0xf5c96b, 1, T_VOLLEY);
      return;
    }
    if (pr.kind === "ebolt" || pr.kind === "bossbolt") {
      /* hostile bolts: faint smolder */if (Math.random() < dt * 12 * q) vfx.trailPuff(tmpV.set(px, py, pz), pr.color, 1, T_EBOLT);
      return;
    }
    switch (pr.element) {
      case "fire":
        /* embers rising off a flame core + thin smoke */if (Math.random() < dt * 26 * q) vfx.trailPuff(tmpV.set(px, py, pz), Math.random() < 0.5 ? 0xff7847 : 0xffb08a, 1, T_FIRE_EMBER);
        if (Math.random() < dt * 6 * q) vfx.trailPuff(tmpV.set(px, py, pz), 0x3a2418, 1, T_FIRE_SMOKE);
        break;
      case "ice":
        /* sparkle glints + pale rime mist */if (Math.random() < dt * 30 * q) vfx.trailPuff(tmpV.set(px, py, pz), 0xeafcff, 1, T_ICE_GLINT);
        if (Math.random() < dt * 10 * q) vfx.trailPuff(tmpV.set(px, py, pz), 0xbfe8ff, 1, T_ICE_MIST);
        break;
      case "arcane":
        {
          /* curved ribbon trail (lateral offset + sway) + steering sparkle */const sp = Math.hypot(pr.vx, pr.vz) || 1;
          const off = Math.sin(pr.spinPhase * 1.7) * 0.22;
          T_RIBBON.ox = -pr.vz / sp * off - pr.vx / sp * 0.22;
          T_RIBBON.oz = pr.vx / sp * off - pr.vz / sp * 0.22;
          if (Math.random() < dt * 30 * q) vfx.trailPuff(tmpV.set(px, py, pz), 0x9a7bff, 1, T_RIBBON);
          if (Math.random() < dt * 8 * q) vfx.trailPuff(tmpV.set(px, py, pz), 0xffffff, 1, T_WHITE_SPARK);
          break;
        }
      case "blood":
        /* heavy droplets raining off the javelin + dark ichor mist */if (Math.random() < dt * 34 * q) vfx.trailPuff(tmpV.set(px, py, pz), 0xff4d6b, 1, T_BLOOD_DROP);
        if (Math.random() < dt * 8 * q) vfx.trailPuff(tmpV.set(px, py, pz), 0x7a0e20, 1, T_BLOOD_MIST);
        break;
      case "nature":
        /* drifting spore motes + rising blight bubbles */if (Math.random() < dt * 22 * q) vfx.trailPuff(tmpV.set(px, py, pz), 0x9ee670, 1, T_SPORE);
        if (Math.random() < dt * 13 * q) vfx.trailPuff(tmpV.set(px, py, pz), 0xb9f29a, 1, T_BUBBLE);
        break;
      case "wind":
        /* wake streaklets trailing behind the blade */if (Math.random() < dt * 32 * q) {
          T_WIND_STREAK.vx = -pr.vx * 0.12;
          T_WIND_STREAK.vz = -pr.vz * 0.12;
          vfx.trailPuff(tmpV.set(px, py, pz), 0x8ce8dc, 1, T_WIND_STREAK);
        }
        break;
      default:
        if (Math.random() < dt * 22 * q) vfx.trailPuff(tmpV.set(px, py, pz), pr.color, 1, T_GENERIC);
        break;
    }
  }
  explode(pr: Projectile, ctx: SimContext): void {
    const r = pr.explodeRadius;
    ctx.vfx.explosion(new THREE.Vector3(pr.x, 1, pr.z), pr.color, r);
    ctx.vfx.ring(new THREE.Vector3(pr.x, 0, pr.z), pr.color, r * 1.6);
    /* pod blasts cough a ring of spores on top of the fireball */
    if (pr.element === "nature") {
      ctx.vfx.trailPuff(tmpV.set(pr.x, 0.6, pr.z), 0x9ee670, 10, T_POD_SPORES);
    }
    ctx.shake(0.22);
    ctx.sfx.play("explode", {
      intensity: 0.6
    });
    for (const e of ctx.enemies) {
      if (e.dead || pr.hitIds.has(e.id)) continue;
      const d = Math.hypot(e.x - pr.x, e.z - pr.z);
      if (d < r + e.radius) {
        pr.hitIds.add(e.id);
        const fall = 1 - Math.min(0.4, d / (r + e.radius) * 0.4);
        ctx.damageEnemy(e, pr.dmg * fall, {
          color: pr.color,
          isSpell: true,
          knock: 3,
          sourceX: pr.x,
          sourceZ: pr.z
        });
        if (pr.burnT > 0) {
          e.burnT = Math.max(e.burnT, pr.burnT);
          e.burnDps = Math.max(e.burnDps, pr.burnDps * 0.6);
          e.burnColor = pr.color;
        }
      }
    }
  }
  boltBlockedByWard(pr: Projectile, ctx: SimContext): boolean {
    for (const h of ctx.hazards) {
      if (h.kind !== "ward" || h.life <= 0) continue;
      const dx = h.dx ?? 0,
        dz = h.dz ?? 0;
      const relX = pr.x - h.x,
        relZ = pr.z - h.z;
      const along = relX * dx + relZ * dz;
      const lateral = -relX * dz + relZ * dx;
      if (Math.abs(lateral) < 2.6 && Math.abs(along) < 0.6) return true;
    }
    return false;
  }
  killProjectile(i: number, _release: boolean): void {
    const pr = this.projectiles[i];
    this.scene.remove(pr.mesh);
    this.releaseMesh(pr.kind, pr.mesh);
    this.projectiles.splice(i, 1);
  }
  updateHazards(dt: number, ctx: SimContext): void {
    const p = ctx.player;
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i];
      h.life -= dt;
      switch (h.kind) {
        case "ward":
          {
            /* rise from the ground on spawn, sink on expiry */if (h.life > 5.4) h.group.position.y = -2.8 + (6 - h.life) * 4.6;else h.group.position.y = -Math.max(0, 0.8 - h.life) * 3.5;
            /* pulsing rune glow + edge rails + breathing stone emissive */
            const wc = h.group.children as THREE.Mesh[];
            (wc[3].material as THREE.MeshBasicMaterial).opacity = 0.5 + 0.35 * Math.sin(ctx.time * 3.4);
            (wc[4].material as THREE.MeshBasicMaterial).opacity = 0.28 + 0.22 * Math.sin(ctx.time * 4.2);
            (wc[5].material as THREE.MeshBasicMaterial).opacity = 0.28 + 0.22 * Math.sin(ctx.time * 4.2 + 2.1);
            (wc[0].material as THREE.MeshStandardMaterial).emissiveIntensity = 0.7 + 0.35 * Math.sin(ctx.time * 2.6);
            break;
          }
        case "well":
          {
            for (const e of ctx.enemies) {
              if (e.dead || e.boss) continue;
              const dx = h.x - e.x,
                dz = h.z - e.z;
              const d = Math.hypot(dx, dz);
              if (d < h.radius * 2.2 && d > 0.01) {
                const pull = (h.pull ?? 8) * dt * (1 - Math.min(1, d / (h.radius * 2.2)));
                e.x += dx / d * pull;
                e.z += dz / d * pull;
              }
              if (d < h.radius + e.radius) {
                ctx.damageEnemy(e, (h.dps ?? 10) * dt, {
                  color: 0xd05bff,
                  noNumbers: true
                });
              }
            }
            h.group.rotation.y += dt * 2.5;
            const wch = h.group.children as THREE.Mesh[];
            /* funnel breathes, core throbs, rim pulses */
            wch[0].scale.y = 1 + Math.sin(ctx.time * 6) * 0.15;
            wch[1].scale.setScalar(h.radius * 0.32 * (1 + 0.16 * Math.sin(ctx.time * 5.2)));
            (wch[3].material as THREE.MeshBasicMaterial).opacity = 0.5 + 0.3 * Math.sin(ctx.time * 4);
            /* inward-spiraling violet motes */
            const wq = ctx.quality * (ctx.vfx.reduced ? 0.5 : 1);
            if (Math.random() < dt * 26 * wq) {
              const a = Math.random() * Math.PI * 2;
              const rr = h.radius * (1 + Math.random() * 0.2);
              const ca = Math.cos(a),
                sa = Math.sin(a);
              T_WELL_SPIRAL.vx = -sa * 2.6 - ca * 1.9;
              T_WELL_SPIRAL.vz = ca * 2.6 - sa * 1.9;
              ctx.vfx.trailPuff(tmpV.set(h.x + ca * rr, 0.3 + Math.random() * 0.6, h.z + sa * rr), 0xd05bff, 1, T_WELL_SPIRAL);
            }
            /* occasional implosion ripple */
            if (Math.random() < dt * 0.9) {
              ctx.vfx.ring(tmpV.set(h.x, 0, h.z), 0xd05bff, h.radius * 1.05, R_WELL_RIPPLE);
            }
            break;
          }
        case "cloud":
          {
            for (const e of ctx.enemies) {
              if (e.dead) continue;
              const d = Math.hypot(e.x - h.x, e.z - h.z);
              if (d < h.radius + e.radius) {
                ctx.damageEnemy(e, (h.dps ?? 8) * dt, {
                  color: 0x7ed957,
                  noNumbers: true
                });
                e.slowT = Math.max(e.slowT, 0.3);
                e.slowF = Math.min(e.slowF, h.slowF ?? 0.7);
              }
            }
            const cch = h.group.children as THREE.Mesh[];
            cch[0].rotation.y += dt * 0.8;
            const br = 1 + Math.sin(ctx.time * 2.2) * 0.04;
            cch[0].scale.set(h.radius * br, h.radius * 0.5 * br, h.radius * br);
            /* rising blight bubbles + drifting spores */
            const cq = ctx.quality * (ctx.vfx.reduced ? 0.5 : 1);
            if (Math.random() < dt * 20 * cq) {
              const a = Math.random() * Math.PI * 2;
              const rr = Math.sqrt(Math.random()) * h.radius * 0.85;
              T_CLOUD_BUBBLE.vy = 1.2 + Math.random() * 0.6;
              T_CLOUD_BUBBLE.size = 0.3 + Math.random() * 0.18;
              ctx.vfx.trailPuff(tmpV.set(h.x + Math.cos(a) * rr, 0.12, h.z + Math.sin(a) * rr), Math.random() < 0.5 ? 0x9ee670 : 0x7ed957, 1, T_CLOUD_BUBBLE);
            }
            if (Math.random() < dt * 9 * cq) {
              const a = Math.random() * Math.PI * 2;
              const rr = Math.sqrt(Math.random()) * h.radius;
              ctx.vfx.trailPuff(tmpV.set(h.x + Math.cos(a) * rr, 0.5 + Math.random() * 0.7, h.z + Math.sin(a) * rr), 0xb9f29a, 1, T_CLOUD_SPORE);
            }
            break;
          }
        case "timefield":
          {
            for (const e of ctx.enemies) {
              if (e.dead) continue;
              const d = Math.hypot(e.x - h.x, e.z - h.z);
              if (d < h.radius + e.radius) {
                e.slowT = Math.max(e.slowT, 0.25);
                e.slowF = Math.min(e.slowF, h.slowF ?? 0.1);
              }
            }
            h.group.rotation.y += dt * 0.5;
            const tch = h.group.children as THREE.Mesh[];
            /* concentric slow ripples breathing outward */
            for (let j = 2; j <= 3; j++) {
              const ph = (ctx.time * 0.45 + (j === 2 ? 0 : 0.5)) % 1;
              tch[j].scale.setScalar(Math.max(0.02, h.radius * (0.2 + 0.8 * ph)));
              (tch[j].material as THREE.MeshBasicMaterial).opacity = 0.45 * Math.min(1, ph * 8) * (1 - ph);
            }
            /* counter-rotating clock-tick ring */
            tch[4].rotation.y -= dt * 1.1;
            break;
          }
        case "shockring":
          {
            h.ringR = (h.ringR ?? 1.5) + (h.ringSpeed ?? 9) * dt;
            h.group.scale.setScalar(h.ringR);
            const pd = Math.hypot(p.x - h.x, p.z - h.z);
            if (!h.hitPlayer && Math.abs(pd - h.ringR) < 1.0) {
              h.hitPlayer = true;
              ctx.damagePlayer(h.dps ?? 10, h.x, h.z, "the tyrant's shockring");
            }
            /* after-image ring trails the shockfront */
            const sch = h.group.children as THREE.Mesh[];
            sch[1].scale.setScalar(1.12 + 0.05 * Math.sin(ctx.time * 9));
            (sch[1].material as THREE.MeshBasicMaterial).opacity = 0.22 + 0.16 * Math.sin(ctx.time * 13);
            /* crackling sparks riding the rim */
            const sq = ctx.quality * (ctx.vfx.reduced ? 0.5 : 1);
            if (Math.random() < dt * 16 * sq) {
              const a = Math.random() * Math.PI * 2;
              const rr = h.ringR ?? 1;
              const ca = Math.cos(a),
                sa = Math.sin(a);
              T_RIM_SPARK.vx = -sa * 3 + Math.random() - 0.5;
              T_RIM_SPARK.vz = ca * 3 + Math.random() - 0.5;
              ctx.vfx.trailPuff(tmpV.set(h.x + ca * rr, 0.35 + Math.random() * 0.3, h.z + sa * rr), h.group.userData.color ?? 0xff4d6b, 1, T_RIM_SPARK);
            }
            break;
          }
        case "rift":
          {
            /* drag the mage toward the heart, then nova */const dx = h.x - p.x,
              dz = h.z - p.z;
            const d = Math.hypot(dx, dz) || 1;
            if (d < h.radius * 2.6) {
              const pull = (h.pullPlayer ?? 7) * dt * (1 - Math.min(1, d / (h.radius * 2.6))) * 2.2;
              p.x += dx / d * pull;
              p.z += dz / d * pull;
            }
            h.group.rotation.y += dt * 4;
            h.group.children[0].scale.setScalar(1.6 + Math.sin(ctx.time * 14) * 0.25);
            /* debris spiraling into the wound */
            const rq = ctx.quality * (ctx.vfx.reduced ? 0.5 : 1);
            if (Math.random() < dt * 20 * rq) {
              const a = Math.random() * Math.PI * 2;
              const rr = 4.6 + Math.random() * 1.2;
              const ca = Math.cos(a),
                sa = Math.sin(a);
              T_RIFT_SPIRAL.vx = -sa * 3.2 - ca * 2.6;
              T_RIFT_SPIRAL.vz = ca * 3.2 - sa * 2.6;
              ctx.vfx.trailPuff(tmpV.set(h.x + ca * rr, 0.3 + Math.random() * 0.9, h.z + sa * rr), h.group.userData.color ?? 0xd05bff, 1, T_RIFT_SPIRAL);
            }
            if (h.life <= 0 && !h.armed) {
              h.armed = true;
              ctx.vfx.explosion(new THREE.Vector3(h.x, 1, h.z), 0xd05bff, 5.5);
              ctx.vfx.ring(new THREE.Vector3(h.x, 0, h.z), 0xd05bff, 9);
              /* detonation: light pillar + white glint flash */
              ctx.vfx.lightPillar(tmpV.set(h.x, 0, h.z), h.group.userData.color ?? 0xd05bff, {
                height: 9,
                width: 2.2,
                life: 0.6
              });
              ctx.vfx.glint(tmpV.set(h.x, 1.4, h.z), 0xffffff, 1.5);
              ctx.shake(0.6);
              ctx.sfx.play("explode", {
                intensity: 1
              });
              if (d < 5.5) ctx.damagePlayer(h.dps ?? 20, h.x, h.z, "a rift hazard");
            }
            break;
          }
      }
      /* fade & retire */
      if (h.kind !== "shockring" && h.kind !== "rift") {
        const fade = Math.min(1, h.life / 0.8);
        h.group.traverse(o => {
          if (o instanceof THREE.Mesh) {
            const m = o.material;
            if ("opacity" in m) {
              m.transparent = true;
              m.opacity = Math.max(0, Math.min(m.opacity, fade));
            }
          }
        });
      }
      if (h.life <= 0 || h.kind === "shockring" && (h.ringR ?? 0) > 15) {
        this.disposeHazard(h);
        this.hazards.splice(i, 1);
      }
    }
  }
  clear(): void {
    for (const pr of this.projectiles) {
      this.scene.remove(pr.mesh);
      this.releaseMesh(pr.kind, pr.mesh);
    }
    this.projectiles.length = 0;
    for (const h of this.hazards) this.disposeHazard(h);
    this.hazards.length = 0;
    for (const b of this.beams) {
      this.scene.remove(b.mesh);
      this.beamPool.push(b.mesh);
    }
    this.beams.length = 0;
  }
  dispose(): void {
    this.clear();
    for (const pool of this.projPool.values()) for (const g of pool) {
      g.traverse(o => {
        if (o instanceof THREE.Mesh) o.geometry.dispose?.();
        if (o instanceof THREE.Sprite) o.material.dispose();
      });
    }
    this.projPool.clear();
    for (const m of this.beamPool) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.beamPool.length = 0;
    /* pooled hazard skeletons: remove from scene + dispose their per-instance
    materials (geometries are module-lifetime shared) */
    for (const pool of this.hazVis.values()) for (const g of pool) {
      this.scene.remove(g);
      g.traverse(o => {
        const mesh = o as THREE.Mesh;
        if (mesh.material) {
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const m of mats) m.dispose();
        }
      });
    }
    this.hazVis.clear();
    this.haloTex.dispose();
  }
}