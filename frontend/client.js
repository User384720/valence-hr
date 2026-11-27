'use strict';

/* ------------------------------------------------------------------ */
/*  JOB JOB — controller client                                        */
/*  Build interview answers out of your friends' words. Vote head to   */
/*  head. Word royalties go to whoever wrote the words you stole.      */
/* ------------------------------------------------------------------ */

const BACKEND_URL = 'https://valence-hr.onrender.com';
const LOCAL_URL = 'http://localhost:3000';

const isLocalHost = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/.test(location.hostname);
const PLACEHOLDER_BACKEND = BACKEND_URL.indexOf('YOUR-RENDER-APP') !== -1;

// Before you paste your Render URL in above, the page falls back to its own
// origin so the backend can serve the frontend for local play and previews.
const CONNECT_TARGETS = PLACEHOLDER_BACKEND
  ? [isLocalHost ? LOCAL_URL : location.origin.replace(/\/$/, '')]
  : isLocalHost
  ? [LOCAL_URL, BACKEND_URL]
  : [BACKEND_URL];

const STORE_SEAT = 'jobjob.seat.v2';
const STORE_MUTE = 'jobjob.mute';

const S = {
  socket: null,
  targetIndex: 0,
  connected: false,
  room: null,
  identity: readJSON(STORE_SEAT),
  entryName: '',
  entryCode: '',
  builder: {},
  builderPrompt: 0,
  order: { key: null, ids: [] },
  ice: ['', ''],
  lastSignature: null,
  toastTimer: null,
  tickTimer: null,
  lastTickSecond: null,
  audio: null,
  muted: localStorage.getItem(STORE_MUTE) === '1',
  rejoinTried: false,
  clockOffset: 0
};

/* ------------------------------------------------------------------ */
/*  Tiny helpers                                                       */
/* ------------------------------------------------------------------ */

function readJSON(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    return null;
  }
}

function writeSeat(code, playerId) {
  S.identity = { code, playerId };
  try {
    localStorage.setItem(STORE_SEAT, JSON.stringify(S.identity));
  } catch (error) {
    /* private mode */
  }
}

function clearSeat() {
  S.identity = null;
  try {
    localStorage.removeItem(STORE_SEAT);
  } catch (error) {
    /* ignore */
  }
}

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function el(id) {
  return document.getElementById(id);
}

function $(selector, root) {
  return (root || document).querySelector(selector);
}

function $$(selector, root) {
  return Array.prototype.slice.call((root || document).querySelectorAll(selector));
}

function fmtScore(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function wordCount(text) {
  return String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function playerById(room, id) {
  if (!room) return null;
  return room.players.find((p) => p.id === id) || null;
}

function avatar(player, extra) {
  if (!player) return '<span class="avatar" style="--c:#1B3B48">??</span>';
  const initials = player.name
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return `<span class="avatar ${extra || ''}" style="--c:${esc(player.color)}">${esc(initials || '?')}</span>`;
}

function toast(message) {
  const node = el('toast');
  if (!node) return;
  node.textContent = message;
  node.classList.add('toast--on');
  clearTimeout(S.toastTimer);
  S.toastTimer = setTimeout(() => node.classList.remove('toast--on'), 2600);
}

function vibrate(ms) {
  if (navigator.vibrate && !S.muted) navigator.vibrate(ms);
}

/* ------------------------------------------------------------------ */
/*  Sound: paper pops, typewriter clacks, stamps — all Web Audio      */
/* ------------------------------------------------------------------ */

function audioCtx() {
  if (!S.audio) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    S.audio = new Ctx();
  }
  if (S.audio.state === 'suspended') S.audio.resume();
  return S.audio;
}

function tone(freq, duration, type, gain, when) {
  const ctx = audioCtx();
  if (!ctx || S.muted) return;
  const start = ctx.currentTime + (when || 0);
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = type || 'sine';
  osc.frequency.setValueAtTime(freq, start);
  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.exponentialRampToValueAtTime(gain == null ? 0.09 : gain, start + 0.012);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(amp).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

function noise(duration, gain, filterFreq) {
  const ctx = audioCtx();
  if (!ctx || S.muted) return;
  const length = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / length);
  }
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = filterFreq || 1400;
  filter.Q.value = 0.9;
  const amp = ctx.createGain();
  amp.gain.value = gain == null ? 0.14 : gain;
  src.connect(filter).connect(amp).connect(ctx.destination);
  src.start();
}

const SFX = {
  pop() {
    tone(520 + Math.random() * 140, 0.07, 'triangle', 0.08);
    noise(0.035, 0.05, 2200);
  },
  clack() {
    noise(0.05, 0.12, 950);
    tone(180, 0.05, 'square', 0.03);
  },
  tick() {
    tone(880, 0.05, 'square', 0.05);
  },
  chime() {
    tone(523.25, 0.16, 'triangle', 0.09, 0);
    tone(659.25, 0.16, 'triangle', 0.08, 0.09);
    tone(783.99, 0.3, 'triangle', 0.09, 0.18);
  },
  buzz() {
    tone(196, 0.18, 'sawtooth', 0.06);
    tone(146, 0.22, 'sawtooth', 0.05, 0.12);
  },
  stamp() {
    noise(0.09, 0.16, 420);
    tone(90, 0.14, 'sine', 0.12);
  }
};

function syncMuteButton() {
  const btn = el('muteBtn');
  if (!btn) return;
  btn.textContent = S.muted ? 'SOUND OFF' : 'SOUND ON';
  btn.setAttribute('aria-pressed', S.muted ? 'true' : 'false');
  btn.classList.toggle('mute-btn--off', S.muted);
}

/* ------------------------------------------------------------------ */
/*  Socket plumbing                                                    */
/* ------------------------------------------------------------------ */

function connect() {
  if (typeof io !== 'function') {
    setBoot('socket.io failed to load. Check your connection.', true);
    return;
  }
  const target = CONNECT_TARGETS[S.targetIndex];
  if (!target) {
    setBoot('No HR server configured. Set BACKEND_URL in client.js.', true);
    return;
  }

  S.socket = io(target, {
    transports: ['polling', 'websocket'],
    reconnection: true,
    reconnectionDelay: 1200,
    reconnectionDelayMax: 6000,
    timeout: 25000
  });

  S.socket.on('connect', () => {
    S.connected = true;
    el('boot').classList.add('boot--gone');
    el('netbar').classList.add('hidden');
    if (S.identity && S.identity.code && S.identity.playerId && !S.rejoinTried) {
      S.rejoinTried = true;
      S.socket.emit(
        'rejoin',
        { code: S.identity.code, playerId: S.identity.playerId },
        (res) => {
          if (!res || !res.ok) {
            clearSeat();
            S.room = null;
            render(true);
          }
        }
      );
    } else {
      render(true);
    }
  });

  S.socket.on('disconnect', () => {
    S.connected = false;
    el('netbar').classList.remove('hidden');
  });

  S.socket.on('connect_error', () => {
    if (!S.connected) {
      if (S.targetIndex < CONNECT_TARGETS.length - 1) {
        S.targetIndex += 1;
        if (S.socket) S.socket.close();
        connect();
        return;
      }
      setBoot('HR is not responding. The free-tier server may still be waking up.', true);
    }
  });

  S.socket.on('room_state', (state) => {
    S.room = state;
    if (state && state.serverNow) S.clockOffset = state.serverNow - Date.now();
    if (state && state.code) writeSeat(state.code, state.myId);
    render(false);
  });
}

function setBoot(message, retry) {
  const status = el('bootStatus');
  if (status) status.textContent = message;
  const retryBtn = el('bootRetry');
  if (retryBtn) retryBtn.classList.toggle('hidden', !retry);
}

function emit(event, payload) {
  return new Promise((resolve) => {
    if (!S.socket || !S.socket.connected) {
      toast('Not connected to HR yet.');
      resolve({ ok: false });
      return;
    }
    S.socket.emit(event, payload || {}, (res) => resolve(res || { ok: false }));
  });
}

