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
     [data-ui="solo-run"]      left hexagonal action button
     [data-ui="online-party"]  right hexagonal action button
     [data-ui="seed-input"]    editable seed field
     [data-ui="seed-edit"]     edit toggle (pencil)
     [data-ui="seed-shuffle"]  randomizer (shuffle)
     [data-ui="open-vault" | "open-runes" | "open-codex" | "open-settings"]
                               bottom dock buttons
     [data-ui="veil"]          run-transition fade layer
     [data-ui="splash-*"]      post-transition splash controls */

export const TITLE_MARKUP = /* html */ `
<div class="stage" id="game-stage" role="application" aria-label="ARCHMAGE: RIFTBOUND main menu">
  <canvas class="scene-canvas" data-ui="canvas" aria-hidden="true"></canvas>

  <div class="hud" data-ui="hud">
    <header class="hud-top">
      <!-- Top-left: player profile card -->
      <section class="profile frame-gold ch-tr" aria-label="Player profile">
        <span class="avatar" aria-hidden="true">
          <svg viewBox="0 0 12 12" shape-rendering="crispEdges" focusable="false">
            <rect x="5" y="0" width="2" height="1" fill="#23236a"/>
            <rect x="4" y="1" width="4" height="1" fill="#23236a"/>
            <rect x="3" y="2" width="6" height="1" fill="#23236a"/>
            <rect x="2" y="3" width="8" height="1" fill="#1b1b58"/>
            <rect x="3" y="3" width="6" height="1" fill="#d4af37"/>
            <rect x="4" y="4" width="4" height="2" fill="#f2d5b8"/>
            <rect x="4" y="4" width="1" height="1" fill="#2a1d45"/>
            <rect x="7" y="4" width="1" height="1" fill="#2a1d45"/>
            <rect x="4" y="6" width="4" height="1" fill="#eabf9f"/>
            <rect x="3" y="7" width="6" height="2" fill="#33358e"/>
            <rect x="5" y="7" width="2" height="1" fill="#d4af37"/>
            <rect x="2" y="9" width="8" height="1" fill="#2a2c78"/>
            <rect x="2" y="10" width="8" height="2" fill="#23236a"/>
            <rect x="5" y="10" width="2" height="1" fill="#ffd76a"/>
          </svg>
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
            <svg viewBox="0 0 24 24" focusable="false">
              <path d="M12 2 L20 9 L12 22 L4 9 Z" fill="#b86ee8"/>
              <path d="M12 2 L16 9 L12 22 L8 9 Z" fill="#dcaeff"/>
              <path d="M4 9 H20 L12 22 Z" fill="#9a4fd0" opacity="0.55"/>
            </svg>
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
            <svg viewBox="0 0 24 24" focusable="false">
              <circle cx="12" cy="12" r="10" fill="#f0c040"/>
              <circle cx="12" cy="12" r="6.5" fill="none" stroke="#a07010" stroke-width="2"/>
              <path d="M12 8.5 L13.4 10.9 L16 11.4 L14 13.3 L14.5 16 L12 14.7 L9.5 16 L10 13.3 L8 11.4 L10.6 10.9 Z" fill="#c98f1e"/>
            </svg>
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

    <!-- Center: hexagonal actions + seed bar -->
    <main class="hud-center">
      <div class="menu-actions">
        <button class="hex-btn hex-solo" data-ui="solo-run" type="button">
          <span class="hex-emblem" aria-hidden="true">
            <svg viewBox="0 0 48 48" focusable="false">
              <g stroke-linecap="square" fill="none">
                <path d="M12 36 L34 14 M34 14 L38 10 M31 13 L35 17" stroke="#f5d060" stroke-width="3.5"/>
                <path d="M36 36 L14 14 M14 14 L10 10 M13 13 L17 17" stroke="#f5d060" stroke-width="3.5"/>
                <path d="M8 33 L14 39 M40 33 L34 39" stroke="#c9973a" stroke-width="4"/>
              </g>
              <circle cx="24" cy="41" r="2.6" fill="#f5d060"/>
            </svg>
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
    </main>

    <!-- Bottom: navigation dock -->
    <nav class="dock" aria-label="Main menu">
      <button class="dock-btn frame-gold" data-ui="open-vault" type="button">
        <span class="dock-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" shape-rendering="crispEdges" focusable="false">
            <path d="M4 7 C4 4 20 4 20 7" fill="none" stroke="#e8b845" stroke-width="2"/>
            <rect x="3" y="7" width="18" height="12" fill="none" stroke="#e8b845" stroke-width="2"/>
            <path d="M3 11 H21" stroke="#e8b845" stroke-width="2"/>
            <rect x="10" y="10" width="4" height="5" fill="#e8b845"/>
          </svg>
        </span>
        <span class="dock-label">VAULT</span>
      </button>
      <button class="dock-btn frame-gold" data-ui="open-runes" type="button">
        <span class="dock-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="#e8b845" stroke-width="2.2" stroke-linecap="square" focusable="false">
            <path d="M12 21 V8"/>
            <path d="M12 13 L6.5 7.5"/>
            <path d="M12 13 L17.5 7.5"/>
            <path d="M12 21 V16"/>
            <path d="M9 18.5 L12 16 L15 18.5"/>
          </svg>
        </span>
        <span class="dock-label">RUNES</span>
      </button>
      <button class="dock-btn frame-gold" data-ui="open-codex" type="button">
        <span class="dock-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="#e8b845" stroke-width="2" stroke-linejoin="round" focusable="false">
            <path d="M3 5 C6 3.4 9 3.4 12 5 C15 3.4 18 3.4 21 5 V19 C18 17.4 15 17.4 12 19 C9 17.4 6 17.4 3 19 Z"/>
            <path d="M12 5 V19"/>
          </svg>
        </span>
        <span class="dock-label">CODEX</span>
      </button>
      <button class="dock-btn frame-gold" data-ui="open-settings" type="button">
        <span class="dock-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" shape-rendering="crispEdges" fill="#e8b845" focusable="false">
            <rect x="9" y="1" width="6" height="3"/>
            <rect x="9" y="20" width="6" height="3"/>
            <rect x="1" y="9" width="3" height="6"/>
            <rect x="20" y="9" width="3" height="6"/>
            <rect x="4" y="4" width="4" height="3"/>
            <rect x="16" y="4" width="4" height="3"/>
            <rect x="4" y="17" width="4" height="3"/>
            <rect x="16" y="17" width="4" height="3"/>
            <path d="M5 5 H19 V19 H5 Z" fill="none" stroke="#e8b845" stroke-width="4"/>
            <rect x="9" y="9" width="6" height="6" fill="#120b1e"/>
          </svg>
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
