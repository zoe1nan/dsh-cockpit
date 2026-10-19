# Cockpit state contract (v0.1)

The plugin serves the whole app under `/cockpit`. The page is static; all live data
comes from two endpoints. Everything below is JSON over HTTP — no build step, no
framework.

## GET /cockpit/api/state

One full snapshot of everything on screen. The client replaces its store with this
object; it never needs to diff.

```json
{
  "ok": true,
  "plugin": "dsh-cockpit",
  "now": 1760000000000,
  "mode": "desktop",

  "session": {
    "id": "session-id",
    "title": "认证模块重构",
    "running": true,
    "turn": 12,
    "startedAt": 1760000000000,
    "elapsedMs": 2520000,
    "percent": 60,
    "completed": 3,
    "total": 5,
    "plan": { "steps": [{ "text": "整理需求与页面结构", "status": "completed" }] },
    "stats": { "turns": 12, "steps": 31, "llmMs": 0, "toolMs": 0, "tokens": 12800 },
    "model": "V4 Pro"
  },

  "capsule": {
    "id": "other-session-id",
    "title": "修复 HUD 状态同步",
    "running": true,
    "elapsedMs": 60000,
    "percent": null,
    "completed": 0,
    "total": 0,
    "plan": { "steps": [] },
    "stats": { "turns": 2, "steps": 0, "llmMs": 0, "toolMs": 0, "tokens": 900 },
    "model": "V4 Pro"
  },

  "team": {
    "members": [
      {
        "id": "member-session-id",
        "name": "lead",
        "role": "lead",
        "phase": "active",
        "model": "V4 Pro",
        "status": "running",
        "running": true,
        "tokens": 12400,
        "current": "正在把 #4 派给测试代理",
        "lastAt": 1760000000000
      }
    ],
    "tasks": [
      {
        "id": "t1",
        "revision": 3,
        "subject": "重构 session 校验逻辑",
        "status": "in_progress",
        "owner": "member-session-id",
        "ownerName": "backend",
        "blockedBy": [],
        "writeScopes": ["server/session.ts"],
        "ready": false,
        "warnings": ["与前端共享 web/src/api/client.ts"]
      }
    ]
  },

  "sessions": [
    { "id": "session-id", "title": "认证模块重构", "running": true, "percent": 60, "lastAt": 1760000000000 }
  ],

  "activity": [
    { "at": 1760000000000, "kind": "tool", "agent": "backend", "text": "运行 pnpm test server", "detail": "42 passed" }
  ],

  "files": [
    { "path": "web/src/api/client.ts", "agents": ["frontend", "backend"], "conflict": true }
  ],

  "approvals": [],

  "aliases": {
    "member-session-id": { "name": "阿码", "color": "violet", "emoji": "" }
  }
}
```

Field rules:

- `session.percent` is `null` when there is no plan.
- `session` is the deck's active session: a session carrying a real team wins,
  otherwise the busiest/most recent one. `null` when no session is visible.
- `capsule` has the same shape as `session` and is the session the desktop HUD
  follows (v1.0.1): any conversation with a running turn wins, most recently
  used first (`lastUserAt`), then the newest event; teammate agent sessions
  never take it over. When nothing is running it falls back to `session`, so a
  finished conversation returns the HUD to `待命` instead of pinning it there.
- `team.members` always starts with the Lead (`role: "lead"`, `name: "lead"`).
  `phase` is `provisioning | active | failed`. `status` is a client hint:
  `running | idle | provisioning | failed`.
- `team.tasks[].status`: `pending | in_progress | completed` (deleted tasks are
  already filtered out). `warnings` mirrors DSH write-scope overlap warnings.
- `activity` is newest first, at most 40 entries. `kind` is one of
  `turn | step | tool | message | team | system`. `agent` is a member name or `lead`.
- `files` is derived from task write scopes: every path claimed by a live owner is
  listed, sorted with conflicts first. `agents` holds the owner names (1..n) and
  `conflict` is `true` when two or more live owners claim the same path.
- `aliases` maps member session id → display name/color/emoji. `color` is a token:
  `blue | green | violet | orange | cyan`. The client falls back to its own
  palette when an alias is missing.
- No personal data is required by the client: every string is already rendered as
  plain text (HTML is escaped client-side).

## GET /cockpit/api/stream