/* ------------------------------------------------------------------ */
/*  Render loop                                                        */
/* ------------------------------------------------------------------ */

function render(force) {
  const app = el('app');
  if (!app) return;

  const signature = signatureOf(S.room);
  if (!force && signature === S.lastSignature) {
    updateLive();
    return;
  }
  S.lastSignature = signature;

  const scrollY = window.scrollY;
  if (!S.room) {
    app.innerHTML = S.connected ? screenEntry() : '';
  } else {
    app.innerHTML = screenForRoom(S.room);
  }
  window.scrollTo(0, scrollY);
  updateLive();
  bindScreen();
}

function signatureOf(room) {
  if (!room) return 'entry';
  const bits = [
    room.phase,
    room.round,
    room.code,
    room.myId,
    room.hostId,
    room.timerEnd > 0 ? 't' : 'n',
    room.memo || ''
  ];
  bits.push(
    room.players
      .map((p) => p.name + ':' + p.score + ':' + (p.connected ? 1 : 0))
      .join('|')
  );
  if (room.phase === 'icebreakers') {
    bits.push(room.prompts.join('||'), room.filed ? 'filed' : 'open', (room.filedIds || []).length);
  }
  if (room.phase === 'briefing') {
    bits.push((room.script || []).join('|'));
  }
  if (room.phase === 'interview') {
    bits.push(
      room.prompts.map((p) => p.text).join('||'),
      JSON.stringify(room.myAnswers),
      (room.answerIds || []).length,
      (room.filedIds || []).length,
      S.builderPrompt
    );
  }
  if (room.phase === 'matchup' && room.match) {
    bits.push(
      room.match.stageLabel,
      room.match.matchNumber,
      room.match.a ? room.match.a.text : '',
      room.match.b ? room.match.b.text : '',
      room.match.myVote || '',
      room.match.mine || '',
      room.match.canVote ? '1' : '0',
      (room.match.votedIds || []).join(',')
    );
  }
  if (room.phase === 'matchup_result' && room.match) {
    bits.push(room.match.winnerId, room.match.stageLabel, room.match.matchNumber);
  }
  if (room.phase === 'round_result' && room.roundResult) {
    bits.push(
      room.roundResult.round,
      room.roundResult.champions.map((c) => c.answer).join('|')
    );
  }
  if (room.phase === 'final') bits.push('final');
  return bits.join('~');
}

function updateLive() {
  const room = S.room;
  if (!room) return;

  const remainingMs = room.timerEnd ? room.timerEnd - (Date.now() + clockSkew()) : 0;
  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));

  $$('[data-timer]').forEach((node) => {
    node.textContent = formatClock(seconds);
  });

  $$('[data-timer-bar]').forEach((node) => {
    const total = Number(node.getAttribute('data-total') || 60);
    const pct = total > 0 ? Math.max(0, Math.min(100, (seconds / total) * 100)) : 0;
    node.style.width = pct + '%';
    node.classList.toggle('timerbar__fill--low', seconds <= 10);
  });

  if (room.phase === 'matchup' && room.match) {
    const votes = room.match.votes || { a: 0, b: 0 };
    const aNode = $('[data-votes="a"]');
    const bNode = $('[data-votes="b"]');
    if (aNode) aNode.textContent = votes.a || 0;
    if (bNode) bNode.textContent = votes.b || 0;
  }

  if (seconds <= 10 && seconds > 0 && room.phase !== 'lobby' && room.phase !== 'final') {
    if (S.lastTickSecond !== seconds) {
      S.lastTickSecond = seconds;
      SFX.tick();
    }
  }
  if (seconds > 10) S.lastTickSecond = null;
}

function clockSkew() {
  return S.clockOffset || 0;
}

function formatClock(seconds) {
  if (seconds >= 60) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m + ':' + String(s).padStart(2, '0');
  }
  return String(seconds);
}

function timerBar(total, secondsLabel) {
  return `
    <div class="timerwrap">
      <div class="timerbar"><div class="timerbar__fill" data-timer-bar data-total="${total}" style="width:100%"></div></div>
      <span class="timerlabel">${secondsLabel ? esc(secondsLabel) : ''} <b data-timer>—</b></span>
    </div>`;
}

/* ------------------------------------------------------------------ */
/*  Shared chrome                                                      */
/* ------------------------------------------------------------------ */

function logo(extraClass) {
  return `
    <div class="logo ${extraClass || ''}" aria-label="Job Job">
      <span class="logo-tile logo-tile--a">JOB</span>
      <span class="logo-tile logo-tile--b">JOB</span>
    </div>`;
}

function bubblesSVG(extraClass) {
  return `
    <svg class="bubbles ${extraClass || ''}" viewBox="0 0 120 140" role="img" aria-label="M. Bubbles, a sentient water cooler">
      <ellipse cx="60" cy="130" rx="32" ry="5" fill="#141414" opacity="0.16"></ellipse>
      <path d="M40 20h40v8c15 7 22 20 22 34v6H18v-6c0-14 7-27 22-34z" fill="#9FD9EA" stroke="#141414" stroke-width="4" stroke-linejoin="round"></path>
      <path d="M18 62h84v9c0 6-18 9-42 9s-42-3-42-9z" fill="#65C3DE" opacity="0.55"></path>
      <rect x="36" y="10" width="48" height="12" rx="4" fill="#1B3B48" stroke="#141414" stroke-width="4"></rect>
      <rect x="16" y="72" width="88" height="52" rx="12" fill="#F4EFE6" stroke="#141414" stroke-width="4"></rect>
      <circle cx="45" cy="62" r="5.5" fill="#141414"></circle>
      <circle cx="75" cy="62" r="5.5" fill="#141414"></circle>
      <circle cx="47" cy="60" r="1.7" fill="#fff"></circle>
      <circle cx="77" cy="60" r="1.7" fill="#fff"></circle>
      <path d="M50 71q10 8 20 0" stroke="#141414" stroke-width="4" fill="none" stroke-linecap="round"></path>
      <path d="M60 79l8 8-3 8-5 12-5-12-3-8z" fill="#F25C2A" stroke="#141414" stroke-width="3" stroke-linejoin="round"></path>
      <rect x="50" y="92" width="20" height="6" rx="3" fill="#F6C84C" stroke="#141414" stroke-width="2.5"></rect>
      <path d="M32 106h56" stroke="#141414" stroke-width="3" opacity="0.25" stroke-linecap="round"></path>
    </svg>`;
}

function speech(text, extraClass) {
  return `<div class="speech ${extraClass || ''}"><span class="speech__name">M. BUBBLES</span>${esc(text)}</div>`;
}

function topBar(room, right) {
  const roundMeta = room.roundMeta;
  return `
    <header class="topbar">
      <div class="topbar__left">${logo('logo--small')}</div>
      <div class="topbar__right">
        ${
          roundMeta
            ? `<span class="chip-tag chip-tag--round">${esc(roundMeta.label)}</span>`
            : '<span class="chip-tag">LOBBY</span>'
        }
        <span class="chip-tag chip-tag--code">${esc(room.code)}</span>
        ${right || ''}
      </div>
    </header>`;
}

function stamp(text, kind) {
  return `<span class="stamp stamp--${kind}">${esc(text)}</span>`;
}

/* ------------------------------------------------------------------ */
/*  Screen: entry                                                      */
/* ------------------------------------------------------------------ */

