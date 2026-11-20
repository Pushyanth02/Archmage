/* ARCHMAGE: RIFTBOUND — title screen markup.
   This module is the single source of truth for the DOM structure of the
   title screen — the exact body an `index.html` would carry in a plain
   Vite build (see /vite.index.html at the repo root, which mounts this
   same tree through src/main.ts). The markup is injected once by the
   bootstrap (`startTitleScreen`) and then owned by the vanilla-TS layer;
   React never reconciles inside it.

   Layout contract (data-ui attributes are the UIManager's query hooks):
     [data-ui="canvas"]        Three.js WebGL surface
     [data-ui="hud"]           semantic HUD overlay root
     [data-ui="solo-run"]      left hexagonal action button (primary)
     [data-ui="online-party"]  right hexagonal action button (secondary)
     [data-ui="seed-input"]    editable seed field
     [data-ui="seed-edit"]     edit toggle (pencil)
     [data-ui="seed-shuffle"]  randomizer (shuffle)
     [data-ui="open-vault" | "open-runes" | "open-codex" | "open-settings"]
                               bottom dock buttons
     [data-ui="veil"]          run-transition fade layer
     [data-ui="splash-*"]      post-transition splash controls

   Pixel art is served from /assets/v31 and always renders with
   image-rendering: pixelated (enforced in style.css). */

