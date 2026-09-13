'use strict';

/* ═══════════════════════════════════════════
   CANVAS roundRect polyfill (Safari < 15.4)
═══════════════════════════════════════════ */
if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
    const R = Math.min(typeof r === 'number' ? r : r[0], w/2, h/2);
    this.moveTo(x + R, y);
    this.lineTo(x + w - R, y);
    this.quadraticCurveTo(x + w, y, x + w, y + R);
    this.lineTo(x + w, y + h - R);
    this.quadraticCurveTo(x + w, y + h, x + w - R, y + h);
    this.lineTo(x + R, y + h);
    this.quadraticCurveTo(x, y + h, x, y + h - R);
    this.lineTo(x, y + R);
    this.quadraticCurveTo(x, y, x + R, y);
    this.closePath();
  };
}

/* ═══════════════════════════════════════════
   WEB AUDIO  — pre-load into AudioBuffers
   so playback is instant with zero latency.
═══════════════════════════════════════════ */
let audioCtx   = null;
let analyser   = null;
let masterGain = null;
let ctxReady   = false;  // AudioContext created (within user gesture)
let audioReady = false;  // buffers fully loaded
const buffers  = {};

const SOUND_MAP = {
  w: 'sounds/tom-1.mp3',
  a: 'sounds/tom-2.mp3',
  s: 'sounds/tom-3.mp3',
  d: 'sounds/tom-4.mp3',
  j: 'sounds/snare.mp3',
  k: 'sounds/crash.mp3',
  l: 'sounds/kick-bass.mp3',
};

/* Phase 1 — synchronous, must run WITHIN user gesture so iOS/Android
   AudioContext unlock works. No await here. */
function ensureContext() {
  if (ctxReady) return;
  audioCtx   = new (window.AudioContext || window.webkitAudioContext)();
  masterGain = audioCtx.createGain();
  masterGain.gain.value = parseFloat(document.getElementById('volSlider').value);
  analyser  = audioCtx.createAnalyser();
  analyser.fftSize = 256;
  masterGain.connect(analyser);
  analyser.connect(audioCtx.destination);
  ctxReady = true;
  loadBuffers(); // start background fetch, don't await
}

/* Phase 2 — async fetch, runs in background after context is ready */
async function loadBuffers() {
  await Promise.all(
    Object.entries(SOUND_MAP).map(async ([key, url]) => {
      try {
        const res = await fetch(url);
        const ab  = await res.arrayBuffer();
        buffers[key] = await audioCtx.decodeAudioData(ab);
      } catch { /* silent if file missing */ }
    })
  );
  audioReady = true;
}

function playSound(key) {
  if (!audioCtx || !buffers[key]) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const src = audioCtx.createBufferSource();
  src.buffer = buffers[key];
  src.connect(masterGain);
  src.start(0);
}

/* ═══════════════════════════════════════════
   PAD MAP
═══════════════════════════════════════════ */
const PAD_MAP = {};
document.querySelectorAll('.pad[data-key]').forEach(p => {
  PAD_MAP[p.dataset.key] = p;
});

/* ═══════════════════════════════════════════
   ANIMATE PAD  — scale + glow flash + ripple
═══════════════════════════════════════════ */
function animatePad(pad) {
  if (!pad) return;

  /* Scale + border glow */
  pad.classList.remove('hit');
  void pad.offsetWidth; // force reflow so animation restarts
  pad.classList.add('hit');
  pad.addEventListener('animationend', () => pad.classList.remove('hit'), { once: true });

  /* Expanding ripple ring */
  const cr   = pad.style.getPropertyValue('--cr') || '255,255,255';
  const ring = document.createElement('span');
  ring.className = 'ripple-ring';
  ring.style.cssText = `left:50%;top:50%;border-color:rgba(${cr},0.75);`;
  pad.appendChild(ring);
  ring.addEventListener('animationend', () => ring.remove(), { once: true });
}

/* ═══════════════════════════════════════════
   HIT COUNTER + COMBO
═══════════════════════════════════════════ */
let hitCount   = 0;
let combo      = 1;
let comboTimer = null;
const COMBO_WINDOW = 1600; // ms between hits to keep combo alive