function screenEntry() {
  return `
    <section class="screen screen--entry">
      <div class="entry-head">
        ${logo('logo--hero')}
        <p class="entry-tag">A VALENCE CORP HIRING SIMULATION</p>
      </div>

      <div class="entry-mascot">
        ${bubblesSVG()}
        ${speech('Welcome, applicant. Everyone is hired. Temporarily.')}
      </div>

      <div class="card card--pad">
        <label class="field">
          <span class="field__label">YOUR NAME (HR WILL MISSPELL IT)</span>
          <input id="nameInput" class="input" type="text" maxlength="16" autocomplete="off"
            placeholder="e.g. Dana from Accounting" value="${esc(S.entryName)}" />
        </label>

        <div class="entry-actions">
          <div class="join-row">
            <input id="codeInput" class="input input--code" type="text" maxlength="4" inputmode="latin"
              autocomplete="off" placeholder="CODE" value="${esc(S.entryCode)}" aria-label="Room code" />
            <button id="joinBtn" class="btn btn--ink" type="button">JOIN</button>
          </div>
          <div class="or"><span>OR</span></div>
          <button id="createBtn" class="btn btn--primary btn--wide" type="button">
            START A COMPANY ROOM
          </button>
        </div>
      </div>

      <div class="howto">
        <h2 class="howto__title">HOW THIS WORKS</h2>
        <ol class="howto__list">
          <li><b>Icebreakers.</b> Two nosy questions. Five words minimum. Lie freely.</li>
          <li><b>Shredding.</b> Your sentences get chopped into word tiles and handed to everyone else.</li>
          <li><b>The interview.</b> Build answers using only your colleagues' words, the question's words, and a few free ones.</li>
          <li><b>Head to head.</b> Answers face off. Everyone votes. Winners score, and so do the people whose words they stole.</li>
          <li><b>Three rounds.</b> Interview, office life, personal statement. Most points scores the JOB JOB.</li>
        </ol>
      </div>
      <p class="fineprint">3–10 APPLICANTS · ~20 MINUTES · NO EXPERIENCE REQUIRED</p>
    </section>`;
}

/* ------------------------------------------------------------------ */
/*  Screen: lobby                                                      */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/*  Shared show: every device gets the host screen, not just the host  */
/* ------------------------------------------------------------------ */

function stage(room, options) {
  const opts = options || {};
  return `
    <section class="stage ${opts.className || ''}">
      <div class="stage__bar">
        <span class="stage__brand">VALENCE CORP · INTERVIEW ROOM 3</span>
        <span class="stage__live"><i></i>LIVE · ALL DEVICES</span>
        <span class="stage__clock" data-timer>—</span>
      </div>
      <div class="stage__body">
        ${opts.top || ''}
        ${opts.body || ''}
        ${opts.bottom || ''}
      </div>
      ${
        room.memo
          ? `<div class="stage__ticker"><span class="stage__ticker-tag">HR MEMO</span><span class="stage__ticker-text">${esc(
              room.memo
            )}</span></div>`
          : ''
      }
    </section>`;
}

function panel(label, body, meta) {
  return `
    <section class="panel">
      <div class="panel__head">
        <span class="panel__tape">${esc(label || 'YOUR CONTROLLER')}</span>
        ${meta ? `<span class="tiny">${esc(meta)}</span>` : ''}
      </div>
      ${body}
    </section>`;
}

function showHead(kicker, title, sub) {
  return `
    <div class="showhead">
      <span class="kicker kicker--light">${esc(kicker)}</span>
      <h2 class="showhead__title">${esc(title)}</h2>
      ${sub ? `<p class="showhead__sub">${esc(sub)}</p>` : ''}
    </div>`;
}

function seatChips(room, ids) {
  const marked = ids || [];
  return room.players
    .map(
      (p) => `
      <span class="seat ${marked.indexOf(p.id) !== -1 ? 'seat--filed' : ''} ${
        p.connected ? '' : 'seat--off'
      }">
        ${avatar(p, 'avatar--sm')}
        <span class="seat__name">${esc(p.name)}</span>
        ${marked.indexOf(p.id) !== -1 ? '<em>✓</em>' : ''}
      </span>`
    )
    .join('');
}

/* ------------------------------------------------------------------ */
/*  Screen: lobby                                                      */
/* ------------------------------------------------------------------ */

function screenLobby(room) {
  const isHost = room.myId === room.hostId;
  const ready = room.players.filter((p) => p.connected).length;
  const enough = ready >= room.minPlayers;
  const empty = Math.max(0, room.maxPlayers - room.players.length);
  const hostName = (playerById(room, room.hostId) || {}).name || 'HR';

  return `
    <section class="screen screen--lobby">
      ${topBar(room)}

      ${stage(room, {
        className: 'stage--lobby',
        body: `
          ${showHead('TODAY ON THE BIG SCREEN', 'OPEN INTERVIEWS', 'A VALENCE CORP HIRING SIMULATION')}
          <div class="stage__codebox">
            <span class="stage__codelabel">JOIN ON YOUR DEVICE</span>
            <span class="stage__code">${esc(room.code)}</span>
            <span class="stage__codenote">The host screen now lives on every device.</span>
          </div>
          <div class="stage__mascotrow">
            ${bubblesSVG('bubbles--stage')}
            ${speech('Take a form. Sit anywhere. Do not touch the water cooler. I am the water cooler.')}
          </div>
          <div class="stage__roster">
            ${room.players
              .map(
                (p) => `
              <span class="seat ${p.connected ? '' : 'seat--off'}">
                ${avatar(p, 'avatar--sm')}
                <span class="seat__name">${esc(p.name)}</span>
                ${p.id === room.hostId ? '<em>HM</em>' : ''}
              </span>`
              )
              .join('')}
            ${Array.from({ length: empty })
              .map(() => '<span class="seat seat--empty">+ EMPTY SEAT</span>')
              .join('')}
          </div>`
      })}

      ${panel(
        'YOUR CONTROLLER',
        `
        <div class="card card--pad">
          <div class="row-between">
            <div>
              <span class="kicker">ROOM CODE</span>
              <div class="code-inline">${esc(room.code)}</div>
            </div>
            <button id="copyCode" class="mini" type="button">COPY CODE</button>
          </div>
          <ul class="players">
            ${room.players
              .map(
                (p) => `
              <li class="player-row ${p.id === room.hostId ? 'player-row--host' : ''} ${
                  p.connected ? '' : 'player-row--off'
                }">
                ${avatar(p)}
                <span class="player-row__name">${esc(p.name)}</span>
                ${p.id === room.hostId ? '<span class="tag">HIRING MANAGER</span>' : ''}
                ${p.id === room.myId ? '<span class="tag tag--you">YOU</span>' : ''}
                ${p.connected ? '' : '<span class="tag tag--off">AWAY</span>'}
              </li>`
              )
              .join('')}
          </ul>
          <p class="tiny">${ready} of ${room.maxPlayers} seats filled · ${
          enough ? 'READY TO BEGIN' : Math.max(0, room.minPlayers - ready) + ' MORE NEEDED'
        }</p>
          <div class="score-legend">
            <span><b>+1,000</b> MATCH WIN</span>
            <span><b>+300</b> EACH WORD AUTHOR</span>
            <span><b>+200</b> EACH QUESTION WORD</span>
            <span><b>+500</b> CROSS-DEPARTMENT</span>
          </div>
        </div>

        <div class="lobby-cta">
          ${
            isHost
              ? `<button id="startBtn" class="btn btn--primary btn--wide" ${
                  enough ? '' : 'disabled'
                } type="button">
                   ${enough ? 'OPEN THE INTERVIEW PROCESS' : 'NEED ' + room.minPlayers + ' APPLICANTS'}
                 </button>
                 <p class="tiny tiny--center">No pressure. The job is fake. The shame is real.</p>`
              : `<div class="waiting-panel">
                   <span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>
                   <b>WAITING FOR ${esc(hostName)} TO START</b>
                   <span class="tiny">M. Bubbles is printing the forms.</span>
                 </div>`
          }
        </div>
      `,
        `${room.players.length}/${room.maxPlayers} APPLICANTS`
      )}
    </section>`;
}

/* ------------------------------------------------------------------ */
/*  Screen: icebreakers                                                */
/* ------------------------------------------------------------------ */

