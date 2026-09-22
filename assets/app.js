/* ============================================================
   Lingora 在线语音转写工具 · 主逻辑
   零依赖（除本地托管的 transformers.js）
   ------------------------------------------------------------
   两个识别引擎：
     webspeech —— 浏览器原生 SpeechRecognition，边说边出字
     whisper   —— 本地 Whisper（transformers.js + 同源自托管模型），音频不出设备
   录音始终由 MediaRecorder 负责，因此两套引擎可以共用同一段音频。
   ============================================================ */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/* ---------------- DOM ---------------- */
const el = {
  envAlert: $('#envAlert'),
  envAlertText: $('#envAlertText'),
  recBtn: $('#recBtn'),
  recLabel: $('#recLabel'),
  recState: $('#recState'),
  recTimer: $('#recTimer'),
  wave: $('#wave'),
  langSel: $('#langSel'),
  modelSel: $('#modelSel'),
  modelField: $('#modelField'),
  modelHint: $('#modelHint'),
  progWrap: $('#progWrap'),
  progFill: $('#progFill'),
  progText: $('#progText'),
  playback: $('#playback'),
  audioEl: $('#audioEl'),
  retranscribeBtn: $('#retranscribeBtn'),
  transcript: $('#transcript'),
  interim: $('#interim'),
  statWords: $('#statWords'),
  statEngine: $('#statEngine'),
  resultTip: $('#resultTip'),
  tsNote: $('#tsNote'),
  copyBtn: $('#copyBtn'),
  dlTxtBtn: $('#dlTxtBtn'),
  dlSrtBtn: $('#dlSrtBtn'),
  dlVttBtn: $('#dlVttBtn'),
  clearBtn: $('#clearBtn'),
  afterUse: $('#afterUse'),
  afterUseEyebrow: $('#afterUseEyebrow'),
  afterUseTitle: $('#afterUseTitle'),
  afterUseDesc: $('#afterUseDesc'),
  afterUseList: $('#afterUseList'),
  stayBtn: $('#stayBtn'),
};

/* ---------------- 状态 ---------------- */
const state = {
  engine: 'webspeech',
  lang: 'zh',
  model: el.modelSel.value || 'whisper-tiny',   // 以下拉框选中项为准，避免与界面显示不一致
  recording: false,
  recorder: null,
  chunks: [],
  blob: null,
  recognition: null,
  restartingRecognition: false,
  segments: [],          // { text, start, end } —— start/end 单位：秒
  usedNoteShown: false,
  startedAt: 0,
  elapsed: 0,
  timerHandle: null,
  audioCtx: null,
  analyser: null,
  sourceNode: null,
  rafId: null,
  stream: null,
  whisper: null,          // 动态 import 的模块
  pipelines: new Map(),   // modelId -> pipeline
};

/* ---------------- 语言映射 ---------------- */
const WS_LANG = {
  zh: 'zh-CN', yue: 'zh-HK', en: 'en-US', ja: 'ja-JP', ko: 'ko-KR',
  fr: 'fr-FR', de: 'de-DE', es: 'es-ES', ru: 'ru-RU',
};
const WHISPER_LANG = {
  zh: 'chinese', yue: 'cantonese', en: 'english', ja: 'japanese', ko: 'korean',
  fr: 'french', de: 'german', es: 'spanish', ru: 'russian',
};
const LANG_LABEL = {
  zh: '中文', yue: '粤语', en: 'English', ja: '日本語', ko: '한국어',
  fr: 'Français', de: 'Deutsch', es: 'Español', ru: 'Русский', auto: '自动判断',
};

// 本地模型：体积从小到大。加载失败时降级到 FALLBACK_MODEL。
const MODEL_LABEL = { 'whisper-tiny': 'Tiny', 'whisper-base': 'Base' };
const FALLBACK_MODEL = 'whisper-tiny';

/* ---------------- 小工具 ---------------- */
const pad = (n, w = 2) => String(n).padStart(w, '0');
const fmtClock = (sec) => `${pad(Math.floor(sec / 60))}:${pad(Math.floor(sec % 60))}`;
const fmtClockLong = (sec) =>
  `${pad(Math.floor(sec / 3600))}:${pad(Math.floor((sec % 3600) / 60))}:${pad(Math.floor(sec % 60))}`;