`text/event-stream`. The server writes one `state` event on connect and then one
on every debounced change (roughly ≤ 5 per second). Payload is exactly the same
object as `/api/state`.

```
event: state
data: {"ok":true,...}
```

The client reconnects automatically; there is no client → server message on this
channel.

## /cockpit/api/aliases

- `GET /cockpit/api/aliases` → `{ "ok": true, "aliases": { ... } }`
- `POST /cockpit/api/aliases` with `{ "id": "<member session id>", "name": "小鲸",
  "color": "green", "emoji": "🐳" }` (`alias` is accepted as an alias of `name`) → `{ "ok": true, "aliases": { ... } }`.
  Empty `name` clears the alias. `color`/`emoji` are optional and preserved.
- `DELETE /cockpit/api/aliases?id=<member session id>` → `{ "ok": true, "aliases": {...} }`

Aliases live in `~/.dsh/cockpit/aliases.json` and are display-only: they never
reach DSH, agent names in DSH stay untouched.

## Static files

- `GET /cockpit` → `public/index.html`
- `GET /cockpit/<path>` → file under `public/` (mime by extension; `index.html`
  for unknown non-API paths is NOT done — only `/cockpit` and `/cockpit/` map to
  index.html)

The client must work from `file://` too (preview mode): use relative URLs
(`./api/state`, `./api/stream`, `./api/aliases`) resolved against the page URL.

## Embedded page

`public/index.html` is also loaded inside the workspace as an iframe of the
client half (`client.js`, added in v0.2). The panel requests `/cockpit/?embed=1`:
the page drops its own brand, status bar and page paddings so it can fill the
main slot. Everything else — endpoints, state shape, aliases — is unchanged.

## Activity wording (v0.2.4)

`activity[].text` is a human label (`运行命令`, `编辑文件`, `任务 t2 已完成`, …) and
`activity[].detail` is the single-line payload (`pnpm test --filter auth`,
`web/src/Auth.tsx`, `320 毫秒`). Clients render the detail on one line and may
expand it on demand; nothing machine-parsed should depend on either field.

## Plan fallback (v0.2.4)

When `team.tasks` is empty but `session.plan.steps` is not, the deck renders those
steps as read-only cards (columns by status, `步骤 N` footer). `team.tasks`
always wins when present.

## Approvals (v0.3)

 is a list of pending one-shot approval asks the deck can answer:

\
-  with  (same-origin only).
  The ask disappears from the next state frame; the host resolves the DSH waterfall with
   / .
- If nobody answers before , the deck disconnects, or the request is aborted,
  the host hands the ask to the native workspace dialog instead (the card shows "已转交"
  for the last second). A deck never blocks an ask that the user cannot see.
- The plugin only registers this answerer while at least one SSE client is connected, and the
  host keeps a small queue (6); beyond that it falls through immediately.

## Approvals (v0.3)

`state.approvals` lists the one-shot approval asks the deck may answer:

```json
{
  "id": "apr-7",
  "sessionId": "…",
  "sessionTitle": "认证模块重构",
  "toolName": "ops_bash",
  "label": "运行命令",
  "callId": "…",
  "reason": "需要在工作区外写入依赖缓存",
  "detail": "pnpm add -D vitest --store-dir …",
  "requestedAt": 1792316000000,
  "expiresAt": 1792316025000
}
```

- `POST /cockpit/api/approvals/:id` with `{ "decision": "allow-once" | "reject" }` (same-origin only).
  The ask leaves the next state frame and the host resolves the DSH waterfall with
  `allowed-once` / `rejected`.
- If nobody answers before `expiresAt`, the deck has no SSE client, the queue is full, or the
  request is aborted, the host hands the ask to the native workspace dialog instead. A deck
  never blocks an ask the user cannot see.
- Timeouts: the host holds at most 25s; the card counts down the last seconds.

## Write actions (v0.4)

Two local endpoints let the deck act on the user's behalf. Both require a
same-origin request, are appended to `~/.dsh/cockpit/audit.jsonl`, and answer
JSON.

`POST /cockpit/api/actions/send`

```
body:  { sessionId: string, text: string, mode?: 'queue' | 'steer' }
200:   { ok: true, mode }
400:   invalid body         403: forbidden (cross-origin)
404:   unknown session      409: the session refused the message
```