const hitCountEl = document.getElementById('hitCount');
const comboValEl = document.getElementById('comboVal');
const comboBoxEl = document.getElementById('comboBox');

function registerHit() {
  hitCount++;
  hitCountEl.textContent = hitCount;
  pulseTitleBeat();

  clearTimeout(comboTimer);
  combo = Math.min(combo + 1, 64);
  comboValEl.textContent = `×${combo}`;
  comboBoxEl.classList.toggle('active', combo > 2);

  comboTimer = setTimeout(() => {
    combo = 1;
    comboValEl.textContent = '×1';
    comboBoxEl.classList.remove('active');
  }, COMBO_WINDOW);
}

/* ═══════════════════════════════════════════
   RECORDING + PLAYBACK
═══════════════════════════════════════════ */
let isRecording  = false;
let recordStart  = 0;
let recording    = [];
let playTimers   = [];

const recordBtn = document.getElementById('recordBtn');
const playBtn   = document.getElementById('playBtn');
const loopBtn   = document.getElementById('loopBtn');
const clearBtn  = document.getElementById('clearBtn');

/* ── Title beat pulse ── */
const titleEl = document.querySelector('.title');
function pulseTitleBeat() {
  if (!titleEl) return;
  titleEl.classList.remove('beat');
  void titleEl.offsetWidth;
  titleEl.classList.add('beat');
  titleEl.addEventListener('animationend', () => titleEl.classList.remove('beat'), { once: true });
}

recordBtn.addEventListener('click', () => {
  isRecording = !isRecording;
  if (isRecording) {
    stopLoop();
    recording   = [];
    recordStart = Date.now();
    recordBtn.classList.add('recording');
    recordBtn.innerHTML = '<span class="rec-dot"></span>Stop';
    playBtn.disabled  = true;
    loopBtn.disabled  = true;
    clearBtn.disabled = true;
  } else {
    recordBtn.classList.remove('recording');
    recordBtn.innerHTML = '<span class="rec-dot"></span>Record';
    const has = recording.length > 0;
    playBtn.disabled  = !has;
    loopBtn.disabled  = !has;
    clearBtn.disabled = !has;
  }
});

function playOnce() {
  if (!recording.length) return;
  playTimers.forEach(clearTimeout);
  playTimers = [];
  recording.forEach(({ key, t }) => {
    playTimers.push(setTimeout(() => {
      playSound(key);
      animatePad(PAD_MAP[key]);
    }, t));
  });
}

playBtn.addEventListener('click', () => { stopLoop(); playOnce(); });

/* ── Loop playback ── */
let isLooping   = false;
let loopTimeout = null;

function stopLoop() {
  isLooping = false;
  clearTimeout(loopTimeout);
  loopTimeout = null;
  playTimers.forEach(clearTimeout);
  playTimers = [];
  loopBtn.classList.remove('looping');
  loopBtn.textContent = '⟳ Loop';
}

function scheduleNextLoop() {
  if (!isLooping || !recording.length) return;
  const duration = recording[recording.length - 1].t + 300;
  loopTimeout = setTimeout(() => {
    if (!isLooping) return;
    playOnce();
    scheduleNextLoop();
  }, duration);
}

loopBtn.addEventListener('click', () => {
  if (!recording.length) return;
  isLooping = !isLooping;
  if (isLooping) {
    loopBtn.classList.add('looping');
    loopBtn.textContent = '⟳ Stop';
    playOnce();
    scheduleNextLoop();
  } else {
    stopLoop();
  }
});

clearBtn.addEventListener('click', () => {
  stopLoop();
  playTimers   = [];
  recording    = [];
  playBtn.disabled  = true;
  loopBtn.disabled  = true;
  clearBtn.disabled = true;
});

/* ── Help / shortcuts overlay ── */
const helpOverlay = document.getElementById('helpOverlay');
const helpClose   = document.getElementById('helpClose');