function screenIcebreakers(room) {
  const filed = Boolean(room.filed);
  const prompts = room.prompts || [];
  const ids = room.filedIds || [];
  const waiting = room.players.filter((p) => p.connected && ids.indexOf(p.id) === -1);
  const minWords = room.minWords || 5;

  if (filed) {
    const mine = room.myAnswers || [];
    return `
      <section class="screen">
        ${topBar(room)}
        ${stage(room, {
          className: 'stage--filed',
          body: `
            <div class="stage__stamprow">${stamp('FILED', 'hired stamp--big')}</div>
            ${showHead(
              'ROUND 0 · SELF-ASSESSMENT',
              'PAPERWORK RECEIVED',
              'Your sentences are being shredded into word tiles as we speak.'
            )}
            <div class="stage__answers">
              ${mine
                .map(
                  (answer, index) => `
                <div class="stage__answer">
                  <span class="kicker kicker--light">YOUR ANSWER ${index + 1}</span>
                  <p>${esc(answer)}</p>
                </div>`
                )
                .join('')}
            </div>
            <div class="stage__roster">${seatChips(room, ids)}</div>
            <p class="tiny tiny--center">${ids.length}/${room.players.length} APPLICANTS HAVE FILED</p>`
        })}
        ${panel(
          'WAITING ROOM',
          `
          <div class="card card--pad waiting-panel">
            <span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>
            <b class="h2">${
              waiting.length
                ? 'WAITING ON ' + waiting.length + ' APPLICANT' + (waiting.length === 1 ? '' : 'S')
                : 'SHREDDER STARTING'
            }</b>
            <p class="muted">Everything you typed is now company property.</p>
            <div class="waiting-list">
              ${
                waiting.length
                  ? waiting
                      .map((p) => `<span class="waiting-pill">${avatar(p)}${esc(p.name)}</span>`)
                      .join('')
                  : '<span class="tiny">Everyone filed. Hold still.</span>'
              }
            </div>
          </div>
        `
        )}
        ${timerBar(150, 'TIME LEFT')}
      </section>`;
  }

  return `
    <section class="screen">
      ${topBar(room)}
      ${stage(room, {
        className: 'stage--ice',
        body: `
          ${showHead(
            'ROUND 0 · SELF-ASSESSMENT',
            'TELL US ABOUT YOURSELF',
            'Every applicant gets their own questions. Five words minimum. Lying is encouraged.'
          )}
          <div class="stage__questions">
            ${prompts
              .map(
                (prompt, index) => `
              <div class="stage__q" data-stage-q="${index}">
                <span class="stage__qno">Q${index + 1}</span>
                <p>${esc(prompt)}</p>
                <span class="stage__qcount" data-stage-count="${index}">${wordCount(
                  S.ice[index] || ''
                )}/${minWords} WORDS</span>
              </div>`
              )
              .join('')}
          </div>
          <div class="stage__roster">${seatChips(room, ids)}</div>`
      })}

      ${panel(
        'YOUR ANSWERS',
        `
        <div class="card card--pad">
          <p class="tiny">Write a whole sentence. Any sentence. HR counts the words and judges the rest.</p>
          ${prompts
            .map(
              (prompt, index) => `
            <label class="ice-field">
              <span class="field__label">ANSWER ${index + 1}</span>
              <textarea class="textarea" data-ice="${index}" rows="3" maxlength="220"
                placeholder="At least five words. More is funnier.">${esc(S.ice[index] || '')}</textarea>
              <span class="ice-field__meta">
                <span class="tiny" data-count="${index}">${wordCount(S.ice[index] || '')} words</span>
                <span class="tiny" data-ok="${index}">${
                wordCount(S.ice[index] || '') >= minWords ? 'OK' : minWords + ' MIN'
              }</span>
              </span>
            </label>`
            )
            .join('')}
        </div>
        <div class="sticky-cta">
          <button id="iceSubmit" class="btn btn--primary btn--wide" type="button" disabled>
            FILE PAPERWORK
          </button>
        </div>
      `
      )}

      ${timerBar(150, 'TIME LEFT')}
    </section>`;
}

/* ------------------------------------------------------------------ */
/*  Screen: cutscene / briefing                                        */
/* ------------------------------------------------------------------ */

function screenBriefing(room) {
  const meta = room.roundMeta || { label: 'ROUND', title: 'THE INTERVIEW', tagline: '' };
  const isHost = room.myId === room.hostId;
  const script = room.script || [];

  return `
    <section class="screen screen--center briefing">
      <div class="briefing__slide cutscene">
        <div class="cutscene__frame">
          <span class="kicker kicker--light">${esc(meta.label)}</span>
          <h1 class="briefing__title">${esc(meta.title)}</h1>
          <p class="briefing__tag">${esc(meta.tagline)}</p>
        </div>
        <div class="cutscene__stage">
          ${bubblesSVG('bubbles--briefing')}
          <div class="cutscene__lines">
            ${script
              .map(
                (line, index) => `
              <p class="cutscene__line" style="--i:${index}">${esc(line)}</p>`
              )
              .join('')}
          </div>
        </div>
        <p class="cutscene__note">M. BUBBLES · HEAD OF HIRING · PLAYING ON EVERY DEVICE</p>
      </div>
      ${
        isHost
          ? '<button id="skipBriefing" class="btn btn--ghost btn--wide" type="button">SKIP CUTSCENE</button>'
          : '<p class="tiny tiny--center">NO NEED TO CROWD THE HOST. THIS IS THE SAME CUTSCENE.</p>'
      }
      ${timerBar(7, 'STARTING IN')}
    </section>`;
}

/* ------------------------------------------------------------------ */
/*  Screen: interview (word builder)                                   */
/* ------------------------------------------------------------------ */

function chipLookup(room, promptIndex) {
  const map = new Map();
  (room.hand || []).forEach((word) => map.set(word.id, { id: word.id, text: word.text, kind: 'hand' }));
  (room.free || []).forEach((word) => map.set(word.id, { id: word.id, text: word.text, kind: 'free' }));
  const prompt = room.prompts[promptIndex];
  (prompt && prompt.words ? prompt.words : []).forEach((word) =>
    map.set(word.id, { id: word.id, text: word.text, kind: 'q' })
  );
  return map;
}

function picksFor(room) {
  const key = 'r' + room.round + 'p' + S.builderPrompt;
  const raw = S.builder[key] || [];
  const lookup = chipLookup(room, S.builderPrompt);
  return raw.filter((chip) => lookup.has(chip.id));
}

function setPicks(room, chips) {
  const key = 'r' + room.round + 'p' + S.builderPrompt;
  S.builder[key] = chips;
}

function orderKey(room) {
  return 'r' + room.round + 'p' + S.builderPrompt;
}

function orderedHand(room) {
  const hand = (room.hand || []).slice();
  const key = orderKey(room) + ':' + S.order.mode;
  if (S.order.key !== key || !S.order.ids.length) {
    if (S.order.mode === 'sort') {
      hand.sort((a, b) => a.text.localeCompare(b.text));
    } else if (S.order.mode === 'shuffle') {
      for (let i = hand.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = hand[i];
        hand[i] = hand[j];
        hand[j] = tmp;
      }
    }
    S.order = { key, ids: hand.map((w) => w.id), mode: S.order.mode };
  }
  const orderIndex = new Map(S.order.ids.map((id, i) => [id, i]));
  hand.sort(
    (a, b) =>
      (orderIndex.has(a.id) ? orderIndex.get(a.id) : 999) -
      (orderIndex.has(b.id) ? orderIndex.get(b.id) : 999)
  );
  return hand;
}

