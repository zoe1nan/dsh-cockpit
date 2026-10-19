/* Cockpit · dsh-cockpit v0.1
 * Vanilla single-page command deck for DeepSeek Harness.
 * All data arrives from ./api/state + ./api/stream; aliases via ./api/aliases.
 */
(function () {
  'use strict';

  var PALETTE = ['blue', 'green', 'violet', 'orange', 'cyan'];
  var TEAM_COLORS = ['green', 'violet', 'orange', 'cyan', 'blue'];
  var FALLBACK_NAMES = ['小鲸', '豆豆', '阿码', '泡泡', '鳍鳍'];
  var TABS = ['overview', 'tasks', 'settings'];
  var KINDS = {
    turn: { icon: '↻', cls: 'violet' },
    step: { icon: '✓', cls: 'green' },
    tool: { icon: '▶', cls: '' },
    done: { icon: '✓', cls: 'green' },
    message: { icon: '✉', cls: 'cyan' },
    team: { icon: '⇄', cls: 'violet' },
    system: { icon: '⚠', cls: 'amber' }
  };
  var STATUS_LABEL = { running: '运行中', idle: '空闲', provisioning: '准备中', failed: '失败' };
  /* v0.5: micro state text next to the "current activity" line. */
  var STATUS_MICRO = { running: '正在执行中', idle: '空闲', provisioning: '准备中', failed: '失败' };
  var TASK_COLS = [
    { key: 'pending', label: '待处理', ico: 'todo' },
    { key: 'in_progress', label: '进行中', ico: 'doing' },
    { key: 'completed', label: '已完成', ico: 'done' }
  ];
  /* v0.4 write actions: relative endpoints, like every other host call. */
  var SEND_URL = './api/actions/send';
  var INTERRUPT_URL = './api/actions/interrupt';
  var COMPOSE_LIMIT = 4000;
  var ICON_MSG = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.3 3.6h11.4v7.6H6.3L3.1 13.7v-2.5H2.3z" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/><path d="M5 6.2h6M5 8.4h4.2" stroke="currentColor" stroke-width="1.15" stroke-linecap="round"/></svg>';
  var ICON_STOP = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4.7" y="4.7" width="6.6" height="6.6" rx="1.5" fill="currentColor"/></svg>';
  var ICON_GRIP = '<svg viewBox="0 0 16 16" aria-hidden="true"><g fill="currentColor"><circle cx="5.7" cy="4.1" r="1.15"/><circle cx="10.3" cy="4.1" r="1.15"/><circle cx="5.7" cy="8" r="1.15"/><circle cx="10.3" cy="8" r="1.15"/><circle cx="5.7" cy="11.9" r="1.15"/><circle cx="10.3" cy="11.9" r="1.15"/></g></svg>';

  /* v0.6: extension cards. One glyph per contract icon, all stroke=currentColor
   * inside the 14px chip — no external assets, no inline fill colours. */
  var CARD_ACTIONS_URL = './api/cards/';

  /* v0.7: remote takeover. The desktop side starts a LAN listener and hands out
   * one-time pairing codes; the phone gets this same page and only reads. */
  var REMOTE_URL = './api/remote';
  var REMOTE_START_URL = './api/remote/start';
  var REMOTE_STOP_URL = './api/remote/stop';
  var REMOTE_PAIR_URL = './api/remote/pair/new';
  var REMOTE_SESSIONS_URL = './api/remote/sessions';
  /* v0.9: HTTPS tunnel guide + public-URL configuration (same-origin JSON). */
  var REMOTE_CONFIG_URL = './api/remote/config';
  var REMOTE_TUNNEL_URL = './api/remote/tunnel';
  var PAIR_TTL = 120000;
  /* The host marks paired remote clients with a readable cookie and redirects
   * them to ?remote=1; either signal flips the page into remote-client mode. */
  var REMOTE_MODE = (function () {
    var flagged = false;
    try {
      flagged = /(?:^|;\s*)cockpit_remote_flag=1(?:;|$)/.test(document.cookie);
    } catch (err) { flagged = false; }
    if (flagged) return true;
    try {
      return new URLSearchParams(window.location.search).has('remote');
    } catch (err) {
      return /(?:[?&])remote(?:=|&|$)/.test(window.location.search);
    }
  })();
  var ICON_CARDS = {
    git: '<svg viewBox="0 0 14 14" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"><circle cx="4.2" cy="3.7" r="1.45"/><circle cx="9.8" cy="3.7" r="1.45"/><circle cx="4.2" cy="10.3" r="1.45"/><path d="M4.2 5.15v3.7M9.8 5.15c0 2.15-1.3 3.55-3.2 4.15"/></g></svg>',
    code: '<svg viewBox="0 0 14 14" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M5.1 4.2 2.4 7l2.7 2.8M8.9 4.2 11.6 7l-2.7 2.8"/></g></svg>',
    test: '<svg viewBox="0 0 14 14" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="7" r="4.85"/><path d="M4.7 7.1 6.3 8.7 9.3 5.5"/></g></svg>',
    cost: '<svg viewBox="0 0 14 14" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M4.4 3.4 7 6.3l2.6-2.9M7 6.3v4.3M4.9 7.7h4.2M4.9 9.4h4.2"/></g></svg>',
    note: '<svg viewBox="0 0 14 14" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"><path d="M3.6 4.2h6.8M3.6 7h6.8M3.6 9.8h4.2"/></g></svg>',
    shield: '<svg viewBox="0 0 14 14" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M7 2.15 11.2 3.5v3c0 2.55-1.7 4.2-4.2 5.05-2.5-.85-4.2-2.5-4.2-5.05v-3z"/><path d="M5.2 7.05 6.6 8.45 9 5.75"/></g></svg>',
    clock: '<svg viewBox="0 0 14 14" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="7" r="4.85"/><path d="M7 4.3V7l1.9 1.2"/></g></svg>',
    spark: '<svg viewBox="0 0 14 14" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"><path d="M7 2.15 8.25 5.75 11.85 7 8.25 8.25 7 11.85 5.75 8.25 2.15 7 5.75 5.75z"/></g></svg>',
    file: '<svg viewBox="0 0 14 14" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><path d="M4 2.6h3.7l2.3 2.3v6.5H4z"/><path d="M7.5 2.8v2.4h2.3"/></g></svg>'
  };
  var CARD_ICON_TONE = { git: '', code: 'violet', test: 'green', cost: 'amber', note: 'cyan', shield: 'green', clock: '', spark: 'violet', file: 'muted' };
  var CARD_ICON_FALLBACK = ICON_CARDS.spark;

  /* v0.7: one clean stroke glyph set for the remote surfaces. */
  var ICON_GEAR = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" aria-hidden="true"><circle cx="10" cy="10" r="2.6"/><path d="M10 3.2v1.7M10 15.1v1.7M16.8 10h-1.7M4.9 10H3.2M14.8 5.2l-1.2 1.2M6.4 13.6l-1.2 1.2M14.8 14.8l-1.2-1.2M6.4 6.4 5.2 5.2"/></svg>';
  var ICON_PHONE = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4.3" y="1.9" width="7.4" height="12.2" rx="2"/><path d="M7 12.4h2"/></svg>';
  var ICON_LINK = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.4 9.6a2.6 2.6 0 0 0 3.7 0l1.8-1.8a2.6 2.6 0 0 0-3.7-3.7l-.9.9"/><path d="M9.6 6.4a2.6 2.6 0 0 0-3.7 0L4.1 8.2a2.6 2.6 0 0 0 3.7 3.7l.9-.9"/></svg>';
  var ICON_X = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';

  /* v0.7.1: team roster grouping — the lead is pinned first, running mates are
   * always expanded, idle/failed mates fold into a single header row. The
   * collapsed preference is persisted per browser so state frames and reloads
   * never re-open a group the user folded. */
  var ROSTER_KEY = 'cockpit.roster.v1';
  var ROSTER_GROUPS = ['running', 'idle', 'failed'];
  var ROSTER_LABEL = { running: '运行中', idle: '空闲', failed: '异常' };
  var ICON_CHEV = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.2 6.25 8 9.05l2.8-2.8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  /* v0.8: the desktop capsule is now bundled with the cockpit plugin, so the
   * settings card drives the built-in capsule process instead of an external
   * dsh-hud bridge. GET/POST once when the settings tab opens (never polls);
   * ./api/hud-bridge is still read for the small team/approval summary. */
  var CAPSULE_URL = './api/capsule';
  var HUD_BRIDGE_URL = './api/hud-bridge';
  var DIAG_URL = './api/diagnostics';
  var CAPSULE_HEARTBEAT_MS = 15000;
  /* v1.2: how long a one-shot ?focus=approvals deep link may wait for the
   * approval to show up — the first frame often arrives before the gate does. */
  var FOCUS_RETRY_FRAMES = 3;
  var FOCUS_TIMEOUT_MS = 5000;

  var EMBED = /(?:[?&])embed=1(?:&|$)/.test(window.location.search);
  /* Column widths are user-draggable and remembered per browser. */
  var WIDTH_KEY = 'cockpit.widths.v1';
  /* Teammate display order is user-draggable and remembered per browser. */
  var ORDER_KEY = 'cockpit.order.v1';
  var LIMITS = { rail: [190, 380], side: [256, 620] };
  function loadWidths() {
    try {
      var raw = JSON.parse(window.localStorage.getItem(WIDTH_KEY) || '{}');
      return { rail: num(raw.rail), side: num(raw.side) };
    } catch (err) {
      return { rail: null, side: null };
    }
  }
  function saveWidths() {
    try {
      window.localStorage.setItem(WIDTH_KEY, JSON.stringify(app.widths));
    } catch (err) { /* storage may be unavailable */ }
  }
  function loadOrder() {
    try {
      var raw = JSON.parse(window.localStorage.getItem(ORDER_KEY) || '[]');
      if (!Array.isArray(raw)) return [];
      var out = [];
      raw.forEach(function (id) {
        if (typeof id === 'string' && id && id.length <= 120 && out.indexOf(id) < 0) out.push(id);
      });
      return out;
    } catch (err) {
      return [];
    }
  }
  function saveOrder() {
    try {
      window.localStorage.setItem(ORDER_KEY, JSON.stringify(arr(app.order)));
    } catch (err) { /* storage may be unavailable */ }
  }
  function stageVars() {
    var parts = [];
    if (num(app.widths.rail) != null) parts.push('--rail-w:' + Math.round(app.widths.rail) + 'px');
    if (num(app.widths.side) != null) parts.push('--side-w:' + Math.round(app.widths.side) + 'px');
    return parts.length ? ' style="' + parts.join(';') + '"' : '';
  }
  var app = {
    data: null,
    loaded: false,
    aliases: {},
    widths: { rail: null, side: null },
    pendingAlias: null,
    connected: false,
    lastEventAt: 0,
    tab: 'overview',
    editing: null,
    resetStageScroll: false,
    /* v0.5: per-connection session selection (?s=), render buffering while an
     * inline rename is open, and the persisted teammate order. */
    selectedSession: null,
    /* v1.2: true only when the user picked the session by hand. A stale ?s=
     * bookmark returns to the automatic view silently; a hand-picked session
     * that vanished still deserves the toast. */
    selectedManual: false,
    stateSeq: 0,
    pendingState: null,
    order: [],
    reorderId: '',
    /* v0.7.1: expanded state of the collapsible roster groups (running is always open) */
    roster: { idle: false, failed: false },
    /* v0.3 approval gate — local UI state keyed by approval id */
    ap: {
      expanded: false,
      seen: {},
      gone: {},
      invalid: {},
      transferred: {},
      busy: {},
      error: {},
      focus: ''
    },
    /* v0.4 write actions */
    compose: null,
    ir: { key: '', busy: false, error: '', focus: false },
    /* v0.6 extension cards (local UI state keyed by card id) + PWA surface */
    xc: {
      busy: {},
      run: null,        /* { card, action } currently in flight */
      error: {},        /* card id -> { action, kind: 'network' | 'fail', status } */
      confirm: null,    /* { card, action } armed confirmation */
      focus: '',        /* data-fk of the control to focus after the next render */
      confirmFocus: false
    },
    pwa: {
      install: null,
      swActive: false
    },
    /* v0.7 remote takeover: host entries (desktop) + the pairing dialog.
     * `loaded`/`available` keep the settings section quiet until the tab asks
     * the host once; `focus` is the data-fk control to focus after a render. */
    remote: {
      seq: 0,
      loaded: false,
      available: true,
      enabled: true,
      running: false,
      url: '',
      /* v0.9: public HTTPS origin (tunnel) + phone-facing URL from the host. */
      publicUrl: '',
      secure: false,
      urlForPhone: '',
      port: null,
      sessions: [],
      busy: '',
      error: '',
      confirmStop: false,
      focus: '',
      /* v0.9: inline public-URL editor state */
      pub: { editing: false, value: '', busy: false, error: '', focus: '' }
    },
    /* v0.9: HTTPS tunnel guide — fetched once when the settings tab opens. */
    tunnel: {
      seq: 0,
      loaded: false,
      available: true,
      running: false,
      lanUrl: '',
      tools: [],
      commands: [],
      busy: false,
      error: '',
      focus: ''
    },
    /* v0.9: Web Notifications (desktop only; hidden on the remote phone view). */
    notify: {
      busy: false,
      error: '',
      focus: ''
    },
    /* v1.1: one-shot deep-link intent from the capsule (?focus=approvals) and
     * the settings self-check card state (loaded lazily, never polled). */
    focusRequest: '',
    focusUntil: 0,
    focusFrames: 0,
    scrollApprovals: false,
    diag: {
      seq: 0,
      loaded: false,
      busy: false,
      error: '',
      status: '',
      version: '',
      generatedAt: 0,
      checks: [],
      report: '',
      focus: ''
    },
    /* v0.8: built-in desktop capsule card (desktop settings). `running` comes
     * from the host process, never from the switch; `bridge` is the read-only
     * summary fetched from ./api/hud-bridge; `heartbeatStale` flips amber
     * locally when the capsule stops sending heartbeats. */
    capsule: {
      seq: 0,
      loaded: false,
      available: true,
      supported: true,
      enabled: false,
      running: false,
      pid: null,
      startedAt: 0,
      statePath: '',
      bridgePath: '',
      scriptPath: '',
      writtenAt: 0,
      heartbeatAt: 0,
      writes: 0,
      legacyDetected: false,
      lastError: '',
      bridge: null,
      heartbeatStale: false,
      busy: false,
      error: '',
      actionError: '',
      focus: ''
    },
    pair: null
  };

  var renderQueued = false;
  var toastTimer = null;
  var es = null;

  /* ---------- host-aware theme (light / dark) ---------- */
  var THEME_MEDIA = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  var themeObserver = null;
  var themeWatchedDoc = null;

  function themeFromElement(el) {
    if (!el || !el.getAttribute) return null;
    var raw = el.getAttribute('data-theme') || el.getAttribute('data-color-mode') ||
      el.getAttribute('data-mode') || el.getAttribute('data-bs-theme');
    if (raw) {
      if (/dark|night|夜/i.test(raw)) return 'dark';
      if (/light|day|日/i.test(raw)) return 'light';
    }
    if (el.classList) {
      if (el.classList.contains('dark') || el.classList.contains('theme-dark')) return 'dark';
      if (el.classList.contains('light') || el.classList.contains('theme-light')) return 'light';
    }
    return null;
  }

  function themeFromComputed(win, el) {
    try {
      var cs = win.getComputedStyle(el || win.document.documentElement);
      var scheme = cs.colorScheme || '';
      if (/dark/i.test(scheme) && !/light/i.test(scheme)) return 'dark';
      if (/light/i.test(scheme) && !/dark/i.test(scheme)) return 'light';
      var m = String(cs.backgroundColor || '').match(/rgba?\(([^)]+)\)/);
      if (m) {
        var p = m[1].split(',').map(Number);
        if (p.length > 3 && p[3] === 0) return null;
        var lum = (0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]) / 255;
        if (lum < 0.38) return 'dark';
        if (lum > 0.8) return 'light';
      }
    } catch (err) { /* ignore unreadable styles */ }
    return null;
  }

  /** Host theme wins (same-origin workspace iframe), then the OS preference. */
  function detectTheme() {
    var forced = null;
    try {
      forced = new URLSearchParams(window.location.search).get('theme');
    } catch (err) { /* about:blank or odd embedder */ }
    if (forced === 'dark' || forced === 'light') return forced;
    if (window.parent && window.parent !== window) {
      try {
        var pdoc = window.parent.document;
        watchHostTheme(pdoc);
        var roots = [pdoc.documentElement, pdoc.body];
        for (var i = 0; i < roots.length; i++) {
          var t = themeFromElement(roots[i]);
          if (t) return t;
        }
        var byStyle = themeFromComputed(window.parent, pdoc.body) || themeFromComputed(window.parent, pdoc.documentElement);
        if (byStyle) return byStyle;
        watchHostTheme(pdoc);
      } catch (err) { /* cross-origin host: follow prefers-color-scheme */ }
    }
    return THEME_MEDIA && THEME_MEDIA.matches ? 'dark' : 'light';
  }

  function watchHostTheme(pdoc) {
    if (themeObserver || !pdoc || !window.MutationObserver || themeWatchedDoc === pdoc) return;
    themeWatchedDoc = pdoc;
    themeObserver = new MutationObserver(function () { applyTheme(); });
    var opts = { attributes: true, attributeFilter: ['class', 'data-theme', 'data-color-mode', 'data-mode', 'data-bs-theme', 'style'] };
    if (pdoc.documentElement) themeObserver.observe(pdoc.documentElement, opts);
    if (pdoc.body) themeObserver.observe(pdoc.body, opts);
  }

  function applyTheme() {
    var theme = detectTheme();
    var root = document.documentElement;
    if (root.getAttribute('data-theme') !== theme) root.setAttribute('data-theme', theme);
    if (root.style.colorScheme !== theme) root.style.colorScheme = theme;
    var meta = document.querySelector('meta[name="color-scheme"]');
    if (meta && meta.getAttribute('content') !== theme) meta.setAttribute('content', theme);
  }

  function initTheme() {
    applyTheme();
    if (THEME_MEDIA) {
      if (THEME_MEDIA.addEventListener) THEME_MEDIA.addEventListener('change', applyTheme);
      else if (THEME_MEDIA.addListener) THEME_MEDIA.addListener(applyTheme);
    }
    document.addEventListener('visibilitychange', function () { if (!document.hidden) applyTheme(); });
    window.addEventListener('focus', applyTheme);
    /* Last resort for hosts that repaint without DOM mutations we can observe. */
    window.setInterval(applyTheme, 5000);
  }

  /* ---------- tiny helpers ---------- */
  function countLabel(n, one, many) {
    return n + ' ' + (n === 1 ? one : many);
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
  function num(value) {
    if (typeof value === 'number' && isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '' && isFinite(Number(value))) return Number(value);
    return null;
  }
  function arr(value) { return Array.isArray(value) ? value : []; }
  function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
  function firstChar(text) {
    var chars = Array.from(String(text == null ? '' : text).trim());
    return chars.length ? chars[0] : '·';
  }
  function fmtInt(value) {
    var n = num(value);
    return n == null ? '—' : String(Math.round(n));
  }
  function fmtTokens(value) {
    var n = num(value);
    if (n == null) return '—';
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(Math.round(n));
  }
  function fmtDur(ms) {
    var n = num(ms);
    if (n == null || n < 0) return '—';
    var sec = Math.floor(n / 1000);
    if (sec < 60) return sec + ' 秒';
    var min = Math.floor(sec / 60);
    if (min < 60) return min + ' 分';
    var hr = Math.floor(min / 60);
    if (hr < 24) return hr + ' 小时 ' + (min % 60) + ' 分';
    return Math.floor(hr / 24) + ' 天';
  }
  function fmtClock(ms) {
    var d = new Date(ms);
    function p(n) { return n < 10 ? '0' + n : '' + n; }
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  /* ---------- data accessors ---------- */
  function data() { return app.data || {}; }
  function session() { return data().session || null; }
  function team() { return data().team || {}; }
  function members() { return arr(team().members); }
  function tasks() { return arr(team().tasks); }
  function sessionsList() { return arr(data().sessions); }
  /* The session the deck is currently scoped to: explicit selection or the
   * host's automatic active session. */
  function displaySessionId() {
    var active = session();
    return app.selectedSession || (active && active.id ? String(active.id) : '');
  }
  function naturalMates() {
    return members().filter(function (m) { return m && m.role !== 'lead'; });
  }
  function activity() { return arr(data().activity); }
  function files() { return arr(data().files); }
  /* v0.6: extension cards arrive pre-sorted from the host; keep only well-formed
   * entries so one malformed card can never take the whole section down. */
  function cards() {
    return arr(data().cards).filter(function (c) {
      return !!c && typeof c === 'object' && c.id != null && String(c.id) !== '';
    });
  }

  /* ---------- approvals (v0.3 gate) ---------- */
  function approvalId(a) { return a && a.id != null ? String(a.id) : ''; }
  function approvalsList() {
    return arr(data().approvals).filter(function (a) { return approvalId(a) !== ''; });
  }
  function approvalGone(a) {
    var id = approvalId(a);
    /* gone = removed from the deck; invalid / transferred stay visible for a
     * beat so the user can read 该请求已失效 / 已转交给工作台确认. */
    return !!(app.ap.gone[id]);
  }
  function visibleApprovals() {
    return approvalsList().filter(function (a) { return !approvalGone(a); });
  }
  function approvalWindow(a) {
    var exp = num(a && a.expiresAt);
    var req = num(a && a.requestedAt);
    var total = exp != null && req != null && exp > req ? exp - req : 25000;
    return { exp: exp, req: req, total: total };
  }
  function approvalSecondsLeft(a) {
    var win = approvalWindow(a);
    if (win.exp == null) return null;
    return Math.max(0, Math.ceil((win.exp - Date.now()) / 1000));
  }
  function approvalRequester(a) {
    if (!a) return '会话';
    if (a.sessionTitle) return String(a.sessionTitle);
    var m = a.sessionId != null ? findMember(a.sessionId) : null;
    if (m) return memberMeta(m).display;
    if (a.memberId != null) { m = findMember(a.memberId); if (m) return memberMeta(m).display; }
    return '当前会话';
  }
  function approvalTool(a) {
    var label = a && a.label ? String(a.label) : '工具调用';
    var name = a && a.toolName ? String(a.toolName) : '';
    return { label: label, name: name };
  }
  function fmtSeconds(sec) {
    if (sec == null) return '—';
    if (sec <= 0) return '0 秒';
    if (sec < 60) return sec + ' 秒';
    return Math.floor(sec / 60) + ' 分 ' + (sec % 60) + ' 秒';
  }

  function approvalCardHTML(a) {
    var id = approvalId(a);
    var win = approvalWindow(a);
    var rem = approvalSecondsLeft(a);
    var busy = app.ap.busy[id];
    var err = app.ap.error[id];
    var invalid = !!app.ap.invalid[id];
    var transferred = !!app.ap.transferred[id];
    var warn = rem != null && rem <= 8 && rem > 0;
    var critical = rem != null && rem <= 3 && rem > 0;
    var cls = ' approval-card';
    if (warn) cls += ' is-warn';
    if (critical) cls += ' is-critical';
    if (invalid) cls += ' is-invalid';
    if (transferred) cls += ' is-transferred';
    if (err) cls += ' is-error';
    var pct = win.exp != null ? clamp((win.exp - Date.now()) / win.total * 100, 0, 100) : 100;
    var tool = approvalTool(a);
    var who = approvalRequester(a);
    var reason = a && a.reason ? String(a.reason) : '';
    var detail = a && a.detail ? String(a.detail) : '';
    var stateHTML = '';
    var actionsHTML = '';
    if (invalid) {
      stateHTML = '<div class="apr-state">该请求已失效，正在从队列移除</div>';
    } else if (transferred) {
      stateHTML = '<div class="apr-state">已转交给工作台确认</div>';
    } else if (busy) {
      stateHTML = '<div class="apr-state is-busy">正在提交决定…</div>';
      actionsHTML = '<div class="apr-actions">' +
        '<button class="apr-btn allow" type="button" disabled>允许中…</button>' +
        '<button class="apr-btn reject" type="button" disabled>拒绝中…</button>' +
      '</div>';
    } else if (err) {
      stateHTML = '<div class="apr-error"><span>提交失败，请检查网络后重试</span>' +
        '<button class="apr-btn retry" type="button" data-action="approval-retry" data-id="' + esc(id) + '" data-decision="' + esc(err) + '">重试</button>' +
      '</div>';
    } else {
      actionsHTML = '<div class="apr-actions">' +
        '<button class="apr-btn allow" type="button" data-action="approval-answer" data-id="' + esc(id) + '" data-decision="allow-once">允许一次</button>' +
        '<button class="apr-btn reject" type="button" data-action="approval-answer" data-id="' + esc(id) + '" data-decision="reject">拒绝</button>' +
      '</div>';
    }
    return '<article class="card' + cls + '" data-apr-id="' + esc(id) + '"' +
        ' data-exp="' + (win.exp == null ? '' : win.exp) + '" data-req="' + (win.req == null ? '' : win.req) + '"' +
        ' role="group" aria-label="需要你确认的审批">' +
      '<div class="card-head apr-head">' +
        '<span class="apr-dot" aria-hidden="true">!</span>' +
        '<h3>需要你确认</h3>' +
        '<span class="apr-time' + (warn ? ' is-warn' : '') + (critical ? ' is-critical' : '') + '" data-apr-time role="timer">' + esc(fmtSeconds(rem)) + '</span>' +
      '</div>' +
      '<div class="apr-bar" aria-hidden="true"><i data-apr-bar style="width:' + pct.toFixed(1) + '%"></i></div>' +
      '<div class="apr-meta">' +
        '<b class="apr-sess" title="' + esc(who) + '">' + esc(who) + '</b>' +
        '<span class="apr-tool" title="' + esc(tool.label + (tool.name ? ' · ' + tool.name : '')) + '">' +
          esc(tool.label) + (tool.name ? '<span class="apr-tool-name">' + esc(tool.name) + '</span>' : '') +
        '</span>' +
      '</div>' +
      (detail ? '<code class="apr-detail" title="' + esc(detail) + '">' + esc(detail) + '</code>' : '') +
      (reason ? '<p class="apr-reason" title="' + esc(reason) + '">' + esc(reason) + '</p>' : '') +
      stateHTML + actionsHTML +
    '</article>';
  }

  function approvalsHTML(extra) {
    var list = visibleApprovals();
    if (!list.length) return '';
    var limit = app.ap.expanded ? list.length : 2;
    var shown = list.slice(0, limit);
    var more = list.length - shown.length;
    return '<div class="approvals ' + esc(extra) + '">' +
      shown.map(approvalCardHTML).join('') +
      (more > 0
        ? '<button class="apr-more" type="button" data-action="approval-more">还有 ' + more + ' 个待确认</button>'
        : '') +
    '</div>';
  }

  function answerApproval(id, decision) {
    id = id == null ? '' : String(id);
    if (!id || (decision !== 'allow-once' && decision !== 'reject')) return;
    if (app.ap.busy[id] || app.ap.gone[id] || app.ap.invalid[id] || app.ap.transferred[id]) return;
    app.ap.busy[id] = decision;
    delete app.ap.error[id];
    scheduleRender();
    fetch('./api/approvals/' + encodeURIComponent(id), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ decision: decision })
    }).then(function (res) {
      if (res.status === 404) {
        delete app.ap.busy[id];
        app.ap.invalid[id] = true;
        scheduleRender();
        setTimeout(function () {
          if (app.ap.invalid[id]) {
            delete app.ap.invalid[id];
            app.ap.gone[id] = true;
            if (visibleApprovals().length <= 2) app.ap.expanded = false;
            scheduleRender();
          }
        }, 1400);
        return null;
      }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json().catch(function () { return { ok: true }; });
    }).then(function (payload) {
      if (payload === null) return;
      delete app.ap.busy[id];
      app.ap.gone[id] = true;
      if (visibleApprovals().length <= 2) app.ap.expanded = false;
      scheduleRender();
      toast(decision === 'allow-once' ? '已允许' : '已拒绝');
    }).catch(function () {
      delete app.ap.busy[id];
      app.ap.error[id] = decision;
      scheduleRender();
      toast('审批提交失败，请重试');
    });
  }

  /* Keep the local UI maps in sync with each state frame: forget ids the host
   * already resolved, remember new asks, and give the first new ask the focus. */
  function syncApprovals(payload) {
    var list = arr(payload && payload.approvals).filter(function (a) { return approvalId(a) !== ''; });
    var ids = {};
    list.forEach(function (a) { ids[approvalId(a)] = true; });
    ['gone', 'invalid', 'transferred', 'busy', 'error'].forEach(function (key) {
      Object.keys(app.ap[key]).forEach(function (id) {
        if (!ids[id]) delete app.ap[key][id];
      });
    });
    list.forEach(function (a) {
      var id = approvalId(a);
      if (app.ap.seen[id] || app.ap.gone[id] || app.ap.invalid[id]) return;
      app.ap.seen[id] = true;
      if (!app.ap.focus) app.ap.focus = id;
    });
    if (list.length <= 2) app.ap.expanded = false;
  }

  function findMember(idOrName) {
    var list = members();
    for (var i = 0; i < list.length; i++) {
      if (list[i] && (list[i].id === idOrName || list[i].name === idOrName)) return list[i];
    }
    return null;
  }
  /* Display order: the lead stays pinned first, teammates follow the persisted
   * order; ids missing from that order keep their natural payload order. */
  function orderedMembers() {
    var leads = [];
    var mates = [];
    members().forEach(function (m) {
      if (!m) return;
      if (m.role === 'lead') leads.push(m); else mates.push(m);
    });
    if (app.order.length && mates.length > 1) {
      var natural = mates.map(function (m) { return m.id; });
      mates.sort(function (a, b) {
        var ia = app.order.indexOf(a.id);
        var ib = app.order.indexOf(b.id);
        if (ia < 0 && ib < 0) return natural.indexOf(a.id) - natural.indexOf(b.id);
        if (ia < 0) return 1;
        if (ib < 0) return -1;
        return ia - ib;
      });
    }
    return leads.concat(mates);
  }
  function baseColorFor(m) {
    if (!m) return 'blue';
    if (m.role === 'lead') return 'blue';
    var mates = naturalMates();
    var idx = Math.max(0, mates.findIndex(function (x) { return x.id === m.id; }));
    return TEAM_COLORS[idx % TEAM_COLORS.length];
  }
  function memberMeta(m) {
    var isLead = !!m && m.role === 'lead';
    var mates = naturalMates();
    var idx = Math.max(0, mates.findIndex(function (x) { return x.id === m.id; }));
    var fallbackName = isLead ? '你' : FALLBACK_NAMES[idx % FALLBACK_NAMES.length];
    var alias = app.aliases[m.id] || {};
    var aliasName = typeof alias.name === 'string' ? alias.name.trim().slice(0, 12) : '';
    var color = PALETTE.indexOf(alias.color) >= 0 ? alias.color : (isLead ? 'blue' : TEAM_COLORS[idx % TEAM_COLORS.length]);
    var display = aliasName || fallbackName;
    return {
      lead: isLead,
      display: display,
      real: m.name || m.id || '—',
      color: color,
      alias: aliasName,
      letter: firstChar(display)
    };
  }
  function statusCls(m) {
    var s = m && m.status;
    if (s === 'running' || s === 'idle' || s === 'provisioning' || s === 'failed') return s;
    if (m && m.phase === 'failed') return 'failed';
    if (m && m.phase === 'provisioning') return 'provisioning';
    return m && m.running ? 'running' : 'idle';
  }
  function sameAgent(item, m) {
    if (!item || !m) return false;
    if (item.agentId != null) return item.agentId === m.id;
    return item.agent === m.name || item.agent === m.id || item.agentId === m.id;
  }
  function isBlocked(t) { if (t && t.status === 'completed') return false; return arr(t && t.blockedBy).length > 0 || (t && t.ready === false); }
  function isHotMember(m) {
    return tasks().some(function (t) { return t && t.owner === m.id && arr(t.warnings).length > 0; });
  }
  function sessionPercent() {
    var s = session();
    if (!s) return null;
    var p = num(s.percent);
    if (p != null) return clamp(Math.round(p), 0, 100);
    var total = num(s.total), done = num(s.completed);
    if (total && done != null) return clamp(Math.round((done / total) * 100), 0, 100);
    var steps = s.plan && Array.isArray(s.plan.steps) ? s.plan.steps : [];
    if (steps.length) {
      var closed = steps.filter(function (x) { return x && x.status === 'completed'; }).length;
      return clamp(Math.round((closed / steps.length) * 100), 0, 100);
    }
    return null;
  }
  function currentElapsed() {
    var s = session();
    if (!s) return null;
    var started = num(s.startedAt);
    if (started != null) {
      var diff = referenceNow() - started;
      if (diff >= 0 && diff < 1000 * 60 * 60 * 24 * 60) return diff;
    }
    return num(s.elapsedMs);
  }

  /* Reference clock: normalizes fixtures whose `now` disagrees with their data
   * (the preview mock is dated months back). Live payloads use the local clock. */
  function referenceNow() {
    var d = data();
    var serverNow = num(d.now);
    var stamps = [];
    activity().forEach(function (a) { var at = num(a && a.at); if (at != null) stamps.push(at); });
    members().forEach(function (m) { var at = num(m && m.lastAt); if (at != null) stamps.push(at); });
    if (serverNow != null && stamps.length) {
      var newest = Math.max.apply(null, stamps);
      if (Math.abs(serverNow - newest) > 1000 * 60 * 60 * 12) return newest;
    }
    return Date.now();
  }
  function shortTitle(value, max) {
    var v = String(value == null ? '' : value).trim();
    if (!v) return '';
    return v.length > max ? v.slice(0, max) + '…' : v;
  }
  function fullDate(at) {
    var d = new Date(at);
    var p2 = function (n) { return n < 10 ? '0' + n : String(n); };
    var sameYear = d.getFullYear() === new Date().getFullYear();
    return (sameYear ? '' : d.getFullYear() + '-') + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
  }
  function ago(at) {
    var atN = num(at);
    if (atN == null) return '—';
    var diff = referenceNow() - atN;
    if (diff < 0) diff = 0;
    /* stale or future snapshots: fall back to an absolute stamp instead of "373 天前" */
    if (diff > 7 * 86400000) return fullDate(atN);
    if (diff < 1500) return '刚刚';
    if (diff < 60000) return Math.floor(diff / 1000) + ' 秒前';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' 分前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
    return Math.floor(diff / 86400000) + ' 天前';
  }

  /* ---------- rich text ---------- */
  function richText(value) {
    if (value == null) return '';
    return String(value).split(/(\s+)/).map(function (token) {
      if (!token) return '';
      var bare = token.replace(/[，。；、,.;:]+$/, '');
      var suffix = token.slice(bare.length);
      var isPath = /^(?:[\w.@-]+\/)+[\w.@-]*$/.test(bare);
      var isFile = /^[\w.@-]+\.(?:[cm]?[jt]sx?|json|md|css|html?|svg|py|rs|go|ya?ml|toml|sh)$/i.test(bare);
      if (isPath || isFile) return '<code>' + esc(bare) + '</code>' + esc(suffix);
      return esc(token);
    }).join('');
  }

  /* ---------- render orchestration ---------- */
  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    var done = false;
    var flush = function () {
      if (done) return;
      done = true;
      renderQueued = false;
      render();
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(flush);
    /* headless/background tabs may hold requestAnimationFrame; keep a timer fallback */
    setTimeout(flush, 50);
  }

  function render() {
    var root = document.getElementById('app');
    if (!root) return;
    /* v0.5: while the inline rename is open the rail must not be rebuilt. A
     * whole-tree swap removes the focused input (focusout closes the editor),
     * so state frames are buffered by applyState() and every other render
     * request is deferred until commit/cancel. The edit's first paint (to
     * insert the input) is allowed through exactly once. */
    if (app.editing) {
      if (app.editing.paint) {
        app.editing.paint = false;
      } else {
        app.deferredRender = true;
        return;
      }
    }
    var active = document.activeElement;
    var focus = null;
    if (active && active.classList) {
      if (active.classList.contains('alias-input')) {
        focus = {
          kind: 'input',
          start: active.selectionStart,
          end: active.selectionEnd,
          value: active.value
        };
      } else if (active.dataset && active.dataset.action) {
        focus = {
          kind: 'action',
          action: active.dataset.action,
          id: active.dataset.id || '',
          tab: active.dataset.tab || '',
          fk: active.dataset.fk || ''
        };
      }
    }
    var scrolls = {};
    var oldStage = root.querySelector('.stage');
    var stageScroll = oldStage ? oldStage.scrollTop : 0;
    root.querySelectorAll('[data-scroll]').forEach(function (el) {
      if (el.dataset.scroll) scrolls[el.dataset.scroll] = el.scrollTop;
    });

    root.innerHTML = shellHTML();

    root.querySelectorAll('[data-scroll]').forEach(function (el) {
      var y = scrolls[el.dataset.scroll];
      if (typeof y === 'number') el.scrollTop = y;
    });
    var newStage = root.querySelector('.stage');
    if (newStage) newStage.scrollTop = app.resetStageScroll ? 0 : stageScroll;
    app.resetStageScroll = false;

    /* The inline rename input survives whole-tree renders: focus it and put
     * the caret back where the user left it (also covers touch / toolbar hits). */
    if (app.editing) {
      var editInput = root.querySelector('.alias-input');
      if (editInput) {
        editInput.focus({ preventScroll: true });
        try {
          if (focus && focus.kind === 'input') {
            var len = editInput.value.length;
            var s = focus.start == null ? len : Math.min(focus.start, len);
            var e = focus.end == null ? len : Math.min(focus.end, len);
            editInput.setSelectionRange(s, e);
          } else {
            editInput.setSelectionRange(editInput.value.length, editInput.value.length);
          }
        } catch (err) { /* ignore */ }
      }
    } else if (focus && focus.kind === 'action') {
      var target = null;
      /* v0.4: write-action controls can share a data-id (a member card and the
       * matching session row), so restore by their unique focus key first. */
      if (focus.fk) {
        var byKey = root.querySelector('[data-fk="' + String(focus.fk).replace(/["\\]/g, '\\$&') + '"]');
        if (byKey) target = byKey;
      }
      if (!target) {
        var candidates = root.querySelectorAll('[data-action]');
        for (var i = 0; i < candidates.length; i++) {
          var el = candidates[i];
          if (el.dataset.action === focus.action &&
              (el.dataset.id || '') === focus.id &&
              (el.dataset.tab || '') === focus.tab) {
            target = el;
            break;
          }
        }
      }
      if (target) {
        /* A hover-revealed ghost action can still be visibility:hidden right
         * after a frame lands (pointer hover is re-evaluated lazily after a
         * DOM swap, and a keyboard user may be returning from a dialog).
         * Make it focusable for this call — CSS :focus-within re-shows the
         * group while it holds focus, so the inline override can be dropped
         * again right after. */
        var wasHidden = false;
        try { wasHidden = window.getComputedStyle(target).visibility === 'hidden'; } catch (err) { wasHidden = false; }
        if (wasHidden) target.style.visibility = 'visible';
        target.focus({ preventScroll: true });
        if (wasHidden) {
          var clearHidden = function () { if (target && target.style) target.style.visibility = ''; };
          if (typeof requestAnimationFrame === 'function') requestAnimationFrame(clearHidden); else setTimeout(clearHidden, 16);
        }
      }
    }
    /* v0.3: a freshly arrived approval takes the default focus on its
     * "允许一次" button, unless the user is already editing/acting elsewhere. */
    if (!app.editing && app.ap.focus) {
      var apId = app.ap.focus;
      app.ap.focus = '';
      if (!(focus && focus.kind === 'action')) {
        var prime = root.querySelector('.approvals [data-action="approval-answer"][data-decision="allow-once"][data-id="' + apId.replace(/"/g, '\\"') + '"]');
        if (prime && prime.offsetParent !== null) prime.focus({ preventScroll: true });
      }
    }
    /* v0.4: arming an interrupt focuses the danger button so Enter/Esc work. */
    if (app.ir.focus) {
      app.ir.focus = false;
      var irBtn = root.querySelector('.ir-confirm [data-action="interrupt-confirm"]');
      if (irBtn && irBtn.offsetParent !== null) irBtn.focus({ preventScroll: true });
    }
    /* v0.6: extension cards keep the keyboard on the control that changed
     * (armed confirm button, or the action button after cancel/success). */
    if (app.xc.focus) {
      var xcKey = app.xc.focus;
      app.xc.focus = '';
      var xcEl = root.querySelector('[data-fk="' + String(xcKey).replace(/["\\]/g, '\\$&') + '"]');
      if (xcEl && xcEl.offsetParent !== null) xcEl.focus({ preventScroll: true });
    }
    if (app.xc.confirmFocus) {
      app.xc.confirmFocus = false;
      var xcDanger = root.querySelector('.xc-confirm [data-action="card-run"]');
      if (xcDanger && xcDanger.offsetParent !== null) xcDanger.focus({ preventScroll: true });
    }
    /* v0.7: remote controls keep the keyboard on the button that changed
     * (start/stop retries, armed stop confirm, rotated pairing code). */
    if (app.remote.focus) {
      var rKey = app.remote.focus;
      app.remote.focus = '';
      var rEl = root.querySelector('[data-fk="' + String(rKey).replace(/["\\]/g, '\\$&') + '"]');
      if (rEl && rEl.offsetParent !== null) rEl.focus({ preventScroll: true });
    }
    /* v0.8: the capsule switch keeps focus across its optimistic re-render. */
    if (app.capsule.focus) {
      var cKey = app.capsule.focus;
      app.capsule.focus = '';
      var cEl = root.querySelector('[data-fk="' + String(cKey).replace(/["\\]/g, '\\$&') + '"]');
      if (cEl && cEl.offsetParent !== null) cEl.focus({ preventScroll: true });
    }
    /* v0.9: tunnel copy/refresh + notification buttons keep their focus. */
    if (app.tunnel.focus) {
      var tKey = app.tunnel.focus;
      app.tunnel.focus = '';
      var tEl = root.querySelector('[data-fk="' + String(tKey).replace(/["\\]/g, '\\$&') + '"]');
      if (tEl && tEl.offsetParent !== null) tEl.focus({ preventScroll: true });
    }
    if (app.notify.focus) {
      var nKey = app.notify.focus;
      app.notify.focus = '';
      var nEl = root.querySelector('[data-fk="' + String(nKey).replace(/["\\]/g, '\\$&') + '"]');
      if (nEl && nEl.offsetParent !== null) nEl.focus({ preventScroll: true });
    }
    /* v1.1: the diagnostics card keeps focus on the button that changed. */
    if (app.diag.focus) {
      var dKey = app.diag.focus;
      app.diag.focus = '';
      var dEl = root.querySelector('[data-fk="' + String(dKey).replace(/["\\]/g, '\\$&') + '"]');
      if (dEl && dEl.offsetParent !== null) dEl.focus({ preventScroll: true });
    }
    /* v1.1: ?focus=approvals deep link from the capsule - bring the gate into
     * view (the approval itself still has to be decided here, never in the HUD). */
    if (app.scrollApprovals) {
      app.scrollApprovals = false;
      var gate = root.querySelector('.approvals');
      if (gate) {
        try { gate.scrollIntoView({ block: 'center' }); } catch (err) { /* ignore */ }
      }
    }
    /* v0.4: the composer lives outside #app (so frames never eat typed text);
     * keep it glued to its trigger and close it if that trigger went away. */
    syncComposerAnchor();
    syncGrabBounds();
  }

  function shellHTML() {
    var empty = !session();
    /* v0.7: the desktop settings page replaces the deck columns; mobile keeps
     * its own sheet layout (the tab bar selects .m-settings). */
    var desktopSettings = app.tab === 'settings' && !isSheetMode();
    var stageContent;
    if (desktopSettings) stageContent = desktopSettingsHTML();
    else if (empty) stageContent = emptyStageHTML() + emptyCardsHTML();
    else stageContent = railHTML() + boardHTML() + sideHTML() + mobileExtrasHTML();
    return '<div class="shell' + (EMBED ? ' is-embed' : '') + '">' +
      '<img class="shell-wm" src="./whale.svg" alt="" aria-hidden="true">' +
      headerHTML() +
      remoteBannerHTML() +
      offlineBannerHTML() +
      '<div class="stage' + (empty ? ' is-empty' : '') + '" data-tab="' + esc(app.tab) + '" data-empty="' + (empty ? '1' : '0') + '"' + stageVars() + '>' +
        stageContent +
        mobileSettingsHTML() +
      '</div>' +
      statusbarHTML() +
      tabbarHTML() +
    '</div>';
  }

  /* ---------- header ---------- */
  function headerHTML() {
    var list = sessionsList();
    return '<header class="titlebar">' +
      '<div class="brand">' +
        '<img class="logo" src="./whale.svg" alt="Cockpit">' +
        '<span class="word">Cockpit</span>' +
        '<span class="tag">for DeepSeek Harness</span>' +
      '</div>' +
      '<nav class="session-pills" aria-label="会话">' +
        (list.length ? list.map(sessionPillHTML).join('') : '<span class="pills-empty">暂无会话</span>') +
      '</nav>' +
      '<div class="topright">' +
        '<button class="set-gear copy-link" type="button" data-action="copy-view-link" title="复制当前视图链接" aria-label="复制当前视图链接">' +
          ICON_LINK + '<span class="set-gear-t">复制链接</span>' +
        '</button>' +
        '<button class="set-gear' + (app.tab === 'settings' ? ' is-on' : '') + '" type="button" data-action="settings-toggle"' +
          ' aria-pressed="' + (app.tab === 'settings' ? 'true' : 'false') + '" title="设置" aria-label="设置">' +
          ICON_GEAR + '<span class="set-gear-t">设置</span>' +
        '</button>' +
        '<span class="live ' + (app.connected ? 'on' : 'off') + '" title="EventSource 实时流状态"><i></i>' + (app.connected ? '实时' : '重连中') + '</span>' +
        '<span class="clock" title="当前时间"><span data-clock-hm>' + esc(fmtClock(Date.now()).slice(0, 5)) + '</span><span class="clock-s" data-clock-s>' + esc(fmtClock(Date.now()).slice(5)) + '</span></span>' +
        '<span class="me" title="你（本机操作者）">你</span>' +
      '</div>' +
    '</header>';
  }

  function sessionPillHTML(s) {
    if (!s) return '';
    var active = session();
    var isActive = !!(active && active.id === s.id);
    var on = displaySessionId() === s.id;
    var pct = num(s.percent);
    var tail;
    if (isActive) {
      var total = num(active.total), done = num(active.completed);
      tail = total != null ? (done == null ? 0 : done) + '/' + total : (pct != null ? Math.round(pct) + '%' : '待命');
    } else if (s.running) {
      tail = pct != null ? Math.round(pct) + '%' : '运行中';
    } else {
      tail = pct != null ? Math.round(pct) + '%' : '待命';
    }
    return '<button class="pill ' + (on ? 'active' : '') + '" data-action="session" data-id="' + esc(s.id) + '"' +
      ' data-fk="pill:' + esc(s.id) + '"' + (on ? ' aria-current="true"' : '') +
      ' title="' + esc(s.title || '新的会话') + ' · ' + esc(tail) + '">' +
      '<span class="pill-dot ' + (on ? 'running' : '') + '"></span>' +
      '<span class="pill-t">' + esc(s.title || '新的会话') + '</span>' +
      '<span class="pill-n">' + esc(tail) + '</span>' +
    '</button>';
  }

  function emptyStageHTML() {
    return '<div class="empty-stage">' +
      '<img class="empty-whale" src="./whale.svg" alt="">' +
      '<h2>等待第一个任务</h2>' +
      '<p>当前没有运行中的会话。</p>' +
      '<span class="empty-pill"><i class="' + (app.connected ? 'on' : '') + '"></i>' + (app.connected ? '实时流已连接' : '正在连接实时流…') + '</span>' +
    '</div>';
  }

  /* Extension cards are session-independent (git status, tests, cost …), so they
     stay visible while the rest of the deck is in its no-session empty state. */
  function emptyCardsHTML() {
    if (!cards().length) return '';
    return '<div class="empty-cards">' + cardsHTML('empty-cards-inner') + '</div>';
  }

  /* ---------- roster grouping (v0.7.1) ---------- */
  function loadRoster() {
    try {
      var raw = JSON.parse(window.localStorage.getItem(ROSTER_KEY) || '{}');
      if (!raw || typeof raw !== 'object') return;
      app.roster.idle = raw.idle === true;
      app.roster.failed = raw.failed === true;
    } catch (err) { /* storage may be unavailable */ }
  }
  function saveRoster() {
    try {
      window.localStorage.setItem(ROSTER_KEY, JSON.stringify({
        idle: !!app.roster.idle,
        failed: !!app.roster.failed
      }));
    } catch (err) { /* storage may be unavailable */ }
  }
  function rosterGroupOf(m) {
    if (!m) return 'idle';
    if (m.running === true) return 'running';
    if (m.phase === 'failed' || m.status === 'failed') return 'failed';
    return 'idle';
  }
  function rosterExpanded(grp) {
    if (grp === 'running') return true;
    return !!app.roster[grp];
  }
  /* Lead pinned separately, teammates bucketed by the host contract. Order inside
   * each bucket follows the persisted teammate order. */
  function rosterBuckets() {
    var lead = null;
    var groups = { running: [], idle: [], failed: [] };
    orderedMembers().forEach(function (m) {
      if (!m) return;
      if (!lead && m.role === 'lead') { lead = m; return; }
      groups[rosterGroupOf(m)].push(m);
    });
    return { lead: lead, groups: groups };
  }
  function rosterGroupIDs(grp) {
    return orderedMembers().filter(function (m) {
      return m && m.role !== 'lead' && rosterGroupOf(m) === grp;
    }).map(function (m) { return m.id; });
  }
  /* Swap one group's sequence inside the flat persisted order without disturbing
   * the other buckets (rendering filters that flat list per group). */
  function reorderRosterSeq(grp, seq) {
    var full = mateOrderIds();
    var inGrp = {};
    seq.forEach(function (id) { inGrp[id] = true; });
    var out = [];
    var placed = false;
    full.forEach(function (id) {
      if (!inGrp[id]) { out.push(id); return; }
      if (placed) return;
      placed = true;
      out.push.apply(out, seq);
    });
    if (!placed) out.push.apply(out, seq);
    return out;
  }
  function toggleRoster(grp) {
    if (grp !== 'idle' && grp !== 'failed') return;
    app.roster[grp] = !app.roster[grp];
    saveRoster();
    scheduleRender();
  }

  /* ---------- left rail ---------- */
  function rosterHTML() {
    var ms = orderedMembers();
    if (!ms.length) return '<div class="rail-empty">编队尚未集结</div>';
    var buckets = rosterBuckets();
    var lead = buckets.lead;
    var groups = buckets.groups;
    var leadRunning = !!(lead && rosterGroupOf(lead) === 'running');
    var html = lead ? memberHTML(lead) : '';
    if (!leadRunning && !groups.running.length) {
      html += '<div class="roster-none">暂无运行中的成员</div>';
    }
    ROSTER_GROUPS.forEach(function (grp) {
      var list = groups[grp];
      if (!list.length) return;
      var count = list.length;
      if (grp === 'running') {
        /* Running mates never fold, so this head is a static section label. It
         * still carries a button shell + aria-expanded/controls so assistive
         * tech sees the same group contract as the foldable heads. */
        html += '<section class="roster-grp" data-grp="running">' +
          '<button class="roster-head is-static" type="button" data-action="roster-static" data-grp="running"' +
            ' data-fk="roster:running"' +
            ' aria-expanded="true" aria-controls="roster-running" aria-disabled="true">' +
            '<span class="roster-dot running" aria-hidden="true"></span>' +
            '<span class="roster-t">运行中</span>' +
            '<span class="roster-n">' + count + ' 位</span>' +
          '</button>' +
          '<div class="roster-list" id="roster-running">' + list.map(memberHTML).join('') + '</div>' +
        '</section>';
        return;
      }
      var expanded = rosterExpanded(grp);
      html += '<section class="roster-grp" data-grp="' + grp + '">' +
        '<button class="roster-head" type="button" data-action="roster-toggle" data-grp="' + grp + '"' +
          ' data-fk="roster:' + grp + '"' +
          ' aria-expanded="' + (expanded ? 'true' : 'false') + '"' +
          ' aria-controls="roster-' + grp + '"' +
          ' title="' + (expanded ? '收起' : '展开') + ROSTER_LABEL[grp] + '成员">' +
          '<span class="roster-dot ' + grp + '" aria-hidden="true"></span>' +
          '<span class="roster-t">' + ROSTER_LABEL[grp] + '</span>' +
          '<span class="roster-n">' + count + ' 位</span>' +
          '<span class="roster-chev" aria-hidden="true">' + ICON_CHEV + '</span>' +
        '</button>' +
        '<div class="roster-list" id="roster-' + grp + '"' + (expanded ? '' : ' hidden') + '>' +
          (expanded ? list.map(memberHTML).join('') : '') +
        '</div>' +
      '</section>';
    });
    return html;
  }

  function railHTML() {
    var ms = orderedMembers();
    var ss = sessionsList();
    return '<aside class="rail">' +
      '<div class="section-head">' +
        '<b>本次编队</b>' +
        '<span class="count">' + countLabel(ms.length, 'agent', 'agents') + '</span>' +
        '<button class="head-more" data-action="tab" data-tab="tasks">查看全部 ›</button>' +
      '</div>' +
      '<div class="members" data-scroll="members">' +
        rosterHTML() +
      '</div>' +
      (ss.length
        ? '<div class="section-head sess-head"><b>会话</b><span class="count">' + ss.length + '</span></div>' +
          '<div class="sessions">' + ss.map(sessionRowHTML).join('') + '</div>'
        : '') +
      '<div class="rail-foot">' +
        '<img class="rf-ico" src="./whale.svg" alt="">' +
        '<span class="txt">只读 · 数据来自 DSH 会话投影</span>' +
      '</div>' +
    '</aside>';
  }

  function memberHTML(m) {
    var meta = memberMeta(m);
    var status = statusCls(m);
    var running = status === 'running';
    var editing = app.editing && app.editing.id === m.id;
    var maxTokens = 1;
    orderedMembers().forEach(function (x) { var t = num(x.tokens); if (t != null && t > maxTokens) maxTokens = t; });
    var tokens = num(m.tokens);
    var hasProgress = tokens != null && tokens > 0;
    var share = !hasProgress ? 0 : clamp(Math.round((tokens / maxTokens) * 100), 2, 100);
    var sessionId = m.sessionId != null && m.sessionId !== '' ? String(m.sessionId) : m.id;
    /* v0.4.1: host says a member without a writable agent is not live yet. */
    var live = m.live !== false && sessionLive(sessionId);
    var irKey = 'member:' + m.id;
    var armed = app.ir.key === irKey;
    var focusText = m.focus != null ? String(m.focus).trim() : '';
    var nameInner = editing
      ? '<input class="alias-input" data-id="' + esc(m.id) + '" maxlength="12" value="' + esc(app.editing.value) +
        '" aria-label="成员别名" spellcheck="false" autocomplete="off">'
      : '<button class="a-name" data-action="alias" data-id="' + esc(m.id) + '" title="双击或按 Enter 重命名" ' +
        'aria-label="重命名 ' + esc(meta.display) + '">' + esc(meta.display) + '</button>';
    return '<div class="agent' + (meta.lead ? ' lead' : '') + (armed ? ' is-armed' : '') +
      (app.reorderId === m.id ? ' is-dragging' : '') + '" data-id="' + esc(m.id) +
      '" data-grp="' + rosterGroupOf(m) + '">' +
      '<div class="avatar av-' + meta.color + '" title="' + esc(meta.real) + '">' + esc(meta.letter) +
        '<span class="sd ' + status + '" title="' + esc(STATUS_LABEL[status] || status) + '"></span>' +
      '</div>' +
      '<div class="a-main">' +
        '<div class="a-line">' +
          (meta.lead ? '' :
            '<button class="a-grip" type="button" data-action="reorder" data-id="' + esc(m.id) + '"' +
            ' data-fk="grip:' + esc(m.id) + '"' +
            ' title="拖动调整顺序（聚焦后按 ↑/↓，或 Alt+↑/↓）"' +
            ' aria-label="调整 ' + esc(meta.display) + ' 的显示顺序">' + ICON_GRIP + '</button>') +
          '<span class="a-real" title="真实名称：' + esc(meta.real) + '">' + esc(meta.real) + '</span>' +
          '<span class="a-dot">·</span>' +
          nameInner +
          '<span class="a-model">' + esc(m.model || '—') + '</span>' +
          '<button class="a-edit" data-action="alias-edit" data-id="' + esc(m.id) + '" title="重命名" aria-label="重命名 ' + esc(meta.display) + '">✎</button>' +
        '</div>' +
        '<div class="a-focus" title="负责：' + esc(focusText || '—') + '">' +
          '<span class="a-focus-t">负责：' + esc(focusText || '—') + '</span>' +
        '</div>' +
        '<div class="a-act" title="当前活动：' + esc(m.current || '—') + '">' +
          '<span class="a-act-t">' + esc(m.current || '—') + '</span>' +
          '<span class="a-cstate ' + status + '" title="' + esc(STATUS_LABEL[status] || status) + '"' +
            ' role="img" aria-label="' + esc(STATUS_LABEL[status] || status) + '"></span>' +
        '</div>' +
        '<div class="a-met">' +
          '<span class="a-tokens">' + (hasProgress ? fmtTokens(tokens) : '—') + '</span>' +
          (hasProgress
            ? '<span class="a-meter"><i style="width:' + share + '%"></i></span>' +
              '<span class="a-share">' + share + '%</span>'
            : '') +
          actionGroupHTML('member', m.id, sessionId, meta.display, running, irKey, '给 ' + meta.display + ' 发消息', live) +
        '</div>' +
      '</div>' +
      (armed ? interruptConfirmHTML(irKey, sessionId) : '') +
    '</div>';
  }

  /** Hover-revealed ghost actions (always visible on touch): message + interrupt. */
  function actionGroupHTML(scope, refId, sessionId, label, running, irKey, sendLabel, liveOverride) {
    var live = typeof liveOverride === 'boolean' ? liveOverride : sessionLive(sessionId);
    /* v0.5b: an inactive target still exposes a real (visually enabled) button —
     * clicking/Entering it explains why nothing opens instead of looking dead. */
    var inactiveText = scope === 'member'
      ? '该成员当前未运行，等它启动后再发消息'
      : '该会话当前未运行，等它启动后再发消息';
    var composeAttrs =
      ' data-scope="' + esc(scope) + '"' +
      ' data-id="' + esc(refId) + '" data-session="' + esc(sessionId) + '" data-name="' + esc(label) + '"' +
      ' data-clabel="' + esc(label) + '" data-compose="' + esc(scope + ':' + refId) + '"' +
      ' data-fk="compose:' + esc(scope + ':' + refId) + '"';
    var compose = live
      ? '<button class="act-ico" type="button" data-action="compose"' + composeAttrs +
          ' title="' + esc(sendLabel) + '" aria-label="' + esc(sendLabel) + '">' + ICON_MSG + '</button>'
      : '<button class="act-ico" type="button" data-action="compose" data-gated="1"' + composeAttrs +
          ' title="' + esc(inactiveText) + '" aria-label="' + esc(inactiveText) + '">' + ICON_MSG + '</button>';
    return '<span class="a-acts">' + compose +
      (running && live
        ? '<button class="act-ico danger" type="button" data-action="interrupt" data-ir="' + esc(irKey) + '"' +
          ' data-id="' + esc(sessionId) + '" data-fk="interrupt:' + esc(irKey) + '"' +
          ' title="中断当前轮" aria-label="中断 ' + esc(label) + ' 的当前轮">' + ICON_STOP + '</button>'
        : '') +
    '</span>';
  }

  function interruptConfirmHTML(key, sessionId) {
    var busy = !!app.ir.busy;
    var err = app.ir.error || '';
    return '<div class="ir-confirm" role="group" aria-label="确认中断当前轮">' +
      '<p class="ir-q"><b>中断当前轮？</b><span>正在执行的工具调用会被停止</span></p>' +
      '<div class="ir-btns">' +
        '<button class="ir-btn ghost" type="button" data-action="interrupt-cancel" data-fk="ir-cancel:' + esc(key) + '" aria-label="取消中断"' + (busy ? ' disabled' : '') + '>取消</button>' +
        '<button class="ir-btn danger" type="button" data-action="interrupt-confirm" data-id="' + esc(sessionId) + '"' +
          ' data-ir="' + esc(key) + '" data-fk="ir-confirm:' + esc(key) + '" aria-label="确认中断当前轮"' + (busy ? ' disabled' : '') + '>' +
          (busy ? '<span class="spin" aria-hidden="true"></span>中断中…' : '确认中断') +
        '</button>' +
      '</div>' +
      (err ? '<span class="ir-err" role="alert">' + esc(err) + '</span>' : '') +
    '</div>';
  }

  function sessionRowHTML(s) {
    if (!s) return '';
    var active = session();
    var isActive = !!(active && active.id === s.id);
    var on = displaySessionId() === s.id;
    var pct = num(s.percent);
    var tail = isActive ? (num(active.total) != null ? (num(active.completed) == null ? 0 : num(active.completed)) + '/' + num(active.total) : (pct != null ? Math.round(pct) + '%' : '待命'))
      : (pct != null ? Math.round(pct) + '%' : '待命');
    var title = s.title ? shortTitle(s.title, 14) : '未命名会话';
    var fullTitle = s.title || '未命名会话';
    var irKey = 'session:' + s.id;
    var armed = app.ir.key === irKey;
    return '<div class="sess-row' + (on ? ' on' : '') + (armed ? ' is-armed' : '') + '">' +
      '<button class="sess ' + (on ? 'on' : '') + '" data-action="session" data-id="' + esc(s.id) + '"' +
        ' data-fk="session-row:' + esc(s.id) + '"' + (on ? ' aria-current="true"' : '') +
        ' title="' + esc(fullTitle) + '">' +
        '<span class="sq"></span>' +
        '<span class="sess-t">' + esc(title) + '</span>' +
        '<span class="sess-n">' + esc(tail) + '</span>' +
      '</button>' +
      actionGroupHTML('session', s.id, s.id, fullTitle, !!s.running, irKey, '给「' + shortTitle(fullTitle, 12) + '」发消息') +
      (armed ? interruptConfirmHTML(irKey, s.id) : '') +
    '</div>';
  }

  /* ---------- middle board ---------- */
  /** No shared task board yet: the turn's own todo plan is the useful thing to show. */
  function plannedTasks() {
    var s = session();
    var steps = s && s.plan && Array.isArray(s.plan.steps) ? s.plan.steps : [];
    return steps.map(function (step, i) {
      var status = step && step.status;
      return {
        id: 'plan:' + (i + 1),
        revision: null,
        subject: step && step.text ? step.text : '步骤 ' + (i + 1),
        status: status === 'completed' ? 'completed' : status === 'in_progress' ? 'in_progress' : 'pending',
        owner: null,
        ownerName: null,
        blockedBy: [],
        writeScopes: [],
        ready: true,
        warnings: [],
        planned: true,
      };
    });
  }

  function boardHTML() {
    var ts = tasks();
    var fromPlan = false;
    if (!ts.length) {
      ts = plannedTasks();
      fromPlan = ts.length > 0;
    }
    var count = { pending: 0, in_progress: 0, completed: 0 };
    ts.forEach(function (t) { if (t && count[t.status] != null) count[t.status] += 1; });
    var blocked = ts.filter(isBlocked).length;
    var s = session();
    var done = s ? num(s.completed) : null;
    var total = s ? num(s.total) : null;
    if (done == null && s && s.plan && Array.isArray(s.plan.steps)) {
      done = s.plan.steps.filter(function (x) { return x && x.status === 'completed'; }).length;
    }
    if (total == null && s && s.plan && Array.isArray(s.plan.steps) && s.plan.steps.length) total = s.plan.steps.length;
    var subParts = s
      ? [(s.turn == null ? null : '#' + s.turn), esc(s.title || '未命名会话'), (done == null || total == null ? null : done + '/' + total + ' 步')].filter(Boolean)
      : [];
    var sub = s ? subParts.join(' · ') : '暂无运行中的会话';
    return '<main class="board">' +
      '<div class="grab grab-rail" data-grab="rail" title="拖动调整编队栏宽度，双击复位"></div>' +
      '<div class="grab grab-side" data-grab="side" title="拖动调整右栏宽度，双击复位"></div>' +
      '<div class="board-head">' +
        '<h1>任务板</h1>' +
        '<span class="sub">' + sub + '</span>' +
        '<div class="chips">' +
          (fromPlan
            ? '<span class="chip plan">本轮计划 ' + ts.length + '</span>' +
              '<span class="chip">已完成 ' + count.completed + '</span>' +
              '<span class="chip">进行中 ' + count.in_progress + '</span>'
            : '<span class="chip on">全部 ' + ts.length + '</span>' +
              '<span class="chip">进行中 ' + count.in_progress + '</span>' +
              '<span class="chip">阻塞 ' + blocked + '</span>') +
        '</div>' +
      '</div>' +
      '<div class="cols">' +
        (ts.length ? '' : '<img class="board-wm" src="./whale.svg" alt="" aria-hidden="true">') +
        TASK_COLS.map(function (col) { return columnHTML(col, ts); }).join('') +
      '</div>' +
      lanesHTML() +
    '</main>';
  }

  function columnHTML(col, ts) {
    var list = ts.filter(function (t) { return t && t.status === col.key; });
    var body = list.map(taskCardHTML).join('');
    var placeholder = '';
    if (!list.length) {
      placeholder = '<div class="col-empty">' +
        (col.key === 'pending' ? '暂无待处理任务' : col.key === 'in_progress' ? '暂无进行中任务' : '暂无已完成任务') +
      '</div>';
    }
    return '<section class="col col-' + col.key + '">' +
      '<div class="col-head">' +
        '<span class="ico ' + col.ico + '">' + colIcon(col.ico) + '</span>' +
        '<b>' + col.label + '</b>' +
        '<span class="n">' + list.length + '</span>' +
        '<span class="bar"></span>' +
      '</div>' +
      body + placeholder +
    '</section>';
  }

  function colIcon(kind) {
    if (kind === 'todo') return '<svg viewBox="0 0 16 16" width="9" height="9" aria-hidden="true"><circle cx="8" cy="8" r="4.6" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';
    if (kind === 'doing') return '<svg viewBox="0 0 16 16" width="9" height="9" aria-hidden="true"><circle cx="8" cy="8" r="3" fill="currentColor"/></svg>';
    return '<svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true"><path d="M3.2 8.4l3.1 3.1 6.5-6.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  function ownerChip(owner, ownerName) {
    var m = findMember(owner);
    var meta = m ? memberMeta(m) : { display: ownerName || owner || '未分配', real: ownerName || owner || '', color: 'blue', letter: firstChar(ownerName || owner || '?') };
    return '<span class="own" title="负责人：' + esc(meta.real) + '">' +
      '<i class="av-' + meta.color + '">' + esc(meta.letter) + '</i>' +
      '<span class="own-n">' + esc(meta.display) + '</span>' +
    '</span>';
  }

  function shortTaskId(id) {
    var m = /(\d+)$/.exec(String(id || ''));
    return m ? '#' + m[1] : '#' + String(id || '下');
  }

  function isHotScope(path, task) {
    var conflict = files().some(function (f) {
      return f && f.path === path && (f.conflict || arr(f.agents).length > 1);
    });
    if (conflict) return true;
    return arr(task && task.warnings).some(function (w) { return String(w || '').indexOf(path) >= 0; });
  }

  function taskCardHTML(t) {
    var planned = !!(t && t.planned);
    if (!t) return '';
    var status = t.status || 'pending';
    var scopes = arr(t.writeScopes).map(function (path) {
      var hot = isHotScope(path, t);
      return '<span class="scope' + (hot ? ' hot' : '') + '" title="' + esc(path) + '">' + esc(path) + '</span>';
    }).join('');
    var blocked = arr(t.blockedBy).map(function (id) {
      return '<span class="flag" title="等待依赖任务 ' + esc(id) + '">⧗ 等待 ' + esc(shortTaskId(id)) + '</span>';
    }).join('');
    if (!blocked && t.ready === false) blocked = '<span class="flag">⧗ 尚未就绪</span>';
    if (status === 'completed') blocked = '';
    var warnings = status === 'completed' ? [] : arr(t.warnings);
    var warnLine = warnings.length
      ? '<div class="task-warn" title="' + esc(warnings.join(' / ')) + '">⚠ ' + esc(warnings[0]) + (warnings.length > 1 ? ' +' + (warnings.length - 1) : '') + '</div>'
      : '';
    var prefix = status === 'completed' ? '<span class="tick">✓</span>' : '';
    var revision = t.revision == null ? '—' : t.revision;
    var stateLine = status === 'in_progress' ? '<span class="task-state">进行中</span>' : '';
    var stepNo = planned ? t.id.split(':')[1] : null;
    var foot = planned
      ? '<div class="task-foot"><span class="rev">步骤 ' + esc(stepNo || '?') + '</span><span class="sp"></span>' + stateLine + '</div>'
      : '<div class="task-foot"><span class="rev">rev ' + esc(revision) + '</span><span class="sp"></span>' + stateLine + '</div>';
    var metaLine = planned
      ? (status === 'completed' ? '<div class="meta"><span class="plan-done">已完成</span></div>' : '')
      : '<div class="meta">' + ownerChip(t.owner, t.ownerName) + scopes + blocked + '</div>';
    return '<article class="task' + (planned ? ' is-plan' : '') + (status === 'in_progress' ? ' active' : '') + (status === 'completed' ? ' done' : '') + '">' +
      '<div class="tt">' + prefix + esc(t.subject || t.id || '未命名任务') + '</div>' +
      metaLine +
      warnLine +
      foot +
    '</article>';
  }

  /* ---------- swim lanes ---------- */
  function lanesHTML() {
    return '<section class="lanes">' +
      '<div class="lanes-head">' +
        '<span>编队进展</span>' +
        '<span class="n">实时</span>' +
        '<span class="bar"></span>' +
        '<span class="hint">写同一文件的代理会被标黄</span>' +
      '</div>' +
      lanesBodyHTML() +
    '</section>';
  }

  function lanesBodyHTML() {
    var ms = orderedMembers();
    var acts = activity().filter(function (a) { return a && num(a.at) != null; });
    if (!acts.length) return '<div class="lanes-empty">暂无活动数据</div>';
    if (!ms.length) return '<div class="lanes-empty">编队尚未集结</div>';
    var ats = acts.map(function (a) { return num(a.at); }).filter(function (n) { return n != null; });
    var start = Math.min.apply(null, ats);
    var end = Math.max.apply(null, [referenceNow()].concat(ats).concat(ms.map(function (m) { return num(m.lastAt) || 0; })));
    if (end - start < 60000) end = start + 60000;
    var pad = (end - start) * 0.035;
    start -= pad;
    end += pad;
    var span = end - start;
    var rows = ms.map(function (m) {
      var meta = memberMeta(m);
      var hot = isHotMember(m);
      var who = '<div class="lane-who"><span class="mini av-' + meta.color + '">' + esc(meta.letter) + '</span>' +
        '<span class="nm" title="' + esc(meta.real) + '">' + esc(meta.display) + '</span></div>';
      var events = acts.filter(function (a) { return sameAgent(a, m); }).sort(function (a, b) { return num(a.at) - num(b.at); });
      if (!events.length) {
        return '<div class="lane' + (hot ? ' warn' : '') + '">' + who +
          '<div class="lane-rail"><span class="lane-now wait after" style="left:0%">暂无活动</span></div></div>';
      }
      var first = num(events[0].at);
      var lastEvent = num(events[events.length - 1].at);
      var last = Math.max(lastEvent, num(m.lastAt) || 0);
      var leftPct = ((first - start) / span) * 100;
      var widthPct = Math.max(((last - first) / span) * 100, 2.2);
      leftPct = clamp(leftPct, 0, Math.max(0, 100 - Math.min(widthPct, 100)));
      var rightPct = clamp(leftPct + widthPct, 0, 100);
      var fullLabel = m.current || (statusCls(m) === 'running' ? '运行中' : '空闲');
      var label = shortTitle(fullLabel, 14);
      /* keep the chip inside the lane: after the bar when there is room, otherwise right-aligned inside its end */
      var availRight = 100 - rightPct;
      var labelCls = 'lane-now' + (availRight >= 38 ? ' after' : ' end') + (hot ? ' hot' : '');
      return '<div class="lane' + (hot ? ' warn' : '') + '">' + who +
        '<div class="lane-rail">' +
          '<i class="av-' + meta.color + (hot ? ' warn-bar' : '') + '" style="left:' + leftPct.toFixed(2) + '%;width:' + widthPct.toFixed(2) + '%"></i>' +
          '<span class="' + labelCls + '" style="left:' + rightPct.toFixed(2) + '%" title="' + esc(fullLabel) + '">' + esc(label) + '</span>' +
        '</div>' +
      '</div>';
    }).join('');
    var axis = '<div class="lane-axis">' +
      [0, 1 / 3, 2 / 3, 1].map(function (f, i) {
        return '<span>' + (i === 3 ? '现在' : esc(ago(start + span * f))) + '</span>';
      }).join('') +
    '</div>';
    return '<div class="lanes-body">' + rows + '</div>' + axis;
  }

  /* ---------- right column ---------- */
  function sideHTML() {
    return '<aside class="side">' + approvalsHTML('side-approvals') + roundCardHTML() + streamCardHTML('') +
      cardsHTML('side-cards') + riskCardHTML('') + '</aside>';
  }

  function roundCardHTML() {
    var s = session();
    var pct = sessionPercent();
    var total = s ? num(s.total) : null;
    var done = s ? num(s.completed) : null;
    var stats = (s && s.stats) || {};
    var plan = s && s.plan && Array.isArray(s.plan.steps) ? s.plan.steps : [];
    if (done == null && plan.length) done = plan.filter(function (x) { return x && x.status === 'completed'; }).length;
    if (total == null && plan.length) total = plan.length;
    var planHTML = plan.length
      ? '<div class="round-plan">' +
          plan.map(function (step) {
            var st = step && step.status ? step.status : 'pending';
            return '<span class="pd ' + esc(st) + '" title="' + esc(step && step.text || '') + '"></span>';
          }).join('') +
          '<span class="pd-label">' + (done == null ? '—' : done) + '/' + (total == null ? '—' : total) + ' 步</span>' +
        '</div>'
      : '';
    return '<section class="card round-card">' +
      '<div class="card-head"><h3>本轮</h3><span class="r">turn ' + esc(s && s.turn != null ? s.turn : '—') + '</span></div>' +
      '<div class="round-title" title="' + esc(s && s.title || '') + '">' + esc(s && s.title || '未命名会话') + '</div>' +
      '<div class="round-top">' +
        '<div class="round-pct">' + (pct == null ? '—' : pct + '<small>%</small>') + '</div>' +
        (total != null && total > 0
          ? '<div class="round-badges"><span class="round-pill">完成 ' + (done == null ? '—' : done) + '/' + total + '</span></div>'
          : '') +
      '</div>' +
      (pct == null ? '' : '<div class="round-bar"><i style="width:' + pct + '%"></i></div>') +
      '<div class="round-grid">' +
        '<div class="rg"><span>tokens</span><b>' + fmtTokens(stats.tokens) + '</b></div>' +
        '<div class="rg"><span>turns</span><b>' + fmtInt(stats.turns) + '</b></div>' +
        '<div class="rg"><span>steps</span><b>' + fmtInt(stats.steps) + '</b></div>' +
        '<div class="rg"><span>耗时</span><b data-elapsed>' + fmtDur(currentElapsed()) + '</b></div>' +
        '<div class="rg"><span>模型</span><b title="' + esc(s && s.model || '') + '">' + esc(s && s.model || '—') + '</b></div>' +
        '<div class="rg"><span>状态</span><b>' + (s && s.running ? '运行中' : '待命') + '</b></div>' +
      '</div>' +
      planHTML +
    '</section>';
  }

  function streamCardHTML(extra) {
    var acts = activity();
    var head = '<div class="card-head"><h3>实时流</h3>' +
      (acts.length ? '<span class="r" data-rel-at="' + (num(acts[0].at) == null ? '' : num(acts[0].at)) + '">' + esc(ago(acts[0].at)) + '</span>' : '<span class="r">—</span>') +
      '</div>';
    var body = acts.length
      ? '<div class="items" data-scroll="stream">' + acts.map(streamItemHTML).join('') + '</div>'
      : '<div class="stream-empty">暂无活动</div>';
    return '<section class="card stream-card ' + extra + (acts.length ? '' : ' is-empty') + '">' + head + body + '</section>';
  }

  function streamItemHTML(a, index) {
    var kind = KINDS[a && a.kind] || { icon: '•', cls: '' };
    var who = activityWho(a);
    var detail = a && a.detail
      ? ' <span class="dim" data-action="expand" title="' + esc(a.detail) + '">· ' + richText(a.detail) + '</span>'
      : '';
    return '<div class="it' + (index === 0 ? ' now' : '') + '">' +
      '<span class="it-time" data-rel-at="' + (num(a && a.at) == null ? '' : num(a.at)) + '">' + esc(ago(a && a.at)) + '</span>' +
      '<span class="it-icon ' + kind.cls + '" aria-hidden="true">' + kind.icon + '</span>' +
      '<div class="it-txt"><span class="ag av-' + who.color + '">' + esc(who.display) + '</span>' +
        richText(a && a.text) + detail +
      '</div>' +
    '</div>';
  }

  function activityWho(a) {
    var m = null;
    if (a && a.agentId != null) m = findMember(a.agentId);
    if (!m && a && a.agent) m = findMember(a.agent);
    if (m) return memberMeta(m);
    var raw = a && (a.agent || a.agentId) ? String(a.agent || a.agentId) : '系统';
    return { display: raw, real: raw, color: 'blue', letter: firstChar(raw) };
  }

  function riskCardHTML(extra) {
    var risks = files().filter(function (f) { return f && f.conflict; });
    if (!risks.length) return '';
    return '<section class="card risk-card ' + extra + '">' +
      '<div class="card-head"><h3>文件风险</h3><span class="r">' + risks.length + ' 处冲突</span></div>' +
      '<div class="risk-list">' +
        risks.map(function (f) {
          var agents = arr(f.agents).map(function (idOrName) {
            var m = findMember(idOrName);
            var meta = m ? memberMeta(m) : { display: String(idOrName || '—'), color: 'blue', letter: firstChar(idOrName) };
            return ownerChip(m ? m.id : idOrName, m ? null : idOrName);
          }).join('');
          return '<div class="risk">' +
            '<code class="risk-path" title="' + esc(f.path) + '">' + esc(f.path) + '</code>' +
            '<div class="risk-meta">' + agents + '<span class="risk-tag">双写风险</span></div>' +
          '</div>';
        }).join('') +
      '</div>' +
    '</section>';
  }

  /* ---------- v0.6: extension cards ---------- */
  function findCard(id) {
    if (id == null) return null;
    var list = cards();
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].id) === String(id)) return list[i];
    }
    return null;
  }

  function findCardAction(card, actionId) {
    var acts = arr(card && card.actions);
    for (var i = 0; i < acts.length; i++) {
      if (acts[i] && acts[i].id != null && String(acts[i].id) === String(actionId)) return acts[i];
    }
    return null;
  }

  function cardStateCls(state) {
    return state === 'ok' || state === 'warn' || state === 'bad' || state === 'idle' ? state : '';
  }

  function cardIconHTML(card) {
    var icon = card && typeof card.icon === 'string' && ICON_CARDS[card.icon] ? card.icon : '';
    var tone = icon ? CARD_ICON_TONE[icon] : '';
    return '<span class="xc-ico' + (tone ? ' ' + tone : '') + '" aria-hidden="true">' +
      (icon ? ICON_CARDS[icon] : CARD_ICON_FALLBACK) + '</span>';
  }

  function cardSkeletonHTML() {
    return '<div class="xc-skel" role="status"><span></span><span></span><em>加载中…</em></div>';
  }

  function cardRowHTML(item) {
    item = item && typeof item === 'object' ? item : {};
    var title = String(item.title == null ? '' : item.title) || '—';
    var detail = String(item.detail == null ? '' : item.detail);
    var state = cardStateCls(item.state);
    return '<div class="xc-row">' +
      (state ? '<span class="xc-dot ' + state + '" aria-hidden="true"></span>' : '') +
      '<b class="xc-row-t" title="' + esc(title) + '">' + esc(title) + '</b>' +
      (detail ? '<span class="xc-row-d" title="' + esc(detail) + '">' + esc(detail) + '</span>' : '') +
    '</div>';
  }

  function cardMetricHTML(row) {
    row = row && typeof row === 'object' ? row : {};
    var label = String(row.label == null ? '' : row.label) || '—';
    var value = String(row.value == null ? '' : row.value) || '—';
    var tone = cardStateCls(row.tone);
    return '<div class="xc-row">' +
      '<span class="xc-row-t" title="' + esc(label) + '">' + esc(label) + '</span>' +
      '<b class="xc-row-v' + (tone ? ' ' + tone : '') + '" title="' + esc(value) + '">' + esc(value) + '</b>' +
    '</div>';
  }

  function cardStatusHTML(payload) {
    var state = cardStateCls(payload.state);
    var label = String(payload.label == null ? '' : payload.label);
    var detail = String(payload.detail == null ? '' : payload.detail);
    return '<div class="xc-status' + (state ? ' ' + state : '') + '">' +
      '<span class="xc-dot ' + (state || 'idle') + '" aria-hidden="true"></span>' +
      '<b class="xc-status-t" title="' + esc(label) + '">' + esc(label || '—') + '</b>' +
    '</div>' +
    (detail ? '<div class="xc-detail" title="' + esc(detail) + '">' + esc(detail) + '</div>' : '');
  }

  function cardBodyHTML(card) {
    var payload = card && card.payload;
    if (payload == null) return '';
    if (typeof payload !== 'object' || Array.isArray(payload)) {
      return '<div class="xc-unsupported">暂不支持的数据格式</div>';
    }
    var kind = typeof payload.kind === 'string' ? payload.kind : '';
    var body;
    if (kind === 'list') {
      var items = arr(payload.items).slice(0, 8);
      body = items.length
        ? '<div class="xc-rows">' + items.map(cardRowHTML).join('') + '</div>'
        : '<div class="xc-empty">暂无内容</div>';
    } else if (kind === 'metrics') {
      var rows = arr(payload.rows).slice(0, 6);
      body = rows.length
        ? '<div class="xc-rows">' + rows.map(cardMetricHTML).join('') + '</div>'
        : '<div class="xc-empty">暂无指标</div>';
    } else if (kind === 'status') {
      body = cardStatusHTML(payload);
    } else if (kind === 'text') {
      var text = String(payload.text == null ? '' : payload.text);
      body = '<p class="xc-text" title="' + esc(text) + '">' + esc(text || '—') + '</p>';
    } else {
      body = '<div class="xc-unsupported">暂不支持的数据格式</div>';
    }
    var footer = typeof payload.footer === 'string' && payload.footer
      ? '<div class="xc-foot" title="' + esc(payload.footer) + '">' + esc(payload.footer) + '</div>'
      : '';
    return body + footer;
  }

  function cardConfirmText(card, action) {
    var q = action && action.confirm;
    if (typeof q === 'string' && q.trim()) return q.trim();
    return '确定执行「' + String((action && action.label) || (action && action.id) || '该操作') + '」？';
  }

  function cardActionHTML(card, action, busy) {
    var id = String(card.id);
    var aid = action && action.id != null ? String(action.id) : '';
    if (!aid) return '';
    var style = action.style === 'primary' || action.style === 'danger' ? action.style : 'ghost';
    var label = String(action.label == null ? '' : action.label).slice(0, 20) || aid;
    var running = !!busy && !!app.xc.run && app.xc.run.card === id && app.xc.run.action === aid;
    return '<button class="xc-btn ' + style + (running ? ' is-busy' : '') + '" type="button"' +
      ' data-action="card-action" data-card="' + esc(id) + '" data-act="' + esc(aid) + '"' +
      ' data-fk="xcard:' + esc(id) + ':' + esc(aid) + '" title="' + esc(label) + '"' +
      (busy ? ' disabled' : '') + '>' +
      (running ? '<span class="spin" aria-hidden="true"></span>' : '') + esc(label) +
    '</button>';
  }

  function cardHTML(card) {
    var id = card && card.id != null ? String(card.id) : '';
    if (!id) return '';
    var title = String(card.title == null ? '' : card.title);
    var subtitle = String(card.subtitle == null ? '' : card.subtitle);
    var busy = !!app.xc.busy[id];
    var hostError = card.error ? String(card.error) : '';
    var netError = app.xc.error[id] || null;
    var actions = arr(card.actions).filter(function (a) {
      return a && a.id != null && String(a.id) !== '';
    }).slice(0, 4);
    var armed = !!(app.xc.confirm && app.xc.confirm.card === id);
    var armedAction = armed ? findCardAction(card, app.xc.confirm.action) : null;

    var body;
    if (card.payload == null && !hostError) {
      body = cardSkeletonHTML();
    } else {
      body = (hostError
        ? '<div class="xc-warn"><span class="xc-warn-t" title="' + esc(hostError) + '">' + esc(hostError) + '</span>' +
          '<button class="xc-link" type="button" data-action="cards-retry">重试</button></div>'
        : '') + cardBodyHTML(card);
    }
    if (netError) {
      body += '<div class="xc-warn"><span class="xc-warn-t">' +
        (netError.kind === 'network'
          ? '网络连接失败'
          : '操作失败' + (netError.status ? '（HTTP ' + esc(netError.status) + '）' : '')) +
        '</span><button class="xc-link" type="button" data-action="card-action" data-card="' + esc(id) +
        '" data-act="' + esc(netError.action) + '">重试</button></div>';
    }
    var actionsHTML = actions.length
      ? '<div class="xc-actions' + (actions.length <= 2 ? ' is-few' : '') + '">' +
          actions.map(function (a) { return cardActionHTML(card, a, busy); }).join('') +
        '</div>'
      : '';
    var confirmHTML = armed && armedAction
      ? '<div class="ir-confirm xc-confirm">' +
          '<p class="ir-q"><b>' + esc(cardConfirmText(card, armedAction)) + '</b>' +
            '<span>确认后将立即执行，无法撤销</span></p>' +
          '<span class="ir-btns">' +
            '<button class="ir-btn ghost" type="button" data-action="card-cancel" data-card="' + esc(id) + '">取消</button>' +
            '<button class="ir-btn danger" type="button" data-action="card-run" data-card="' + esc(id) +
              '" data-act="' + esc(String(armedAction.id)) + '" data-fk="xcard-confirm:' + esc(id) + '">' +
              esc(String(armedAction.label == null ? '执行' : armedAction.label)) + '</button>' +
          '</span>' +
        '</div>'
      : '';
    if (armed && !armedAction) app.xc.confirm = null;
    return '<div class="xc-card" data-xcard="' + esc(id) + '">' +
      '<div class="xc-head">' + cardIconHTML(card) +
        '<div class="xc-id">' +
          '<b class="xc-title" title="' + esc(title) + '">' + esc(title || id) + '</b>' +
          (subtitle ? '<span class="xc-sub" title="' + esc(subtitle) + '">' + esc(subtitle) + '</span>' : '') +
        '</div>' +
        (hostError ? '<span class="xc-flag" title="加载失败" aria-label="加载失败"></span>' : '') +
      '</div>' +
      '<div class="xc-body">' + body + '</div>' +
      actionsHTML +
      confirmHTML +
    '</div>';
  }

  function cardsHTML(extra) {
    var list = cards();
    if (!list.length) {
      app.xc.confirm = null;
      return '';
    }
    if (app.xc.confirm && !findCard(app.xc.confirm.card)) app.xc.confirm = null;
    return '<section class="card xcards ' + esc(extra || '') + '">' +
      '<div class="card-head"><h3>扩展</h3><span class="r">' + list.length + ' 个</span></div>' +
      '<div class="xc-list">' + list.map(cardHTML).join('') + '</div>' +
    '</section>';
  }

  /* ---------- v0.6: extension card actions ---------- */
  function handleCardAction(cardId, actionId) {
    var card = findCard(cardId);
    if (!card) return;
    var action = findCardAction(card, actionId);
    if (!action || app.xc.busy[String(card.id)]) return;
    if (action.confirm) {
      app.xc.confirm = { card: String(card.id), action: String(action.id) };
      app.xc.confirmFocus = true;
      scheduleRender();
      return;
    }
    runCardAction(cardId, actionId);
  }

  function cancelCardConfirm() {
    var armed = app.xc.confirm;
    app.xc.confirm = null;
    if (armed) app.xc.focus = 'xcard:' + armed.card + ':' + armed.action;
    scheduleRender();
  }

  function runCardAction(cardId, actionId) {
    var card = findCard(cardId);
    if (!card) return;
    var action = findCardAction(card, actionId);
    var id = String(card.id);
    if (!action || app.xc.busy[id]) return;
    app.xc.confirm = null;
    app.xc.confirmFocus = false;
    app.xc.busy[id] = true;
    app.xc.run = { card: id, action: String(action.id) };
    delete app.xc.error[id];
    app.xc.focus = 'xcard:' + id + ':' + String(action.id);
    scheduleRender();
    var clear = function () {
      delete app.xc.busy[id];
      if (app.xc.run && app.xc.run.card === id) app.xc.run = null;
    };
    postAction(CARD_ACTIONS_URL + encodeURIComponent(id) + '/action', { actionId: String(action.id) })
      .then(function (res) {
        clear();
        if (res.status === 404) {
          toast('该卡片操作已失效');
          scheduleRender();
          refreshState();
          return;
        }
        if (!res.ok) {
          app.xc.error[id] = { action: String(action.id), kind: 'fail', status: res.status };
          scheduleRender();
          return;
        }
        toast('已刷新');
        scheduleRender();
        refreshState();
      })
      .catch(function () {
        clear();
        app.xc.error[id] = { action: String(action.id), kind: 'network' };
        scheduleRender();
      });
  }

  /* ---------- v0.6: offline + PWA surface ---------- */
  function isOnline() { return window.navigator.onLine !== false; }

  function isSecurePWA() {
    var host = window.location.hostname;
    return window.location.protocol === 'https:' || host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
  }

  function pwaStandalone() {
    if (window.navigator.standalone === true) return true;
    return !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  }

  function pwaSectionHTML() {
    var supported = 'serviceWorker' in navigator;
    var standalone = pwaStandalone();
    var installable = !!app.pwa.install && !standalone;
    var secure = isSecurePWA();
    /* v0.9: remote clients reach the deck over an HTTPS tunnel, so keep the card there too. */
    if (!(REMOTE_MODE || standalone || installable || app.pwa.swActive || (supported && secure))) return '';
    var status = standalone ? '已安装' : (installable ? '可安装' : '仅浏览器可用');
    var swText = app.pwa.swActive ? '离线外壳已缓存' : (supported && secure ? '尚未缓存' : '不可用');
    var how;
    if (standalone) {
      how = '<p class="set-note pwa-hint">已作为应用运行</p>';
    } else if (installable) {
      how = '<button class="pwa-install" type="button" data-action="pwa-install">安装到桌面</button>';
    } else {
      how = '<details class="pwa-how">' +
        '<summary>如何添加到主屏幕</summary>' +
        '<div class="pwa-how-rows">' +
          '<span><b>iPhone</b>分享 → 添加到主屏幕</span>' +
          '<span><b>Android</b>Chrome ⋮ → 安装应用</span>' +
        '</div>' +
      '</details>';
    }
    return '<div class="card set-card pwa-card" data-pwa="' + (standalone ? 'standalone' : (installable ? 'installable' : 'browser')) + '">' +
      '<div class="remote-head"><h3>离线与安装</h3></div>' +
      '<div class="kv"><span>应用</span><b class="' + (standalone || installable ? 'ok' : '') + '">' + esc(status) + '</b></div>' +
      '<div class="kv"><span>离线外壳</span><b class="' + (app.pwa.swActive ? 'ok' : 'warn') + '">' + esc(swText) + '</b></div>' +
      how +
      '<p class="set-note">安装后可从桌面直接打开；断网时仍可看到最后一次的数据。</p>' +
    '</div>';
  }

  function promptInstall() {
    var ev = app.pwa.install;
    if (!ev || typeof ev.prompt !== 'function') return;
    app.pwa.install = null;
    try { ev.prompt(); } catch (err) { /* ignore */ }
    try {
      if (ev.userChoice && typeof ev.userChoice.then === 'function') {
        ev.userChoice.then(function () { scheduleRender(); }, function () { scheduleRender(); });
      }
    } catch (err) { /* ignore */ }
    scheduleRender();
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator) || !isSecurePWA()) return;
    var start = function () {
      try {
        navigator.serviceWorker.register('./sw.js', { scope: './' }).then(function (reg) {
          var mark = function () {
            if (!app.pwa.swActive) { app.pwa.swActive = true; scheduleRender(); }
          };
          if (reg && (reg.active || navigator.serviceWorker.controller)) mark();
          var ready = navigator.serviceWorker.ready;
          if (ready && typeof ready.then === 'function') ready.then(mark, function () { /* ignore */ });
        }).catch(function () { /* offline shell is a bonus; rendering never depends on it */ });
      } catch (err) { /* ignore */ }
    };
    if (document.readyState === 'complete') start();
    else window.addEventListener('load', start);
  }

  function captureInstallPrompt() {
    window.addEventListener('beforeinstallprompt', function (ev) {
      ev.preventDefault();
      app.pwa.install = ev;
      scheduleRender();
    });
    window.addEventListener('appinstalled', function () {
      app.pwa.install = null;
      scheduleRender();
      toast('已安装到桌面');
    });
  }

  function offlineBannerHTML() {
    if (isOnline()) return '';
    return '<div class="offline-bar" role="status"><span class="ob-dot" aria-hidden="true"></span>离线 · 显示的是最后一次数据</div>';
  }

  /* =====================================================================
     v0.7 remote takeover — host-side pairing (desktop) and the phone-side
     remote-client view. Every host string below is escaped at the boundary.
     ===================================================================== */

  var REMOTE_BANNER_TEXT = '远程连接 · 所有操作会记录在桌面审计里';

  /** The page the phone gets: a slim persistent audit banner above the deck. */
  function remoteBannerHTML() {
    if (!REMOTE_MODE) return '';
    return '<div class="remote-bar" role="status">' +
      '<span class="rb-dot" aria-hidden="true"></span>' +
      '<span class="rb-text">' + esc(REMOTE_BANNER_TEXT) + '</span>' +
      '<span class="rb-hint" title="请在桌面端「设置 → 远程接管」断开">断开</span>' +
    '</div>';
  }

  function remoteSessions(list) {
    return arr(list).map(function (s) {
      if (!s || typeof s !== 'object') return null;
      var id = s.id == null ? '' : String(s.id);
      if (!id) return null;
      return {
        id: id,
        label: String(s.label == null ? '' : s.label),
        createdAt: num(s.createdAt),
        lastSeenAt: num(s.lastSeenAt)
      };
    }).filter(Boolean);
  }

  function remoteErrorText(status, fallback) {
    if (status === 403) return '这台机器不允许远程访问';
    if (status === 429) return '操作太频繁，请稍后再试';
    if (status === 404) return '远程接口不存在';
    if (status >= 500) return '远程服务暂时不可用（HTTP ' + status + '）';
    if (status) return fallback + '（HTTP ' + status + '）';
    return '网络连接失败，请重试';
  }

  /** Fold a contract-shaped payload into local state (never re-fetches). */
  function remoteNormalize(payload) {
    if (!payload || typeof payload !== 'object') return;
    var r = app.remote;
    r.loaded = true;
    r.available = true;
    r.enabled = payload.enabled !== false;
    r.running = r.enabled && !!payload.running;
    r.url = r.running && payload.url ? String(payload.url) : '';
    /* v0.9: public origin (tunnel) + secure flag + the URL the phone should open. */
    r.publicUrl = r.running && payload.publicUrl ? String(payload.publicUrl) : '';
    r.secure = payload.secure === true;
    r.urlForPhone = r.running && payload.urlForPhone ? String(payload.urlForPhone) : '';
    r.port = num(payload.port);
    r.sessions = remoteSessions(payload.sessions);
    if (!r.running) {
      r.sessions = [];
      r.url = '';
      r.publicUrl = '';
      r.secure = false;
      r.urlForPhone = '';
      r.port = null;
      r.confirmStop = false;
      r.pub.editing = false;
      r.pub.value = '';
      r.pub.busy = false;
      r.pub.error = '';
    } else if (r.pub.busy) {
      /* a config POST is in flight; the response itself settles the editor */
    } else if (!r.pub.editing) {
      r.pub.value = r.publicUrl;
    }
    if (!r.running && app.pair) closePair(false);
  }

  /** One GET. Called when the settings tab opens and after every host action —
   * never on a timer, so the 3s state frames stay the only push channel. */
  function fetchRemote() {
    if (REMOTE_MODE) return;
    var r = app.remote;
    var seq = ++r.seq;
    fetch(REMOTE_URL, { headers: { 'Accept': 'application/json' } })
      .then(function (res) {
        if (res.status === 404 || res.status === 501) return { missing: true };
        if (!res.ok) return { fail: true, status: res.status };
        return res.json().catch(function () { return null; }).then(function (payload) {
          return { payload: payload };
        });
      })
      .then(function (out) {
        if (seq !== r.seq) return;
        if (out.missing) {
          r.loaded = true;
          r.available = false;
          if (app.pair) closePair(false);
          scheduleRender();
          return;
        }
        if (out.fail) {
          r.loaded = true;
          r.error = remoteErrorText(out.status, '无法读取远程状态');
          scheduleRender();
          return;
        }
        var payload = out.payload;
        if (!payload || payload.ok === false) {
          r.loaded = true;
          r.error = payload && payload.error ? String(payload.error) : '远程接口返回异常';
          scheduleRender();
          return;
        }
        r.error = '';
        remoteNormalize(payload);
        scheduleRender();
      })
      .catch(function () {
        if (seq !== r.seq) return;
        r.loaded = true;
        r.error = '无法读取远程状态，请检查连接';
        scheduleRender();
      });
  }

  /** v0.9: one GET for the HTTPS-tunnel guide (settings open / refresh only). */
  function tunnelTools(list) {
    return arr(list).map(function (t) {
      if (!t || typeof t !== 'object' || t.id == null) return null;
      return {
        id: String(t.id),
        label: String(t.label == null ? t.id : t.label),
        available: t.available === true,
        path: t.path == null ? '' : String(t.path)
      };
    }).filter(Boolean);
  }

  function tunnelCommands(list) {
    return arr(list).map(function (c) {
      if (!c || typeof c !== 'object' || c.id == null) return null;
      return {
        id: String(c.id),
        label: String(c.label == null ? c.id : c.label),
        command: String(c.command == null ? '' : c.command),
        note: String(c.note == null ? '' : c.note)
      };
    }).filter(Boolean);
  }

  function fetchTunnel() {
    if (REMOTE_MODE) return;
    var t = app.tunnel;
    var seq = ++t.seq;
    t.busy = true;
    fetch(REMOTE_TUNNEL_URL, { headers: { 'Accept': 'application/json' } })
      .then(function (res) {
        if (res.status === 404 || res.status === 501) return { missing: true };
        if (!res.ok) return { fail: true, status: res.status };
        return res.json().catch(function () { return null; }).then(function (payload) {
          return { payload: payload };
        });
      })
      .then(function (out) {
        if (seq !== t.seq) return;
        t.loaded = true;
        t.busy = false;
        if (out.missing) {
          t.available = false;
          t.error = '';
          scheduleRender();
          return;
        }
        if (out.fail) {
          t.error = remoteErrorText(out.status, '读取隧道信息失败');
          scheduleRender();
          return;
        }
        var payload = out.payload;
        if (!payload || payload.ok === false) {
          t.error = payload && payload.error ? String(payload.error) : '隧道接口返回异常';
          scheduleRender();
          return;
        }
        t.available = true;
        t.error = '';
        t.running = payload.running === true;
        t.lanUrl = payload.lanUrl ? String(payload.lanUrl) : '';
        t.tools = tunnelTools(payload.tools);
        t.commands = tunnelCommands(payload.commands);
        scheduleRender();
      })
      .catch(function () {
        if (seq !== t.seq) return;
        t.loaded = true;
        t.busy = false;
        t.error = '无法读取隧道信息，请检查连接';
        scheduleRender();
      });
  }

  /** Generic JSON call for the remote endpoints (DELETE needs a method arg). */
  function apiCall(method, url, body) {
    var opts = { method: method, headers: { 'Accept': 'application/json' } };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    return fetch(url, opts).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (payload) {
        return { ok: res.ok, status: res.status, data: payload };
      });
    });
  }

  /** Clipboard with an execCommand fallback for non-secure LAN origins. */
  function copyText(text) {
    var value = String(text == null ? '' : text);
    if (!value) return;
    var fallback = function () {
      var ok = false;
      try {
        var ta = document.createElement('textarea');
        ta.value = value;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '-1000px';
        ta.style.left = '-1000px';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { ta.setSelectionRange(0, value.length); } catch (err) { /* ignore */ }
        ok = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch (err) { ok = false; }
      toast(ok ? '已复制' : '复制失败，请手动选择');
    };
    if (window.navigator.clipboard && window.navigator.clipboard.writeText) {
      window.navigator.clipboard.writeText(value).then(function () { toast('已复制'); }, fallback);
    } else {
      fallback();
    }
  }

  /* ---------- remote section (settings tab, desktop + mobile) ---------- */
  function remoteSectionHTML() {
    if (REMOTE_MODE) return remoteClientCardHTML();
    var r = app.remote;
    if (!r.available) return '';
    if (!r.loaded) {
      return '<div class="card set-card remote-card">' +
        '<div class="remote-head"><h3>远程接管</h3></div>' +
        '<p class="set-note remote-loading">正在读取远程状态…</p>' +
      '</div>';
    }
    if (!r.enabled) {
      return '<div class="card set-card remote-card">' +
        '<div class="remote-head"><h3>远程接管</h3><span class="remote-status off">未启用</span></div>' +
        '<p class="set-note">本机未启用远程访问功能。</p>' +
      '</div>';
    }
    return '<div class="card set-card remote-card" data-remote="' + (r.running ? 'on' : 'off') + '">' +
      '<div class="remote-head"><h3>远程接管</h3>' +
        '<span class="remote-status ' + (r.running ? 'on' : 'off') + '"><i aria-hidden="true"></i>' +
          (r.running ? '已开启' : '未开启') + '</span>' +
        (r.running && r.secure
          ? '<span class="remote-secure-chip" title="公网地址为 HTTPS，配对 Cookie 会带 Secure 标记">' +
              '<i aria-hidden="true"></i>安全连接 · Secure Cookie</span>'
          : '') +
      '</div>' +
      (r.running ? remoteRunningBodyHTML() : remoteOffBodyHTML()) +
    '</div>';
  }

  function remoteOffBodyHTML() {
    var busy = app.remote.busy === 'start';
    return '<p class="set-note remote-note">只在同一局域网内开放；开启后手机凭一次性配对码接入，可随时断开</p>' +
      remoteErrorHTML() +
      '<button class="remote-btn primary remote-start-btn" type="button" data-action="remote-start" data-fk="remote-start"' +
        (busy ? ' disabled' : '') + '>' +
        (busy ? '<span class="spin" aria-hidden="true"></span>正在开启…' : '开启远程访问') +
      '</button>';
  }

  function remoteRunningBodyHTML() {
    var r = app.remote;
    var n = r.sessions.length;
    var pairBusy = r.busy === 'pair';
    var devices = n
      ? r.sessions.map(remoteDeviceHTML).join('')
      : '<p class="set-note remote-empty">还没有设备接入</p>';
    var lanNote = r.publicUrl
      ? '手机用上面的公网地址（HTTPS）或局域网地址打开，输入一次性配对码即可接入。'
      : '手机连同一 Wi-Fi 后打开上面的地址，用一次性配对码接入。';
    var actions = r.confirmStop ? remoteStopConfirmHTML() :
      '<div class="remote-actions">' +
        '<button class="remote-btn" type="button" data-action="remote-pair" data-fk="remote-pair"' +
          (pairBusy ? ' disabled' : '') + '>' +
          (pairBusy ? '<span class="spin" aria-hidden="true"></span>生成中…' : '生成新配对码') +
        '</button>' +
        '<span class="remote-sp"></span>' +
        '<button class="remote-btn danger-text" type="button" data-action="remote-stop-arm" data-fk="remote-stop-arm">关闭远程访问</button>' +
      '</div>';
    return '<button class="remote-url" type="button" data-action="remote-copy-url" title="点击复制局域网地址">' +
        '<code>' + esc(r.url || '地址获取中…') + '</code>' +
        '<span class="remote-copy">' + ICON_LINK + '复制</span>' +
      '</button>' +
      remotePubHTML() +
      '<p class="set-note remote-note">' + esc(lanNote) + '</p>' +
      '<div class="remote-dev-head"><b>已配对设备 ' + n + ' 台</b>' +
        (n > 1 ? '<button class="remote-mini" type="button" data-action="remote-revoke-all" data-fk="remote-revoke-all"' +
          (r.busy === 'revoke-all' ? ' disabled' : '') + '>' +
          (r.busy === 'revoke-all' ? '断开中…' : '全部断开') + '</button>' : '') +
      '</div>' +
      '<div class="remote-devs">' + devices + '</div>' +
      remoteErrorHTML() +
      remoteTunnelHTML() +
      actions;
  }

  /** v0.9: inline public-origin editor — only rendered while the listener runs. */
  function remotePubHTML() {
    var r = app.remote;
    var pub = r.pub;
    if (!pub.editing) {
      return '<div class="remote-pub">' +
        '<div class="remote-pub-head"><span>公网地址</span>' +
          (r.publicUrl
            ? '<code title="' + esc(r.publicUrl) + '">' + esc(r.publicUrl) + '</code>'
            : '<b class="remote-pub-none">未设置</b>') +
        '</div>' +
        '<button class="remote-mini remote-pub-edit" type="button" data-action="remote-pub-edit" data-fk="remote-pub-edit">编辑</button>' +
      '</div>';
    }
    return '<div class="remote-pub is-editing">' +
      '<label class="remote-pub-label" for="remote-pub-input">公网地址</label>' +
      '<input id="remote-pub-input" class="remote-pub-input" type="url" inputmode="url" autocomplete="off"' +
        ' spellcheck="false" placeholder="https://xxx.trycloudflare.com"' +
        ' value="' + esc(pub.value) + '" data-action="remote-pub-input" data-fk="remote-pub-input"' +
        (pub.busy ? ' disabled' : '') + '>' +
      '<div class="remote-pub-btns">' +
        '<button class="remote-btn primary remote-pub-save" type="button" data-action="remote-pub-save" data-fk="remote-pub-save"' +
          (pub.busy ? ' disabled' : '') + '>' +
          (pub.busy ? '<span class="spin" aria-hidden="true"></span>保存中…' : '保存') +
        '</button>' +
        '<button class="remote-btn ghost" type="button" data-action="remote-pub-clear" data-fk="remote-pub-clear"' +
          (pub.busy ? ' disabled' : '') + '>清除</button>' +
      '</div>' +
      (pub.error ? '<p class="remote-pub-err" role="alert">' + esc(pub.error) + '</p>' : '') +
      '<p class="remote-pub-hint">粘贴完整 https 地址；回车保存，Esc 取消编辑。</p>' +
    '</div>';
  }

  function shortCmdPath(p) {
    var s = String(p == null ? '' : p);
    if (s.length <= 30) return s;
    return '…' + s.slice(s.length - 28);
  }

  /** v0.9: HTTPS tunnel guide — inside the remote card, under the device list. */
  function remoteTunnelHTML() {
    if (REMOTE_MODE) return '';
    var t = app.tunnel;
    if (!t.available) return '';
    var head = '<div class="remote-tunnel-head"><b>HTTPS 隧道</b>' +
      '<button class="remote-mini remote-tunnel-x" type="button" data-action="tunnel-refresh" data-fk="tunnel-refresh"' +
        (t.busy ? ' disabled' : '') + '>' + (t.busy ? '刷新中…' : '刷新') + '</button>' +
    '</div>';
    var intro = '<p class="set-note remote-tunnel-note">想要 HTTPS / 手机可安装 PWA，用下面任一方式建隧道，然后把公网地址填到上面的「公网地址」。</p>';
    if (!t.loaded && !t.error) {
      return '<div class="remote-tunnel">' + head + intro +
        '<p class="set-note remote-empty">正在检测隧道工具…</p></div>';
    }
    if (t.error) {
      return '<div class="remote-tunnel">' + head + intro +
        '<div class="remote-err" role="alert"><span>' + esc(t.error) + '</span></div>' +
        '<button class="remote-mini remote-tunnel-retry" type="button" data-action="tunnel-retry" data-fk="tunnel-retry">重试</button>' +
      '</div>';
    }
    var tools = t.tools || [];
    var rows = t.commands.map(function (cmd) {
      var tool = null;
      tools.forEach(function (x) { if (x.id === cmd.id) tool = x; });
      var found = tool && tool.available;
      var label = (tool && tool.label) || cmd.label;
      var avail = found
        ? '<span class="tunnel-avail is-on"><i aria-hidden="true"></i>已检测到' +
            (tool.path ? ' · <code title="' + esc(tool.path) + '">' + esc(shortCmdPath(tool.path)) + '</code>' : '') +
          '</span>'
        : '<span class="tunnel-avail is-off"><i aria-hidden="true"></i>未安装</span>';
      return '<div class="tunnel-tool" data-tool="' + esc(cmd.id) + '">' +
        '<div class="tunnel-tool-head"><b>' + esc(label) + '</b>' + avail + '</div>' +
        '<div class="tunnel-cmd-wrap">' +
          '<pre class="tunnel-cmd" data-cmd-copy="' + esc(cmd.id) + '"><code>' + esc(cmd.command) + '</code></pre>' +
          '<button class="remote-mini tunnel-copy" type="button" data-action="tunnel-copy" data-id="' + esc(cmd.id) + '">复制命令</button>' +
        '</div>' +
        (cmd.note ? '<p class="set-note tunnel-note">' + esc(cmd.note) + '</p>' : '') +
      '</div>';
    }).join('');
    return '<div class="remote-tunnel">' + head + intro + rows + '</div>';
  }

  function remoteDeviceHTML(s) {
    var busy = app.remote.busy === 'revoke:' + s.id;
    var seen = s.lastSeenAt
      ? '<span data-rel-at="' + esc(String(s.lastSeenAt)) + '">' + esc(ago(s.lastSeenAt)) + '</span>'
      : '<span>—</span>';
    return '<div class="remote-dev">' +
      '<span class="remote-dev-ico" aria-hidden="true">' + ICON_PHONE + '</span>' +
      '<div class="remote-dev-main"><b>' + esc(s.label || '未知设备') + '</b>' +
        '<span>最近活跃 ' + seen + '</span>' +
      '</div>' +
      '<button class="remote-dev-x" type="button" data-action="remote-revoke" data-id="' + esc(s.id) + '"' +
        (busy ? ' disabled' : '') + '>' + (busy ? '断开中…' : '断开') + '</button>' +
    '</div>';
  }

  function remoteStopConfirmHTML() {
    var busy = app.remote.busy === 'stop';
    return '<div class="remote-confirm" role="alertdialog" aria-label="确认关闭远程访问">' +
      '<p>关闭后所有已配对设备将立即断开</p>' +
      '<div class="remote-confirm-btns">' +
        '<button class="remote-btn ghost" type="button" data-action="remote-stop-cancel" data-fk="remote-stop-cancel"' +
          (busy ? ' disabled' : '') + '>取消</button>' +
        '<button class="remote-btn danger" type="button" data-action="remote-stop" data-fk="remote-stop-confirm"' +
          (busy ? ' disabled' : '') + '>' +
          (busy ? '<span class="spin" aria-hidden="true"></span>关闭中…' : '确认关闭') +
        '</button>' +
      '</div>' +
    '</div>';
  }

  function remoteErrorHTML() {
    var msg = app.remote.error;
    if (!msg) return '';
    return '<div class="remote-err" role="alert"><span>' + esc(msg) + '</span></div>';
  }

  /** The phone view of the settings tab: no start/stop controls, only context. */
  function remoteClientCardHTML() {
    var host = '';
    try { host = window.location.host || ''; } catch (err) { host = ''; }
    return '<div class="card set-card remote-card remote-client">' +
      '<div class="remote-head"><h3>远程连接</h3>' +
        '<span class="remote-status on"><i aria-hidden="true"></i>远程客户端</span>' +
      '</div>' +
      '<p class="set-about">你正在通过局域网连接到桌面上的 Cockpit。所有操作都会记录在桌面端的审计日志里；需要断开请回到桌面端「设置 → 远程接管」。</p>' +
      '<div class="remote-host"><span>当前主机</span><code>' + esc(host || '—') + '</code></div>' +
    '</div>';
  }

  /* ---------- remote host actions ---------- */
  function remoteStart() {
    var r = app.remote;
    if (r.busy) return;
    r.busy = 'start';
    r.error = '';
    scheduleRender();
    apiCall('POST', REMOTE_START_URL).then(function (res) {
      r.busy = '';
      if (!res.ok) {
        r.error = remoteErrorText(res.status, '开启远程访问失败');
        r.focus = 'remote-start';
        scheduleRender();
        return;
      }
      var payload = res.data;
      if (!payload || payload.ok === false) {
        r.error = payload && payload.error ? String(payload.error) : '开启远程访问失败';
        r.focus = 'remote-start';
        scheduleRender();
        return;
      }
      r.error = '';
      remoteNormalize(payload);
      scheduleRender();
      fetchTunnel();
      if (payload.pair && payload.running) openPair(payload.pair);
      else toast('远程访问已开启');
    }).catch(function () {
      r.busy = '';
      r.error = '网络连接失败，请重试';
      r.focus = 'remote-start';
      scheduleRender();
    });
  }

  function remoteStop() {
    var r = app.remote;
    if (r.busy) return;
    r.busy = 'stop';
    r.error = '';
    scheduleRender();
    apiCall('POST', REMOTE_STOP_URL).then(function (res) {
      r.busy = '';
      r.confirmStop = false;
      if (!res.ok) {
        r.error = remoteErrorText(res.status, '关闭远程访问失败');
        r.focus = 'remote-stop-arm';
        scheduleRender();
        return;
      }
      var payload = res.data;
      if (payload && payload.ok === false) {
        r.error = payload.error ? String(payload.error) : '关闭远程访问失败';
        r.focus = 'remote-stop-arm';
        scheduleRender();
        return;
      }
      if (app.pair) closePair(false);
      if (payload) remoteNormalize(payload);
      else {
        r.running = false;
        r.url = '';
        r.port = null;
        r.sessions = [];
      }
      r.error = '';
      scheduleRender();
      fetchTunnel();
      toast('远程访问已关闭');
    }).catch(function () {
      r.busy = '';
      r.error = '网络连接失败，请重试';
      r.focus = 'remote-stop-arm';
      scheduleRender();
    });
  }

  function remotePair() {
    var r = app.remote;
    if (r.busy) return;
    r.busy = 'pair';
    r.error = '';
    scheduleRender();
    apiCall('POST', REMOTE_PAIR_URL).then(function (res) {
      r.busy = '';
      if (!res.ok) {
        r.error = remoteErrorText(res.status, '生成配对码失败');
        r.focus = 'remote-pair';
        scheduleRender();
        return;
      }
      var payload = res.data;
      if (!payload || payload.ok === false || !payload.pair) {
        r.error = payload && payload.error ? String(payload.error) : '没有拿到新的配对码';
        r.focus = 'remote-pair';
        scheduleRender();
        return;
      }
      if (payload.url) r.url = String(payload.url);
      r.error = '';
      scheduleRender();
      openPair(payload.pair);
    }).catch(function () {
      r.busy = '';
      r.error = '网络连接失败，请重试';
      r.focus = 'remote-pair';
      scheduleRender();
    });
  }

  function remoteRevoke(id) {
    var r = app.remote;
    if (!id || r.busy) return;
    r.busy = 'revoke:' + id;
    r.error = '';
    scheduleRender();
    apiCall('DELETE', REMOTE_SESSIONS_URL + '?id=' + encodeURIComponent(id)).then(function (res) {
      r.busy = '';
      if (!res.ok) {
        r.error = remoteErrorText(res.status, '断开设备失败');
        scheduleRender();
        return;
      }
      var payload = res.data;
      if (payload && Array.isArray(payload.sessions)) {
        r.sessions = remoteSessions(payload.sessions);
        scheduleRender();
      } else {
        fetchRemote();
      }
      toast('已断开该设备');
    }).catch(function () {
      r.busy = '';
      r.error = '网络连接失败，请重试';
      scheduleRender();
    });
  }

  function remoteRevokeAll() {
    var r = app.remote;
    if (r.busy) return;
    r.busy = 'revoke-all';
    r.error = '';
    scheduleRender();
    apiCall('DELETE', REMOTE_SESSIONS_URL).then(function (res) {
      r.busy = '';
      if (!res.ok) {
        r.error = remoteErrorText(res.status, '断开全部设备失败');
        scheduleRender();
        return;
      }
      var payload = res.data;
      if (payload && Array.isArray(payload.sessions)) {
        r.sessions = remoteSessions(payload.sessions);
        scheduleRender();
      } else {
        fetchRemote();
      }
      toast('已断开全部设备');
    }).catch(function () {
      r.busy = '';
      r.error = '网络连接失败，请重试';
      scheduleRender();
    });
  }

  function remoteStopArm() {
    if (app.remote.busy) return;
    app.remote.confirmStop = true;
    app.remote.focus = 'remote-stop-confirm';
    scheduleRender();
  }

  function remoteStopCancel() {
    app.remote.confirmStop = false;
    app.remote.focus = 'remote-stop-arm';
    scheduleRender();
  }

  /* ---------- v0.9: public (tunnel) origin editor ---------- */
  function remotePubEdit() {
    var r = app.remote;
    if (!r.running || r.pub.busy) return;
    r.pub.editing = true;
    r.pub.value = r.publicUrl || '';
    r.pub.error = '';
    r.pub.focus = '';
    r.focus = 'remote-pub-input';
    scheduleRender();
  }

  function remotePubCancel() {
    var pub = app.remote.pub;
    if (pub.busy) return;
    pub.editing = false;
    pub.error = '';
    app.remote.focus = 'remote-pub-edit';
    scheduleRender();
  }

  function remotePubSave(clear) {
    var r = app.remote;
    var pub = r.pub;
    if (pub.busy || !r.running) return;
    var value = clear ? '' : String(pub.value || '').trim();
    pub.busy = true;
    pub.error = '';
    scheduleRender();
    apiCall('POST', REMOTE_CONFIG_URL, { publicUrl: value }).then(function (res) {
      pub.busy = false;
      var data = res.data;
      if (!res.ok || !data || data.ok === false) {
        pub.error = (data && typeof data.error === 'string' && data.error)
          ? data.error
          : remoteErrorText(res.status, clear ? '清除公网地址失败' : '保存公网地址失败');
        app.remote.focus = clear ? 'remote-pub-clear' : 'remote-pub-save';
        scheduleRender();
        return;
      }
      pub.editing = false;
      pub.value = '';
      remoteNormalize(data);
      r.pub.value = r.publicUrl;
      r.focus = 'remote-pub-edit';
      scheduleRender();
      toast(clear ? '已清除公网地址' : '公网地址已保存');
    }).catch(function () {
      pub.busy = false;
      pub.error = '网络连接失败，请重试';
      app.remote.focus = clear ? 'remote-pub-clear' : 'remote-pub-save';
      scheduleRender();
    });
  }

  /** Copy a tunnel command; falls back to selecting the code block. */
  function copyCommand(text, cmdId) {
    var value = String(text == null ? '' : text);
    if (!value) return;
    var selectFallback = function () {
      try {
        var pre = document.querySelector('[data-cmd-copy="' + String(cmdId).replace(/"/g, '\\"') + '"]');
        if (pre) {
          var range = document.createRange();
          range.selectNodeContents(pre);
          var sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
        }
      } catch (e) { /* selection is best-effort */ }
      toast('复制失败，请手动复制');
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value).then(function () {
        toast('已复制命令');
      }, selectFallback);
      return;
    }
    selectFallback();
  }

  function tunnelCopy(id) {
    var t = app.tunnel;
    var cmd = null;
    t.commands.forEach(function (c) { if (c.id === id) cmd = c; });
    if (!cmd) return;
    copyCommand(cmd.command, id);
  }

  function tunnelRetry() {
    app.tunnel.focus = 'tunnel-refresh';
    fetchTunnel();
  }

  /* ---------- pairing dialog (layer outside #app, like the composer) ---------- */
  function pairLayerEl() {
    return document.getElementById('pair-layer');
  }

  function fmtRemoteCode(code) {
    var digits = String(code == null ? '' : code).replace(/[^0-9]/g, '');
    if (digits.length === 6) return digits.slice(0, 3) + ' ' + digits.slice(3);
    return digits;
  }

  function fmtCountdown(sec) {
    var total = Math.max(0, Math.floor(sec));
    var min = Math.floor(total / 60);
    var rest = total % 60;
    return min + ':' + (rest < 10 ? '0' + rest : '' + rest);
  }

  function pairIsExpired(p) {
    return !!(p && (p.expired || !(num(p.expiresAt) > Date.now())));
  }

  function pairPanelHTML(p) {
    var expired = pairIsExpired(p);
    var phoneUrl = app.remote.urlForPhone || app.remote.publicUrl || app.remote.url || '';
    var viaPublic = !!(app.remote.publicUrl || app.remote.urlForPhone) && /^https:\/\//i.test(phoneUrl);
    var url = phoneUrl;
    var remMs = num(p.expiresAt) ? p.expiresAt - Date.now() : 0;
    var secs = Math.max(0, Math.ceil(remMs / 1000));
    var pct = clamp(remMs / PAIR_TTL * 100, 0, 100);
    var busyNew = p.busy === 'new';
    var codeArea;
    if (expired) {
      codeArea = '<div class="pair-expired">' +
        '<span>配对码已过期</span>' +
        '<button class="remote-btn primary" type="button" data-act="pair-new" data-pair-focus="pair-new"' +
          (busyNew ? ' disabled' : '') + '>' +
          (busyNew ? '<span class="spin" aria-hidden="true"></span>生成中…' : '生成新配对码') +
        '</button>' +
      '</div>';
    } else {
      codeArea = '<button class="pair-code" type="button" data-act="pair-copy" data-pair-focus="pair-copy" title="点击复制配对码">' +
          '<span class="pair-digits">' + esc(fmtRemoteCode(p.code)) + '</span>' +
          '<span class="pair-copy-tag">复制</span>' +
        '</button>' +
        '<div class="pair-timer">' +
          '<span class="pair-remain" data-pair-count>剩余 ' + fmtCountdown(secs) + '</span>' +
          '<div class="pair-track" aria-hidden="true"><i data-pair-bar style="width:' + pct.toFixed(1) + '%"></i></div>' +
        '</div>';
    }
    return '<div class="pair-scrim" data-act="pair-dismiss" aria-hidden="true"></div>' +
      '<div class="pair" role="dialog" aria-modal="true" aria-labelledby="pair-title" aria-describedby="pair-desc">' +
        '<div class="pair-head">' +
          '<span class="pair-ico" aria-hidden="true">' + ICON_PHONE + '</span>' +
          '<div class="pair-titlewrap"><b id="pair-title">配对手机</b><span>一次性配对码 · 2 分钟有效</span></div>' +
          '<button class="pair-x" type="button" data-act="pair-close" aria-label="关闭配对码" title="关闭（Esc）">' + ICON_X + '</button>' +
        '</div>' +
        '<div class="pair-body">' + codeArea +
          '<div class="pair-url">' +
            '<span class="pair-url-label">手机浏览器打开</span>' +
            '<button class="pair-link" type="button" data-act="pair-copy-url" title="点击复制地址">' +
              '<code>' + esc(url || '等待桌面端地址…') + '</code>' +
              '<span class="pair-copy-tag">复制</span>' +
            '</button>' +
          '</div>' +
          '<ol class="pair-steps">' +
            '<li><b>①</b>手机连同一个 Wi-Fi</li>' +
            '<li><b>②</b>浏览器打开上面的地址，输入配对码</li>' +
          '</ol>' +
          (viaPublic ? '<p class="pair-secure"><i aria-hidden="true"></i>地址为 HTTPS，可安装为 PWA / 通知可用</p>' : '') +
          '<p class="pair-note" id="pair-desc">配对码 2 分钟有效、只能用一次；设备可在下方随时断开。</p>' +
          (p.error ? '<div class="pair-err" role="alert"><span>' + esc(p.error) + '</span></div>' : '') +
        '</div>' +
      '</div>';
  }

  function renderPair() {
    var layer = pairLayerEl();
    var p = app.pair;
    if (!layer || !p) return;
    layer.hidden = false;
    layer.innerHTML = pairPanelHTML(p);
    positionPair();
    if (p.focus) {
      var key = p.focus;
      p.focus = '';
      var target = layer.querySelector('[data-pair-focus="' + String(key).replace(/["\\]/g, '\\$&') + '"]');
      if (target) {
        try { target.focus({ preventScroll: true }); } catch (err) { /* ignore */ }
      }
    }
  }

  /** Desktop: centered by CSS. Mobile: a sheet sitting exactly on the tab bar. */
  function positionPair() {
    var layer = pairLayerEl();
    var panel = layer && layer.querySelector('.pair');
    if (!panel) return;
    if (isSheetMode()) {
      var tabbar = document.querySelector('.tabbar');
      var h = tabbar && tabbar.offsetParent !== null ? tabbar.getBoundingClientRect().height : 0;
      panel.style.bottom = Math.max(0, Math.round(h)) + 'px';
    } else {
      panel.style.bottom = '';
    }
  }

  function openPair(pair) {
    var code = pair && pair.code ? String(pair.code).replace(/[^0-9]/g, '') : '';
    if (!code) return;
    var expiresAt = num(pair.expiresAt) || (Date.now() + PAIR_TTL);
    app.pair = {
      code: code,
      expiresAt: expiresAt,
      expired: expiresAt <= Date.now(),
      busy: '',
      error: '',
      focus: 'pair-copy'
    };
    renderPair();
    var layer = pairLayerEl();
    var first = layer && layer.querySelector('[data-act="pair-copy"]');
    if (first) {
      try { first.focus({ preventScroll: true }); } catch (err) { /* ignore */ }
    }
  }

  function closePair(refetch) {
    var had = !!app.pair;
    app.pair = null;
    var layer = pairLayerEl();
    if (layer) {
      layer.innerHTML = '';
      layer.hidden = true;
    }
    if (had && refetch !== false) fetchRemote();
  }

  /** Rotate without restarting the listener (the expired state and the settings
   * "生成新配对码" both land here). */
  function rotatePair() {
    var p = app.pair;
    if (!p || p.busy) return;
    p.busy = 'new';
    p.error = '';
    renderPair();
    apiCall('POST', REMOTE_PAIR_URL).then(function (res) {
      if (!app.pair) { fetchRemote(); return; }
      var payload = res.data;
      if (!res.ok || !payload || payload.ok === false || !payload.pair) {
        app.pair.busy = '';
        app.pair.error = res.ok
          ? (payload && payload.error ? String(payload.error) : '没有拿到新的配对码')
          : remoteErrorText(res.status, '生成配对码失败');
        app.pair.focus = 'pair-new';
        renderPair();
        return;
      }
      if (payload.url) {
        app.remote.url = String(payload.url);
        scheduleRender();
      }
      app.pair.busy = '';
      app.pair.error = '';
      app.pair.code = String(payload.pair.code == null ? '' : payload.pair.code).replace(/[^0-9]/g, '');
      app.pair.expiresAt = num(payload.pair.expiresAt) || (Date.now() + PAIR_TTL);
      app.pair.expired = app.pair.expiresAt <= Date.now();
      app.pair.focus = 'pair-copy';
      renderPair();
    }).catch(function () {
      if (!app.pair) return;
      app.pair.busy = '';
      app.pair.error = '网络连接失败，请重试';
      app.pair.focus = 'pair-new';
      renderPair();
    });
  }

  function onPairClick(ev) {
    var target = ev.target;
    if (!target || !target.closest) return;
    var actEl = target.closest('[data-act]');
    if (!actEl) return;
    var act = actEl.getAttribute('data-act');
    var p = app.pair;
    if (!p) return;
    if (act === 'pair-dismiss' || act === 'pair-close') {
      closePair(true);
      return;
    }
    if (act === 'pair-copy') {
      copyText(p.code);
      return;
    }
    if (act === 'pair-copy-url') {
      if (app.remote.url) copyText(app.remote.url);
      else toast('暂时没有可用地址');
      return;
    }
    if (act === 'pair-new') {
      rotatePair();
    }
  }

  function pairFocusables() {
    var layer = pairLayerEl();
    if (!layer) return [];
    return Array.prototype.filter.call(layer.querySelectorAll('button'), function (el) {
      return !el.disabled && el.offsetParent !== null;
    });
  }

  function onPairKeydown(ev) {
    if (!app.pair) return;
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      closePair(true);
      return;
    }
    if (ev.key !== 'Tab') return;
    var list = pairFocusables();
    if (!list.length) return;
    var idx = list.indexOf(document.activeElement);
    var next;
    if (ev.shiftKey) next = idx <= 0 ? list[list.length - 1] : list[idx - 1];
    else next = idx === -1 || idx === list.length - 1 ? list[0] : list[idx + 1];
    ev.preventDefault();
    next.focus({ preventScroll: true });
  }

  function bindPairLayer() {
    var layer = pairLayerEl();
    if (!layer) return;
    layer.addEventListener('click', onPairClick);
    layer.addEventListener('keydown', onPairKeydown);
  }

  /* ---------- built-in desktop capsule (v0.8) ---------- */
  function capsuleErrorText(status) {
    if (status === 403) return '当前来源无权访问胶囊接口';
    if (status === 429) return '操作太频繁，请稍后再试';
    if (status >= 500) return '胶囊服务暂时不可用（HTTP ' + status + '）';
    if (status) return '读取胶囊状态失败（HTTP ' + status + '）';
    return '无法读取胶囊状态，请检查连接';
  }

  function capsuleBridgeNormalize(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var teamRaw = raw.team && typeof raw.team === 'object' ? raw.team : {};
    return {
      running: num(teamRaw.running) || 0,
      total: num(teamRaw.total) || 0,
      approvals: num(raw.approvals) || 0,
      session: raw.session && typeof raw.session === 'object' ? raw.session : null
    };
  }

  /** A heartbeat older than 15s means the capsule process stopped responding —
   * checked against the local clock (tickTimes), never by polling the host. */
  function capsuleHeartbeatStale() {
    var c = app.capsule;
    if (!c.enabled || !c.running || !c.heartbeatAt) return false;
    return Date.now() - c.heartbeatAt > CAPSULE_HEARTBEAT_MS;
  }

  /** Small read-only summary (running agents / pending approvals) from the
   * bridge snapshot; kept separate so an older host still shows capsule state. */
  function fetchCapsuleBridge() {
    var c = app.capsule;
    fetch(HUD_BRIDGE_URL, { headers: { 'Accept': 'application/json' } })
      .then(function (res) {
        if (!res.ok) return null;
        return res.json().catch(function () { return null; });
      })
      .then(function (payload) {
        if (!payload || payload.ok === false) return;
        c.bridge = capsuleBridgeNormalize(payload.bridge);
        scheduleRender();
      })
      .catch(function () {});
  }

  /** One GET when the settings tab opens or after a switch — never on a timer. */
  function fetchCapsule() {
    if (REMOTE_MODE) return;
    var c = app.capsule;
    var seq = ++c.seq;
    fetchCapsuleBridge();   /* summary row comes from the bridge snapshot */
    fetch(CAPSULE_URL, { headers: { 'Accept': 'application/json' } })
      .then(function (res) {
        if (res.status === 404) return { missing: true };
        if (!res.ok) return { fail: true, status: res.status };
        return res.json().catch(function () { return null; }).then(function (payload) {
          return { payload: payload };
        });
      })
      .then(function (out) {
        if (seq !== c.seq) return;
        c.loaded = true;
        if (out.missing) {
          c.available = false;
          c.error = '';
          scheduleRender();
          return;
        }
        if (out.fail) {
          if (out.status === 501) {
            /* 501 = this host cannot run a capsule (non-Windows): keep the card
             * visible but read-only with the switch disabled. */
            c.available = true;
            c.supported = false;
            c.enabled = false;
            c.running = false;
            c.error = '';
            c.actionError = '';
            scheduleRender();
            return;
          }
          c.error = capsuleErrorText(out.status);
          scheduleRender();
          return;
        }
        var payload = out.payload;
        if (!payload || payload.ok === false) {
          if (payload && payload.supported === false) {
            c.available = true;
            c.supported = false;
            c.enabled = false;
            c.running = false;
            c.error = '';
            scheduleRender();
            return;
          }
          c.error = payload && payload.error ? String(payload.error) : '胶囊接口返回异常';
          scheduleRender();
          return;
        }
        c.available = true;
        c.supported = payload.supported !== false;
        c.enabled = payload.enabled === true;
        c.running = payload.running === true;
        c.pid = payload.pid == null ? null : num(payload.pid);
        c.startedAt = num(payload.startedAt) || 0;
        c.statePath = payload.statePath ? String(payload.statePath) : c.statePath;
        c.bridgePath = payload.bridgePath ? String(payload.bridgePath) : c.bridgePath;
        c.scriptPath = payload.scriptPath ? String(payload.scriptPath) : c.scriptPath;
        c.writtenAt = num(payload.writtenAt) || 0;
        c.heartbeatAt = num(payload.heartbeatAt) || 0;
        c.writes = num(payload.writes) || 0;
        c.legacyDetected = payload.legacyDetected === true;
        c.lastError = payload.lastError ? String(payload.lastError) : '';
        c.heartbeatStale = capsuleHeartbeatStale();
        c.error = '';
        scheduleRender();
      })
      .catch(function () {
        if (seq !== c.seq) return;
        c.loaded = true;
        c.error = '无法读取胶囊状态，请检查连接';
        scheduleRender();
      });
  }

  var capsuleRefetchTimer = null;
  /** After enabling, wait for running=true in the next frame: one immediate GET
   * plus (only while still not running) a single follow-up after 1.5s. */
  function capsuleRefetchSoon() {
    if (capsuleRefetchTimer) { clearTimeout(capsuleRefetchTimer); capsuleRefetchTimer = null; }
    capsuleRefetchTimer = setTimeout(function () {
      capsuleRefetchTimer = null;
      if (app.capsule.enabled && !app.capsule.running) fetchCapsule();
    }, 1500);
  }

  function capsuleSummaryText() {
    var b = app.capsule.bridge;
    if (!b) return '';
    return fmtInt(b.running) + ' 个运行中 · ' + fmtInt(b.approvals) + ' 个待审批';
  }

  function capsuleBadgeHTML() {
    var c = app.capsule;
    if (!c.supported) {
      return '<span class="remote-status off"><i aria-hidden="true"></i>不受支持</span>';
    }
    /* v0.8: only an *enabled* capsule with an error is a launch failure; a
     * deliberate stop may still carry an informational lastError from the
     * host, and must read as 已停止 rather than 启动失败. */
    if (c.enabled && c.lastError) {
      return '<span class="remote-status bad"><i aria-hidden="true"></i>启动失败</span>';
    }
    if (c.running) {
      return '<span class="remote-status on"><i aria-hidden="true"></i>运行中' +
        (c.pid ? ' · pid ' + esc(String(c.pid)) : '') + '</span>';
    }
    if (c.enabled) {
      return '<span class="remote-status off"><i aria-hidden="true"></i>启动中</span>';
    }
    return '<span class="remote-status off"><i aria-hidden="true"></i>已停止</span>';
  }

  function capsuleSwitchHTML() {
    var c = app.capsule;
    return '<div class="hud-switch-row">' +
      '<span class="hud-switch-label" id="capsule-switch-label">胶囊进程</span>' +
      '<button class="hud-switch' + (c.enabled ? ' is-on' : '') + '" type="button" role="switch"' +
        ' aria-checked="' + (c.enabled ? 'true' : 'false') + '"' +
        ' aria-labelledby="capsule-switch-label" data-action="capsule-toggle" data-fk="capsule-toggle"' +
        (c.busy || !c.supported ? ' disabled' : '') + '>' +
        (c.busy ? '<span class="spin hud-spin" aria-hidden="true"></span>' : '') +
        '<span class="hud-knob' + (c.busy ? ' is-hidden' : '') + '" aria-hidden="true"></span>' +
      '</button>' +
    '</div>';
  }

  function capsuleToggle() {
    var c = app.capsule;
    if (c.busy || !c.supported || !c.available) return;
    var prev = c.enabled;
    var next = !prev;
    c.busy = true;
    c.actionError = '';
    c.enabled = next;                 /* optimistic: the switch flips immediately */
    c.heartbeatStale = false;
    if (!next) { c.running = false; c.pid = null; c.lastError = ''; }
    c.focus = 'capsule-toggle';
    scheduleRender();
    apiCall('POST', CAPSULE_URL, { enabled: next }).then(function (res) {
      c.busy = false;
      var payload = res.data;
      if (res.status === 501 || (payload && payload.supported === false)) {
        c.supported = false;
        c.enabled = false;
        c.running = false;
        c.actionError = '';
        c.focus = '';
        scheduleRender();
        return;
      }
      if (!res.ok || !payload || payload.ok === false) {
        c.enabled = prev;             /* roll the switch back on failure */
        c.heartbeatStale = capsuleHeartbeatStale();
        c.actionError = '设置失败，请重试';
        c.focus = 'capsule-toggle';
        scheduleRender();
        return;
      }
      c.supported = payload.supported !== false;
      c.enabled = payload.enabled === true;
      c.running = payload.running === true;
      c.pid = payload.pid == null ? null : num(payload.pid);
      c.startedAt = num(payload.startedAt) || 0;
      c.writtenAt = num(payload.writtenAt) || c.writtenAt;
      c.heartbeatAt = num(payload.heartbeatAt) || c.heartbeatAt;
      c.writes = num(payload.writes) || c.writes;
      c.legacyDetected = payload.legacyDetected === true;
      c.lastError = payload.lastError ? String(payload.lastError) : '';
      c.heartbeatStale = capsuleHeartbeatStale();
      c.actionError = '';
      c.focus = 'capsule-toggle';
      scheduleRender();
      if (c.enabled) capsuleRefetchSoon();   /* wait for running=true in a later frame */
      else fetchCapsuleBridge();
    }).catch(function () {
      c.busy = false;
      c.enabled = prev;
      c.heartbeatStale = capsuleHeartbeatStale();
      c.actionError = '设置失败，请重试';
      c.focus = 'capsule-toggle';
      scheduleRender();
    });
  }

  function capsuleCopyPath() {
    if (!app.capsule.statePath) { toast('暂时没有状态文件路径'); return; }
    copyText(app.capsule.statePath);
  }

  /** Desktop settings card: "桌面胶囊" — sits right after 远程接管. */
  function capsuleSectionHTML() {
    if (REMOTE_MODE) return '';
    var c = app.capsule;
    if (!c.available) return '';
    var head = '<div class="remote-head hud-head"><h3>桌面胶囊</h3>' + capsuleBadgeHTML() + '</div>';
    var note = '<p class="set-note hud-note">胶囊已内置，开箱即用</p>';
    if (!c.loaded) {
      return '<div class="card set-card hud-card">' + head + note +
        '<p class="set-note hud-loading">正在读取胶囊状态…</p>' +
      '</div>';
    }
    if (c.error) {
      return '<div class="card set-card hud-card" data-capsule="error">' + head + note +
        '<div class="hud-err-row" role="alert"><span>' + esc(c.error) + '</span>' +
          '<button class="remote-mini hud-retry" type="button" data-action="capsule-retry" data-fk="capsule-retry">重试</button>' +
        '</div>' +
      '</div>';
    }
    if (!c.supported) {
      return '<div class="card set-card hud-card" data-capsule="unsupported">' + head + note +
        '<p class="set-note hud-loading">当前系统不支持胶囊（仅 Windows 可用）；不会影响指挥台本身。</p>' +
        capsuleSwitchHTML() +
      '</div>';
    }
    var summary = capsuleSummaryText();
    return '<div class="card set-card hud-card" data-capsule="' +
      (c.running ? 'running' : c.enabled ? 'starting' : 'stopped') + '">' +
      head +
      note +
      (c.enabled && c.lastError ? '<p class="hud-fail" role="alert">' + esc(c.lastError) + '</p>' : '') +
      '<div class="kv hud-kv"><span>最近状态帧</span><b class="hud-rel" data-rel-at="' +
        (c.writtenAt ? esc(String(c.writtenAt)) : '') + '">' +
        esc(c.writtenAt ? ago(c.writtenAt) : '—') + '</b></div>' +
      '<div class="kv hud-kv"><span>胶囊心跳</span>' +
        (c.heartbeatStale
          ? '<b class="hud-heart is-bad">胶囊未响应</b>'
          : '<b class="hud-rel" data-rel-at="' + (c.heartbeatAt ? esc(String(c.heartbeatAt)) : '') + '">' +
            esc(c.heartbeatAt ? ago(c.heartbeatAt) : '—') + '</b>') +
      '</div>' +
      '<div class="kv hud-kv"><span>数据摘要</span><b class="hud-sum">' + esc(summary || '暂无数据') + '</b></div>' +
      '<button class="hud-path" type="button" data-action="capsule-copy-path" title="点击复制状态文件路径">' +
        '<span class="hud-path-label">状态文件</span>' +
        '<code>' + esc(c.statePath || '—') + '</code>' +
        '<span class="remote-copy">' + ICON_LINK + '复制</span>' +
      '</button>' +
      capsuleSwitchHTML() +
      (c.actionError ? '<p class="hud-err" role="alert">' + esc(c.actionError) + '</p>' : '') +
      (c.legacyDetected
        ? '<div class="hud-warn" role="status">检测到旧版桌面 HUD 仍在运行，请先停用它以免重叠</div>'
        : '') +
    '</div>';
  }

  /* ---------- v1.1: settings diagnostics ---------------------------------- */
  function diagBadgeHTML() {
    var d = app.diag;
    if (d.busy) return '<span class="remote-status off"><i aria-hidden="true"></i>检查中</span>';
    if (!d.loaded) return '<span class="remote-status off">未自检</span>';
    if (d.status === 'ok') return '<span class="remote-status on"><i aria-hidden="true"></i>正常</span>';
    if (d.status === 'warn') return '<span class="diag-status warn">有提醒</span>';
    return '<span class="diag-status fail">有异常</span>';
  }

  /** Desktop settings card: "自检与诊断" - a one-click local self-check whose
   * report can be pasted into a bug report (read-only; never changes state). */
  function diagnosticsCardHTML() {
    if (REMOTE_MODE) return '';
    var d = app.diag;
    var head = '<div class="remote-head diag-head"><h3>自检与诊断</h3>' + diagBadgeHTML() + '</div>';
    var note = '<p class="set-note diag-note">出问题时先跑一次自检，把报告贴给维护者。</p>';
    var actions = '<div class="set-actions diag-actions">' +
      '<button class="remote-btn" type="button" data-action="diag-run" data-fk="diag-run"' + (d.busy ? ' disabled' : '') + '>' +
        (d.busy ? '<span class="spin" aria-hidden="true"></span>检查中…' : (d.loaded ? '重新自检' : '运行自检')) +
      '</button>' +
      (d.report
        ? '<button class="remote-btn primary" type="button" data-action="diag-copy" data-fk="diag-copy">复制报告</button>'
        : '') +
    '</div>';
    var body;
    if (d.error) {
      body = '<p class="hud-fail" role="alert">' + esc(d.error) + '</p>';
    } else if (!d.loaded) {
      body = '<p class="set-note diag-loading">检查插件接口、桌面胶囊、HUD 数据桥与远程接管是否正常。</p>';
    } else {
      body = '<div class="diag-rows">' + d.checks.map(function (c) {
        return '<div class="diag-row" data-status="' + esc(c.status) + '">' +
          '<b class="diag-dot ' + esc(c.status) + '" aria-hidden="true"></b>' +
          '<span class="diag-label">' + esc(c.label) + '</span>' +
          '<span class="diag-detail">' + esc(c.detail) + '</span>' +
        '</div>';
      }).join('') + '</div>' +
        '<p class="set-note diag-meta">生成于 ' + esc(ago(d.generatedAt)) + ' · 插件 v' + esc(d.version) + '</p>' +
        '<details class="diag-report"><summary>查看完整报告</summary><pre>' + esc(d.report) + '</pre></details>';
    }
    return '<div class="card set-card diag-card" data-diag="' + esc(d.status) + '">' +
      head + note + body + actions +
    '</div>';
  }

  /** One GET on the button click (never on a timer). */
  function fetchDiagnostics() {
    if (REMOTE_MODE) return;
    var d = app.diag;
    var seq = ++d.seq;
    d.busy = true;
    d.error = '';
    scheduleRender();
    fetch(DIAG_URL, { headers: { 'Accept': 'application/json' } })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (payload) {
        if (seq !== d.seq) return;
        d.busy = false;
        d.loaded = true;
        if (!payload || payload.ok === false) {
          d.error = '自检接口返回异常';
          scheduleRender();
          return;
        }
        d.status = String(payload.status || 'warn');
        d.version = String(payload.version || '');
        d.generatedAt = num(payload.generatedAt) || Date.now();
        d.checks = arr(payload.checks).map(function (c) {
          return {
            id: String((c && c.id) || ''),
            label: String((c && c.label) || ''),
            status: String((c && c.status) || 'warn'),
            detail: String((c && c.detail) || '')
          };
        }).filter(function (c) { return c.label !== ''; });
        d.report = String(payload.report || '');
        scheduleRender();
      })
      .catch(function (err) {
        if (seq !== d.seq) return;
        d.busy = false;
        d.loaded = true;
        d.error = '自检失败：' + (err && err.message ? err.message : '网络错误');
        scheduleRender();
      });
  }

  function diagCopyReport() {
    if (!app.diag.report) {
      toast('还没有可复制的报告，先运行一次自检');
      return;
    }
    copyText(app.diag.report);
  }

  /* ---------- v0.9: approval notifications ---------- */
  function notifySupported() {
    return typeof window.Notification !== 'undefined' && typeof window.Notification.requestPermission === 'function';
  }

  function notifyPermission() {
    if (!notifySupported()) return 'unsupported';
    try {
      return window.Notification.permission || 'default';
    } catch (e) {
      return 'unsupported';
    }
  }

  function notifSectionHTML() {
    if (REMOTE_MODE) return '';
    var n = app.notify;
    var perm = notifyPermission();
    var badgeCls = 'off';
    var badgeText = '未开启';
    var body = '';
    if (perm === 'unsupported') {
      badgeText = '不支持';
      body = '<p class="set-note notif-note">当前浏览器不支持通知。</p>' +
        '<div class="set-actions notif-actions">' +
          '<button class="remote-btn notif-btn" type="button" disabled>浏览器不支持通知</button>' +
        '</div>';
    } else if (perm === 'denied') {
      badgeCls = 'bad';
      badgeText = '已拒绝';
      body = '<p class="set-note notif-note">浏览器已拒绝通知，请在站点设置里重新允许。</p>' +
        '<div class="set-actions notif-actions">' +
          '<button class="remote-btn notif-btn" type="button" disabled>通知已被拒绝</button>' +
        '</div>';
    } else if (perm === 'granted') {
      badgeCls = 'on';
      badgeText = '已开启';
      body = '<p class="set-note notif-note">审批到达而页面在后台时会弹出系统通知。</p>' +
        '<div class="set-actions notif-actions">' +
          '<button class="remote-btn notif-btn" type="button" data-action="notif-test" data-fk="notif-test"' +
            (n.busy ? ' disabled' : '') + '>' + (n.busy ? '发送中…' : '发送测试通知') + '</button>' +
        '</div>';
    } else {
      body = '<p class="set-note notif-note">开启后，审批到达而页面在后台时会弹出系统通知。</p>' +
        '<div class="set-actions notif-actions">' +
          '<button class="remote-btn primary notif-btn" type="button" data-action="notif-enable" data-fk="notif-enable"' +
            (n.busy ? ' disabled' : '') + '>' +
            (n.busy ? '<span class="spin" aria-hidden="true"></span>请求中…' : '开启通知') + '</button>' +
        '</div>';
    }
    return '<div class="card set-card notif-card" data-notif="' + esc(perm) + '">' +
      '<div class="remote-head"><h3>通知</h3>' +
        '<span class="remote-status ' + badgeCls + '"><i aria-hidden="true"></i>' + esc(badgeText) + '</span>' +
      '</div>' +
      body +
      (n.error ? '<p class="remote-pub-err" role="alert">' + esc(n.error) + '</p>' : '') +
    '</div>';
  }

  function notifEnable() {
    var n = app.notify;
    if (n.busy) return;
    if (!notifySupported()) {
      n.error = '当前浏览器不支持通知';
      scheduleRender();
      return;
    }
    n.busy = true;
    n.error = '';
    scheduleRender();
    var settled = false;
    var done = function (perm) {
      if (settled) return;
      settled = true;
      n.busy = false;
      var now = perm || notifyPermission();
      n.error = now === 'denied' ? '通知已被浏览器拒绝' : '';
      app.notify.focus = 'notif-enable';
      scheduleRender();
      if (now === 'granted') toast('通知已开启');
    };
    try {
      var ret = window.Notification.requestPermission(function (perm) { done(perm); });
      if (ret && typeof ret.then === 'function') {
        ret.then(function (perm) { done(perm); }, function () {
          if (settled) return;
          settled = true;
          n.busy = false;
          n.error = '请求通知权限失败';
          scheduleRender();
        });
      }
    } catch (e) {
      if (!settled) {
        settled = true;
        n.busy = false;
        n.error = '请求通知权限失败';
        scheduleRender();
      }
    }
  }

  function notifTest() {
    var n = app.notify;
    if (notifyPermission() !== 'granted') {
      n.error = '通知权限尚未开启';
      scheduleRender();
      return;
    }
    n.error = '';
    try {
      var pop = new window.Notification('Cockpit 测试通知', {
        body: '通知已就绪：审批到达且页面在后台时会提醒你。',
        tag: 'cockpit-test'
      });
      pop.onclick = function () {
        try { window.focus(); } catch (e) { /* ignore */ }
        pop.close();
      };
      toast('已发送测试通知');
    } catch (e) {
      n.error = '发送通知失败';
      scheduleRender();
    }
  }

  /** v0.9: fire one system notification per previously-unseen approval, background only. */
  function approvalNotify(list) {
    if (notifyPermission() !== 'granted') return;
    if (!document.hidden) return;
    arr(list).forEach(function (a) {
      var id = approvalId(a);
      if (!id) return;
      var tool = approvalTool(a) || {};
      var label = tool.label || '待审批';
      var reason = a && (a.reason || a.detail || a.description);
      var body = reason ? String(reason) : '有新的审批请求';
      var pop;
      try {
        pop = new window.Notification('需要你确认 · ' + label, {
          body: body,
          tag: 'cockpit-approval-' + id,
          renotify: true
        });
      } catch (e) {
        return;
      }
      pop.onclick = function () {
        try { window.focus(); } catch (err) { /* ignore */ }
        pop.close();
      };
    });
  }

  /* ---------- settings shared cards (desktop page + mobile sheet) ---------- */
  function connectionCardHTML() {
    return '<div class="card set-card conn-card" data-conn="' + (app.connected ? 'on' : 'off') + '">' +
      '<div class="remote-head"><h3>数据连接</h3>' +
        '<span class="remote-status ' + (app.connected ? 'on' : 'off') + '"><i aria-hidden="true"></i>' +
          (app.connected ? '已连接' : '重连中') + '</span>' +
      '</div>' +
      '<div class="kv"><span>实时流</span><b class="' + (app.connected ? 'ok' : 'warn') + '">' + (app.connected ? '已连接' : '重连中') + '</b></div>' +
      '<div class="kv"><span>数据接口</span><code>./api/state</code></div>' +
      '<div class="kv"><span>最近事件</span><b>' + (app.lastEventAt ? ago(app.lastEventAt) : '—') + '</b></div>' +
      '<div class="kv"><span>地址</span><code>' + esc(location.host || 'localhost') + '</code></div>' +
    '</div>';
  }

  function aliasCardHTML() {
    var ms = orderedMembers();
    var rows = ms.length ? ms.map(function (m) {
      var meta = memberMeta(m);
      return '<div class="alias-row">' +
        '<span class="mini av-' + meta.color + '">' + esc(meta.letter) + '</span>' +
        '<div class="alias-info"><b>' + esc(meta.display) + '</b><span>' + esc(meta.real) + '</span></div>' +
        (meta.alias
          ? '<button class="alias-reset" data-action="alias-reset" data-id="' + esc(m.id) + '">恢复默认</button>'
          : '<span class="alias-default">默认</span>') +
      '</div>';
    }).join('') : '<p class="set-note">编队尚未集结，暂无成员别名。</p>';
    return '<div class="card set-card alias-card">' +
      '<div class="remote-head"><h3>成员别名</h3></div>' + rows +
      '<p class="set-note">双击成员名或点击 ✎ 即可重命名；留空提交会恢复默认称呼。</p>' +
    '</div>';
  }

  function aboutCardHTML() {
    var s = session();
    return '<div class="card set-card about-card">' +
      '<div class="remote-head"><h3>关于</h3></div>' +
      '<p class="set-about">Cockpit 是 DeepSeek Harness 的实时指挥台，把编队状态、任务板与活动流收进一屏。</p>' +
      '<div class="kv"><span>版本</span><b>cockpit v' + esc(data().version || '0.1') + '</b></div>' +
      '<div class="kv"><span>适配</span><b>DeepSeek Harness</b></div>' +
      '<div class="kv"><span>会话</span><b>' + esc(s && s.title || '暂无运行中会话') + '</b></div>' +
    '</div>';
  }

  /** v0.7: the desktop settings page reached from the header gear. */
  function desktopSettingsHTML() {
    return '<section class="d-settings" aria-label="设置">' +
      '<div class="d-settings-head">' +
        '<h2>设置</h2>' +
        '<span class="v">cockpit v' + esc(data().version || '0.1') + '</span>' +
        '<button class="d-settings-x" type="button" data-action="settings-toggle" title="返回概览">返回概览</button>' +
      '</div>' +
      '<div class="d-settings-cols">' +
        '<div class="d-settings-col">' +
          connectionCardHTML() +
          remoteSectionHTML() +
          pwaSectionHTML() +
        '</div>' +
        '<div class="d-settings-col">' +
          capsuleSectionHTML() +
          diagnosticsCardHTML() +
          notifSectionHTML() +
          aliasCardHTML() +
          aboutCardHTML() +
        '</div>' +
      '</div>' +
    '</section>';
  }

  /* ---------- mobile-only sections ---------- */
  function mobileExtrasHTML() {
    if (!session()) return '';
    return heroHTML() + approvalsHTML('m-approvals') + cardsHTML('m-cards') +
      doingHTML() + streamCardHTML('m-stream') + riskCardHTML('m-files');
  }

  function heroHTML() {
    var s = session();
    if (!s) return '';
    var pct = sessionPercent();
    var done = num(s.completed), total = num(s.total);
    var stats = s.stats || {};
    var noTitle = !String(s.title == null ? '' : s.title).trim();
    var plan = s.plan && Array.isArray(s.plan.steps) ? s.plan.steps : [];
    if (!(total > 0) && !plan.length) {
      return '<section class="m-hero standby">' +
        '<div class="top"><span class="t">' + esc(noTitle ? '新的会话' : s.title) + '</span><span class="c">待命</span></div>' +
        '<div class="num"><b>待命</b><span>等待第一条指令</span></div>' +
        '<div class="strip"><span>本轮 ' + fmtTokens(stats.tokens) + ' tokens</span><span>·</span>' +
          '<span>' + fmtInt(stats.turns) + ' turns</span><span class="sp"></span>' +
          '<span data-elapsed>' + fmtDur(currentElapsed()) + '</span></div>' +
      '</section>';
    }
    var title = noTitle ? '未命名会话' : s.title;
    var big = total != null ? (done == null ? 0 : done) + '/' + total : (pct == null ? '—' : pct + '%');
    var sub = total != null ? '步 · ' + (pct == null ? '—' : pct) + '% 完成' : '完成度';
    return '<section class="m-hero">' +
      '<div class="top"><span class="t">' + esc(title) + '</span>' +
        '<span class="c">turn ' + esc(s.turn == null ? '—' : s.turn) + '</span></div>' +
      '<div class="num"><b>' + esc(big) + '</b><span>' + esc(sub) + '</span></div>' +
      '<div class="liquid"><i style="width:' + (pct == null ? 0 : pct) + '%"></i></div>' +
      '<div class="strip"><span>本轮 ' + fmtTokens(stats.tokens) + ' tokens</span><span>·</span>' +
        '<span>' + fmtInt(stats.turns) + ' turns</span><span class="sp"></span>' +
        '<span data-elapsed>' + fmtDur(currentElapsed()) + '</span></div>' +
    '</section>';
  }

  function doingHTML() {
    var list = tasks();
    var fromPlan = false;
    if (!list.length) {
      list = plannedTasks();
      fromPlan = list.length > 0;
    }
    var doing = list.filter(function (t) { return t && t.status === 'in_progress'; });
    var pending = fromPlan ? list.filter(function (t) { return t && t.status === 'pending'; }).slice(0, 2) : [];
    var shown = doing.concat(pending);
    return '<section class="m-doing">' +
      '<div class="sec"><b>' + (fromPlan ? '本轮计划' : '进行中') + '</b><span class="n">' + (fromPlan ? list.length : doing.length) + '</span>' +
        '<button class="more" data-action="tab" data-tab="tasks">查看任务板 ›</button></div>' +
      '<div class="tasks">' +
        (shown.length ? shown.map(taskCardHTML).join('') : '<div class="col-empty">暂无进行中的任务</div>') +
      '</div>' +
    '</section>';
  }

  function mobileSettingsHTML() {
    return '<section class="m-settings">' +
      '<div class="m-page-head"><h2>设置</h2><span>cockpit v' + esc(data().version || '0.1') + '</span></div>' +
      connectionCardHTML() +
      remoteSectionHTML() +
      pwaSectionHTML() +
      capsuleSectionHTML() +
      diagnosticsCardHTML() +
      notifSectionHTML() +
      aliasCardHTML() +
      aboutCardHTML() +
    '</section>';
  }

  /* ---------- status bar & tab bar ---------- */
  function statusbarHTML() {
    var s = session();
    var stats = (s && s.stats) || {};
    var pct = sessionPercent();
    var caps = members().length;
    var sessCount = sessionsList().length;
    var host = location.hostname || 'localhost';
    if (host === '127.0.0.1' || host === '::1' || host === '0.0.0.0') host = 'localhost';
    return '<footer class="statusbar">' +
      '<span class="sb-item">今日 <b>' + fmtTokens(stats.tokens) + '</b> tokens</span>' +
      '<span class="sb-item">本轮 <b data-elapsed>' + fmtDur(currentElapsed()) + '</b>' + (pct == null ? '' : ' · ' + pct + '%') + '</span>' +
      '<span class="sb-item"><b>' + caps + '</b> ' + (caps === 1 ? 'agent' : 'agents') + ' · <b>' + sessCount + '</b> ' + (sessCount === 1 ? 'session' : 'sessions') + '</span>' +
      '<span class="sb-item">cockpit v' + esc(data().version || '0.1') + '</span>' +
      '<span class="sp"></span>' +
      '<span class="conn' + (app.connected ? '' : ' off') + '"><i></i>' + (app.connected ? '已连接' : '重连中') + ' ' + esc(host) + '</span>' +
    '</footer>';
  }

  function tabbarHTML() {
    var icons = {
      overview: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="10" cy="10" r="6.4"/><circle cx="10" cy="10" r="2.3" fill="currentColor" stroke="none"/></svg>',
      tasks: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M4 6h12M4 10h12M4 14h7"/></svg>',
      settings: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" aria-hidden="true"><circle cx="10" cy="10" r="2.6"/><path d="M10 3.2v1.7M10 15.1v1.7M16.8 10h-1.7M4.9 10H3.2M14.8 5.2l-1.2 1.2M6.4 13.6l-1.2 1.2M14.8 14.8l-1.2-1.2M6.4 6.4 5.2 5.2"/></svg>'
    };
    var labels = { overview: '概览', tasks: '任务', settings: '设置' };
    return '<nav class="tabbar" aria-label="主导航">' +
      TABS.map(function (tab) {
        return '<button class="tab' + (app.tab === tab ? ' active' : '') + '" data-action="tab" data-tab="' + tab + '"' +
          (app.tab === tab ? ' aria-current="page"' : '') + '>' +
          '<span class="ic">' + icons[tab] + '</span><span>' + labels[tab] + '</span>' +
        '</button>';
      }).join('') +
    '</nav>';
  }

  /* ---------- v0.4 write actions: message composer + interrupt ---------- */
  function postAction(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (payload) {
        return { ok: res.ok, status: res.status, data: payload };
      });
    });
  }

  /** Pull a fresh projection after an action; the SSE stream is not guaranteed to
   * push a frame for host-side writes, so the deck asks once and reconciles. */
  function refreshState() {
    fetch(stateURL(), { headers: { 'Accept': 'application/json' } })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (payload) { applyState(payload); })
      .catch(function () { /* the stream will reconcile when it can */ });
  }

  function findSessionById(id) {
    var list = sessionsList();
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === id) return list[i];
    }
    return session() && session().id === id ? session() : null;
  }

  function sessionIsRunning(id) {
    var s = findSessionById(id);
    if (s && s.running) return true;
    var m = findMember(id);
    return !!m && statusCls(m) === 'running';
  }

  /* v0.4.1: the host marks sessions it can actually write to. "live" defaults
   * to true, so an unknown target keeps the affordance; only an explicit
   * `live: false` (a session without a writable agent yet) gates sending. */
  function sessionLive(id) {
    var s = findSessionById(id);
    return s ? s.live !== false : true;
  }

  function composeTrigger(kind, refId) {
    return document.querySelector('[data-action="compose"][data-compose="' + esc(kind + ':' + refId) + '"]');
  }

  function isSheetMode() {
    return !!(window.matchMedia && window.matchMedia('(max-width: 759px)').matches);
  }

  function composePanelHTML(c) {
    var running = sessionIsRunning(c.sessionId);
    return '<div class="compose-scrim" data-act="compose-dismiss" aria-hidden="true"></div>' +
      '<div class="compose" id="compose-panel" role="dialog" aria-modal="true" aria-labelledby="compose-title">' +
        '<div class="compose-head">' +
          '<span class="compose-ico" aria-hidden="true">' + ICON_MSG + '</span>' +
          '<div class="compose-who">' +
            '<b id="compose-title">发消息给 ' + esc(c.name || '该 agent') + '</b>' +
            '<span class="compose-sub" title="' + esc(c.sessionId) + '">' + esc(c.sessionId) + ' · ' + (running ? '运行中' : '空闲') + '</span>' +
          '</div>' +
          '<button class="compose-x" type="button" data-act="compose-cancel" aria-label="关闭发消息面板" title="关闭（Esc）">' +
            '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>' +
          '</button>' +
        '</div>' +
        '<textarea class="compose-input" id="compose-input" rows="2" maxlength="' + COMPOSE_LIMIT + '" spellcheck="false"' +
          ' placeholder="输入要发送给 ' + esc(c.name || '该 agent') + ' 的消息…" aria-label="消息内容"></textarea>' +
        '<div class="compose-modes" role="radiogroup" aria-label="发送方式">' +
          '<button class="cmode" type="button" role="radio" aria-checked="true" data-act="compose-mode" data-mode="queue" title="当前轮结束后送达">' +
            '<b>排队</b><span>当前轮结束后送达</span>' +
          '</button>' +
          '<button class="cmode steer" type="button" role="radio" aria-checked="false" data-act="compose-mode" data-mode="steer" title="打断当前轮，立即插话">' +
            '<b>插入</b><span>打断当前轮 · 立即插话</span>' +
          '</button>' +
        '</div>' +
        '<div class="compose-err" role="alert" hidden></div>' +
        '<div class="compose-foot">' +
          '<span class="compose-count" data-compose-count><b>0</b><span>/' + COMPOSE_LIMIT + '</span></span>' +
          '<span class="compose-kbd">Ctrl/⌘ + Enter 发送</span>' +
          '<span class="sp"></span>' +
          '<button class="cbtn ghost" type="button" data-act="compose-cancel">取消</button>' +
          '<button class="cbtn primary" type="button" data-act="compose-send" disabled>发送</button>' +
        '</div>' +
      '</div>';
  }

  function openComposer(opts) {
    if (!opts || !opts.sessionId) return;
    if (app.compose) closeComposer(false);
    app.compose = {
      key: opts.kind + ':' + opts.refId,
      kind: opts.kind,
      refId: opts.refId,
      sessionId: opts.sessionId,
      name: opts.name || '',
      text: '',
      mode: 'queue',
      busy: false,
      error: '',
      retry: false
    };
    var layer = composeLayerEl();
    if (!layer) return;
    layer.hidden = false;
    layer.innerHTML = composePanelHTML(app.compose);
    syncComposeUI();
    if (isSheetMode()) positionSheet(); else positionComposer();
    var ta = document.getElementById('compose-input');
    if (ta) {
      ta.focus({ preventScroll: true });
      try { ta.setSelectionRange(0, 0); } catch (err) { /* ignore */ }
    }
  }

  function closeComposer(restoreFocus) {
    var c = app.compose;
    if (!c) return;
    app.compose = null;
    var layer = composeLayerEl();
    if (layer) {
      layer.innerHTML = '';
      layer.hidden = true;
    }
    if (restoreFocus) {
      var trigger = composeTrigger(c.kind, c.refId);
      if (trigger) trigger.focus({ preventScroll: true });
    }
  }

  function composeLayerEl() {
    return document.getElementById('compose-layer');
  }

  /* Follow the card the composer belongs to; close if that card disappeared. */
  function syncComposerAnchor() {
    if (!app.compose) return;
    if (!composeTrigger(app.compose.kind, app.compose.refId)) {
      closeComposer(false);
      return;
    }
    if (isSheetMode()) positionSheet(); else positionComposer();
  }

  function positionComposer() {
    var layer = composeLayerEl();
    var panel = layer && layer.querySelector('.compose');
    if (!panel || isSheetMode()) return;
    var trigger = app.compose && composeTrigger(app.compose.kind, app.compose.refId);
    if (!trigger) return;
    var anchor = trigger.closest('.agent, .sess-row, .sess') || trigger;
    var a = anchor.getBoundingClientRect();
    var width = panel.offsetWidth || 352;
    var height = panel.offsetHeight || 300;
    var vw = document.documentElement.clientWidth;
    var vh = document.documentElement.clientHeight;
    var margin = 10;
    var left = Math.min(a.left, vw - width - margin);
    left = Math.max(margin, left);
    var top = a.bottom + 8;
    if (top + height > vh - margin) {
      var above = a.top - height - 8;
      top = above >= margin ? above : Math.max(margin, vh - height - margin);
    }
    panel.style.left = Math.round(left) + 'px';
    panel.style.top = Math.round(top) + 'px';
    panel.style.bottom = '';
    panel.style.right = '';
  }

  function positionSheet() {
    var layer = composeLayerEl();
    var panel = layer && layer.querySelector('.compose');
    if (!panel) return;
    var tabbar = document.querySelector('.tabbar');
    var h = tabbar && tabbar.offsetParent !== null ? tabbar.getBoundingClientRect().height : 0;
    panel.style.left = '';
    panel.style.top = '';
    panel.style.right = '';
    panel.style.bottom = Math.max(0, Math.round(h)) + 'px';
  }

  function syncComposeUI() {
    var c = app.compose;
    if (!c) return;
    var layer = composeLayerEl();
    if (!layer) return;
    var ta = layer.querySelector('.compose-input');
    if (ta && ta.value !== c.text) ta.value = c.text;
    var count = layer.querySelector('[data-compose-count] b');
    if (count) count.textContent = String(c.text.length);
    var countWrap = layer.querySelector('[data-compose-count]');
    if (countWrap) {
      countWrap.classList.toggle('is-warn', c.text.length > 3600 && c.text.length < COMPOSE_LIMIT);
      countWrap.classList.toggle('is-full', c.text.length >= COMPOSE_LIMIT);
    }
    var panel = layer.querySelector('.compose');
    if (panel) panel.classList.toggle('mode-steer', c.mode === 'steer');
    layer.querySelectorAll('[data-act="compose-mode"]').forEach(function (btn) {
      var on = btn.getAttribute('data-mode') === c.mode;
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-checked', on ? 'true' : 'false');
      btn.disabled = !!c.busy;
    });
    var send = layer.querySelector('[data-act="compose-send"]');
    if (send) send.disabled = !!c.busy || !c.text.trim();
    growComposeInput();
    if (isSheetMode()) positionSheet(); else positionComposer();
  }

  /** Textarea grows from 2 to 4 lines, then scrolls. */
  function growComposeInput() {
    var layer = composeLayerEl();
    var ta = layer && layer.querySelector('.compose-input');
    if (!ta) return;
    var lineHeight = parseFloat(window.getComputedStyle(ta).lineHeight) || 20;
    var max = lineHeight * 4 + 2;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight || 0, max) + 'px';
    ta.style.overflowY = (ta.scrollHeight || 0) > max ? 'auto' : 'hidden';
  }

  function setComposeBusy(busy) {
    var c = app.compose;
    if (!c) return;
    c.busy = !!busy;
    var layer = composeLayerEl();
    if (!layer) return;
    layer.querySelectorAll('button').forEach(function (btn) { btn.disabled = c.busy; });
    var ta = layer.querySelector('.compose-input');
    if (ta) ta.readOnly = c.busy;
    var panel = layer.querySelector('.compose');
    if (panel) panel.classList.toggle('is-busy', c.busy);
    var send = layer.querySelector('[data-act="compose-send"]');
    if (send) {
      send.innerHTML = c.busy ? '<span class="spin" aria-hidden="true"></span>发送中' : '发送';
      send.disabled = c.busy || !c.text.trim();
    }
    if (!c.busy) syncComposeUI();
  }

  function showComposeError(message, retry) {
    var layer = composeLayerEl();
    var box = layer && layer.querySelector('.compose-err');
    if (!box) return;
    box.innerHTML = '<span>' + esc(message) + '</span>' +
      (retry ? '<button class="cbtn tiny" type="button" data-act="compose-retry">重试</button>' : '');
    box.hidden = false;
  }

  function clearComposeError() {
    var layer = composeLayerEl();
    var box = layer && layer.querySelector('.compose-err');
    if (box) {
      box.hidden = true;
      box.innerHTML = '';
    }
  }

  function focusComposeInput() {
    var ta = document.getElementById('compose-input');
    if (ta && !ta.readOnly) ta.focus({ preventScroll: true });
  }

  function sendCompose() {
    var c = app.compose;
    if (!c || c.busy) return;
    var text = c.text.replace(/\s+$/, '');
    if (!text.trim()) {
      showComposeError('消息不能为空', false);
      focusComposeInput();
      return;
    }
    clearComposeError();
    setComposeBusy(true);
    postAction(SEND_URL, { sessionId: c.sessionId, text: text, mode: c.mode }).then(function (res) {
      if (!app.compose) return;
      if (res.ok) {
        var mode = c.mode;
        toast(mode === 'steer' ? '已发送 · 插入当前轮' : '已发送');
        closeComposer(true);
        refreshState();
        return;
      }
      setComposeBusy(false);
      if (res.status === 404) showComposeError('找不到该会话，可能已关闭', false);
      else if (res.status === 409) showComposeError('该会话当前无法接收消息', false);
      else if (res.status === 400) showComposeError('消息为空或内容不合法，请调整后重试', false);
      else showComposeError('发送失败（HTTP ' + res.status + '）', true);
      focusComposeInput();
      if (res.status === 404 || res.status === 409) refreshState();
    }).catch(function () {
      if (!app.compose) return;
      setComposeBusy(false);
      showComposeError('网络连接失败，消息未发送', true);
      focusComposeInput();
    });
  }

  function onComposeClick(ev) {
    var target = ev.target;
    if (!target || !target.closest) return;
    var actEl = target.closest('[data-act]');
    if (!actEl) return;
    var act = actEl.getAttribute('data-act');
    var c = app.compose;
    if (!c) return;
    if (act === 'compose-cancel' || act === 'compose-dismiss') {
      if (c.busy) return;
      closeComposer(true);
      return;
    }
    if (act === 'compose-mode') {
      if (c.busy) return;
      var mode = actEl.getAttribute('data-mode');
      if (mode !== 'queue' && mode !== 'steer') return;
      c.mode = mode;
      syncComposeUI();
      actEl.focus({ preventScroll: true });
      return;
    }
    if (act === 'compose-send') { sendCompose(); return; }
    if (act === 'compose-retry') { clearComposeError(); sendCompose(); }
  }

  function onComposeInput(ev) {
    var c = app.compose;
    if (!c) return;
    var target = ev.target;
    if (!target || !target.classList || !target.classList.contains('compose-input')) return;
    c.text = target.value.slice(0, COMPOSE_LIMIT);
    clearComposeError();
    syncComposeUI();
  }

  function composeFocusables() {
    var layer = composeLayerEl();
    if (!layer) return [];
    return Array.prototype.filter.call(layer.querySelectorAll('button, textarea'), function (el) {
      return !el.disabled && el.offsetParent !== null;
    });
  }

  function onComposeKeydown(ev) {
    var c = app.compose;
    if (!c) return;
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      if (!c.busy) closeComposer(true);
      return;
    }
    if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') {
      ev.preventDefault();
      ev.stopPropagation();
      sendCompose();
      return;
    }
    if (ev.key !== 'Tab') return;
    var list = composeFocusables();
    if (!list.length) return;
    var idx = list.indexOf(document.activeElement);
    var next;
    if (ev.shiftKey) next = idx <= 0 ? list[list.length - 1] : list[idx - 1];
    else next = idx === -1 || idx === list.length - 1 ? list[0] : list[idx + 1];
    ev.preventDefault();
    next.focus({ preventScroll: true });
  }

  function bindComposeLayer() {
    var layer = composeLayerEl();
    if (!layer) return;
    layer.addEventListener('click', onComposeClick);
    layer.addEventListener('input', onComposeInput);
    layer.addEventListener('keydown', onComposeKeydown);
  }

  function armInterrupt(key) {
    if (!key || app.ir.key === key || app.ir.busy) return;
    app.ir.key = key;
    app.ir.busy = false;
    app.ir.error = '';
    app.ir.focus = true;
    scheduleRender();
  }

  function cancelInterrupt() {
    if (!app.ir.key) return;
    app.ir.key = '';
    app.ir.busy = false;
    app.ir.error = '';
    app.ir.focus = false;
    scheduleRender();
  }

  function confirmInterrupt(sessionId, key) {
    if (!sessionId || app.ir.busy || app.ir.key !== key) return;
    app.ir.busy = true;
    app.ir.error = '';
    scheduleRender();
    postAction(INTERRUPT_URL, { sessionId: sessionId }).then(function (res) {
      if (res.ok) {
        app.ir.key = '';
        app.ir.busy = false;
        app.ir.error = '';
        scheduleRender();
        toast('已中断');
        refreshState();
        return;
      }
      if (res.status === 409) {
        app.ir.key = '';
        app.ir.busy = false;
        app.ir.error = '';
        scheduleRender();
        toast('该会话已不在运行');
        refreshState();
        return;
      }
      app.ir.busy = false;
      app.ir.error = res.status === 404 ? '找不到该会话' : '中断失败，请重试';
      scheduleRender();
    }).catch(function () {
      app.ir.busy = false;
      app.ir.error = '网络连接失败，请重试';
      scheduleRender();
    });
  }

  /* ---------- interactions ---------- */
  function startEdit(id) {
    var m = findMember(id);
    if (!m) return;
    var alias = app.aliases[id];
    var source = alias && typeof alias.name === 'string' && alias.name.trim() ? alias.name.trim() : memberMeta(m).display;
    app.editing = { id: id, value: source, paint: true };
    scheduleRender();
  }

  function cancelEdit() {
    if (!app.editing) return;
    app.editing = null;
    flushPendingState();  /* apply the latest frame the edit buffered */
    scheduleRender();
  }

  function commitAlias(id, raw) {
    var m = findMember(id);
    if (!m) { app.editing = null; flushPendingState(); scheduleRender(); return; }
    var text = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim().slice(0, 12);
    var prev = app.aliases[id] ? JSON.parse(JSON.stringify(app.aliases[id])) : null;
    var color = prev && PALETTE.indexOf(prev.color) >= 0 ? prev.color : baseColorFor(m);
    var next = {};
    Object.keys(app.aliases).forEach(function (k) { next[k] = app.aliases[k]; });
    if (text) {
      next[id] = { name: text, color: color };
      if (prev && prev.emoji) next[id].emoji = prev.emoji;
    } else {
      delete next[id];
    }
    app.aliases = next;
    app.editing = null;
    app.pendingAlias = { id: id, name: text };
    flushPendingState();  /* apply the latest frame the edit buffered */
    scheduleRender();
    fetch('./api/aliases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ id: id, name: text, color: color })
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function (payload) {
      if (app.pendingAlias && app.pendingAlias.id === id) app.pendingAlias = null;
      if (payload && payload.ok !== false && payload.aliases && typeof payload.aliases === 'object') {
        app.aliases = mergeAliases(payload.aliases);
      }
      scheduleRender();
      toast(text ? '已将该成员改名为「' + text + '」' : '已恢复默认称呼');
    }).catch(function () {
      if (app.pendingAlias && app.pendingAlias.id === id) app.pendingAlias = null;
      var rollback = {};
      Object.keys(app.aliases).forEach(function (k) { rollback[k] = app.aliases[k]; });
      if (prev) rollback[id] = prev; else delete rollback[id];
      app.aliases = rollback;
      scheduleRender();
      toast('别名保存失败，请检查连接后重试');
    });
  }

  function resetAlias(id) {
    if (!app.aliases[id]) return;
    var prev = JSON.parse(JSON.stringify(app.aliases[id]));
    var next = {};
    Object.keys(app.aliases).forEach(function (k) { next[k] = app.aliases[k]; });
    delete next[id];
    app.aliases = next;
    app.pendingAlias = { id: id, name: '' };
    scheduleRender();
    fetch('./api/aliases?id=' + encodeURIComponent(id), { method: 'DELETE', headers: { 'Accept': 'application/json' } })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (payload) {
        if (app.pendingAlias && app.pendingAlias.id === id) app.pendingAlias = null;
        if (payload && payload.ok !== false && payload.aliases && typeof payload.aliases === 'object') {
          app.aliases = mergeAliases(payload.aliases);
        }
        scheduleRender();
        toast('已恢复默认称呼');
      })
      .catch(function () {
        if (app.pendingAlias && app.pendingAlias.id === id) app.pendingAlias = null;
        app.aliases = mergeAliases(app.aliases);
        app.aliases[id] = prev;
        scheduleRender();
        toast('恢复失败，请稍后重试');
      });
  }

  function mergeAliases(serverAliases) {
    var out = {};
    var source = serverAliases && typeof serverAliases === 'object' ? serverAliases : {};
    Object.keys(source).forEach(function (k) { out[k] = source[k]; });
    if (app.pendingAlias) {
      if (app.pendingAlias.name) {
        out[app.pendingAlias.id] = Object.assign({}, out[app.pendingAlias.id] || {}, { name: app.pendingAlias.name });
      } else {
        delete out[app.pendingAlias.id];
      }
    }
    return out;
  }

  /* v0.6: the manifest shortcuts deep-link the mobile tab bar. The URL param is
   * a mobile-only surface (desktop shows every column at once), so switching
   * tabs rewrites it with history.replaceState. */
  function tabFromURL() {
    if (!isSheetMode()) return '';
    try {
      var tab = new URLSearchParams(window.location.search).get('tab');
      return tab && TABS.indexOf(tab) >= 0 ? tab : '';
    } catch (err) { return ''; }
  }

  function syncTabURL(tab) {
    if (!window.history || typeof window.history.replaceState !== 'function') return;
    try {
      var url = new URL(window.location.href);
      if (isSheetMode()) {
        if (url.searchParams.get('tab') === tab) return;
        url.searchParams.set('tab', tab);
      } else {
        if (!url.searchParams.has('tab')) return;
        url.searchParams.delete('tab');
      }
      window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    } catch (err) { /* ignore */ }
  }

  /* v1.1: ?s=<session> is the shareable view. The host already scopes the
   * frame and the SSE handshake per connection, so a copied link reproduces
   * exactly what this browser shows (the capsule's "打开指挥台" reuses it). */
  function sessionFromURL() {
    try {
      var value = new URLSearchParams(window.location.search).get('s');
      return value ? String(value) : '';
    } catch (err) { return ''; }
  }

  function syncSessionURL(id) {
    if (!window.history || typeof window.history.replaceState !== 'function') return;
    try {
      var url = new URL(window.location.href);
      var wanted = id == null ? '' : String(id);
      if (!wanted) {
        if (!url.searchParams.has('s')) return;
        url.searchParams.delete('s');
      } else {
        if (url.searchParams.get('s') === wanted) return;
        url.searchParams.set('s', wanted);
      }
      window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    } catch (err) { /* ignore */ }
  }

  function focusFromURL() {
    try {
      var value = new URLSearchParams(window.location.search).get('focus');
      return value === 'approvals' ? 'approvals' : '';
    } catch (err) { return ''; }
  }

  function syncFocusURL() {
    if (!window.history || typeof window.history.replaceState !== 'function') return;
    try {
      var url = new URL(window.location.href);
      if (!url.searchParams.has('focus')) return;
      url.searchParams.delete('focus');
      window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    } catch (err) { /* ignore */ }
  }

  /** Copy the current view link - one click, no dialog (v1.1). */
  function copyViewLink() {
    try {
      var url = new URL(window.location.href);
      url.searchParams.delete('focus');
      copyText(url.href);
    } catch (err) {
      copyText(window.location.href);
    }
  }

  function setTab(tab) {
    if (TABS.indexOf(tab) < 0) return;
    if (app.tab === tab) {
      syncTabURL(tab);
      return;
    }
    app.tab = tab;
    app.resetStageScroll = true;
    syncTabURL(tab);
    /* v0.8: the settings tab asks the host for remote + capsule state on open only. */
    if (tab === 'settings') { fetchRemote(); fetchCapsule(); fetchTunnel(); }
    scheduleRender();
  }

  /* v0.5: clicking a session row / header pill re-scopes the whole deck. The
   * host rebuilds every state frame for the selected session (?s=), and each
   * EventSource connection remembers its own selection, so the stream is
   * re-opened too. Rows and pills update optimistically via displaySessionId(). */
  function fetchSessionState() {
    var seq = ++app.stateSeq;
    fetch(stateURL(), { headers: { 'Accept': 'application/json' } })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (payload) {
        if (seq !== app.stateSeq) return;
        applyState(payload);
      })
      .catch(function () {
        if (seq !== app.stateSeq) return;
        app.selectedSession = null;
        app.selectedManual = false;
        reconnectStream();
        scheduleRender();
        toast('切换会话失败，已回到自动视图');
      });
  }

  function switchSession(id) {
    id = id == null ? '' : String(id);
    if (!id || displaySessionId() === id) return;
    if (app.compose) closeComposer(false);
    if (app.editing) cancelEdit();
    if (app.ir.key) cancelInterrupt();
    app.selectedSession = id;
    app.selectedManual = true;
    syncSessionURL(id);
    scheduleRender();   /* optimistic: the clicked row / pill lights up now */
    reconnectStream();  /* independent per-connection selection (?s=) */
    fetchSessionState();
  }

  function toast(message) {
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2400);
  }

  /* ---------- state plumbing ---------- */
  /* Volatile fields change on every push without changing what is on screen
     (the clock and elapsed labels are patched by tickTimes instead), so they
     are excluded from the signature. Identical signatures skip the rebuild. */
  function stateSignature(payload) {
    var copy = {};
    for (var k in payload) {
      if (k === 'now') continue;
      if (k === 'session' && payload.session) {
        var s = {};
        for (var sk in payload.session) { if (sk !== 'elapsedMs') s[sk] = payload.session[sk]; }
        copy[k] = s;
      } else {
        copy[k] = payload[k];
      }
    }
    return JSON.stringify(copy);
  }

  function applyState(payload) {
    if (!payload || payload.ok === false) return;
    /* v0.5: a selected session that vanished makes the host fall back to its
     * automatic view — detect that and drop the stale selection. */
    if (app.selectedSession) {
      var gotSession = payload.session && payload.session.id ? String(payload.session.id) : '';
      if (gotSession !== app.selectedSession) {
        var wasManual = app.selectedManual;
        app.selectedSession = null;
        app.selectedManual = false;
        syncSessionURL('');
        reconnectStream();
        /* v1.2: a stale ?s= bookmark (shared link, reload, bookmark) returns to
         * the automatic view silently; only a session the user picked by hand
         * earns an explanation. */
        if (wasManual) toast('该会话已结束，已回到自动视图');
      }
    }
    /* v0.5: an open inline rename owns the rail. Buffer frames instead of
     * rebuilding the tree (that used to blur the input mid-typing); the latest
     * frame is applied by flushPendingState() on commit / cancel. */
    if (app.editing) {
      app.pendingState = payload;
      app.lastEventAt = Date.now();
      return;
    }
    app.pendingState = null;
    var sig = stateSignature(payload);
    var unchanged = sig === app.stateSig;
    var firstFrame = !app.loaded;
    /* v0.9: remember approvals we have never rendered so the notification path
     * can tell a fresh ask apart from what was already on screen. */
    var freshApprovals = [];
    if (!firstFrame && !unchanged) {
      arr(payload.approvals).forEach(function (a) {
        var aid = approvalId(a);
        if (aid && !app.ap.seen[aid] && !app.ap.gone[aid] && !app.ap.invalid[aid]) freshApprovals.push(a);
      });
    }
    app.data = payload;
    app.loaded = true;
    app.lastEventAt = Date.now();
    app.aliases = mergeAliases(payload.aliases);
    /* v1.1: the capsule deep-links "打开指挥台" with ?focus=approvals when a
     * decision is waiting; reveal the gate once, then drop the intent so a
     * later refresh does not re-focus. v1.2: wait up to FOCUS_RETRY_FRAMES
     * frames / FOCUS_TIMEOUT_MS because the first frame can arrive before the
     * approval does; if nothing shows up the intent is dropped silently. */
    if (app.focusRequest === 'approvals') {
      var waitingApprovals = arr(payload.approvals);
      if (waitingApprovals.length) {
        app.focusRequest = '';
        syncFocusURL();
        app.ap.expanded = true;
        app.scrollApprovals = true;
        var firstApprovalId = approvalId(waitingApprovals[0]);
        if (firstApprovalId) app.ap.focus = firstApprovalId;
      } else {
        app.focusFrames = Math.max(0, app.focusFrames - 1);
        if (app.focusFrames === 0 || Date.now() > app.focusUntil) {
          app.focusRequest = '';
          syncFocusURL();
        }
      }
    }
    if (unchanged) return;
    app.stateSig = sig;
    syncApprovals(payload);
    if (freshApprovals.length) approvalNotify(freshApprovals);
    scheduleRender();
  }

  /* Latest frame that arrived while an inline rename was open. */
  function flushPendingState() {
    var pending = app.pendingState;
    app.pendingState = null;
    if (pending) applyState(pending);
  }

  function stateURL() {
    return app.selectedSession
      ? './api/state?s=' + encodeURIComponent(app.selectedSession)
      : './api/state';
  }

  function streamURL() {
    return app.selectedSession
      ? './api/stream?s=' + encodeURIComponent(app.selectedSession)
      : './api/stream';
  }

  function connectStream() {
    try {
      es = new EventSource(streamURL());
    } catch (err) {
      app.connected = false;
      scheduleRender();
      return;
    }
    es.addEventListener('state', function (ev) {
      try {
        var payload = JSON.parse(ev.data);
        applyState(payload);
      } catch (err) { /* ignore malformed frame */ }
      if (!app.connected) { app.connected = true; scheduleRender(); }
    });
    es.addEventListener('open', function () {
      if (!app.connected) { app.connected = true; scheduleRender(); }
    });
    es.addEventListener('error', function () {
      if (app.connected) { app.connected = false; scheduleRender(); }
    });
  }

  /** Selection is per-connection in the host: the stream must be re-opened
   * with the matching ?s= handshake whenever the selection changes. */
  function reconnectStream() {
    if (es) { try { es.close(); } catch (err) { /* ignore */ } }
    es = null;
    app.connected = false;
    connectStream();
  }

  function loadInitial() {
    fetch(stateURL(), { headers: { 'Accept': 'application/json' } })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (payload) {
        if (!app.data) applyState(payload);
      })
      .catch(function () { scheduleRender(); });
  }

  /* ---------- clock ticker ---------- */
  function tickTimes() {
    var root = document.getElementById('app');
    if (!root) return;
    var hm = root.querySelector('[data-clock-hm]');
    var sec = root.querySelector('[data-clock-s]');
    if (hm || sec) {
      var now = fmtClock(Date.now());
      if (hm) hm.textContent = now.slice(0, 5);
      if (sec) sec.textContent = now.slice(5);
    }
    var elapsed = fmtDur(currentElapsed());
    root.querySelectorAll('[data-elapsed]').forEach(function (el) { el.textContent = elapsed; });
    root.querySelectorAll('[data-rel-at]').forEach(function (el) {
      el.textContent = ago(el.getAttribute('data-rel-at'));
    });
    /* v0.8: flip the capsule heartbeat row amber when the last heartbeat is
     * older than 15s while the settings page is open (local clock only, and the
     * relative times above are patched by [data-rel-at]). */
    if (app.capsule.loaded && app.capsule.available && app.capsule.supported) {
      var heartStaleNow = capsuleHeartbeatStale();
      if (heartStaleNow !== app.capsule.heartbeatStale) {
        app.capsule.heartbeatStale = heartStaleNow;
        if (app.tab === 'settings') scheduleRender();
      }
    }
    /* v0.7: the pairing code drains its own progress line; when it hits 0 the
     * dialog flips to the expired state (the modal itself stays open). */
    if (app.pair) {
      var pairLayer = pairLayerEl();
      var pairRem = app.pair.expiresAt - Date.now();
      if (pairLayer && !pairLayer.hidden) {
        var pairSecs = Math.max(0, Math.ceil(pairRem / 1000));
        var pairCount = pairLayer.querySelector('[data-pair-count]');
        if (pairCount) {
          pairCount.textContent = '剩余 ' + fmtCountdown(pairSecs);
          pairCount.classList.toggle('is-warn', pairSecs <= 15 && pairSecs > 0);
          pairCount.classList.toggle('is-critical', pairSecs <= 5 && pairSecs > 0);
        }
        var pairBar = pairLayer.querySelector('[data-pair-bar]');
        if (pairBar) pairBar.style.width = clamp(pairRem / PAIR_TTL * 100, 0, 100).toFixed(1) + '%';
        if (!app.pair.expired && pairRem <= 0) {
          app.pair.expired = true;
          app.pair.busy = '';
          app.pair.error = '';
          app.pair.focus = 'pair-new';
          renderPair();
        }
      }
    }
    /* approval countdown: seconds + progress bar + warn colours + expiry */
    root.querySelectorAll('.approval-card[data-apr-id]').forEach(function (card) {
      var id = card.getAttribute('data-apr-id') || '';
      var exp = num(card.getAttribute('data-exp'));
      var req = num(card.getAttribute('data-req'));
      if (exp == null) return;
      var remMs = exp - Date.now();
      var secs = Math.max(0, Math.ceil(remMs / 1000));
      var total = exp != null && req != null && exp > req ? exp - req : 25000;
      var pct = clamp(remMs / total * 100, 0, 100);
      var timeEl = card.querySelector('[data-apr-time]');
      if (timeEl) {
        timeEl.textContent = fmtSeconds(secs);
        timeEl.classList.toggle('is-warn', secs <= 8 && secs > 0);
        timeEl.classList.toggle('is-critical', secs <= 3 && secs > 0);
      }
      var bar = card.querySelector('[data-apr-bar]');
      if (bar) bar.style.width = pct.toFixed(1) + '%';
      card.classList.toggle('is-warn', secs <= 8 && secs > 0);
      card.classList.toggle('is-critical', secs <= 3 && secs > 0);
      if (remMs <= 0 && !app.ap.busy[id] && !app.ap.error[id] && !app.ap.invalid[id] &&
          !app.ap.transferred[id] && !app.ap.gone[id]) {
        app.ap.transferred[id] = true;
        scheduleRender();
        setTimeout(function () {
          if (app.ap.transferred[id]) {
            delete app.ap.transferred[id];
            app.ap.gone[id] = true;
            if (visibleApprovals().length <= 2) app.ap.expanded = false;
            scheduleRender();
          }
        }, 1600);
      }
    });
  }

  /* ---------- column resize ---------- */
  var dragging = null;

  function applyWidths() {
    var stage = document.querySelector('.stage');
    if (!stage) return;
    if (num(app.widths.rail) != null) stage.style.setProperty('--rail-w', Math.round(app.widths.rail) + 'px');
    if (num(app.widths.side) != null) stage.style.setProperty('--side-w', Math.round(app.widths.side) + 'px');
    syncGrabBounds();
  }

  /* v0.5b: in the 2-column layout the rail divider still works, but the side
   * column is stacked below the board — bound the divider to the board box so
   * the grab line can never paint over the stacked cards. The handles live
   * inside .board, so the height is simply the board's own box height. */
  function syncGrabBounds() {
    var stage = document.querySelector('.stage');
    if (!stage) return;
    var twoCol = window.innerWidth >= 760 && window.innerWidth <= 1179;
    var board = stage.querySelector('.board');
    if (!twoCol || !board) {
      stage.style.removeProperty('--grab-h');
      return;
    }
    var h = board.offsetTop + board.offsetHeight;
    if (h > 0) stage.style.setProperty('--grab-h', Math.round(h) + 'px');
  }

  function onGrabDown(ev) {
    var grab = ev.target && ev.target.closest ? ev.target.closest('[data-grab]') : null;
    if (!grab) return;
    var stage = grab.closest('.stage');
    if (!stage) return;
    ev.preventDefault();
    var kind = grab.getAttribute('data-grab');
    /* v0.5b: track the delta from the grab point instead of the absolute
     * pointer position, so the stage padding cannot make the divider jump
     * by ~20px the moment a drag starts (and so the 2-column rail divider
     * starts from the real, possibly clamped, column width). */
    var column = stage.querySelector(kind === 'rail' ? '.rail' : '.side');
    var startW = column ? column.getBoundingClientRect().width : (kind === 'rail' ? 250 : 300);
    dragging = { kind: kind, grab: grab, stage: stage, limits: LIMITS[kind], startX: ev.clientX, startW: startW };
    grab.classList.add('on');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', onGrabMove);
    window.addEventListener('pointerup', onGrabUp, { once: true });
  }

  function onGrabMove(ev) {
    if (!dragging) return;
    /* grow while the pointer moves right for the rail column, left for the side */
    var delta = (ev.clientX - dragging.startX) * (dragging.kind === 'rail' ? 1 : -1);
    var value = dragging.startW + delta;
    app.widths[dragging.kind] = clamp(value, dragging.limits[0], dragging.limits[1]);
    applyWidths();
  }

  function onGrabUp() {
    if (!dragging) return;
    dragging.grab.classList.remove('on');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    window.removeEventListener('pointermove', onGrabMove);
    saveWidths();
    dragging = null;
    scheduleRender();
  }

  document.addEventListener('pointerdown', onGrabDown);

  /* v0.4: a click anywhere outside dismisses the open composer / interrupt confirm. */
  document.addEventListener('pointerdown', function (ev) {
    var target = ev.target;
    if (!target || !target.closest) return;
    if (app.compose && !target.closest('.compose') &&
        !target.closest('[data-act="compose-dismiss"]') &&
        !target.closest('[data-action="compose"]')) {
      closeComposer(false);
    }
    if (app.ir.key && !target.closest('.ir-confirm') && !target.closest('[data-action="interrupt"]')) {
      cancelInterrupt();
    }
  });
  document.addEventListener('dblclick', function (ev) {
    var grab = ev.target && ev.target.closest ? ev.target.closest('[data-grab]') : null;
    if (!grab) return;
    app.widths[grab.getAttribute('data-grab')] = null;
    saveWidths();
    scheduleRender();
  });

  /* ---------- v0.5 teammate order: pointer drag + keyboard ---------- */
  var reorder = null;

  function mateOrderIds() {
    return orderedMembers().filter(function (m) { return m && m.role !== 'lead'; }).map(function (m) { return m.id; });
  }

  function persistOrder(ids) {
    app.order = ids.slice();
    saveOrder();
  }

  function moveMember(id, delta) {
    var m = findMember(id);
    if (!m || m.role === 'lead') return;
    /* v0.7.1: keyboard reorder stays inside the member's status group. */
    var grp = rosterGroupOf(m);
    var ids = rosterGroupIDs(grp);
    var i = ids.indexOf(id);
    if (i < 0) return;
    var j = i + delta;
    if (j < 0 || j >= ids.length) {
      toast(delta < 0 ? '已经在最前面了' : '已经在最后面了');
      return;
    }
    ids.splice(j, 0, ids.splice(i, 1)[0]);
    persistOrder(reorderRosterSeq(grp, ids));
    toast(delta < 0 ? '已上移' : '已下移');
    scheduleRender();
  }

  function onReorderDown(ev) {
    var grip = ev.target && ev.target.closest ? ev.target.closest('[data-action="reorder"]') : null;
    if (!grip) return;
    if (ev.button != null && ev.button !== 0) return;
    var id = grip.dataset.id || '';
    if (!id) return;
    reorder = { id: id, startY: ev.clientY, active: false };
    if (ev.cancelable) ev.preventDefault();
    /* v0.5b: capture the pointer so a drag inside the host iframe keeps
     * tracking even when the cursor leaves the grip, and never turns into a
     * rail scroll / text selection. */
    try {
      if (ev.pointerId != null && grip.setPointerCapture) grip.setPointerCapture(ev.pointerId);
    } catch (err) { /* ignore */ }
    window.addEventListener('pointermove', onReorderMove, { passive: false });
    window.addEventListener('pointerup', onReorderUp, { once: true });
    window.addEventListener('pointercancel', onReorderUp, { once: true });
  }

  function onReorderMove(ev) {
    if (!reorder) return;
    if (ev.cancelable) ev.preventDefault();
    if (!reorder.active) {
      if (Math.abs(ev.clientY - reorder.startY) < 5) return;
      reorder.active = true;
      app.reorderId = reorder.id;
      document.body.classList.add('is-reordering');
      scheduleRender();
    }
    /* v0.5b: the member list can be scrollable (many agents / short rail). Keep
     * it following a drag near its top/bottom edge so off-screen cards are
     * reachable without letting the drag turn into a scroll gesture. */
    var listEl = document.querySelector('.members');
    if (listEl && listEl.scrollHeight > listEl.clientHeight + 1) {
      var listRect = listEl.getBoundingClientRect();
      var edge = 26;
      if (ev.clientY < listRect.top + edge && listEl.scrollTop > 0) {
        listEl.scrollTop -= Math.min(18, Math.max(4, Math.ceil((listRect.top + edge - ev.clientY) / 2)));
      } else if (ev.clientY > listRect.bottom - edge) {
        listEl.scrollTop += Math.min(18, Math.max(4, Math.ceil((ev.clientY - (listRect.bottom - edge)) / 2)));
      }
    }
    /* v0.7.1: only same-group cards are drop targets; dragging across a folded
     * group simply keeps sorting near the closest same-group slot. */
    var dragMember = findMember(reorder.id);
    if (!dragMember) return;
    var grp = rosterGroupOf(dragMember);
    var cards = Array.prototype.slice.call(document.querySelectorAll('.members .agent[data-id]'))
      .filter(function (el) {
        return el.dataset.id !== reorder.id && !el.classList.contains('lead') && el.dataset.grp === grp;
      });
    if (!cards.length) return;
    var insert = cards.length;
    for (var i = 0; i < cards.length; i++) {
      var rect = cards[i].getBoundingClientRect();
      if (ev.clientY < rect.top + rect.height / 2) { insert = i; break; }
    }
    var ids = cards.map(function (el) { return el.dataset.id; });
    ids.splice(insert, 0, reorder.id);
    var next = reorderRosterSeq(grp, ids);
    if (next.join('\u0000') === mateOrderIds().join('\u0000')) return;
    persistOrder(next);
    scheduleRender();
  }

  function onReorderUp() {
    if (!reorder) return;
    var active = reorder.active;
    var id = reorder.id;
    reorder = null;
    window.removeEventListener('pointermove', onReorderMove);
    document.body.classList.remove('is-reordering');
    if (!active) return;
    app.reorderId = '';
    scheduleRender();
    /* keep keyboard users on the handle they were holding */
    var grip = document.querySelector('[data-action="reorder"][data-id="' + id.replace(/["\\]/g, '\\$&') + '"]');
    if (grip) {
      try { grip.focus({ preventScroll: true }); } catch (err) { /* ignore */ }
    }
  }

  document.addEventListener('pointerdown', onReorderDown);

  /* ---------- delegated events ---------- */
  function closestAction(node) {
    while (node && node !== document) {
      if (node.dataset && node.dataset.action) return node;
      node = node.parentElement;
    }
    return null;
  }

  document.addEventListener('click', function (ev) {
    var target = ev.target;
    if (!target || !target.closest) return;
    var actionEl = closestAction(target);
    if (!actionEl) return;
    var action = actionEl.dataset.action;
    if (action === 'session') {
      switchSession(actionEl.dataset.id);
    } else if (action === 'tab') {
      setTab(actionEl.dataset.tab);
    } else if (action === 'card-action') {
      ev.preventDefault();
      handleCardAction(actionEl.dataset.card, actionEl.dataset.act);
    } else if (action === 'card-run') {
      ev.preventDefault();
      runCardAction(actionEl.dataset.card, actionEl.dataset.act);
    } else if (action === 'card-cancel') {
      ev.preventDefault();
      cancelCardConfirm();
    } else if (action === 'cards-retry') {
      ev.preventDefault();
      refreshState();
    } else if (action === 'pwa-install') {
      ev.preventDefault();
      promptInstall();
    } else if (action === 'roster-toggle') {
      ev.preventDefault();
      toggleRoster(actionEl.dataset.grp);
    } else if (action === 'roster-static') {
      /* running members never fold — the head only anchors focus/semantics */
      ev.preventDefault();
    } else if (action === 'alias-edit') {
      ev.preventDefault();
      startEdit(actionEl.dataset.id);
    } else if (action === 'alias-reset') {
      resetAlias(actionEl.dataset.id);
    } else if (action === 'expand') {
      var item = actionEl.closest('.it');
      if (item) item.classList.toggle('open');
    } else if (action === 'approval-answer') {
      answerApproval(actionEl.dataset.id, actionEl.dataset.decision);
    } else if (action === 'approval-retry') {
      answerApproval(actionEl.dataset.id, actionEl.dataset.decision);
    } else if (action === 'approval-more') {
      app.ap.expanded = true;
      scheduleRender();
    } else if (action === 'compose') {
      ev.preventDefault();
      handleComposeTrigger(actionEl);
    } else if (action === 'interrupt') {
      ev.preventDefault();
      armInterrupt(actionEl.dataset.ir);
    } else if (action === 'interrupt-cancel') {
      cancelInterrupt();
    } else if (action === 'interrupt-confirm') {
      confirmInterrupt(actionEl.dataset.id, actionEl.dataset.ir);
    } else if (action === 'settings-toggle') {
      ev.preventDefault();
      setTab(app.tab === 'settings' ? 'overview' : 'settings');
    } else if (action === 'remote-start') {
      ev.preventDefault();
      remoteStart();
    } else if (action === 'remote-pair') {
      ev.preventDefault();
      remotePair();
    } else if (action === 'remote-stop-arm') {
      ev.preventDefault();
      remoteStopArm();
    } else if (action === 'remote-stop-cancel') {
      ev.preventDefault();
      remoteStopCancel();
    } else if (action === 'remote-stop') {
      ev.preventDefault();
      remoteStop();
    } else if (action === 'remote-copy-url') {
      ev.preventDefault();
      if (app.remote.url) copyText(app.remote.url);
      else toast('还没有可复制的地址');
    } else if (action === 'remote-revoke') {
      ev.preventDefault();
      remoteRevoke(actionEl.dataset.id);
    } else if (action === 'remote-revoke-all') {
      ev.preventDefault();
      remoteRevokeAll();
    } else if (action === 'remote-pub-edit') {
      ev.preventDefault();
      remotePubEdit();
    } else if (action === 'remote-pub-save') {
      ev.preventDefault();
      remotePubSave(false);
    } else if (action === 'remote-pub-clear') {
      ev.preventDefault();
      remotePubSave(true);
    } else if (action === 'tunnel-refresh' || action === 'tunnel-retry') {
      ev.preventDefault();
      tunnelRetry();
    } else if (action === 'tunnel-copy') {
      ev.preventDefault();
      tunnelCopy(actionEl.dataset.id);
    } else if (action === 'notif-enable') {
      ev.preventDefault();
      notifEnable();
    } else if (action === 'notif-test') {
      ev.preventDefault();
      notifTest();
    } else if (action === 'capsule-toggle') {
      ev.preventDefault();
      capsuleToggle();
    } else if (action === 'capsule-retry') {
      ev.preventDefault();
      fetchCapsule();
    } else if (action === 'capsule-copy-path') {
      ev.preventDefault();
      capsuleCopyPath();
    } else if (action === 'copy-view-link') {
      ev.preventDefault();
      copyViewLink();
    } else if (action === 'diag-run') {
      ev.preventDefault();
      app.diag.focus = 'diag-run';
      fetchDiagnostics();
    } else if (action === 'diag-copy') {
      ev.preventDefault();
      app.diag.focus = 'diag-copy';
      diagCopyReport();
    }
    /* data-action="alias" (the name button) only reacts to dblclick / Enter / long-press */
  });

  function handleComposeTrigger(trigger) {
    /* v0.5b: session/member is known but has no writable agent yet — tell the
     * user why the composer stays shut instead of opening a dead dialog. */
    if (trigger.getAttribute('data-gated') === '1') {
      toast(trigger.dataset.scope === 'member'
        ? '该成员当前未运行，等它启动后再发消息'
        : '该会话当前未运行，等它启动后再发消息');
      return;
    }
    var key = trigger.dataset.compose || '';
    if (app.compose && app.compose.key === key) {
      closeComposer(true);
      return;
    }
    openComposer({
      kind: trigger.dataset.scope,
      refId: trigger.dataset.id,
      sessionId: trigger.dataset.session,
      name: trigger.dataset.name
    });
  }

  document.addEventListener('dblclick', function (ev) {
    var target = ev.target;
    if (!target || !target.closest) return;
    var name = target.closest('.a-name');
    if (!name) return;
    ev.preventDefault();
    startEdit(name.dataset.id);
  });

  document.addEventListener('keydown', function (ev) {
    var target = ev.target;
    if (!target || !target.classList) return;
    /* v0.7: the pairing dialog owns the keyboard while it is open (its own
     * layer handler covers Esc/Tab; this is the body-focus fallback). */
    if (app.pair) {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        closePair(true);
      }
      return;
    }
    /* v0.4: the composer owns the keyboard while it is open — deck shortcuts
     * (including the approval Esc/Enter gate) stay suspended. */
    if (app.compose) {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        if (!app.compose.busy) closeComposer(true);
        return;
      }
      if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') {
        ev.preventDefault();
        sendCompose();
        return;
      }
      return;
    }
    if (app.ir.key && ev.key === 'Escape') {
      ev.preventDefault();
      cancelInterrupt();
      return;
    }
    /* v0.9: Enter saves / Esc cancels the inline public-URL editor; keep the
     * approval Enter gate from firing while the input owns the keyboard. */
    if (target.classList.contains('remote-pub-input')) {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        remotePubSave(false);
        return;
      }
      if (ev.key === 'Escape') {
        ev.preventDefault();
        remotePubCancel();
        return;
      }
    }
    /* v0.6: Esc closes an armed card confirmation. */
    if (app.xc.confirm && ev.key === 'Escape') {
      ev.preventDefault();
      cancelCardConfirm();
      return;
    }
    /* v0.5: reorder grip — ↑/↓ (also with Alt) moves the member. */
    if (target.classList.contains('a-grip')) {
      var reorderDelta = (ev.key === 'ArrowUp' || ev.key === 'ArrowLeft') ? -1
        : ((ev.key === 'ArrowDown' || ev.key === 'ArrowRight') ? 1 : 0);
      if (reorderDelta) {
        ev.preventDefault();
        moveMember(target.dataset.id, reorderDelta);
        return;
      }
    }
    /* v0.3 gate shortcuts: Esc = reject the first visible ask, Enter = allow it
     * (unless the focus is already inside the approval buttons / an input). */
    if (!app.editing) {
      var pending = visibleApprovals();
      if (pending.length) {
        var focused = document.activeElement;
        var onApprovalButton = !!(focused && focused.dataset && focused.dataset.action &&
          focused.dataset.action.indexOf('approval-') === 0);
        if (ev.key === 'Escape') {
          ev.preventDefault();
          answerApproval(approvalId(pending[0]), 'reject');
          return;
        }
        if (ev.key === 'Enter' && !onApprovalButton &&
            (!focused || focused === document.body || (focused.classList && focused.classList.contains('approval-card')))) {
          ev.preventDefault();
          answerApproval(approvalId(pending[0]), 'allow-once');
          return;
        }
      }
    }
    if (target.classList.contains('a-name') && (ev.key === 'Enter' || ev.key === 'F2')) {
      ev.preventDefault();
      startEdit(target.dataset.id);
      return;
    }
    if (target.classList.contains('alias-input')) {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        commitAlias(target.dataset.id, target.value);
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        cancelEdit();
      }
    }
  });

  document.addEventListener('input', function (ev) {
    var target = ev.target;
    if (!target || !target.classList) return;
    if (target.classList.contains('alias-input') && app.editing) {
      app.editing.value = target.value;
    }
    /* v0.9: keep the draft public URL across scheduled re-renders. */
    if (target.classList.contains('remote-pub-input')) {
      app.remote.pub.value = target.value;
    }
  });

  document.addEventListener('focusout', function (ev) {
    var target = ev.target;
    if (!target || !target.classList) return;
    if (target.classList.contains('alias-input') && app.editing && app.editing.id === target.dataset.id) {
      cancelEdit();
    }
  });

  /* touch: long-press a member name to rename */
  var pressTimer = null;
  var pressPoint = null;
  var pressId = null;
  document.addEventListener('pointerdown', function (ev) {
    var target = ev.target;
    if (!target || !target.closest) return;
    var name = target.closest('.a-name');
    if (!name || (ev.pointerType && ev.pointerType === 'mouse')) return;
    pressId = name.dataset.id;
    pressPoint = { x: ev.clientX, y: ev.clientY };
    if (pressTimer) clearTimeout(pressTimer);
    pressTimer = setTimeout(function () {
      pressTimer = null;
      if (pressId) startEdit(pressId);
    }, 520);
  });
  function clearPress() {
    if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
    pressPoint = null;
    pressId = null;
  }
  document.addEventListener('pointermove', function (ev) {
    if (!pressPoint) return;
    if (Math.abs(ev.clientX - pressPoint.x) > 8 || Math.abs(ev.clientY - pressPoint.y) > 8) clearPress();
  });
  document.addEventListener('pointerup', clearPress);
  document.addEventListener('pointercancel', clearPress);

  /* ---------- boot ---------- */
  var lastSheetMode = isSheetMode();

  function boot() {
    if (EMBED) document.body.classList.add('embed');
    app.widths = loadWidths();
    app.order = loadOrder();
    loadRoster();
    /* v1.1: shareable view links and the capsule's ?focus= deep link are read
     * before the first frame so the very first stream handshake carries ?s=. */
    var linkedSession = sessionFromURL();
    if (linkedSession) {
      app.selectedSession = linkedSession;
      app.selectedManual = false;
    }
    app.focusRequest = focusFromURL();
    if (app.focusRequest) {
      app.focusFrames = FOCUS_RETRY_FRAMES;
      app.focusUntil = Date.now() + FOCUS_TIMEOUT_MS;
    }
    /* v0.6: manifest shortcuts deep-link ?tab= on the mobile tab bar. */
    var linkedTab = tabFromURL();
    if (linkedTab) app.tab = linkedTab;
    initTheme();
    bindComposeLayer();
    bindPairLayer();
    captureInstallPrompt();
    registerServiceWorker();
    window.addEventListener('resize', function () {
      syncGrabBounds();
      syncTabURL(app.tab);
      if (app.compose) syncComposerAnchor();
      if (app.pair) positionPair();
      /* crossing the sheet breakpoint swaps the settings render path */
      var sheet = isSheetMode();
      if (sheet !== lastSheetMode) {
        lastSheetMode = sheet;
        scheduleRender();
      }
    });
    window.addEventListener('online', function () { scheduleRender(); });
    window.addEventListener('offline', function () { scheduleRender(); });
    /* v0.9: the notification permission can change outside the app (site
     * settings); re-read it whenever the page becomes visible again. */
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) scheduleRender();
    });
    render(); /* synchronous first paint: the shell must never flash empty */
    /* v0.8: a deep-linked settings tab asks the host for remote + capsule state once. */
    if (app.tab === 'settings') { fetchRemote(); fetchCapsule(); fetchTunnel(); }
    loadInitial();
    connectStream();
    tickTimes();
    setInterval(tickTimes, 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