function toggleHelp(force) {
  const show = force !== undefined ? force : !helpOverlay.classList.contains('visible');
  helpOverlay.classList.toggle('visible', show);
}
helpClose.addEventListener('click', () => toggleHelp(false));

/* ═══════════════════════════════════════════
   METRONOME  — generated beep, no file needed
═══════════════════════════════════════════ */
let metroOn  = false;
let metroInt = null;

const metroBtn  = document.getElementById('metroBtn');
const bpmSlider = document.getElementById('bpmSlider');
const bpmValEl  = document.getElementById('bpmVal');

function metroBeat() {
  if (!audioCtx) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const osc = audioCtx.createOscillator();
  const g   = audioCtx.createGain();
  osc.connect(g);
  g.connect(audioCtx.destination);
  osc.frequency.value = 880;
  g.gain.setValueAtTime(0.18, audioCtx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.042);
  osc.start(audioCtx.currentTime);
  osc.stop(audioCtx.currentTime + 0.042);
}

function startMetro() {
  const ms = 60000 / parseInt(bpmSlider.value);
  metroBeat();
  metroInt = setInterval(metroBeat, ms);
}
function stopMetro() { clearInterval(metroInt); metroInt = null; }

metroBtn.addEventListener('click', () => {
  ensureContext();
  metroOn = !metroOn;
  if (metroOn) {
    startMetro();
    metroBtn.classList.add('active');
    metroBtn.textContent = '♩ ON';
  } else {
    stopMetro();
    metroBtn.classList.remove('active');
    metroBtn.textContent = '♩ Metro';
  }
});

bpmSlider.addEventListener('input', () => {
  bpmValEl.textContent = bpmSlider.value;
  if (metroOn) { stopMetro(); startMetro(); }
});

/* ═══════════════════════════════════════════
   VOLUME
═══════════════════════════════════════════ */
document.getElementById('volSlider').addEventListener('input', e => {
  if (masterGain) masterGain.gain.value = parseFloat(e.target.value);
});

/* ═══════════════════════════════════════════
   SINGLE TRIGGER POINT
   — plays sound, animates pad, logs hit,
     captures to recording if active.
═══════════════════════════════════════════ */
function triggerPad(key) {
  const pad = PAD_MAP[key];
  if (!pad) return;
  animatePad(pad);    // always immediate — no audio dependency
  registerHit();
  if (isRecording) recording.push({ key, t: Date.now() - recordStart });
  playSound(key);     // silent if buffers not loaded yet (first tap)
}

/* ── Keyboard ── */
document.addEventListener('keydown', e => {
  if (e.repeat) return;
  const key = e.key.toLowerCase();

  /* Help overlay shortcuts */
  if (key === '?' || e.key === '?') { toggleHelp(); return; }
  if (e.key === 'Escape') { toggleHelp(false); stopLoop(); return; }

  /* Control shortcuts */
  if (key === 'r') { recordBtn.click(); return; }
  if (key === 'p') { if (!playBtn.disabled) { stopLoop(); playOnce(); } return; }
  if (key === 'o') { if (!loopBtn.disabled) loopBtn.click(); return; }
  if (key === 'm') { metroBtn.click(); return; }

  /* Pad keys */
  if (!PAD_MAP[key]) return;
  ensureContext();   // synchronous context creation within keyboard gesture
  triggerPad(key);
});

/* ── Pointer (click / touch) ── */
/* passive:false lets us preventDefault so scroll doesn't steal the tap */
document.querySelectorAll('.pad').forEach(pad => {
  pad.addEventListener('pointerdown', e => {
    e.preventDefault();
    ensureContext();   // synchronous — AudioContext created within gesture
    triggerPad(pad.dataset.key);
  }, { passive: false });
});

/* ═══════════════════════════════════════════
   FREQUENCY VISUALISER  (canvas bars)
═══════════════════════════════════════════ */
const vizCanvas = document.getElementById('vizCanvas');
const vizCtx    = vizCanvas.getContext('2d');
const VIZ_COLORS = [
  '#8B5CF6','#7B6EF6','#3B82F6','#22B8A6','#14B8A6',
  '#22C55E','#84CC16','#EAB308','#F97316','#EC4899',
];