function screenInterview(room) {
  const prompts = room.prompts || [];
  const answeredAll =
    prompts.length > 0 && prompts.every((_, index) => room.myAnswers && room.myAnswers[index]);
  const meta = room.roundMeta || { label: 'ROUND', title: 'THE INTERVIEW', tagline: '' };

  if (answeredAll) {
    const waiting = room.players.filter((p) => p.connected && (room.filedIds || []).indexOf(p.id) === -1);
    return `
      <section class="screen">
        ${topBar(room)}
        ${stage(room, {
          className: 'stage--filed',
          body: `
            <div class="stage__stamprow">${stamp('FILED', 'hired stamp--big')}</div>
            ${showHead(meta.label + ' · COMPLETE', 'APPLICATION COMPLETE', 'The bracket is being drawn.')}
            <div class="stage__answers">
              ${(room.myAnswers || [])
                .filter(Boolean)
                .map(
                  (answer, index) => `
                <div class="stage__answer">
                  <span class="kicker kicker--light">YOUR ANSWER ${index + 1}</span>
                  <p>${esc(answer.text)}</p>
                </div>`
                )
                .join('')}
            </div>
            <div class="stage__roster">${seatChips(room, room.filedIds || [])}</div>
            <p class="tiny tiny--center">${(room.filedIds || []).length}/${
            room.players.length
          } APPLICANTS HAVE FILED</p>`
        })}
        ${panel(
          'WAITING ROOM',
          `
          <div class="card card--pad waiting-panel">
            <span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>
            <b class="h2">${
              waiting.length
                ? 'WAITING ON ' + waiting.length + ' APPLICANT' + (waiting.length === 1 ? '' : 'S')
                : 'BUILDING THE BRACKET'
            }</b>
            <div class="waiting-list">
              ${
                waiting.length
                  ? waiting
                      .map((p) => `<span class="waiting-pill">${avatar(p)}${esc(p.name)}</span>`)
                      .join('')
                  : '<span class="tiny">Everyone filed. Drawing the head-to-heads…</span>'
              }
            </div>
          </div>
        `
        )}
        ${timerBar(210, 'TIME LEFT')}
      </section>`;
  }

  const promptIndex = S.builderPrompt === 1 && prompts.length > 1 ? 1 : 0;
  const prompt = prompts[promptIndex];
  if (!prompt) {
    return `<section class="screen">${topBar(room)}<p class="muted">HR is still printing the questions…</p></section>`;
  }

  const picks = picksFor(room);
  const answerText = picks.map((chip) => chip.text).join(' ');
  const filedHere = Boolean(room.myAnswers && room.myAnswers[promptIndex]);
  const hand = orderedHand(room);
  const answerDisplay = prompt.blank
    ? esc(prompt.text).replace('___', `<span class="blank">${esc(answerText || '________')}</span>`)
    : esc(answerText || 'Tap a word');

  const chipButton = (chip, pool) => `
    <button class="chip chip--${pool}" type="button" data-add="${esc(chip.id)}">${esc(chip.text)}</button>`;

  return `
    <section class="screen screen--builder">
      ${topBar(room)}
      ${stage(room, {
        className: 'stage--interview',
        body: `
          ${showHead(
            meta.label + ' · QUESTION ' + (promptIndex + 1) + ' OF ' + prompts.length,
            meta.title,
            meta.tagline
          )}
          <div class="stage__question">
            <span class="stage__qlabel">${
              prompt.blank ? 'FINISH THE SENTENCE' : 'ANSWER THE QUESTION'
            }</span>
            <p class="stage__qtext">${prompt.blank ? answerDisplay : esc(prompt.text)}</p>
            <span class="stage__qfoot">${picks.length} WORD${picks.length === 1 ? '' : 'S'} PLACED${
          filedHere ? ' · FILED ✓' : ''
        }</span>
          </div>
          <div class="stage__roster">${seatChips(room, room.filedIds || [])}</div>`
      })}

      ${panel(
        'BUILD YOUR ANSWER',
        `
        <div class="qhead">
          ${
            prompts.length > 1
              ? `<div class="tabs">
                  ${prompts
                    .map(
                      (_, i) => `
                    <button class="tab ${i === promptIndex ? 'tab--on' : ''}" data-tab="${i}" type="button">
                      Q${i + 1}${room.myAnswers && room.myAnswers[i] ? ' ✓' : ''}
                    </button>`
                    )
                    .join('')}
                </div>`
              : '<span class="tiny">ONE STATEMENT ONLY</span>'
          }
          <span class="tiny">${(room.filedIds || []).length}/${room.players.length} FILED</span>
        </div>

        <div class="card card--pad tray-card">
          <div class="row-between">
            <span class="kicker">YOUR ANSWER</span>
            <span class="tiny">${picks.length} WORDS</span>
          </div>
          <div class="tray" data-tray>
            ${
              picks.length
                ? picks
                    .map(
                      (chip, index) => `
                  <button class="chip chip--placed" type="button" data-remove="${index}">${esc(
                        chip.text
                      )}</button>`
                    )
                    .join('')
                : '<span class="tray-empty">Tap words below to build your answer. Minimum two.</span>'
            }
          </div>
          <div class="tray-actions">
            <button class="mini" type="button" data-act="undo">UNDO</button>
            <button class="mini" type="button" data-act="clear">CLEAR</button>
          </div>
        </div>

        <div class="card card--pad words-card">
          <div class="row-between">
            <span class="kicker">YOUR COLLEAGUES' WORDS</span>
            <div class="toolbar">
              <button class="mini" type="button" data-act="shuffle">SHUFFLE</button>
              <button class="mini" type="button" data-act="sort">SORT A–Z</button>
              <button class="mini mini--accent" type="button" data-act="start">START FOR ME</button>
            </div>
          </div>
          <p class="tiny">Every tile was written by another applicant. Using their words earns them points
          when your answer wins.</p>
          <div class="words">
            ${
              hand.length
                ? hand.map((chip) => chipButton(chip, 'hand')).join('')
                : '<span class="tiny">No words assigned. HR is investigating.</span>'
            }
          </div>

          <span class="kicker kicker--spaced">FROM THE QUESTION</span>
          <div class="words words--q">
            ${(prompt.words || []).map((chip) => chipButton(chip, 'q')).join('')}
          </div>

          <span class="kicker kicker--spaced">FREE WORDS</span>
          <div class="words words--free">
            ${(room.free || []).map((chip) => chipButton(chip, 'free')).join('')}
          </div>
        </div>

        <div class="sticky-cta">
          ${
            filedHere
              ? `<button id="nextQuestion" class="btn btn--ink btn--wide" type="button">NEXT QUESTION</button>`
              : `<button id="fileAnswer" class="btn btn--primary btn--wide" type="button" ${
                  picks.length >= 2 ? '' : 'disabled'
                }>${picks.length >= 2 ? 'FILE ANSWER' : 'TWO WORDS MINIMUM'}</button>`
          }
          <p class="tiny tiny--center">${(room.filedIds || []).length}/${
          room.players.length
        } applicants have filed</p>
        </div>
      `,
        `ROUND ${room.round + 1} OF ${room.totalRounds}`
      )}
      ${timerBar(210, 'TIME LEFT')}
    </section>`;
}

/* ------------------------------------------------------------------ */
/*  Screen: matchup vote                                               */
/* ------------------------------------------------------------------ */

function fillPromptText(text, answer) {
  if (String(text || '').indexOf('___') === -1) return null;
  return esc(text).replace('___', `<span class="blank">${esc(answer || '—')}</span>`);
}

function matchupCard(room, side) {
  const match = room.match;
  const data = match[side];
  if (!data) {
    return '<div class="match-card match-card--empty"><span class="tiny">NO OPPONENT — BYE</span></div>';
  }
  const mine = match.mine === side;
  const voted = match.myVote === side;
  const filled = fillPromptText(match.promptText, data.text);
  const disabled = mine || !match.canVote || Boolean(match.myVote);
  return `
    <button class="match-card ${mine ? 'match-card--mine' : ''} ${voted ? 'match-card--voted' : ''}"
      type="button" data-vote="${side}" ${disabled ? 'disabled' : ''}>
      <span class="match-card__tag">${mine ? 'YOUR FILING' : side.toUpperCase()}</span>
      <span class="match-card__text">${filled || esc(data.text)}</span>
      ${mine ? '<span class="match-card__note">You cannot approve yourself.</span>' : ''}
      ${voted ? '<span class="match-card__note">REVIEW FILED ✓</span>' : ''}
    </button>`;
}

