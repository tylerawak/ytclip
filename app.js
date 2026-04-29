// ─── State ───────────────────────────────────────────────────────────────────

const state = {
  videoId: null,
  startTime: 0.0,   // seconds, 1 decimal place
  endTime: 0.0,
  duration: 0,
  previewing: false,
};

const STEP = 0.1; // tenth-of-a-second precision

// ─── DOM refs ────────────────────────────────────────────────────────────────

const ytUrlInput      = document.getElementById('yt-url');
const loadBtn         = document.getElementById('load-btn');
const urlError        = document.getElementById('url-error');
const playerSection   = document.getElementById('player-section');
const playPauseBtn    = document.getElementById('play-pause-btn');
const currentTimeDisp = document.getElementById('current-time-display');
const durationDisp    = document.getElementById('duration-display');
const scrubber        = document.getElementById('scrubber');
const startTimeInput  = document.getElementById('start-time');
const endTimeInput    = document.getElementById('end-time');
const clipDurLabel    = document.getElementById('clip-duration-label');
const previewBtn      = document.getElementById('preview-btn');
const shareUrlInput   = document.getElementById('share-url');
const copyBtn         = document.getElementById('copy-btn');
const copyConfirm     = document.getElementById('copy-confirm');

// ─── YouTube player ──────────────────────────────────────────────────────────

let player = null;
let rafId  = null;

window.onYouTubeIframeAPIReady = function () {
  // If a videoId was parsed from the URL on load, auto-init
  if (state.videoId) initPlayer(state.videoId);
};

function initPlayer(videoId) {
  if (player) {
    player.loadVideoById(videoId);
    return;
  }
  player = new YT.Player('player', {
    videoId,
    playerVars: {
      controls: 1,
      disablekb: 0,
      modestbranding: 1,
      rel: 0,
    },
    events: {
      onReady: onPlayerReady,
      onStateChange: onPlayerStateChange,
    },
  });
}

function onPlayerReady(e) {
  state.duration = player.getDuration();
  durationDisp.textContent = formatTime(state.duration);
  if (state.startTime > 0) player.seekTo(state.startTime, true);
  startLoop();
}

function onPlayerStateChange(e) {
  const playing = e.data === YT.PlayerState.PLAYING;
  playPauseBtn.innerHTML = playing ? '&#9646;&#9646;' : '&#9654;';

  if (playing) {
    startLoop();
  } else {
    stopLoop();
    // Refresh display once when paused
    syncDisplay();
  }

  // Stop preview when it ends or is paused manually
  if (state.previewing && !playing && e.data !== YT.PlayerState.BUFFERING) {
    endPreview();
  }
}

// ─── RAF loop ────────────────────────────────────────────────────────────────

function startLoop() {
  if (rafId) return;
  (function tick() {
    syncDisplay();
    rafId = requestAnimationFrame(tick);
  })();
}