`queue` (default) admits a user message to the agent inbox and delivers it after
the current turn; `steer` interrupts the running turn with it.

`POST /cockpit/api/actions/interrupt`

```
body:  { sessionId: string }
200:   { ok: true }
400 | 403 | 404 | 409 (session is not running)
```

Guard rails: targets must be live agents from the agents registry; the deck never
spawns agents, never approves on its own beyond one ask, and never runs commands
itself — it forwards the user's explicit action, and every attempt (accepted or
rejected) leaves one audit line.

## Writability markers (v0.4)

- `session.live` and `sessions[].live`: true when the host holds a live agent for
  that session, i.e. the write endpoints will accept it.
- `team.members[].live` and `team.members[].sessionId`: a member id is the agent
  id, so `sessionId` is the session to address for 发消息 / 中断; it is null when
  the member's session is not reachable. Clients should fall back to `member.id`.
- `/cockpit/api/actions/*` accept either id form; prefer the session id.

## Session selection (v0.5)

`GET /cockpit/api/state?s=<sessionId>` and `GET /cockpit/api/stream?s=<sessionId>`
build every frame for the selected session; each stream connection remembers its
own selection, so tabs are independent. An unknown id falls back to the automatic
pick (busy team first, then most recent).

## Member focus line (v0.5)

`team.members[].focus` is a short human line describing what the member is
responsible for in this session, derived host-side from the subjects of tasks
they own (max two), else from files touched in recent activity. It may be empty.

## Extension cards (v0.6)

Other plugins can put a small structured card on the deck. The host exposes a
cordis service named `cockpit`; a plugin injects it and registers a card:

```js
export const inject = ['cockpit']
export function apply(ctx) {
  const dispose = ctx.cockpit.registerCard({
    id: 'git-status',            // /^[a-z0-9][a-z0-9._-]{1,40}$/, unique
    title: 'Git 状态',            // <= 24 chars
    subtitle: '当前工作区',        // optional, <= 40 chars
    icon: 'git',                 // git|code|test|cost|note|shield|clock|spark|file
    order: 10,                   // optional sort key, default 100
    load: async () => payload,   // optional, time-boxed to 800ms
    actions: [{ id: 'refresh', label: '刷新', style: 'ghost', confirm: '...?' }],
    onAction: async (actionId) => result, // optional, time-boxed to 4s
  })
  ctx.effect(() => () => dispose())
}
```

`payload` is plain JSON; the deck owns presentation (no HTML from plugins):

| kind | shape |
| --- | --- |
| `list` | `{ kind:'list', items:[{title, detail?, state?:'ok'|'warn'|'bad'|'idle'}], footer? }` (max 8 items) |
| `metrics` | `{ kind:'metrics', rows:[{label, value, tone?}], footer? }` (max 6 rows) |
| `status` | `{ kind:'status', state, label, detail?, footer? }` |
| `text` | `{ kind:'text', text, footer? }` (max 400 chars) |

Every state frame carries `cards: [{ id, title, subtitle, icon, order,
actions, payload, error, updatedAt }]`, sorted by `order`. A card whose `load()`
throws keeps its last good payload and reports `error`; the deck shows the error
inline instead of dropping the card.

Actions go through `POST /cockpit/api/cards/<id>/action` with `{ actionId }`
(same-origin only). The host runs `onAction` in the owning plugin, invalidates
the cache and pushes a fresh frame. `GET /cockpit/api/cards` lists registered
cards for debugging.

The host rejects: invalid ids, duplicate ids, more than 24 cards, unknown
actions (404), and cross-origin calls (403). `load`/`onAction` timeouts surface
as `error` / 409 respectively.


## Remote access (v0.7)

The deck can be opened from a phone on the same network. Two surfaces exist:

**Desktop API** (same origin as the deck, all `POST` unless noted):