function voteDisabled(room, side) {
  const match = room.match;
  if (!match) return 'disabled';
  return match.mine === side || !match.canVote || Boolean(match.myVote) ? 'disabled' : '';
}

function screenMatchup(room) {
  const match = room.match;
  if (!match) {
    return `<section class="screen">${topBar(room)}<p class="muted">Loading matchup…</p></section>`;
  }
  const voted = Boolean(match.myVote);
  const promptLine =
    fillPromptText(match.promptText, match.blank ? '________' : null) || esc(match.promptText);
  const statusLine = !match.eligible
    ? 'You filed no answer, so you are observing this round.'
    : voted
    ? 'Review filed. Waiting for the rest of the panel…'
    : match.mine
    ? 'Vote for your opponent. Democracy is mandatory.'
    : 'Pick the answer that gets the job. Or the funniest one.';

  return `
    <section class="screen screen--matchup">
      ${topBar(room)}
      ${stage(room, {
        className: 'stage--matchup',
        body: `
          ${showHead(match.stageLabel + ' · MATCH ' + match.matchNumber, 'HEAD TO HEAD', '')}
          <p class="stage__qtext stage__qtext--plain">${promptLine}</p>
          <div class="matchup">
            ${matchupCard(room, 'a')}
            <div class="vs" aria-hidden="true">VS</div>
            ${matchupCard(room, 'b')}
          </div>
          <div class="stage__votes">
            <span>A · <b data-votes="a">${match.votes.a || 0}</b></span>
            <span>B · <b data-votes="b">${match.votes.b || 0}</b></span>
            <span>${(match.votedIds || []).length}/${match.voterCount} VOTED</span>
          </div>`
      })}

      ${panel(
        'CAST YOUR VOTE',
        `
        <div class="vote-buttons">
          <button class="vote-btn vote-btn--a ${
            match.myVote === 'a' ? 'vote-btn--on' : ''
          }" type="button" data-vote="a" ${voteDisabled(room, 'a')}>APPROVE A</button>
          <button class="vote-btn vote-btn--b ${
            match.myVote === 'b' ? 'vote-btn--on' : ''
          }" type="button" data-vote="b" ${voteDisabled(room, 'b')}>APPROVE B</button>
        </div>
        <p class="tiny tiny--center">${statusLine}</p>
        <div class="card card--pad voter-card">
          <span class="kicker">PANEL</span>
          <div class="seatrow">${seatChips(room, match.votedIds || [])}</div>
        </div>
      `,
        `${match.matchNumber} OF ${match.stageCount}`
      )}
      ${timerBar(15, 'VOTING CLOSES IN')}
    </section>`;
}

/* ------------------------------------------------------------------ */
/*  Screen: matchup result                                             */
/* ------------------------------------------------------------------ */

function revealWords(words) {
  return words
    .map(
      (word) => `
      <span class="w ${word.free ? 'w--free' : ''}">
        ${esc(word.text)}<i class="w__dot" style="--c:${esc(word.color)}" title="${esc(
        word.authorName
      )}">${esc(word.initial)}</i>
      </span>`
    )
    .join(' ');
}

function resultCard(room, side) {
  const match = room.match;
  const data = match[side];
  if (!data) {
    return `<div class="result-card result-card--empty"><span class="tiny">NO OPPONENT — BYE</span></div>`;
  }
  const won = match.winnerSide === side;
  const mine = data.authorId === room.myId;
  const filled = fillPromptText(match.promptText, data.text);
  return `
    <div class="result-card ${won ? 'result-card--win' : 'result-card--lose'}">
      <div class="result-card__top">
        ${avatar({ name: data.authorName, color: data.authorColor }, 'avatar--sm')}
        <span class="result-card__name">${esc(data.authorName)}${mine ? ' (YOU)' : ''}</span>
        ${won ? stamp('HIRED', 'hired') : stamp('REJECTED', 'rejected')}
      </div>
      <p class="result-card__text">${filled || esc(data.text)}</p>
      <div class="reveal-words">${revealWords(data.words)}</div>
      <div class="result-card__votes">
        <b>${match.votes[side] || 0}</b> vote${(match.votes[side] || 0) === 1 ? '' : 's'}
      </div>
    </div>`;
}

function screenMatchupResult(room) {
  const match = room.match;
  if (!match) {
    return `<section class="screen">${topBar(room)}<p class="muted">Tallying…</p></section>`;
  }
  const isHost = room.myId === room.hostId;
  const winner = match.winnerId === room.myId;
  const awards = (match.awards || []).filter(
    (award, index, list) =>
      list.findIndex((other) => other.id === award.id && other.reason === award.reason) === index
  );

  return `
    <section class="screen screen--result">
      ${topBar(room)}
      ${stage(room, {
        className: 'stage--result',
        body: `
          ${showHead(match.stageLabel + ' · RESULT', 'THE PANEL HAS DECIDED', match.promptText)}
          ${
            match.tieBreak
              ? '<div class="stage__flagrow"><span class="flag">TIE — BROKEN BY CROSS-DEPARTMENT WORD COUNT</span></div>'
              : ''
          }
          <div class="results">
            ${resultCard(room, 'a')}
            ${resultCard(room, 'b')}
          </div>`
      })}

      ${panel(
        'PAYROLL UPDATE',
        `
        ${
          match.crossBonus
            ? `<div class="bonus-banner">${stamp('BONUS', 'bonus')} WORDS FROM THREE DIFFERENT APPLICANTS: +500</div>`
            : ''
        }
        <div class="card card--pad awards">
          <span class="kicker">WHO GOT PAID</span>
          ${
            awards.length
              ? awards
                  .map(
                    (award) => `
                <div class="award">
                  <span class="award__name" style="--c:${esc(award.color)}">${esc(award.name)}</span>
                  <span class="award__reason">${esc(award.reason)}</span>
                  <span class="award__pts">+${fmtScore(award.points)}</span>
                </div>`
                  )
                  .join('')
              : '<p class="tiny">Nobody scored. HR is taking this personally.</p>'
          }
        </div>
        <p class="tiny tiny--center">${winner ? 'Your filing advances.' : 'HR has made a decision.'}</p>
        ${
          isHost
            ? '<button id="skipResult" class="btn btn--ink btn--wide" type="button">CONTINUE</button>'
            : '<div class="waiting-panel"><span class="dots"><i></i><i></i><i></i></span><b>NEXT MATCHUP AUTOMATIC</b></div>'
        }
      `,
        'SCORES ARE FINAL'
      )}
      ${timerBar(9, 'NEXT MATCH IN')}
    </section>`;
}

/* ------------------------------------------------------------------ */
/*  Screen: round result                                               */
/* ------------------------------------------------------------------ */