function stopLoop() {
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

function syncDisplay() {
  if (!player || typeof player.getCurrentTime !== 'function') return;
  const t = player.getCurrentTime();
  currentTimeDisp.textContent = formatTime(t);

  const dur = state.duration || player.getDuration() || 1;
  scrubber.value = Math.round((t / dur) * 1000);
}

// ─── Preview ─────────────────────────────────────────────────────────────────

function startPreview() {
  if (!player) return;
  if (state.endTime <= state.startTime) {
    showError('End time must be after start time.');
    return;
  }
  clearError();
  state.previewing = true;
  previewBtn.classList.add('previewing');
  previewBtn.textContent = 'Stop Preview';
  // loadVideoById with endSeconds lets the YouTube player stop natively,
  // firing ENDED reliably — much more robust than RAF-based bounds checking.
  player.loadVideoById({
    videoId: state.videoId,
    startSeconds: state.startTime,
    endSeconds: state.endTime,
  });
}

function endPreview() {
  state.previewing = false;
  previewBtn.classList.remove('previewing');
  previewBtn.textContent = 'Preview Clip';
}

// ─── URL parsing ─────────────────────────────────────────────────────────────

function extractVideoId(input) {
  input = input.trim();
  // youtu.be/ID
  let m = input.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
  if (m) return m[1];
  // ?v=ID or &v=ID
  m = input.match(/[?&]v=([A-Za-z0-9_-]{11})/);
  if (m) return m[1];
  // bare 11-char ID
  if (/^[A-Za-z0-9_-]{11}$/.test(input)) return input;
  return null;
}

function buildShareUrl() {
  if (!state.videoId) return '';
  return `https://ytclip.tylerawak.net/?v=${state.videoId}&st=${state.startTime.toFixed(1)}&et=${state.endTime.toFixed(1)}`;
}

function loadFromQueryString() {
  const params = new URLSearchParams(window.location.search);
  const v  = params.get('v');
  const st = parseFloat(params.get('st'));
  const et = parseFloat(params.get('et'));

  if (!v || !/^[A-Za-z0-9_-]{11}$/.test(v)) return;

  state.videoId  = v;
  state.startTime = isFinite(st) ? roundTenth(st) : 0;
  state.endTime   = isFinite(et) ? roundTenth(et) : 0;

  ytUrlInput.value = `https://www.youtube.com/watch?v=${v}`;
  showPlayer();
  updateEndpointDisplays();
  updateShareUrl();

  // Player init happens in onYouTubeIframeAPIReady if API not ready yet,
  // or directly if it already fired.
  if (typeof YT !== 'undefined' && YT.Player) {
    initPlayer(v);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function roundTenth(n) {
  return Math.round(n * 10) / 10;
}

// Accepts "1:23.4", "1:23", "83.4", "83" — returns seconds or null on bad input
function parseTimeInput(str) {
  str = str.trim();
  const colonForm = str.match(/^(\d+):(\d{1,2})(\.\d)?$/);
  if (colonForm) {
    const mins = parseInt(colonForm[1], 10);
    const secs = parseFloat(colonForm[2] + (colonForm[3] || '.0'));
    return roundTenth(mins * 60 + secs);
  }
  const n = parseFloat(str);
  return isFinite(n) && n >= 0 ? roundTenth(n) : null;
}

function commitTimeInput(target, raw) {
  const dur = state.duration || (player ? player.getDuration() : 0) || 9999;
  const parsed = parseTimeInput(raw);
  if (parsed === null) {
    // Revert to last good value
    updateEndpointDisplays();
    return;
  }
  if (target === 'start') {
    state.startTime = clamp(parsed, 0, state.endTime > 0 ? state.endTime : dur);
  } else {
    state.endTime = clamp(parsed, state.startTime, dur);
  }
  updateEndpointDisplays();
  updateShareUrl();
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function formatTime(seconds) {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(1).padStart(4, '0');
  return `${m}:${sec}`;
}

function showError(msg) {
  urlError.textContent = msg;
  urlError.classList.remove('hidden');
}

function clearError() {
  urlError.textContent = '';
  urlError.classList.add('hidden');
}

function showPlayer() {
  playerSection.classList.remove('hidden');
}

function updateEndpointDisplays() {
  startTimeInput.value = state.startTime.toFixed(1);
  endTimeInput.value   = state.endTime.toFixed(1);
  const dur = Math.max(0, state.endTime - state.startTime);
  clipDurLabel.textContent = dur.toFixed(1) + 's';
}

function updateShareUrl() {
  shareUrlInput.value = buildShareUrl();
  // Keep the URL in sync so it can be shared directly from the address bar
  if (state.videoId) {
    history.replaceState(null, '', `/?v=${state.videoId}&st=${state.startTime.toFixed(1)}&et=${state.endTime.toFixed(1)}`);
  }
}

// ─── Event handlers ──────────────────────────────────────────────────────────

loadBtn.addEventListener('click', () => {
  clearError();
  const id = extractVideoId(ytUrlInput.value);
  if (!id) {
    showError('Could not find a valid YouTube video ID in that URL.');
    return;
  }
  state.videoId   = id;
  state.startTime = 0;
  state.endTime   = 0;
  showPlayer();
  updateEndpointDisplays();
  updateShareUrl();
  initPlayer(id);
});

ytUrlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') loadBtn.click();
});

playPauseBtn.addEventListener('click', () => {
  if (!player) return;
  const s = player.getPlayerState();
  if (s === YT.PlayerState.PLAYING) {
    player.pauseVideo();
  } else {
    player.playVideo();
  }
});

scrubber.addEventListener('input', () => {
  if (!player) return;
  const dur = state.duration || player.getDuration() || 1;
  const t = (scrubber.value / 1000) * dur;
  player.seekTo(t, true);
  currentTimeDisp.textContent = formatTime(t);
});

// Step buttons (+ / -)
document.querySelectorAll('.step-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.target;   // 'start' or 'end'
    const dir    = parseFloat(btn.dataset.dir);
    const dur    = state.duration || (player ? player.getDuration() : 0) || 9999;

    if (target === 'start') {
      state.startTime = roundTenth(clamp(state.startTime + dir * STEP, 0, state.endTime || dur));
    } else {
      state.endTime = roundTenth(clamp(state.endTime + dir * STEP, state.startTime, dur));
    }
    updateEndpointDisplays();
    updateShareUrl();
  });
});

// "Set to current" buttons
document.querySelectorAll('.set-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (!player) return;
    const target = btn.dataset.target;
    const t = roundTenth(player.getCurrentTime());
    const dur = state.duration || player.getDuration() || 9999;

    if (target === 'start') {
      state.startTime = clamp(t, 0, state.endTime || dur);
    } else {
      state.endTime = clamp(t, state.startTime, dur);
    }
    updateEndpointDisplays();
    updateShareUrl();
  });
});

// Editable start/end time inputs
[startTimeInput, endTimeInput].forEach((input) => {
  const target = input.id === 'start-time' ? 'start' : 'end';

  input.addEventListener('focus', () => input.select());

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { input.blur(); return; }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const dir = e.key === 'ArrowUp' ? 1 : -1;
      const dur = state.duration || (player ? player.getDuration() : 0) || 9999;
      if (target === 'start') {
        state.startTime = roundTenth(clamp(state.startTime + dir * STEP, 0, state.endTime || dur));
      } else {
        state.endTime = roundTenth(clamp(state.endTime + dir * STEP, state.startTime, dur));
      }
      updateEndpointDisplays();
      updateShareUrl();
    }
  });

  input.addEventListener('blur', () => commitTimeInput(target, input.value));
});

previewBtn.addEventListener('click', () => {
  if (state.previewing) {
    player.pauseVideo();
    endPreview();
  } else {
    startPreview();
  }
});

copyBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(shareUrlInput.value).then(() => {
    copyConfirm.classList.remove('hidden');
    setTimeout(() => copyConfirm.classList.add('hidden'), 2000);
  });
});

// ─── Boot ────────────────────────────────────────────────────────────────────

loadFromQueryString();