| Route | Meaning |
| --- | --- |
| `GET /cockpit/api/remote` | `{ ok, enabled, running, url, publicUrl, secure, urlForPhone, port, pair: { code, expiresAt }\|null, sessions: [{ id, label, createdAt, lastSeenAt }] }` |
| `POST /cockpit/api/remote/start` | open the LAN listener if needed and mint a fresh code |
| `POST /cockpit/api/remote/pair/new` | rotate the code (409 when the listener is not running) |
| `POST /cockpit/api/remote/stop` | close the listener, revoke every paired device and clear pairing lockouts |
| `DELETE /cockpit/api/remote/sessions[?id=]` | revoke one device (`id`) or all of them |
| `POST /cockpit/api/remote/config` | `{ publicUrl }` — set (or clear with `""`) the address phones should open; a bare origin is required (`https://host[:port]`, no path/query/credentials). Returns 400 `{ ok:false, error }` on invalid input. When `publicUrl` is `https://…` the pair cookies gain `Secure` (also forceable with `DSH_COCKPIT_REMOTE_SECURE=1`) |
| `GET /cockpit/api/remote/tunnel` | `{ ok, running, lanUrl, tools: [{ id: 'cloudflared'\|'tailscale', label, available, path\|null }], commands: [{ id, label, command, note }] }` — detection only, nothing is spawned; commands use the live listener port |

Pairing lockouts (5 attempts per IP / 5 min) are persisted in `remote.json`
alongside sessions and survive a restart. An explicit `POST …/stop` is the
documented reset.

**Remote listener** (separate port, default `6688`, `DSH_COCKPIT_REMOTE_PORT` overrides; binds one
private LAN address):

- `GET /` — pairing page (CSP `default-src 'none'`); a client with a valid session is redirected to the deck
- `POST /pair` — `code` (form-encoded or JSON); on success `302 /cockpit/?remote=1` and sets
  `cockpit_remote` (HttpOnly, SameSite=Strict, 7 days) plus readable `cockpit_remote_flag=1`
- `/cockpit/*` — forwarded to the same handlers after auth; `/cockpit/api/remote*` returns 403
  (a phone can never manage pairing); everything else returns 404
- only loopback / RFC1918 clients are accepted; pairing is limited to 5 attempts per IP per 5 min;
  codes are single use and expire after 120 s

Sessions store a SHA-256 token hash only (in `~/.dsh/cockpit/remote.json`, mode 0600), expire after
7 days absolute / 24 hours idle, and are revocable from the desktop. Actions taken through the remote
listener append `remote: true` to the audit trail. The listener is plain HTTP on the LAN: pair only on
networks you trust; installing the PWA or using push still needs HTTPS.

## Remote public assets (v0.7)

Browsers fetch a web app manifest without cookies, so the remote listener serves
`/cockpit/manifest.webmanifest`, `/cockpit/icons/*`, `/cockpit/favicon.svg` and
`/cockpit/whale.svg` without a paired session. They are static, already-public
assets; every other `/cockpit` path (state, stream, actions, cards, approvals)
still requires the `cockpit_remote` session cookie.

## HUD bridge (v0.7.2)

The desktop capsule runs in its own process and cannot call into the
plugin, so the deck leaves a small read-only snapshot behind:

    ~/.dsh/cockpit/hud.json

Written atomically at most every 2 s (and right after approval changes), it
contains only aggregate counters and the deck URL - never step titles, file
names or message text:

    { v:1, at:<ms>, enabled:true, cockpitUrl:"http://127.0.0.1:6123/cockpit/",
      session:{ id, title, running } | null,
      team:{ running, total },
      approvals: <number>,
      round:{ title, percent|null, done, total, running } | null }

`session` and `round` describe the capsule's focus session (the conversation
the HUD follows, i.e. `state.capsule`), so the summary follows the conversation
that is actually working. `team` keeps counting the members of the deck's active
team, so the badge still reports background agents while a side conversation has
the capsule's title.

A stale snapshot (older than 120 s) is ignored by the capsule. Since v1.1 the
bridge is compared without its volatile `at` timestamp: an unchanged payload is
rewritten at most every 60 s (keepalive) instead of on every timer tick, so an
idle host stops churning the file. Settings:

* GET  /cockpit/api/hud-bridge -> { ok, enabled, path, writtenAt, staleMs, bridge }
* POST /cockpit/api/hud-bridge { enabled: boolean } (same-origin only)

The preference lives in ~/.dsh/cockpit/settings.json. When disabled the bridge
keeps publishing { enabled:false } so the capsule hides the extras immediately,
and any existing data fields are dropped.

## Built-in capsule (v0.8)

The desktop capsule ships inside this plugin (`capsule/overlay.ps1` + `whale.png`).
The host owns the process and writes its state frame; nothing is installed
separately.

### Runtime files

