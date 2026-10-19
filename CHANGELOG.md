# Changelog

All notable changes to this project are documented here. Versions follow
[Semantic Versioning](https://semver.org/).

## 1.1.0 — Self-check, shareable views, one-tap capsule

The "less guessing" release: the settings page can tell you what is wrong and
hand you a report, a link reproduces the view you are looking at, and clicking
the desktop capsule opens the deck.

### Added
- **Settings → 自检与诊断 card** (desktop + mobile): one-click self-check of the
  plugin process, state data, live stream, desktop capsule, HUD bridge, remote
  access, pending approvals and the DSH host API; each row shows status and
  detail, and the full report can be copied for a bug report
  (`GET /cockpit/api/diagnostics`, read-only)
- **Shareable view links**: the header 「复制链接」 button copies the current URL
  with the on-screen conversation encoded as `?s=…`; opening the link restores
  that conversation in the new tab, while each tab keeps its own selection
- **One-tap capsule** (Windows): clicking the capsule body opens the cockpit —
  `?focus=approvals` plus an auto-expanded, scrolled-to approval list when
  something is waiting; the chevron area still toggles the card, dragging still
  moves the capsule, and when no bridge file is available the old
  toggle-on-click behavior is kept. Tooltip explains the pending state

### Changed
- **Idle write cadence**: `hud.json` and `capsule/state.json` are compared
  without their volatile `at` / `lastAt` timestamps, and an unchanged frame is
  rewritten at most every 60 s (bridge) or 30 s (capsule) instead of on every
  timer tick. Visibly identical behavior, far fewer atomic renames and overlay
  repaints while DSH sits idle
- `?focus=approvals` is consumed once (and then removed from the URL) so a
  plain refresh does not re-trigger the focus jump

### Tests
- `test/diagnostics.test.mjs` covers the frame-signature helpers
  (`signatureWithout`) and the age formatting used by the diagnostics card;
  `node --test` now runs 18 tests
- New CI workflow `.github/workflows/ci.yml`: syntax checks (`index.js`,
  `client.js`, `public/app.js`), `npm test` and `npm pack --dry-run` on Node 22

## 1.0.1 — HUD follows the conversation that is working

The desktop capsule used to follow the deck's team session only, so it sat on
`待命` while the user worked any other conversation. It now follows any running
conversation.

### Fixed
- Desktop capsule and `hud.json` summary follow the conversation that is
  actually doing work: a running turn wins, the most recently used conversation
  wins among several, and teammate agent sessions never take the capsule over.
  When nothing runs the capsule falls back to the deck's active session and
  returns to `待命` (`state.capsule`, `pickCapsuleSession`)
- `/cockpit/api/state` exposes `capsule` (same shape as `session`) so external
  HUDs can mirror the focus; `hud.json` `session`/`round` now describe it while
  `team` keeps counting the deck's active team

### Tests
- `npm test` (`node --test`) covers the focus rule, the overlay frame and the
  per-session `lastUserAt` tracker

## 1.0.0 — First public release

The first release intended for general use: a complete command deck for
DeepSeek Harness agent teams, plus a built-in Windows desktop capsule and
phone-ready remote access.

### Core deck
- Embedded workspace panel (sidebar entry) and standalone `/cockpit/` page
- Session switching with per-tab selection
- Live team roster: real per-agent tokens, current action, derived ownership,
  grouped by running / idle / failed with drag reordering
- Task board: status columns, dependencies, write-scope conflict warnings,
  plan fallback from the current turn's todo list
- Human-readable activity stream with expandable details
- Round stats, liquid progress, dark mode, three responsive layouts,
  resizable columns, keyboard access and reduced-motion support

### Decisions and actions
- Approval gate: answer allow-once / reject inside the deck, 25 s fallback to
  the native dialog, local audit log
- Write actions: queue a message, steer it into the running turn, interrupt a
  turn — each guarded by same-origin checks and a running check
- Local audit log (`~/.dsh/cockpit/audit.jsonl`, rotated)

### Desktop capsule (Windows)
- Built-in WPF overlay: liquid progress, step readout, `N run · M batch` badge
- Supervisor-managed process (start / stop / restart / heartbeat), settings card
- Legacy HUD detection to avoid two capsules at once

### Remote access and PWA
- Opt-in LAN listener with one-time 6-digit pairing, lockout persisted,
  revocable sessions, `remote:true` audit
- Public HTTPS address support with Secure cookies and a tunnel wizard that
  only suggests commands (cloudflared / Tailscale)
- In-page notification when an approval arrives in the background
- Installable PWA with offline shell and install guidance

### Extensions
- Extension card API: `registerCard()` with `list` / `metrics` / `status` /
  `text` payloads, action endpoints, timeouts, caching and error isolation
- Example plugin: `examples/git-card`

### Documentation
- `docs/STATE.md`: state, SSE, endpoints, approvals, actions, remote and card
  contracts; `docs/ROADMAP.md`: product direction

## 0.9.0
- Phone-ready remote access: public URL + Secure cookies, tunnel wizard,
  persisted pairing lockout, background approval notifications, PWA install
  guidance

## 0.8.0
- Desktop capsule merged into the plugin; supervisor, settings card, legacy
  HUD handover, real-time progress pipeline

## 0.7.1
- Roster grouped by status (running / idle / failed), collapsed by default,
  per-group drag ordering

## 0.7.0
- Remote access: LAN listener, one-time pairing, device management, audit

## 0.6.0
- Extension cards API + example plugin; installable PWA and offline shell

## 0.5.1
- Member cards: uniform four-row layout, no clipping on short rails

## 0.5.0
- Session switching, editable aliases buffer, derived ownership line, drag
  reordering

## 0.4.0
- Write actions: queue / steer / interrupt, live gating, audit

## 0.3.0
- Approval gate with native fallback

## 0.2.0
- Embedded workspace panel, performance pass (throttled frames, no full
  re-render on unchanged state)

## 0.1.0
- First working deck: roster, task board, activity stream, approvals preview