function screenRoundResult(room) {
  const result = room.roundResult;
  if (!result) {
    return `<section class="screen">${topBar(room)}<p class="muted">Tabulating…</p></section>`;
  }
  const isHost = room.myId === room.hostId;
  const board = result.leaderboard || [];

  return `
    <section class="screen screen--result">
      ${topBar(room)}
      ${stage(room, {
        className: 'stage--round',
        body: `
          ${showHead(result.label + ' · COMPLETE', result.title, 'The panel reviewed every filing. Some of you are thriving.')}
          <div class="champions">
            ${result.champions
              .map(
                (champ) => `
              <div class="card card--pad champion">
                <span class="kicker">BEST ANSWER</span>
                <p class="champion__prompt">${
                  fillPromptText(champ.prompt, champ.answer) || esc(champ.prompt)
                }</p>
                <div class="champion__meta">
                  <span class="tag" style="--c:${esc(champ.authorColor)}">${esc(
                  champ.authorName || 'NOBODY'
                )}</span>
                  ${stamp('HIRED', 'hired')}
                </div>
              </div>`
              )
              .join('')}
          </div>`
      })}

      ${panel(
        'STANDINGS',
        `
        <div class="card card--pad">
          <ol class="board">
            ${board
              .map(
                (p) => `
              <li class="board-row ${p.id === room.myId ? 'board-row--me' : ''}">
                <span class="board-row__rank">${p.rank}</span>
                ${avatar(p, 'avatar--sm')}
                <span class="board-row__name">${esc(p.name)}</span>
                <span class="board-row__title">${esc(p.title)}</span>
                <span class="board-row__score">${fmtScore(p.score)}</span>
              </li>`
              )
              .join('')}
          </ol>
        </div>
        <p class="tiny tiny--center">${
          room.round + 1 < room.totalRounds ? 'Next round is being printed.' : 'The fiscal year is ending.'
        }</p>
        ${
          isHost
            ? '<button id="skipRound" class="btn btn--ink btn--wide" type="button">CONTINUE</button>'
            : '<div class="waiting-panel"><span class="dots"><i></i><i></i><i></i></span><b>NEXT ROUND AUTOMATIC</b></div>'
        }
      `,
        'ROUND ' + (result.round + 1) + ' OF ' + room.totalRounds
      )}
      ${timerBar(10, 'NEXT ROUND IN')}
    </section>`;
}

/* ------------------------------------------------------------------ */
/*  Screen: final                                                      */
/* ------------------------------------------------------------------ */

function screenFinal(room) {
  const leaders = room.leaders || [];
  const board = room.leaderboard || [];
  const winnerNames = leaders.map((leader) => leader.name).join(' & ');
  const iWon = leaders.some((leader) => leader.id === room.myId);
  const isHost = room.myId === room.hostId;

  return `
    <section class="screen screen--final">
      ${topBar(room)}
      ${stage(room, {
        className: 'stage--final',
        body: `
          <div class="final-hero final-hero--inset">
            ${stamp('HIRED', 'hired stamp--big')}
            <h1 class="final-title">${esc(winnerNames || 'NOBODY')}</h1>
            <p class="final-sub">SCORED THE JOB JOB</p>
            <div class="final-mascot">${bubblesSVG()}</div>
            ${speech(
              iWon
                ? 'Congratulations. You are now legally responsible for the break room.'
                : 'You were not hired. But you are welcome to keep using the water cooler.'
            )}
          </div>`
      })}

      ${panel(
        'FINAL HEADCOUNT',
        `
        <div class="card card--pad">
          <ol class="board">
            ${board
              .map(
                (p) => `
              <li class="board-row ${p.rank === 1 ? 'board-row--first' : ''} ${
                  p.id === room.myId ? 'board-row--me' : ''
                }">
                <span class="board-row__rank">${p.rank}</span>
                ${avatar(p, 'avatar--sm')}
                <span class="board-row__name">${esc(p.name)}</span>
                <span class="board-row__title">${esc(p.title)}</span>
                <span class="board-row__score">${fmtScore(p.score)}</span>
              </li>`
              )
              .join('')}
          </ol>
        </div>
        ${
          isHost
            ? '<button id="playAgain" class="btn btn--primary btn--wide" type="button">INTERVIEW AGAIN</button>'
            : '<div class="waiting-panel"><span class="dots"><i></i><i></i><i></i></span><b>WAITING FOR HR</b></div>'
        }
        <p class="fineprint">THANK YOU FOR APPLYING TO VALENCE CORP · WE WILL NOT BE IN TOUCH</p>
      `,
        'THE JOB IS A LANYARD'
      )}
    </section>`;
}

/* ------------------------------------------------------------------ */
/*  Screen router                                                      */
/* ------------------------------------------------------------------ */

function screenForRoom(room) {
  switch (room.phase) {
    case 'lobby':
      return screenLobby(room);
    case 'icebreakers':
      return screenIcebreakers(room);
    case 'briefing':
      return screenBriefing(room);
    case 'interview':
      return screenInterview(room);
    case 'matchup':
      return screenMatchup(room);
    case 'matchup_result':
      return screenMatchupResult(room);
    case 'round_result':
      return screenRoundResult(room);
    case 'final':
      return screenFinal(room);
    default:
      return `<section class="screen">${topBar(room)}<p class="muted">Loading…</p></section>`;
  }
}

/* ------------------------------------------------------------------ */
/*  Interactions                                                       */
/* ------------------------------------------------------------------ */

function saveName(name) {
  try {
    localStorage.setItem('jobjob.name', name);
  } catch (error) {
    /* ignore */
  }
}

function storedName() {
  try {
    return localStorage.getItem('jobjob.name') || '';
  } catch (error) {
    return '';
  }
}

function doCreate() {
  const name = (el('nameInput') ? el('nameInput').value : S.entryName).trim();
  if (!name) {
    toast('Enter a name first. HR needs something to mispronounce.');
    return;
  }
  S.entryName = name;
  saveName(name);
  emit('create_room', { name }).then((res) => {
    if (!res.ok) {
      toast(res.error || 'HR rejected your application.');
      return;
    }
    clearSeat();
    SFX.chime();
  });
}

function doJoin() {
  const name = (el('nameInput') ? el('nameInput').value : S.entryName).trim();
  const code = (el('codeInput') ? el('codeInput').value : S.entryCode)
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, 4);
  if (!name) {
    toast('Enter a name first.');
    return;
  }
  if (code.length !== 4) {
    toast('Room codes are four letters.');
    return;
  }
  S.entryName = name;
  S.entryCode = code;
  saveName(name);
  emit('join_room', { name, code }).then((res) => {
    if (!res.ok) {
      toast(res.error || 'Could not join that room.');
      return;
    }
    SFX.chime();
  });
}

function iceReady() {
  const room = S.room;
  if (!room || !room.prompts) return false;
  const min = room.minWords || 5;
  return room.prompts.every((_, index) => wordCount(S.ice[index] || '') >= min);
}

function updateIceCounter(index) {
  const room = S.room;
  const min = room && room.minWords ? room.minWords : 5;
  const count = wordCount(S.ice[index] || '');
  const countNode = $('[data-count="' + index + '"]');
  const okNode = $('[data-ok="' + index + '"]');
  if (countNode) countNode.textContent = count + ' words';
  if (okNode) {
    okNode.textContent = count >= min ? 'OK' : min + ' MIN';
    okNode.classList.toggle('tiny--ok', count >= min);
    okNode.classList.toggle('tiny--warn', count < min);
  }
  const stageCount = $('[data-stage-count="' + index + '"]');
  if (stageCount) stageCount.textContent = count + '/' + min + ' WORDS';
  const stageQ = $('[data-stage-q="' + index + '"]');
  if (stageQ) stageQ.classList.toggle('stage__q--done', count >= min);
  const submit = el('iceSubmit');
  if (submit) submit.disabled = !iceReady();
}

function submitIcebreakers() {
  const room = S.room;
  if (!room || !iceReady()) {
    toast('Both answers need at least five words.');
    return;
  }
  emit('submit_icebreakers', { answers: [S.ice[0], S.ice[1]] }).then((res) => {
    if (!res.ok) {
      toast(res.error || 'HR rejected the paperwork.');
      return;
    }
    SFX.clack();
    vibrate(20);
  });
}

function addChip(id) {
  const room = S.room;
  if (!room || room.phase !== 'interview') return;
  if (room.myAnswers && room.myAnswers[S.builderPrompt]) return;
  const lookup = chipLookup(room, S.builderPrompt);
  const chip = lookup.get(id);
  if (!chip) return;
  const picks = picksFor(room);
  if (picks.length >= 40) {
    toast('That is a very long answer. HR caps it at 40 words.');
    return;
  }
  setPicks(room, picks.concat([{ id: chip.id, text: chip.text, kind: chip.kind }]));
  SFX.pop();
  vibrate(8);
  render(true);
}