function resizeViz() {
  const dpr = window.devicePixelRatio || 1;
  vizCanvas.width  = vizCanvas.offsetWidth  * dpr;
  vizCanvas.height = vizCanvas.offsetHeight * dpr;
}
resizeViz();
window.addEventListener('resize', resizeViz, { passive: true });

function drawViz(ts) {
  const dpr = window.devicePixelRatio || 1;
  const W   = vizCanvas.offsetWidth;
  const H   = vizCanvas.offsetHeight;
  vizCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  vizCtx.clearRect(0, 0, W, H);

  const N   = 52;
  const gap = 2;
  const barW = (W - (N - 1) * gap) / N;

  if (analyser) {
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);
    const step = Math.ceil(data.length / N);

    for (let i = 0; i < N; i++) {
      let sum = 0;
      for (let j = 0; j < step; j++) sum += data[i * step + j] || 0;
      const val  = (sum / step) / 255;
      const barH = Math.max(3, val * H * 0.88);
      const x    = i * (barW + gap);
      const y    = H - barH;
      const col  = VIZ_COLORS[i % VIZ_COLORS.length];

      vizCtx.globalAlpha = 0.65 + val * 0.35;
      vizCtx.fillStyle   = col;
      vizCtx.beginPath();
      vizCtx.roundRect(x, y, barW, barH, [3, 3, 0, 0]);
      vizCtx.fill();

      // Glow on loud bars
      if (val > 0.38) {
        vizCtx.shadowColor = col;
        vizCtx.shadowBlur  = 12 * val;
        vizCtx.beginPath();
        vizCtx.roundRect(x, y, barW, barH, [3, 3, 0, 0]);
        vizCtx.fill();
        vizCtx.shadowBlur = 0;
      }
    }
  } else {
    /* Idle — static colour baseline */
    for (let i = 0; i < N; i++) {
      vizCtx.fillStyle  = VIZ_COLORS[i % VIZ_COLORS.length];
      vizCtx.globalAlpha = 0.18;
      vizCtx.fillRect(i * (barW + gap), H - 3, barW, 3);
    }
  }
  vizCtx.globalAlpha = 1;
  requestAnimationFrame(drawViz);
}
requestAnimationFrame(drawViz);

/* ═══════════════════════════════════════════
   AMBIENT BACKGROUND  (pulsing colour orbs)
═══════════════════════════════════════════ */
const bgCanvas = document.getElementById('bgCanvas');
const bgCtx    = bgCanvas.getContext('2d');

const ORBS = [
  { rx: 0.12, ry: 0.18, r: 0.40, hex: '#8B5CF6', phase: 0   },
  { rx: 0.88, ry: 0.30, r: 0.32, hex: '#3B82F6', phase: 2.1 },
  { rx: 0.50, ry: 0.80, r: 0.36, hex: '#EC4899', phase: 4.3 },
];

function resizeBg() {
  bgCanvas.width  = window.innerWidth;
  bgCanvas.height = window.innerHeight;
}
resizeBg();
window.addEventListener('resize', resizeBg, { passive: true });

function drawBg(ts) {
  const W = bgCanvas.width, H = bgCanvas.height;
  bgCtx.clearRect(0, 0, W, H);
  const t = ts / 4500;
  ORBS.forEach(o => {
    const scale = 0.94 + Math.sin(t + o.phase) * 0.08;
    const rad   = o.r * Math.min(W, H) * scale;
    const cx    = o.rx * W;
    const cy    = o.ry * H;
    const grad  = bgCtx.createRadialGradient(cx, cy, 0, cx, cy, rad);
    grad.addColorStop(0, o.hex + '1e');
    grad.addColorStop(1, o.hex + '00');
    bgCtx.fillStyle = grad;
    bgCtx.fillRect(0, 0, W, H);
  });
  requestAnimationFrame(drawBg);
}
requestAnimationFrame(drawBg);