function srtTime(sec) {
  const s = Math.max(0, sec);
  const ms = Math.floor((s % 1) * 1000);
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(Math.floor(s % 60))},${pad(ms, 3)}`;
}
function vttTime(sec) {
  return srtTime(sec).replace(',', '.');
}

function setState(text, isError = false) {
  el.recState.textContent = text;
  el.recState.classList.toggle('is-error', isError);
}

function showProgress(pct, text) {
  el.progWrap.hidden = false;
  el.progFill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  if (text) el.progText.textContent = text;
}
function hideProgress() {
  el.progWrap.hidden = true;
  el.progFill.style.width = '0%';
}

function updateStats() {
  const text = el.transcript.innerText.replace(/\s+/g, '');
  el.statWords.textContent = `${text.length} 字`;
}

/* ============================================================
   1. 环境检查
   ============================================================ */
function checkEnv() {
  const problems = [];
  if (!window.isSecureContext) {
    problems.push('当前页面不是 HTTPS 或 localhost，浏览器会禁用麦克风。请通过 https 地址打开本页。');
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    problems.push('这个浏览器不支持录音接口（getUserMedia），建议换用 Chrome 或 Edge 的新版本。');
  }
  if (!window.MediaRecorder) {
    problems.push('这个浏览器不支持 MediaRecorder，无法录制音频。建议换用 Chrome 或 Edge。');
  }
  if (problems.length) {
    el.envAlert.hidden = false;
    el.envAlertText.innerHTML = problems.join('<br />');
    el.recBtn.disabled = true;
    setState('环境不满足，无法开始录音', true);
    return false;
  }
  return true;
}

/* ============================================================
   2. 引擎可用性探测
   ============================================================ */
function getSpeechRecognition() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function probeEngines() {
  const wsBadge = $('[data-engine-state="webspeech"]');
  const whBadge = $('[data-engine-state="whisper"]');

  // 浏览器原生识别
  const SR = getSpeechRecognition();
  if (SR) {
    wsBadge.textContent = '当前浏览器可用';
    wsBadge.classList.add('is-ok');
  } else {
    wsBadge.textContent = '当前浏览器不支持';
    wsBadge.classList.add('is-bad');
    // 自动切到本地模型，避免用户一按就失败
    const whisperRadio = $('input[name="engine"][value="whisper"]');
    if (whisperRadio) {
      whisperRadio.checked = true;
      state.engine = 'whisper';
      syncEngineUI();
    }
  }

  // 本地模型：运行时已随站点托管，只需能连上镜像源
  whBadge.textContent = '运行时已就绪';
  whBadge.classList.add('is-ok');
}

/* ============================================================
   3. 引擎切换
   ============================================================ */
function syncEngineUI() {
  el.modelField.hidden = state.engine !== 'whisper';
  el.langSel.querySelector('option[value="auto"]').disabled = state.engine !== 'whisper';
  if (state.engine === 'webspeech') {
    el.resultTip.textContent = '文字会随你说话自动出现。说完点停止，就能直接在这里修改。';
  } else {
    el.resultTip.textContent = '本地模型在录音结束后才开始转写，音频不会离开这台设备。第一次用需要先下载模型。';
  }
}

$$('input[name="engine"]').forEach((radio) => {
  radio.addEventListener('change', () => {
    if (!radio.checked) return;
    state.engine = radio.value;
    syncEngineUI();
  });
});

el.langSel.addEventListener('change', () => {
  state.lang = el.langSel.value;
  if (state.engine === 'webspeech' && state.lang === 'auto') {
    state.lang = 'zh';
    el.langSel.value = 'zh';
    setState('浏览器原生识别不支持「自动判断」，已切回中文。');
  }
});

el.modelSel.addEventListener('change', () => {
  state.model = el.modelSel.value;
  el.modelHint.textContent = '';
});

/* ============================================================
   4. 计时器
   ============================================================ */
function startTimer() {
  state.startedAt = performance.now();
  stopTimer();
  state.timerHandle = window.setInterval(() => {
    state.elapsed = (performance.now() - state.startedAt) / 1000;
    el.recTimer.textContent = fmtClock(state.elapsed);
  }, 200);
}
function stopTimer() {
  if (state.timerHandle) window.clearInterval(state.timerHandle);
  state.timerHandle = null;
}
const nowSec = () =>
  state.startedAt ? (performance.now() - state.startedAt) / 1000 : 0;

/* ============================================================
   5. 波形可视化
   ============================================================ */
function setupWave() {
  const canvas = el.wave;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 520;
  const cssH = canvas.clientHeight || 48;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  ctx.scale(dpr, dpr);
  return { ctx, w: cssW, h: cssH };
}

function drawWave() {
  const { ctx, w, h } = setupWave();
  ctx.clearRect(0, 0, w, h);

  const bars = 48;
  const gap = 3;
  const bw = (w - gap * (bars - 1)) / bars;
  let data = null;

  if (state.analyser) {
    data = new Uint8Array(state.analyser.frequencyBinCount);
    state.analyser.getByteFrequencyData(data);
  }

  for (let i = 0; i < bars; i += 1) {
    let v = 0.06;
    if (data) {
      const idx = Math.floor((i / bars) * data.length * 0.62);
      v = Math.max(0.06, data[idx] / 255);
    }
    const bh = Math.max(3, v * (h - 8));
    const x = i * (bw + gap);
    const y = (h - bh) / 2;
    // 每 3 根用珊瑚色点一下，呼应「译文」那一侧的强调色
    ctx.fillStyle = i % 3 === 2 && state.recording ? '#FF7A5C' : '#12E1B0';
    ctx.globalAlpha = state.recording ? 0.95 : 0.3;
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(x, y, bw, bh, bw / 2);
    } else {
      ctx.rect(x, y, bw, bh);
    }
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function loopWave() {
  drawWave();
  if (state.recording) state.rafId = requestAnimationFrame(loopWave);
}

/* ============================================================
   6. 录音
   ============================================================ */
function pickMime() {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ];
  for (const m of candidates) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m;
  }
  return '';
}

async function startRecording() {
  if (state.recording) return;

  // 权限与环境
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  } catch (err) {
    const map = {
      NotAllowedError: '你拒绝了麦克风权限。点地址栏左侧的锁图标，把麦克风改成「允许」再试一次。',
      PermissionDeniedError: '你拒绝了麦克风权限。点地址栏左侧的锁图标，把麦克风改成「允许」再试一次。',
      NotFoundError: '没有检测到麦克风设备，检查一下是否插好或是否被系统禁用。',
      NotReadableError: '麦克风被其他程序占用了（比如会议软件），关掉那个程序再试。',
    };
    setState(map[err.name] || `无法打开麦克风：${err.message}`, true);
    return;
  }
  state.stream = stream;

  // 音频分析（波形）
  try {
    state.audioCtx = state.audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (state.audioCtx.state === 'suspended') await state.audioCtx.resume();
    state.sourceNode = state.audioCtx.createMediaStreamSource(stream);
    state.analyser = state.audioCtx.createAnalyser();
    state.analyser.fftSize = 256;
    state.analyser.smoothingTimeConstant = 0.72;
    state.sourceNode.connect(state.analyser);
  } catch (e) {
    state.analyser = null; // 波形画不出来不影响录音
  }

  // MediaRecorder
  state.chunks = [];
  const mime = pickMime();
  try {
    state.recorder = mime
      ? new MediaRecorder(stream, { mimeType: mime })
      : new MediaRecorder(stream);
  } catch (e) {
    setState(`录音初始化失败：${e.message}`, true);
    return;
  }
  state.recorder.ondataavailable = (ev) => {
    if (ev.data && ev.data.size > 0) state.chunks.push(ev.data);
  };
  state.recorder.onstop = onRecorderStop;
  state.recorder.start(250);

  // 状态
  state.recording = true;
  state.segments = [];
  state.elapsed = 0;
  el.recTimer.textContent = '00:00';
  el.recBtn.classList.add('is-recording');
  el.recLabel.textContent = '停止并转写';
  el.audioEl.removeAttribute('src');
  el.playback.hidden = true;
  startTimer();
  loopWave();

  // 实时识别
  if (state.engine === 'webspeech') {
    startWebSpeech();
    setState('正在录音并实时识别…说完点「停止并转写」');
  } else {
    setState('正在录音。本地模型会在你停止后开始转写。');
  }
}

function stopRecording() {
  if (!state.recording) return;
  state.recording = false;

  stopTimer();
  state.elapsed = nowSec();
  el.recTimer.textContent = fmtClock(state.elapsed);
  el.recBtn.classList.remove('is-recording');
  el.recLabel.textContent = '开始录音';
  cancelAnimationFrame(state.rafId);
  drawWave();

  stopWebSpeech();

  if (state.recorder && state.recorder.state !== 'inactive') {
    try { state.recorder.stop(); } catch (e) { /* ignore */ }
  }
  if (state.stream) {
    state.stream.getTracks().forEach((t) => t.stop());
    state.stream = null;
  }
  if (state.sourceNode) {
    try { state.sourceNode.disconnect(); } catch (e) { /* ignore */ }
    state.sourceNode = null;
  }
  state.analyser = null;
  flushInterim();
}

function onRecorderStop() {
  const mime = state.recorder && state.recorder.mimeType ? state.recorder.mimeType : 'audio/webm';
  state.blob = new Blob(state.chunks, { type: mime });
  state.chunks = [];

  if (state.blob.size > 0) {
    el.audioEl.src = URL.createObjectURL(state.blob);
    el.playback.hidden = false;
  }

  if (state.engine === 'whisper') {
    transcribeWithWhisper(state.blob);
  } else {
    setState(`录音结束，共 ${fmtClock(state.elapsed)}。文字已写入右侧，可以直接修改或导出。`);
    updateStats();
    unlockAfterUse();
  }
}

/* ============================================================
   7. 浏览器原生实时识别
   ============================================================ */
function startWebSpeech() {
  const SR = getSpeechRecognition();
  if (!SR) {
    setState('当前浏览器不支持原生语音识别，请切换到「本地 Whisper 模型」。', true);
    return;
  }
  const rec = new SR();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = WS_LANG[state.lang] || 'zh-CN';

  rec.onresult = (ev) => {
    let interim = '';
    for (let i = ev.resultIndex; i < ev.results.length; i += 1) {
      const res = ev.results[i];
      const txt = res[0].transcript.trim();
      if (!txt) continue;
      if (res.isFinal) {
        // 用真实经过的时间当作这一段的边界，比均匀估算准
        const end = nowSec();
        const prevEnd = state.segments.length
          ? state.segments[state.segments.length - 1].end
          : 0;
        appendSegment(txt, prevEnd, Math.max(end, prevEnd + 0.6));
      } else {
        interim += txt;
      }
    }
    el.interim.textContent = interim;
    if (interim) el.interim.textContent = `${interim}…`;
  };

  rec.onerror = (ev) => {
    const map = {
      'not-allowed': '麦克风权限被拒绝，无法进行实时识别。',
      'service-not-allowed': '浏览器拒绝了语音服务权限，可以改用「本地 Whisper 模型」。',
      network: '浏览器原生识别需要连到浏览器厂商的语音服务，当前网络访问不通。请改用「本地 Whisper 模型」，它在本地跑，不需要联网。',
      'no-speech': '没有听到说话声。',
      audio_capture: '音频采集出错，检查一下麦克风。',
    };
    if (ev.error === 'no-speech') return; // 静音不算错误，交给 onend 重启
    setState(map[ev.error] || `识别出错：${ev.error}`, true);
  };

  rec.onend = () => {
    // Chrome 在静音一段时间后会自己结束，这里自动续上
    if (state.recording && !state.restartingRecognition) {
      state.restartingRecognition = true;
      try { rec.start(); } catch (e) { /* ignore */ }
      window.setTimeout(() => { state.restartingRecognition = false; }, 300);
    }
  };

  try {
    rec.start();
    state.recognition = rec;
  } catch (e) {
    setState(`无法启动实时识别：${e.message}`, true);
  }
}

function stopWebSpeech() {
  if (!state.recognition) return;
  try { state.recognition.onend = null; state.recognition.stop(); } catch (e) { /* ignore */ }
  state.recognition = null;
}

function flushInterim() {
  const t = el.interim.textContent.replace(/…$/, '').trim();
  if (t) {
    const end = Math.max(state.elapsed, 0.6);
    const prevEnd = state.segments.length
      ? state.segments[state.segments.length - 1].end
      : 0;
    appendSegment(t, prevEnd, Math.max(end, prevEnd + 0.6));
  }
  el.interim.textContent = '';
}

/* ============================================================
   8. 结果写入
   ============================================================ */
function appendSegment(text, start, end) {
  const clean = text.trim();
  if (!clean) return;
  state.segments.push({ text: clean, start, end });

  const idx = state.segments.length - 1;
  const seg = document.createElement('div');
  seg.className = 'seg' + (idx % 2 === 1 ? ' seg--b' : '');
  seg.dataset.start = String(start);
  seg.dataset.end = String(end);

  const meta = document.createElement('span');
  meta.className = 'seg__meta';
  meta.textContent = `${String(idx + 1).padStart(2, '0')} · ${fmtClock(start)}`;

  const body = document.createElement('span');
  body.className = 'seg__body';
  body.textContent = clean;

  seg.append(meta, body);
  el.transcript.appendChild(seg);
  el.transcript.scrollTop = el.transcript.scrollHeight;
  updateStats();
  unlockAfterUse();
}

function setEngineStat(text) {
  el.statEngine.textContent = text;
}

/* ============================================================
   9. 本地 Whisper 转写
   ============================================================ */
async function loadWhisper() {
  if (state.whisper) return state.whisper;
  const mod = await import('./vendor/transformers.min.js');
  const { env } = mod;

  // ---------------------------------------------------------------
  // 关键配置：模型与 wasm 全部走同源自托管
  // 起因：hf-mirror.com 只返回 Access-Control-Allow-Origin: https://hf-mirror.com
  //       浏览器从本页 fetch 它会被 CORS 拦掉（curl 不校验 CORS，测不出来）。
  //       放进 assets/vendor/ 后是同一个源，不存在跨域，问题从根上消失。
  //
  // 路径必须用「绝对 URL」——这两件事的解析基准不一样，写相对路径必踩坑：
  //   · import('./vendor/transformers.min.js')  相对 app.js 解析
  //   · env.localModelPath / wasmPaths          直接拼进 fetch()，相对当前文档解析
  // 也就是说同样写 './vendor/'，import 能命中而 fetch 会 404（正是本站早先的故障）。
  // 用 document.baseURI 换算出绝对地址，无论页面放在 / 还是子目录都成立。
  // ---------------------------------------------------------------
  const vendorBase = new URL('assets/vendor/', document.baseURI).href;

  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = vendorBase + 'models/';
  env.useBrowserCache = true;

  if (env.backends && env.backends.onnx && env.backends.onnx.wasm) {
    // 非多线程 wasm（GitHub Pages 无法设置 COOP/COEP，拿不到 SharedArrayBuffer）
    // 该值被 emscripten 的 locateFile 直接字符串拼接 → 必须以 / 结尾
    env.backends.onnx.wasm.wasmPaths = vendorBase + 'ort/';
  }
  state.whisper = mod;
  return mod;
}

async function getPipeline(modelId) {
  if (state.pipelines.has(modelId)) return state.pipelines.get(modelId);
  const mod = await loadWhisper();

  const badge = $('[data-engine-state="whisper"]');
  badge.className = 'engine__state is-busy';
  badge.textContent = '模型加载中…';

  const pipe = await mod.pipeline('automatic-speech-recognition', modelId, {
    quantized: true,
    progress_callback: (p) => {
      if (p.status === 'progress' && p.total) {
        const pct = (p.loaded / p.total) * 100;
        showProgress(pct, `加载 ${p.file || '模型文件'} — ${pct.toFixed(0)}%`);
      } else if (p.status === 'done') {
        showProgress(100, `已就绪：${p.file || ''}`);
      }
    },
  });

  state.pipelines.set(modelId, pipe);
  badge.className = 'engine__state is-ok';
  badge.textContent = '模型已缓存';
  return pipe;
}

/**
 * 加载模型；失败且原因像「文件取不到」时，自动降级到最小的 tiny。
 *
 * 为什么需要：大模型在弱网下可能加载不下来。与其让用户卡在一个
 * 「加载失败」上重新选模型再试，不如换更小的模型先把活干完，
 * 同时同步更新下拉框，保证界面显示与实际用的模型一致。
 */
async function getPipelineWithFallback(modelId) {
  try {
    return await getPipeline(modelId);
  } catch (err) {
    const msg = String((err && err.message) || err);
    const looksLikeMissing = /404|not found|failed to fetch|load|network/i.test(msg);
    if (modelId === FALLBACK_MODEL || !looksLikeMissing) throw err;

    const from = MODEL_LABEL[modelId] || modelId;
    setState(`「${from}」没加载成功，已自动改用体积更小的 Tiny 模型继续，进度不受影响。`);
    el.modelSel.value = FALLBACK_MODEL;
    state.model = FALLBACK_MODEL;
    return await getPipeline(FALLBACK_MODEL);
  }
}

/** 把 Blob 解成 Whisper 需要的 16kHz 单声道 Float32Array */
async function decodeToPcm(blob) {
  const buf = await blob.arrayBuffer();
  const Ctx = window.AudioContext || window.webkitAudioContext;
  // 直接以 16kHz 建上下文，让 decodeAudioData 顺手完成重采样
  const ctx = new Ctx({ sampleRate: 16000 });
  const audio = await ctx.decodeAudioData(buf.slice(0));
  const pcm = audio.getChannelData(0);
  const out = new Float32Array(pcm.length);
  out.set(pcm);
  try { await ctx.close(); } catch (e) { /* ignore */ }
  return out;
}

async function transcribeWithWhisper(blob) {
  if (!blob || blob.size === 0) {
    setState('没有录到音频，无法转写。', true);
    return;
  }
  el.recBtn.disabled = true;
  setEngineStat('本地模型转写中');

  try {
    setState('正在加载本地模型…首次使用要读取模型文件，之后就快了。');
    showProgress(1, '加载运行时…');
    const pipe = await getPipelineWithFallback(state.model);

    setState('模型就绪，正在解码音频…');
    showProgress(100, '解码音频…');
    const pcm = await decodeToPcm(blob);

    setState('正在转写，长录音会慢一些…');
    const total = pcm.length / 16000;
    showProgress(0, `已解码 ${fmtClock(total)} 音频，开始推理…`);

    const langKey = state.lang === 'auto' ? undefined : (WHISPER_LANG[state.lang] || 'chinese');
    const out = await pipe(pcm, {
      task: 'transcribe',
      language: langKey,
      return_timestamps: true,
      chunk_length_s: 30,
      stride_length_s: 5,
      callback_function: undefined,
    });

    hideProgress();
    el.recBtn.disabled = false;

    renderWhisperOutput(out);

    setState(`转写完成，共 ${fmtClock(total)} 音频。可以修改、复制或导出了。`);
    setEngineStat(`本地模型 · ${LANG_LABEL[state.lang] || ''}`);
    unlockAfterUse();
  } catch (err) {
    hideProgress();
    el.recBtn.disabled = false;
    console.error(err);
    const msg = String(err && err.message ? err.message : err);
    if (/memory|allocat|RangeError|Array buffer/i.test(msg)) {
      setState('内存不足，转写被中断。建议把模型换成 Tiny，或者把录音分成几段分别处理。', true);
    } else if (/fetch|network|Failed|load/i.test(msg)) {
      setState('模型文件加载失败。模型是从本站同源加载的，请刷新页面重试；也可以先切回「浏览器实时识别」。', true);
    } else {
      setState(`本地转写失败：${msg}`, true);
    }
  }
}

function renderWhisperOutput(out) {
  // 先清掉旧结果，避免和上一段混在一起
  el.transcript.innerHTML = '';
  state.segments = [];

  const chunks = Array.isArray(out && out.chunks) ? out.chunks : null;

  if (chunks && chunks.length) {
    chunks.forEach((c, i) => {
      const text = Array.isArray(c.text) ? c.text.join('') : c.text;
      const clean = String(text || '').trim();
      if (!clean) return;
      const start = Array.isArray(c.timestamp) && c.timestamp[0] != null ? c.timestamp[0] : 0;
      let end = Array.isArray(c.timestamp) && c.timestamp[1] != null ? c.timestamp[1] : null;
      if (end == null) end = start + Math.max(1, clean.length * 0.15);

      state.segments.push({ text: clean, start, end });

      const seg = document.createElement('div');
      seg.className = 'seg' + (i % 2 === 1 ? ' seg--b' : '');
      seg.dataset.start = String(start);
      seg.dataset.end = String(end);

      const meta = document.createElement('span');
      meta.className = 'seg__meta';
      meta.textContent = `${String(i + 1).padStart(2, '0')} · ${fmtClock(start)}`;

      const body = document.createElement('span');
      body.className = 'seg__body';
      body.textContent = clean;

      seg.append(meta, body);
      el.transcript.appendChild(seg);
    });
  } else {
    const text = String((out && out.text) || '').trim();
    if (text) {
      const end = state.elapsed || 1;
      state.segments.push({ text, start: 0, end });
      const seg = document.createElement('div');
      seg.className = 'seg';
      seg.dataset.start = '0';
      seg.dataset.end = String(end);
      const body = document.createElement('span');
      body.className = 'seg__body';
      body.textContent = text;
      seg.appendChild(body);
      el.transcript.appendChild(seg);
    }
  }

  if (!state.segments.length) {
    setState('这段音频里没有识别到可转写的语音内容。', true);
  }
  updateStats();
}

/* ============================================================
   10. 导出
   ============================================================ */
/** 从 DOM 收集当前段落（用户可能已经手动改过文字） */
function collectSegments() {
  const nodes = $$('.seg', el.transcript);
  if (nodes.length && nodes.length === state.segments.length) {
    return nodes.map((n, i) => {
      const body = $('.seg__body', n);
      return {
        text: (body ? body.innerText : n.innerText).trim(),
        start: Number(n.dataset.start || state.segments[i].start),
        end: Number(n.dataset.end || state.segments[i].end),
      };
    });
  }
  if (nodes.length) {
    // 段落数不一致（用户手动增删过），时间轴按总时长均分
    const total = Math.max(state.elapsed, 1);
    return nodes.map((n, i) => {
      const body = $('.seg__body', n);
      const step = total / nodes.length;
      return {
        text: (body ? body.innerText : n.innerText).trim(),
        start: i * step,
        end: (i + 1) * step,
      };
    });
  }
  const plain = el.transcript.innerText.trim();
  return plain ? [{ text: plain, start: 0, end: Math.max(state.elapsed, 1) }] : [];
}

function download(filename, content, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function stamp() {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function toSrt(segs) {
  return segs
    .map((s, i) => `${i + 1}\n${srtTime(s.start)} --> ${srtTime(s.end)}\n${s.text}\n`)
    .join('\n');
}
function toVtt(segs) {
  const body = segs
    .map((s) => `${vttTime(s.start)} --> ${vttTime(s.end)}\n${s.text}\n`)
    .join('\n');
  return `WEBVTT\n\n${body}`;
}

el.copyBtn.addEventListener('click', async () => {
  const segs = collectSegments();
  const text = segs.length
    ? segs.map((s) => s.text).join('\n')
    : el.transcript.innerText.trim();
  if (!text) { setState('还没有可以复制的内容。', true); return; }
  try {
    await navigator.clipboard.writeText(text);
    el.copyBtn.textContent = '已复制';
    window.setTimeout(() => { el.copyBtn.textContent = '复制全文'; }, 1600);
  } catch (e) {
    // 剪贴板 API 在非安全上下文会被拦，退回到选中方式
    const range = document.createRange();
    range.selectNodeContents(el.transcript);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    setState('已为你选中全文，按 Ctrl+C 复制。');
  }
});

el.dlTxtBtn.addEventListener('click', () => {
  const segs = collectSegments();
  if (!segs.length) { setState('还没有可以导出的内容。', true); return; }
  const lines = segs.map((s, i) => `${String(i + 1).padStart(3, '0')}  [${fmtClockLong(s.start)}]  ${s.text}`);
  const head = [
    'Lingora 在线语音转写',
    `导出时间：${new Date().toLocaleString('zh-CN')}`,
    `语言：${el.langSel.options[el.langSel.selectedIndex].text}`,
    `时长：${fmtClockLong(state.elapsed)}`,
    '',
    '─'.repeat(48),
    '',
  ].join('\n');
  download(`lingora-转写-${stamp()}.txt`, head + lines.join('\n') + '\n');
  setState('TXT 已开始下载。');
});

el.dlSrtBtn.addEventListener('click', () => {
  const segs = collectSegments();
  if (!segs.length) { setState('还没有可以导出的内容。', true); return; }
  download(`lingora-字幕-${stamp()}.srt`, toSrt(segs), 'application/x-subrip;charset=utf-8');
  if (state.engine === 'webspeech') el.tsNote.hidden = false;
  setState('SRT 字幕已开始下载。');
});

el.dlVttBtn.addEventListener('click', () => {
  const segs = collectSegments();
  if (!segs.length) { setState('还没有可以导出的内容。', true); return; }
  download(`lingora-字幕-${stamp()}.vtt`, toVtt(segs), 'text/vtt;charset=utf-8');
  if (state.engine === 'webspeech') el.tsNote.hidden = false;
  setState('VTT 字幕已开始下载。');
});

el.clearBtn.addEventListener('click', () => {
  el.transcript.innerHTML = '';
  el.interim.textContent = '';
  state.segments = [];
  state.blob = null;
  state.elapsed = 0;
  el.recTimer.textContent = '00:00';
  el.playback.hidden = true;
  el.audioEl.removeAttribute('src');
  el.tsNote.hidden = true;
  setEngineStat('未开始');
  updateStats();
  drawWave();
  setState('已清空，可以重新开始。');
});

el.retranscribeBtn.addEventListener('click', () => {
  if (!state.blob) { setState('还没有录到音频。', true); return; }
  const whisperRadio = $('input[name="engine"][value="whisper"]');
  if (whisperRadio) { whisperRadio.checked = true; state.engine = 'whisper'; syncEngineUI(); }
  transcribeWithWhisper(state.blob);
});

/* ============================================================
   11. 主按钮
   ============================================================ */
el.recBtn.addEventListener('click', () => {
  if (state.recording) stopRecording();
  else startRecording();
});

/* 编辑内容时同步字数 */
el.transcript.addEventListener('input', () => {
  updateStats();
  unlockAfterUse();
});
el.transcript.addEventListener('paste', (ev) => {
  // 粘贴时只取纯文本，避免把外部样式带进来
  ev.preventDefault();
  const text = (ev.clipboardData || window.clipboardData).getData('text/plain');
  document.execCommand('insertText', false, text);
});

/* ============================================================
   12. 用完之后才给下载入口
   ============================================================ */
function unlockAfterUse() {
  if (state.usedNoteShown) return;
  const has = el.transcript.innerText.replace(/\s+/g, '').length > 8;
  if (!has) return;
  state.usedNoteShown = true;
  el.afterUse.classList.add('is-ready');
  el.afterUseEyebrow.textContent = '你已经在用了';
  el.afterUseTitle.textContent = '网页版能解决，就不用下载';
  el.afterUseDesc.textContent =
    '上面这些功能没有一分钱、也没有时长限制，随时可以回来用。只有当你想把在线会议、网课、视频里的声音也转成文字时，桌面版才值得装——它还在开发中。';
  el.afterUseList.hidden = false;
}

el.stayBtn.addEventListener('click', () => {
  setState('好的，继续用网页版。这个页面可以一直开着。');
  el.afterUse.scrollIntoView({ behavior: 'smooth', block: 'center' });
});

/* ============================================================
   13. 初始化
   ============================================================ */
(function init() {
  const ok = checkEnv();
  probeEngines();
  syncEngineUI();
  drawWave();
  updateStats();

  if (ok && state.engine === 'webspeech' && !getSpeechRecognition()) {
    setState('当前浏览器不支持原生实时识别，已自动切到本地 Whisper 模型。');
  } else if (ok) {
    setState('准备好了，点上面的按钮开始录音。');
  }

  window.addEventListener('beforeunload', (ev) => {
    if (state.recording) {
      ev.preventDefault();
      ev.returnValue = '';
    }
  });
})();