function removeChip(index) {
  const room = S.room;
  if (!room) return;
  const picks = picksFor(room).slice();
  picks.splice(index, 1);
  setPicks(room, picks);
  SFX.pop();
  render(true);
}

function builderAction(action) {
  const room = S.room;
  if (!room || room.phase !== 'interview') return;
  const picks = picksFor(room);

  if (action === 'undo') {
    setPicks(room, picks.slice(0, -1));
    SFX.pop();
    render(true);
    return;
  }
  if (action === 'clear') {
    setPicks(room, []);
    SFX.clack();
    render(true);
    return;
  }
  if (action === 'shuffle') {
    S.order = { key: null, ids: [], mode: 'shuffle' };
    SFX.pop();
    render(true);
    return;
  }
  if (action === 'sort') {
    S.order = { key: null, ids: [], mode: 'sort' };
    SFX.pop();
    render(true);
    return;
  }
  if (action === 'start') {
    const used = new Set(picks.map((chip) => chip.id));
    const pool = (room.hand || []).filter((word) => !used.has(word.id));
    for (let i = pool.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = pool[i];
      pool[i] = pool[j];
      pool[j] = tmp;
    }
    const extra = pool.slice(0, 3).map((word) => ({ id: word.id, text: word.text, kind: 'hand' }));
    if (!extra.length) return;
    setPicks(room, picks.concat(extra));
    SFX.chime();
    render(true);
  }
}

function fileAnswer() {
  const room = S.room;
  if (!room || room.phase !== 'interview') return;
  const promptIndex = S.builderPrompt;
  const picks = picksFor(room);
  if (picks.length < 2) {
    toast('Two words minimum. HR is not flexible on this.');
    return;
  }
  emit('submit_answer', { promptIndex, wordIds: picks.map((chip) => chip.id) }).then((res) => {
    if (!res.ok) {
      toast(res.error || 'HR rejected that answer.');
      return;
    }
    SFX.clack();
    vibrate(25);
    const key = 'r' + room.round + 'p' + promptIndex;
    S.builder[key] = [];
    const slot = room.myAnswers || [null, null];
    if (promptIndex === 0 && (room.prompts || []).length > 1 && !slot[1]) {
      S.builderPrompt = 1;
    }
    render(true);
  });
}

function castVote(side) {
  const room = S.room;
  if (!room || room.phase !== 'matchup' || !room.match) return;
  if (room.match.myVote) return;
  if (room.match.mine === side) {
    toast('You cannot approve your own answer.');
    return;
  }
  emit('cast_vote', { side }).then((res) => {
    if (!res.ok) {
      toast(res.error || 'Vote rejected.');
      return;
    }
    SFX.clack();
    vibrate(15);
  });
}

function handleAction(action) {
  switch (action) {
    case 'start':
      emit('start_game', {}).then((res) => {
        if (!res.ok) toast(res.error || 'Could not start yet.');
        else SFX.chime();
      });
      break;
    case 'copy': {
      const code = S.room ? S.room.code : '';
      if (navigator.clipboard) {
        navigator.clipboard.writeText(code).then(
          () => toast('Room code ' + code + ' copied. Shout it anyway.'),
          () => toast('Copy failed. It is ' + code + '.')
        );
      } else {
        toast('Room code: ' + code);
      }
      break;
    }
    case 'leave':
      clearSeat();
      S.room = null;
      S.builder = {};
      S.ice = ['', ''];
      S.lastSignature = null;
      if (S.socket) S.socket.disconnect();
      location.reload();
      break;
    default:
      break;
  }
}

function onClick(event) {
  const removeBtn = event.target.closest('[data-remove]');
  if (removeBtn) {
    removeChip(Number(removeBtn.getAttribute('data-remove')));
    return;
  }

  const addBtn = event.target.closest('[data-add]');
  if (addBtn) {
    addChip(addBtn.getAttribute('data-add'));
    return;
  }

  const actBtn = event.target.closest('[data-act]');
  if (actBtn) {
    builderAction(actBtn.getAttribute('data-act'));
    return;
  }

  const tabBtn = event.target.closest('[data-tab]');
  if (tabBtn) {
    S.builderPrompt = Number(tabBtn.getAttribute('data-tab')) === 1 ? 1 : 0;
    SFX.pop();
    render(true);
    return;
  }

  const voteBtn = event.target.closest('[data-vote]');
  if (voteBtn) {
    castVote(voteBtn.getAttribute('data-vote'));
    return;
  }

  if (event.target.closest('#createBtn')) {
    doCreate();
    return;
  }
  if (event.target.closest('#joinBtn')) {
    doJoin();
    return;
  }
  if (event.target.closest('#copyCode')) {
    handleAction('copy');
    return;
  }
  if (event.target.closest('#startBtn')) {
    handleAction('start');
    return;
  }
  if (event.target.closest('#leaveBtn')) {
    handleAction('leave');
    return;
  }
  if (event.target.closest('#iceSubmit')) {
    submitIcebreakers();
    return;
  }
  if (event.target.closest('#fileAnswer')) {
    fileAnswer();
    return;
  }
  if (event.target.closest('#nextQuestion')) {
    const filed = (S.room && S.room.myAnswers) || [null, null];
    const multi = S.room && (S.room.prompts || []).length > 1;
    S.builderPrompt = multi && filed[0] ? 1 : 0;
    SFX.pop();
    render(true);
    return;
  }
  if (event.target.closest('#skipBriefing')) {
    emit('next_phase', {});
    return;
  }
  if (event.target.closest('#skipResult')) {
    emit('next_phase', {});
    return;
  }
  if (event.target.closest('#skipRound')) {
    emit('next_phase', {});
    return;
  }
  if (event.target.closest('#playAgain')) {
    emit('play_again', {}).then((res) => {
      if (!res.ok) {
        toast(res.error || 'Could not restart.');
        return;
      }
      S.builder = {};
      S.ice = ['', ''];
      S.builderPrompt = 0;
      S.order = { key: null, ids: [], mode: null };
      SFX.chime();
    });
    return;
  }
  if (event.target.closest('#bootRetry')) {
    location.reload();
  }
}

function bindScreen() {
  const nameInput = el('nameInput');
  if (nameInput) {
    nameInput.addEventListener('input', () => {
      S.entryName = nameInput.value;
    });
  }

  const codeInput = el('codeInput');
  if (codeInput) {
    codeInput.addEventListener('input', () => {
      const clean = codeInput.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
      if (codeInput.value !== clean) codeInput.value = clean;
      S.entryCode = clean;
    });
    codeInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') doJoin();
    });
  }

  $$('[data-ice]').forEach((textarea) => {
    const index = Number(textarea.getAttribute('data-ice'));
    textarea.addEventListener('input', () => {
      S.ice[index] = textarea.value;
      updateIceCounter(index);
    });
    updateIceCounter(index);
  });
}

function startTicker() {
  if (S.tickTimer) clearInterval(S.tickTimer);
  S.tickTimer = setInterval(updateLive, 250);
}

function init() {
  S.entryName = storedName();
  syncMuteButton();

  const muteBtn = el('muteBtn');
  if (muteBtn) {
    muteBtn.addEventListener('click', () => {
      S.muted = !S.muted;
      try {
        localStorage.setItem(STORE_MUTE, S.muted ? '1' : '0');
      } catch (error) {
        /* ignore */
      }
      syncMuteButton();
      if (!S.muted) SFX.pop();
    });
  }

  document.addEventListener('click', onClick);
  document.addEventListener(
    'pointerdown',
    () => {
      audioCtx();
    },
    { once: true }
  );

  const retry = el('bootRetry');
  if (retry) retry.addEventListener('click', () => location.reload());

  startTicker();
  connect();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