export const TITLE_MARKUP = /* html */ `
<div class="stage" id="game-stage" role="application" aria-label="ARCHMAGE: RIFTBOUND main menu">
  <canvas class="scene-canvas" data-ui="canvas" aria-hidden="true"></canvas>

  <div class="hud" data-ui="hud">
    <header class="hud-top">
      <!-- Top-left: player profile card -->
      <section class="profile frame-gold ch-tr" aria-label="Player profile">
        <span class="avatar" aria-hidden="true">
          <img class="avatar-img" src="/assets/v31/portraits/stormcaller.png" alt="" width="128" height="128"/>
        </span>
        <div class="profile-meta">
          <span class="profile-name" data-ui="profile-name">InfinityCat</span>
          <div class="profile-level">
            <span class="lv">Lv.&nbsp;<b data-ui="profile-level">28</b></span>
            <span class="xp-track" role="progressbar" aria-label="Experience to next level"
                  aria-valuemin="0" aria-valuemax="26000" aria-valuenow="14300"
                  data-ui="xp-track"><span class="xp-fill" data-ui="xp-fill"></span></span>
          </div>
        </div>
      </section>

      <!-- Top-center: the wordmark -->
      <div class="title-block" aria-hidden="true">
        <div class="title-archmage-wrap">
          <span class="title-archmage">ARCHMAGE</span>
          <span class="title-star">
            <span class="star-halo"></span>
            <svg viewBox="0 0 48 48" class="starburst" focusable="false">
              <path d="M24 1 L28.4 19.6 L47 24 L28.4 28.4 L24 47 L19.6 28.4 L1 24 L19.6 19.6 Z" fill="#fff8d8"/>
              <path d="M24 9 L26.4 21.6 L39 24 L26.4 26.4 L24 39 L21.6 26.4 L9 24 L21.6 21.6 Z" fill="#ffd76a"/>
            </svg>
          </span>
        </div>
        <div class="title-sub-row">
          <span class="divider" aria-hidden="true"></span>
          <span class="title-riftbound">RIFTBOUND</span>
          <span class="divider" aria-hidden="true"></span>
        </div>
      </div>

      <!-- Top-right: currency pills -->
      <div class="currency" aria-label="Currencies">
        <div class="pill frame-gold ch-tlbr">
          <span class="pill-icon" aria-hidden="true">
            <img src="/assets/v31/icons/crystal.png" alt="" width="64" height="64"/>
          </span>
          <span class="pill-value" data-ui="gem-value">1,420</span>
          <button class="pill-plus" data-ui="gems-plus" type="button" aria-label="Add 150 gems">
            <svg viewBox="0 0 24 24" shape-rendering="crispEdges" focusable="false">
              <path d="M12 5 V19 M5 12 H19" stroke="#e0b850" stroke-width="3"/>
            </svg>
          </button>
        </div>
        <div class="pill frame-gold ch-tlbr">
          <span class="pill-icon" aria-hidden="true">
            <img src="/assets/v31/icons/coins.png" alt="" width="64" height="64"/>
          </span>
          <span class="pill-value" data-ui="gold-value">58,300</span>
          <button class="pill-plus" data-ui="gold-plus" type="button" aria-label="Add 1,500 gold">
            <svg viewBox="0 0 24 24" shape-rendering="crispEdges" focusable="false">
              <path d="M12 5 V19 M5 12 H19" stroke="#e0b850" stroke-width="3"/>
            </svg>
          </button>
        </div>
      </div>
    </header>

    <!-- Center: the gate cluster — hex actions with the seed forge framed
         directly beneath them, one ornate unit instead of an orphan bar. -->
    <main class="hud-center">
      <div class="menu-actions">
        <button class="hex-btn hex-solo" data-ui="solo-run" type="button">
          <span class="hex-emblem" aria-hidden="true">
            <img src="/assets/v31/relics/staff_storm.png" alt="" width="128" height="128"/>
          </span>
          <span class="hex-label">SOLO RUN</span>
        </button>
        <button class="hex-btn hex-party" data-ui="online-party" type="button">
          <span class="hex-emblem" aria-hidden="true">
            <svg viewBox="0 0 48 48" focusable="false">
              <g fill="#d890f8">
                <circle cx="9" cy="17" r="5"/>
                <path d="M1 40 C1 29 17 29 17 40 Z"/>
                <circle cx="39" cy="17" r="5"/>
                <path d="M31 40 C31 29 47 29 47 40 Z"/>
                <circle cx="24" cy="13" r="6.5"/>
                <path d="M12 41 C12 26 36 26 36 41 Z"/>
              </g>
            </svg>
          </span>
          <span class="hex-label">ONLINE PARTY</span>
        </button>
      </div>

      <!-- The gate cluster's tether: a gold stem + gem that welds the seed
           forge to the action buttons so the plate reads as part of the
           gate, not an orphaned bar. -->
      <div class="seed-link" aria-hidden="true">
        <span class="seed-link-stem"></span>
        <span class="seed-link-gem"></span>
      </div>

      <div class="seed-plate frame-gold ch-tlbr">
        <span class="seed-plate-tag" aria-hidden="true">RIFT SEED</span>
        <form class="seed-bar" data-ui="seed-form" autocomplete="off">
          <span class="seed-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" shape-rendering="crispEdges" focusable="false">
              <rect x="3" y="3" width="18" height="18" fill="none" stroke="#e0b850" stroke-width="2"/>
              <rect x="6.5" y="6.5" width="3" height="3" fill="#e0b850"/>
              <rect x="10.5" y="10.5" width="3" height="3" fill="#e0b850"/>
              <rect x="14.5" y="14.5" width="3" height="3" fill="#e0b850"/>
            </svg>
          </span>
          <label class="seed-label" for="seed-input">Seed:</label>
          <input id="seed-input" class="seed-input" data-ui="seed-input" type="text"
                 value="echo-4584" maxlength="18" spellcheck="false" readonly
                 aria-describedby="seed-hint"/>
          <button class="seed-edit" data-ui="seed-edit" type="button" aria-label="Edit seed" aria-pressed="false">
            <svg viewBox="0 0 24 24" focusable="false">
              <path d="M4 20 L5 15 L16 4 L20 8 L9 19 Z" fill="#c0a0d8"/>
              <path d="M14 6 L18 10" stroke="#1a1025" stroke-width="1.6"/>
            </svg>
          </button>
          <button class="seed-shuffle frame-gold ch-tlbr" data-ui="seed-shuffle" type="button" aria-label="Randomize seed">
            <svg viewBox="0 0 24 24" fill="none" stroke="#e0b850" stroke-width="2.4" stroke-linecap="square" focusable="false">
              <path d="M3 6 H8 C13 6 11 18 16 18 H20"/>
              <path d="M3 18 H8 C10 18 11.4 15.4 12.8 12.4"/>
              <path d="M20 6 H16 C15 6 14 6.6 13 7.8"/>
              <path d="M17 3 L20 6 L17 9"/>
              <path d="M17 15 L20 18 L17 21"/>
            </svg>
          </button>
          <span id="seed-hint" class="sr-only">Same seed always builds the same rift. Shuffle to reroll.</span>
        </form>
      </div>
    </main>

    <!-- Bottom: navigation dock -->
    <nav class="dock" aria-label="Main menu">
      <button class="dock-btn frame-gold" data-ui="open-vault" type="button">
        <span class="dock-icon" aria-hidden="true">
          <img src="/assets/v31/icons/chest.png" alt="" width="64" height="64"/>
        </span>
        <span class="dock-label">VAULT</span>
      </button>
      <button class="dock-btn frame-gold" data-ui="open-runes" type="button">
        <span class="dock-icon" aria-hidden="true">
          <img src="/assets/v31/relics/amulet.png" alt="" width="128" height="128"/>
        </span>
        <span class="dock-label">RUNES</span>
      </button>
      <button class="dock-btn frame-gold" data-ui="open-codex" type="button">
        <span class="dock-icon" aria-hidden="true">
          <img src="/assets/v31/relics/grimoire.png" alt="" width="128" height="128"/>
        </span>
        <span class="dock-label">CODEX</span>
      </button>
      <button class="dock-btn frame-gold" data-ui="open-settings" type="button">
        <span class="dock-icon" aria-hidden="true">
          <img src="/assets/v31/icons/flask.png" alt="" width="64" height="64"/>
        </span>
        <span class="dock-label">SETTINGS</span>
      </button>
    </nav>

    <!-- Run transition veil + splash -->
    <div class="run-veil" data-ui="veil" aria-hidden="true">
      <div class="run-splash" data-ui="splash">
        <div class="splash-sigil" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="#ffd76a" stroke-width="1.8" stroke-linecap="square" focusable="false">
            <path d="M12 22 V6"/>
            <path d="M12 11 L5 4"/>
            <path d="M12 11 L19 4"/>
            <path d="M12 22 V15"/>
            <path d="M8 19 L12 15.5 L16 19"/>
          </svg>
        </div>
        <p class="splash-kicker">ENTERING THE RIFT</p>
        <p class="splash-seed">seed&nbsp;<b data-ui="splash-seed">echo-4584</b></p>
        <button class="splash-return frame-gold ch-tlbr" data-ui="splash-return" type="button"><span>RETURN TO THE GATE</span></button>
      </div>
    </div>
  </div>
</div>
<p class="rotate-hint" aria-hidden="true">Rotate your device — the rift opens in landscape</p>
`;