| path | purpose |
| --- | --- |
| `~/.dsh/cockpit/settings.json` | `{ "capsule": true, "hudBridge": true }`; `capsule` controls the process |
| `~/.dsh/cockpit/capsule/state.json` | the frame the overlay renders (read every 350 ms) |
| `~/.dsh/cockpit/capsule/overlay.heartbeat` | overlay liveness stamp |
| `~/.dsh/cockpit/capsule/overlay.log` | overlay log, rotated at 200 KB |
| `~/.dsh/cockpit/hud.json` | the badge/panel summary the overlay polls (same contract as v0.7.2) |

`state.json` shape:

```json
{
  "v": 1,
  "at": 1792330606195,
  "active": {
    "sessionId": "session-…",
    "title": "认证模块重构",
    "status": "charging | waiting | done | noplan",
    "steps": [{ "text": "…", "status": "completed|in_progress|pending" }],
    "total": 4, "completed": 1, "percent": 25,
    "currentStep": "重构 session 校验逻辑",
    "running": true,
    "elapsedMs": 42000,
    "lastAt": 1792330606195
  }
}
```

`active` follows the capsule focus (v1.0.1): the running conversation the user
used most recently, otherwise the deck's active session. It is `null` only when
DSH lists no session at all. The overlay therefore shows `进行中` whenever any
conversation is running and falls back to `待命` once nothing is running. The
frame is rewritten at most every 150 ms (event debounce) and at least every
second (elapsed time), and only when its content actually changed. Since v1.1
the change test ignores `lastAt`: an unchanged frame is rewritten at most every
30 s (keepalive).

Clicking the capsule body opens `cockpitUrl`; when the bridge reports pending
approvals the target gains `?focus=approvals` so the deck expands the approvals
and scrolls to them (the parameter is consumed once and then removed). The
chevron area still toggles the expanded card, dragging still moves the capsule,
and without a fresh bridge the old toggle-on-click behavior is kept.

### Endpoint

`GET /cockpit/api/capsule` → `{ ok, supported, enabled, running, pid, startedAt,
statePath, bridgePath, scriptPath, writtenAt, heartbeatAt, writes,
legacyDetected, lastError }`

`POST /cockpit/api/capsule` body `{ "enabled": true|false }` → same shape.
`supported` is false outside Windows; the endpoint then answers 501. Requests are
same-origin only and the process is spawned with `windowsHide`.

### Legacy detection

If the old HUD plugin heartbeat file is fresh (20 s), the legacy desktop HUD overlay
is considered running: the built-in capsule does not start (and retries every
5 s) so the screen never shows two capsules. The deck surfaces this as
`legacyDetected`.

## Diagnostics (v1.1)

The settings page runs a read-only self-check and shows one row per subsystem.
The same data can be fetched directly:

`GET /cockpit/api/diagnostics` →

    { ok:true, plugin:"dsh-cockpit", version, generatedAt:<ms>,
      status:"ok"|"warn"|"fail",
      host:{ pid, platform, arch, node, uptimeMs },
      totals:{ sessions, running, streamClients, approvals, capsule, bridge, remote },
      deck:{ id, title, running } | null,
      capsuleFocus:{ id, title, running } | null,
      capsule:{ supported, enabled, running, pid, heartbeatAgeMs, lastError, legacyDetected },
      bridge:{ enabled, path, ageMs, staleMs },
      remote:{ enabled, running, secure, port, url },
      checks:[{ id, label, status:"ok"|"warn"|"fail", detail }],
      report:"<plain-text report for bug reports>" }

`checks` covers `plugin`, `state`, `stream`, `capsule`, `bridge`, `remote`,
`approvals` and `host-api`; `status` is the worst row. The endpoint never writes
anything, never touches the DSH host API and is safe to poll from the settings
page. `report` is the zh-CN text the 「复制报告」 button copies.

## Shareable view links (v1.1)

The deck header keeps a 「复制链接」 button: it copies the current URL with the
on-screen conversation encoded as `?s=<sessionId>`. A tab that boots with `?s=`
starts on that conversation (and its live stream is created for it), so the same
link opens the same view elsewhere. Switching sessions updates the URL through
`history.replaceState`; when the selected session disappears the parameter is
dropped and the deck returns to the automatic view. `?focus=approvals` (used by
the capsule click-through) is separate: it is consumed once and then removed.
