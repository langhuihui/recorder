/**
 * 练唱录音：伴奏来自 /api/public 练唱歌曲 + 声部；歌谱垂直滚动显示当前页码。
 */
(function () {
  const PUBLIC_SONGS_API = '/api/public/songs';
  const PDFJS_VERSION = '4.9.124';
  const PDF_MODULE = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.mjs`;
  const PDF_WORKER = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.mjs`;

  let pdfjsLoadPromise = null;
  function loadPdfJs() {
    if (!pdfjsLoadPromise) {
      pdfjsLoadPromise = import(PDF_MODULE).then((lib) => {
        lib.GlobalWorkerOptions.workerSrc = PDF_WORKER;
        return lib;
      });
    }
    return pdfjsLoadPromise;
  }

  function isPdfSheet(s) {
    const k = (s.file_key || '').toLowerCase();
    if (k.endsWith('.pdf')) return true;
    return /\.pdf(\?|#|$)/i.test(s.url || '');
  }

  const PART_LABELS = {
    soprano: '高音',
    alto: '中音',
    tenor: '次中音',
    bass: '低音',
  };

  const VOCAL_PARTS_ORDER = ['soprano', 'alto', 'tenor', 'bass'];

  const HISTORY_MAX = 600;
  const COMBO_MIC_ALPHA = 0.45;
  const COMBO_LINE_STROKE = '#cbd5e1';

  let rootEl;
  let songSelectEl;
  let audioTrackSelectEl;
  let songSelectMobile;
  let audioTrackSelectModal;
  let pickModalEl;
  let pickModalTitleEl;
  let pickModalBackdrop;
  let pickModalDoneBtn;
  let modalSongBlock;
  let openSongModalBtn;
  let sheetScrollEl;
  let sheetTitleEl;
  let bgHintEl;
  let bgMetaEl;
  let bgLabelEl;
  let bgVolEl;
  let bgVolPctEl;
  let bgProgressEl;
  let clearBgBtn;
  let headphoneEl;
  let mixLabelEl;
  let timeDisplayEl;
  let micCanvas;
  let bgCanvas;
  let mixCanvas;
  let comboCanvas;
  let micDotEl;
  let micDotComboEl;
  let seekEl;
  let seekFillEl;
  let playbackRowEl;
  let startBtn;
  let stopBtn;
  let stoppedActionsEl;
  let playBtn;
  let resetBtn;
  let shareBtn;
  let downloadBtn;
  let playbackAudioEl;
  let openBtn;
  let closeBtn;

  let practiceSongs = [];
  let currentSongDetail = null;
  let sheetPageCount = 0;

  /** 参考音频下拉里「本地伴奏」选项的 value */
  const LOCAL_BG_TRACK_VALUE = 'local:bg';

  /** 持久化的本地伴奏 object URL（切换云端音轨时不撤销，便于再次选用） */
  let localBgBlobUrl = null;
  let localBgFileName = '';

  /** @type {{ kind: 'image'; blobUrl: string; name: string } | { kind: 'pdf'; file: File; name: string }}[] */
  let localSheetEntries = [];

  let localSheetsInput;
  let localBgBtn;
  let localBgInput;
  let modalLocalSheetsBtn;
  let modalLocalBgBtn;
  let modalClearLocalSheetsBtn;
  let wavesEl;

  let recordingState = 'idle';
  let audioUrl = null;
  let duration = 0;
  let currentTime = 0;
  let isPlaying = false;
  let isHeadphoneMode = false;
  let bgMusicUrl = null;
  let bgMusicTitle = '';
  let bgVolume = 0.5;
  let bgDuration = 0;
  let bgCurrentTime = 0;
  let outputExt = '';

  let mediaRecorder = null;
  const audioChunks = [];
  let audioBlob = null;
  let animationId = null;
  let timerId = null;
  let replayRafId = null;
  let isSeeking = false;

  const micHistory = [];
  const bgHistory = [];
  const mixHistory = [];
  const micAllHistory = [];
  const bgAllHistory = [];
  const mixAllHistory = [];
  let micReplayHistory = [];
  let bgReplayHistory = [];
  let mixReplayHistory = [];

  let micAnalyser = null;
  let bgAnalyser = null;
  let mixAnalyser = null;
  let audioContext = null;
  let isRecordingFlag = false;

  let bgAudioElement = null;
  let bgGainNode = null;
  let bgTimeHandler = null;
  let bgMetaHandler = null;

  const pcmChunks = [];
  let pcmSampleRate = 0;
  let pcmCaptureNode = null;
  let pcmSourceNode = null;
  let pcmZeroGain = null;

  const canRecordM4a =
    typeof MediaRecorder !== 'undefined' &&
    (MediaRecorder.isTypeSupported('audio/mp4;codecs=mp4a.40.2') || MediaRecorder.isTypeSupported('audio/mp4'));

  function formatTime(s) {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }

  function getPeak(analyser) {
    const bufferLength = analyser.fftSize;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteTimeDomainData(dataArray);
    let peak = 0;
    for (let i = 0; i < bufferLength; i++) {
      const v = Math.abs(dataArray[i] - 128) / 128;
      if (v > peak) peak = v;
    }
    return peak;
  }

  function resamplePeaks(peaks, targetPoints) {
    if (targetPoints <= 0 || peaks.length === 0) return [];
    if (peaks.length <= targetPoints) return peaks.slice();
    const out = new Array(targetPoints).fill(0);
    for (let i = 0; i < targetPoints; i++) {
      const start = Math.floor((i * peaks.length) / targetPoints);
      const end = Math.floor(((i + 1) * peaks.length) / targetPoints);
      let m = 0;
      for (let j = start; j < end && j < peaks.length; j++) m = Math.max(m, peaks[j]);
      out[i] = m;
    }
    return out;
  }

  function useMobileWaveLayout() {
    return typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 900px)').matches;
  }

  function strokeCenterPlayhead(ctx, centerX, h, color) {
    ctx.strokeStyle = `${color}ee`;
    ctx.lineWidth = Math.max(2, (window.devicePixelRatio || 1) * 1);
    ctx.beginPath();
    ctx.moveTo(centerX, 0);
    ctx.lineTo(centerX, h);
    ctx.stroke();
  }

  function drawMirrorWaveShape(ctx, h, xs, peaks, color, glowColor) {
    const cx = h / 2;
    const n = xs.length;
    if (n < 2 || peaks.length !== n) return;

    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const y = cx - peaks[i] * cx * 0.85;
      if (i === 0) ctx.moveTo(xs[i], y);
      else ctx.lineTo(xs[i], y);
    }
    for (let i = n - 1; i >= 0; i--) {
      const y = cx + peaks[i] * cx * 0.85;
      ctx.lineTo(xs[i], y);
    }
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, `${color}66`);
    grad.addColorStop(0.5, `${color}22`);
    grad.addColorStop(1, `${color}66`);
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = 4;

    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const y = cx - peaks[i] * cx * 0.85;
      if (i === 0) ctx.moveTo(xs[i], y);
      else ctx.lineTo(xs[i], y);
    }
    ctx.stroke();

    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const y = cx + peaks[i] * cx * 0.85;
      if (i === 0) ctx.moveTo(xs[i], y);
      else ctx.lineTo(xs[i], y);
    }
    ctx.stroke();

    ctx.shadowBlur = 0;
  }

  function drawMobileRecordingWave(canvas, history, color, glowColor) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    const cx = h / 2;
    const centerX = w * 0.5;
    ctx.fillStyle = '#17172c';
    ctx.fillRect(0, 0, w, h);
    const n = history.length;
    if (n >= 2) {
      const leftSpan = centerX;
      const xs = new Array(n);
      for (let i = 0; i < n; i++) {
        const t = n <= 1 ? 1 : i / (n - 1);
        xs[i] = centerX - (1 - t) * leftSpan;
      }
      drawMirrorWaveShape(ctx, h, xs, history, color, glowColor);
    } else if (n === 1) {
      const p = history[0];
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = 3;
      ctx.beginPath();
      ctx.moveTo(centerX, cx - p * cx * 0.85);
      ctx.lineTo(centerX, cx + p * cx * 0.85);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    strokeCenterPlayhead(ctx, centerX, h, color);
  }

  function drawMobileReplayWave(canvas, history, color, glowColor, progress) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    const cx = h / 2;
    const centerX = w * 0.5;
    ctx.fillStyle = '#17172c';
    ctx.fillRect(0, 0, w, h);
    const n = history.length;
    const pr = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
    if (n >= 2) {
      const half = w * 0.5;
      const scale = n <= 1 ? 0 : half / (n - 1);
      const idx = n <= 1 ? 0 : pr * (n - 1);
      const xs = new Array(n);
      for (let i = 0; i < n; i++) {
        xs[i] = centerX + (i - idx) * scale;
      }
      drawMirrorWaveShape(ctx, h, xs, history, color, glowColor);
    } else if (n === 1) {
      const p = history[0];
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(centerX, cx - p * cx * 0.85);
      ctx.lineTo(centerX, cx + p * cx * 0.85);
      ctx.stroke();
    }
    strokeCenterPlayhead(ctx, centerX, h, color);
  }

  function alignedHistPair(mixH, micH) {
    const n = Math.min(mixH.length, micH.length);
    if (n < 1) return { n: 0, mix: [], mic: [] };
    return {
      n,
      mix: mixH.slice(mixH.length - n),
      mic: micH.slice(micH.length - n),
    };
  }

  function alignedReplayPair(mixH, micH) {
    const n = Math.min(mixH.length, micH.length);
    if (n < 1) return { n: 0, mix: [], mic: [] };
    return { n, mix: mixH.slice(0, n), mic: micH.slice(0, n) };
  }

  function drawMobileComboRecording(canvas, mixH, micH) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    const cx = h / 2;
    const centerX = w * 0.5;
    ctx.fillStyle = '#17172c';
    ctx.fillRect(0, 0, w, h);
    const { n, mix, mic } = alignedHistPair(mixH, micH);
    if (n < 1) {
      strokeCenterPlayhead(ctx, centerX, h, COMBO_LINE_STROKE);
      return;
    }
    if (n >= 2) {
      const leftSpan = centerX;
      const xs = new Array(n);
      for (let i = 0; i < n; i++) {
        const t = n <= 1 ? 1 : i / (n - 1);
        xs[i] = centerX - (1 - t) * leftSpan;
      }
      drawMirrorWaveShape(ctx, h, xs, mix, '#4ade80', '#22c55e');
      ctx.save();
      ctx.globalAlpha = COMBO_MIC_ALPHA;
      drawMirrorWaveShape(ctx, h, xs, mic, '#f472b6', '#ec4899');
      ctx.restore();
    } else {
      const pm = mix[0];
      const pi = mic[0];
      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = 2;
      ctx.shadowColor = '#22c55e';
      ctx.shadowBlur = 3;
      ctx.beginPath();
      ctx.moveTo(centerX, cx - pm * cx * 0.85);
      ctx.lineTo(centerX, cx + pm * cx * 0.85);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.save();
      ctx.globalAlpha = COMBO_MIC_ALPHA;
      ctx.strokeStyle = '#f472b6';
      ctx.shadowColor = '#ec4899';
      ctx.shadowBlur = 3;
      ctx.beginPath();
      ctx.moveTo(centerX, cx - pi * cx * 0.85);
      ctx.lineTo(centerX, cx + pi * cx * 0.85);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.restore();
    }
    strokeCenterPlayhead(ctx, centerX, h, COMBO_LINE_STROKE);
  }

  function drawMobileComboReplay(canvas, mixH, micH, progress) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    const cx = h / 2;
    const centerX = w * 0.5;
    ctx.fillStyle = '#17172c';
    ctx.fillRect(0, 0, w, h);
    const { n, mix, mic } = alignedReplayPair(mixH, micH);
    if (n < 1) {
      strokeCenterPlayhead(ctx, centerX, h, COMBO_LINE_STROKE);
      return;
    }
    const pr = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
    if (n >= 2) {
      const half = w * 0.5;
      const scale = n <= 1 ? 0 : half / (n - 1);
      const idx = n <= 1 ? 0 : pr * (n - 1);
      const xs = new Array(n);
      for (let i = 0; i < n; i++) {
        xs[i] = centerX + (i - idx) * scale;
      }
      drawMirrorWaveShape(ctx, h, xs, mix, '#4ade80', '#22c55e');
      ctx.save();
      ctx.globalAlpha = COMBO_MIC_ALPHA;
      drawMirrorWaveShape(ctx, h, xs, mic, '#f472b6', '#ec4899');
      ctx.restore();
    } else {
      const pm = mix[0];
      const pi = mic[0];
      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(centerX, cx - pm * cx * 0.85);
      ctx.lineTo(centerX, cx + pm * cx * 0.85);
      ctx.stroke();
      ctx.save();
      ctx.globalAlpha = COMBO_MIC_ALPHA;
      ctx.strokeStyle = '#f472b6';
      ctx.beginPath();
      ctx.moveTo(centerX, cx - pi * cx * 0.85);
      ctx.lineTo(centerX, cx + pi * cx * 0.85);
      ctx.stroke();
      ctx.restore();
    }
    strokeCenterPlayhead(ctx, centerX, h, COMBO_LINE_STROKE);
  }

  function replayBitmapTargetPoints() {
    if (useMobileWaveLayout() && comboCanvas && comboCanvas.width > 0) return comboCanvas.width;
    if (micCanvas && micCanvas.width > 0) return micCanvas.width;
    return 700;
  }

  function setRecordingDotsVisible(visible) {
    if (micDotEl) micDotEl.classList.toggle('hidden', !visible);
    if (micDotComboEl) micDotComboEl.classList.toggle('hidden', !visible);
  }

  function drawSingleWave(canvas, history, color, glowColor, cursorRatio) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    const cx = h / 2;

    ctx.fillStyle = '#17172c';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = `${color}22`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, cx);
    ctx.lineTo(w, cx);
    ctx.stroke();

    if (history.length >= 2) {
      ctx.beginPath();
      for (let i = 0; i < history.length; i++) {
        const x = history.length <= 1 ? 0 : (i / (history.length - 1)) * w;
        const y = cx - history[i] * cx * 0.85;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      for (let i = history.length - 1; i >= 0; i--) {
        const x = history.length <= 1 ? 0 : (i / (history.length - 1)) * w;
        const y = cx + history[i] * cx * 0.85;
        ctx.lineTo(x, y);
      }
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, `${color}66`);
      grad.addColorStop(0.5, `${color}22`);
      grad.addColorStop(1, `${color}66`);
      ctx.fillStyle = grad;
      ctx.fill();

      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = 4;

      ctx.beginPath();
      for (let i = 0; i < history.length; i++) {
        const x = history.length <= 1 ? 0 : (i / (history.length - 1)) * w;
        const y = cx - history[i] * cx * 0.85;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      ctx.beginPath();
      for (let i = 0; i < history.length; i++) {
        const x = history.length <= 1 ? 0 : (i / (history.length - 1)) * w;
        const y = cx + history[i] * cx * 0.85;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      ctx.shadowBlur = 0;
    }

    const ratio = Number.isFinite(cursorRatio) ? cursorRatio : 0;
    const cursorX = Math.max(0, Math.min(1, ratio)) * w;
    ctx.strokeStyle = `${color}99`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cursorX, 0);
    ctx.lineTo(cursorX, h);
    ctx.stroke();
  }

  function drawWaveUnified(canvas, history, color, glowColor, cursorRatio, phase) {
    if (!canvas) return;
    const hist = history || [];
    if (useMobileWaveLayout()) {
      if (hist.length === 0) {
        initWaveCanvas(canvas, color);
        return;
      }
      if (phase === 'recording') drawMobileRecordingWave(canvas, hist, color, glowColor);
      else drawMobileReplayWave(canvas, hist, color, glowColor, cursorRatio);
    } else {
      drawSingleWave(canvas, hist, color, glowColor, cursorRatio);
    }
  }

  function initWaveCanvas(canvas, color) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = '#17172c';
    ctx.fillRect(0, 0, w, h);
    if (useMobileWaveLayout()) {
      strokeCenterPlayhead(ctx, w * 0.5, h, color);
    } else {
      ctx.strokeStyle = `${color}33`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();
    }
  }

  function setPlayButtonUi(playing) {
    if (!playBtn) return;
    playBtn.classList.toggle('recorder-is-playing', playing);
    const label = playing ? '暂停' : '播放';
    playBtn.setAttribute('aria-label', label);
    playBtn.setAttribute('title', label);
  }

  function resizeCanvasToLayout() {
    const map = [
      [micCanvas, '#f472b6'],
      [bgCanvas, '#60a5fa'],
      [mixCanvas, '#4ade80'],
      [comboCanvas, '#4ade80'],
    ];
    const dpr = window.devicePixelRatio || 1;
    map.forEach(([canvas, color]) => {
      if (!canvas) return;
      let rw = canvas.getBoundingClientRect().width;
      let rh = canvas.getBoundingClientRect().height;
      if (rw < 2 && canvas.parentElement) {
        const pr = canvas.parentElement.getBoundingClientRect();
        rw = pr.width;
        if (rh < 2) rh = pr.height;
      }
      const w = Math.max(160, Math.floor(rw * dpr));
      const h = Math.max(40, Math.floor(rh * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      initWaveCanvas(canvas, color);
    });

    if (recordingState === 'stopped' && audioUrl) {
      const cr = duration > 0 ? currentTime / duration : 0;
      if (useMobileWaveLayout()) {
        if (comboCanvas) drawMobileComboReplay(comboCanvas, mixReplayHistory, micReplayHistory, cr);
      } else {
        if (micCanvas) drawWaveUnified(micCanvas, micReplayHistory, '#f472b6', '#ec4899', cr, 'replay');
        if (bgCanvas && bgMusicUrl) drawWaveUnified(bgCanvas, bgReplayHistory, '#60a5fa', '#3b82f6', cr, 'replay');
        if (mixCanvas) drawWaveUnified(mixCanvas, mixReplayHistory, '#4ade80', '#22c55e', cr, 'replay');
      }
    }
  }

  function drawWaveformsLoop() {
    if (!isRecordingFlag) return;
    animationId = requestAnimationFrame(drawWaveformsLoop);

    if (micAnalyser) {
      const peak = getPeak(micAnalyser);
      micHistory.push(peak);
      if (micHistory.length > HISTORY_MAX) micHistory.shift();
      micAllHistory.push(peak);
    }
    if (bgAnalyser) {
      const peak = getPeak(bgAnalyser);
      bgHistory.push(peak);
      if (bgHistory.length > HISTORY_MAX) bgHistory.shift();
      bgAllHistory.push(peak);
    }
    if (mixAnalyser) {
      const peak = getPeak(mixAnalyser);
      mixHistory.push(peak);
      if (mixHistory.length > HISTORY_MAX) mixHistory.shift();
      mixAllHistory.push(peak);
    }

    if (useMobileWaveLayout()) {
      if (comboCanvas) drawMobileComboRecording(comboCanvas, mixHistory, micHistory);
    } else {
      if (micCanvas) {
        const cursorRatio = Math.min(1, micHistory.length / HISTORY_MAX);
        drawWaveUnified(micCanvas, micHistory, '#f472b6', '#ec4899', cursorRatio, 'recording');
      }
      if (bgCanvas && bgMusicUrl) {
        const cursorRatio = Math.min(1, bgHistory.length / HISTORY_MAX);
        drawWaveUnified(bgCanvas, bgHistory, '#60a5fa', '#3b82f6', cursorRatio, 'recording');
      }
      if (mixCanvas) {
        const cursorRatio = Math.min(1, mixHistory.length / HISTORY_MAX);
        drawWaveUnified(mixCanvas, mixHistory, '#4ade80', '#22c55e', cursorRatio, 'recording');
      }
    }
  }

  function updateTimeDisplay() {
    if (!timeDisplayEl) return;
    if (recordingState === 'stopped' && audioUrl) {
      timeDisplayEl.textContent = `${formatTime(currentTime)} / ${formatTime(duration)}`;
    } else {
      timeDisplayEl.textContent = formatTime(duration);
    }
  }

  function updateBgProgressUI() {
    const bgDur = Number.isFinite(bgDuration) && bgDuration > 0 ? bgDuration : 0;
    const bgPos = recordingState === 'recording' ? bgCurrentTime : bgDur > 0 ? currentTime % bgDur : 0;
    const pct = bgDur > 0 ? Math.max(0, Math.min(100, (bgPos / bgDur) * 100)) : 0;
    if (bgProgressEl) bgProgressEl.style.width = `${pct}%`;
    if (bgLabelEl && bgMusicTitle && bgMusicUrl) {
      const timeStr = bgDur > 0 ? `${formatTime(bgPos)} / ${formatTime(bgDur)}` : '--:-- / --:--';
      bgLabelEl.textContent = `${bgMusicTitle} · ${timeStr}`;
    }
  }

  function setBgMusicFromUrl(url, title) {
    const prev = bgMusicUrl;
    bgMusicUrl = url || null;
    bgMusicTitle = title || '';
    bgDuration = 0;
    bgCurrentTime = 0;

    if (!url) {
      if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
      localBgBlobUrl = null;
      localBgFileName = '';
    } else if (prev && prev.startsWith('blob:')) {
      const prevWasLocal = prev === localBgBlobUrl;
      if (!prevWasLocal && prev !== url) URL.revokeObjectURL(prev);
    }

    if (url) {
      probeBgDuration(url);
    }
    updateBgProgressUI();
    initWaveCanvas(bgCanvas, '#60a5fa');
  }

  /** 切换歌曲加载中时暂停参考音频显示，不撤销本地伴奏 blob */
  function suspendBgOutputOnly() {
    bgMusicUrl = null;
    bgMusicTitle = '';
    bgDuration = 0;
    bgCurrentTime = 0;
    updateBgProgressUI();
    initWaveCanvas(bgCanvas, '#60a5fa');
  }

  function setLocalAccompanimentFile(file) {
    if (!file) return;
    if (!file.type.startsWith('audio/')) {
      if (typeof window.toast === 'function') window.toast('请选择音频文件', 'error');
      return;
    }
    if (localBgBlobUrl) {
      URL.revokeObjectURL(localBgBlobUrl);
      localBgBlobUrl = null;
    }
    localBgBlobUrl = URL.createObjectURL(file);
    localBgFileName = file.name;
    bgMusicUrl = localBgBlobUrl;
    bgMusicTitle = `本地伴奏 · ${file.name}`;
    bgDuration = 0;
    bgCurrentTime = 0;
    probeBgDuration(bgMusicUrl);
    updateBgProgressUI();
    initWaveCanvas(bgCanvas, '#60a5fa');
    buildAudioTrackSelectOptions();
    if (audioTrackSelectEl) audioTrackSelectEl.value = LOCAL_BG_TRACK_VALUE;
    syncPicksToMobile();
    syncBgMetaVisibility();
    updateMobileAccButtonsState();
  }

  function updateClearLocalSheetsBtn() {
    if (!modalClearLocalSheetsBtn) return;
    modalClearLocalSheetsBtn.classList.toggle('hidden', localSheetEntries.length === 0);
  }

  function syncSongPickButtonsVisibility() {
    const hasSong = Boolean(songSelectEl && songSelectEl.value);
    if (openSongModalBtn) openSongModalBtn.classList.toggle('hidden', !hasSong);
  }

  function pickFirstAudioFileFromList(files) {
    const arr = [...files];
    for (const f of arr) {
      if (f.type.startsWith('audio/')) return f;
    }
    for (const f of arr) {
      if (/\.(mp3|m4a|aac|wav|ogg|opus|webm|flac)$/i.test(f.name)) return f;
    }
    return null;
  }

  function initRecorderDragDrop() {
    if (sheetScrollEl) {
      sheetScrollEl.addEventListener('dragenter', (e) => {
        if (recordingState === 'recording') return;
        e.preventDefault();
        sheetScrollEl.classList.add('recorder-drop-hover');
      });
      sheetScrollEl.addEventListener('dragleave', (e) => {
        if (!sheetScrollEl.contains(e.relatedTarget)) {
          sheetScrollEl.classList.remove('recorder-drop-hover');
        }
      });
      sheetScrollEl.addEventListener('dragover', (e) => {
        if (recordingState === 'recording') return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      });
      sheetScrollEl.addEventListener('drop', (e) => {
        if (recordingState === 'recording') return;
        e.preventDefault();
        sheetScrollEl.classList.remove('recorder-drop-hover');
        const fl = e.dataTransfer?.files;
        if (fl?.length) ingestLocalSheetFiles(fl);
      });
    }

    if (wavesEl) {
      wavesEl.addEventListener('dragenter', (e) => {
        if (recordingState === 'recording') return;
        e.preventDefault();
        wavesEl.classList.add('recorder-drop-hover');
      });
      wavesEl.addEventListener('dragleave', (e) => {
        if (!wavesEl.contains(e.relatedTarget)) {
          wavesEl.classList.remove('recorder-drop-hover');
        }
      });
      wavesEl.addEventListener('dragover', (e) => {
        if (recordingState === 'recording') return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      });
      wavesEl.addEventListener('drop', (e) => {
        if (recordingState === 'recording') return;
        e.preventDefault();
        wavesEl.classList.remove('recorder-drop-hover');
        const fl = e.dataTransfer?.files;
        if (!fl?.length) return;
        const audio = pickFirstAudioFileFromList(fl);
        if (audio) setLocalAccompanimentFile(audio);
        else if (typeof window.toast === 'function') window.toast('请拖入音频文件', 'error');
      });
    }
  }

  function clearLocalSheets() {
    if (recordingState === 'recording') return;
    for (const e of localSheetEntries) {
      if (e.kind === 'image' && e.blobUrl) URL.revokeObjectURL(e.blobUrl);
    }
    localSheetEntries = [];
    updateClearLocalSheetsBtn();
    void refreshSheets();
  }

  function ingestLocalSheetFiles(fileList) {
    const arr = [...fileList].filter(
      (f) =>
        f.type.startsWith('image/') ||
        f.type === 'application/pdf' ||
        f.name.toLowerCase().endsWith('.pdf'),
    );
    if (!arr.length) {
      if (typeof window.toast === 'function') window.toast('没有可加载的歌谱（支持图片或 PDF）', 'error');
      return;
    }
    for (const f of arr) {
      if (f.type.startsWith('image/')) {
        localSheetEntries.push({ kind: 'image', blobUrl: URL.createObjectURL(f), name: f.name });
      } else {
        localSheetEntries.push({ kind: 'pdf', file: f, name: f.name });
      }
    }
    updateClearLocalSheetsBtn();
    void refreshSheets();
    if (typeof window.toast === 'function') window.toast(`已添加 ${arr.length} 个本地歌谱文件`, 'success');
  }

  function buildMergedSheetItems() {
    const items = [];
    const serverSheets = currentSongDetail?.resources?.sheets;
    if (serverSheets?.length) {
      const sorted = [...serverSheets].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
      for (const s of sorted) items.push({ src: 'server', sheet: s });
    }
    for (const e of localSheetEntries) items.push({ src: 'local', entry: e });
    return items;
  }

  function refreshSheets() {
    return renderMergedSheets(buildMergedSheetItems());
  }

  function probeBgDuration(url) {
    const probe = new Audio();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      probe.removeEventListener('loadedmetadata', onMeta);
      probe.removeEventListener('error', onErr);
      probe.src = '';
    };
    const onMeta = () => {
      const d = probe.duration;
      if (Number.isFinite(d) && d > 0) bgDuration = d;
      finish();
      updateBgProgressUI();
    };
    const onErr = () => finish();
    probe.preload = 'metadata';
    probe.addEventListener('loadedmetadata', onMeta);
    probe.addEventListener('error', onErr);
    probe.src = url;
    probe.load();
    window.setTimeout(() => {
      finish();
      updateBgProgressUI();
    }, 3000);
  }

  function buildAudioTrackSelectOptions() {
    if (!audioTrackSelectEl) return;
    audioTrackSelectEl.innerHTML = '';

    if (currentSongDetail) {
      const acc = currentSongDetail.resources?.accompaniment || [];
      const voc = currentSongDetail.resources?.vocal || [];
      const accTrack = acc.find((t) => t.part_name === 'default') || acc[0];
      if (accTrack) {
        const o = document.createElement('option');
        o.value = `acc:${accTrack.part_name}`;
        o.textContent = '伴奏';
        audioTrackSelectEl.appendChild(o);
      }
      VOCAL_PARTS_ORDER.forEach((pn) => {
        const t = voc.find((v) => v.part_name === pn);
        if (t) {
          const o = document.createElement('option');
          o.value = `voc:${pn}`;
          const lab = PART_LABELS[pn] || t.part_label || pn;
          o.textContent = `${lab}范唱`;
          audioTrackSelectEl.appendChild(o);
        }
      });
    }

    if (localBgBlobUrl) {
      const o = document.createElement('option');
      o.value = LOCAL_BG_TRACK_VALUE;
      const shortName = localBgFileName.length > 22 ? `${localBgFileName.slice(0, 20)}…` : localBgFileName;
      o.textContent = `本地伴奏 · ${shortName}`;
      audioTrackSelectEl.appendChild(o);
    }

    if (audioTrackSelectEl.options.length === 0) {
      audioTrackSelectEl.appendChild(new Option('请选择歌曲或添加本地伴奏', '', true, true));
      audioTrackSelectEl.disabled = true;
    } else {
      audioTrackSelectEl.disabled = recordingState === 'recording';
    }
    syncPicksToMobile();
  }

  function applyAudioTrackValue(encoded) {
    if (!encoded) {
      setBgMusicFromUrl(null, '');
      return;
    }
    if (encoded === LOCAL_BG_TRACK_VALUE) {
      if (localBgBlobUrl) {
        const shortName = localBgFileName.length > 40 ? `${localBgFileName.slice(0, 38)}…` : localBgFileName;
        setBgMusicFromUrl(localBgBlobUrl, `本地伴奏 · ${shortName}`);
      } else {
        setBgMusicFromUrl(null, '');
      }
      return;
    }
    if (!currentSongDetail) {
      setBgMusicFromUrl(null, '');
      return;
    }
    const i = encoded.indexOf(':');
    if (i < 1) {
      setBgMusicFromUrl(null, '');
      return;
    }
    const kind = encoded.slice(0, i);
    const part = encoded.slice(i + 1);
    if (kind === 'acc') {
      const list = currentSongDetail.resources?.accompaniment || [];
      const track = list.find((t) => t.part_name === part);
      if (!track) {
        setBgMusicFromUrl(null, '');
        return;
      }
      const label = PART_LABELS[track.part_name] || track.part_label || track.part_name;
      const title = `${currentSongDetail.title} · 伴奏 · ${label}`;
      setBgMusicFromUrl(track.url, title);
    } else if (kind === 'voc') {
      const list = currentSongDetail.resources?.vocal || [];
      const track = list.find((t) => t.part_name === part);
      if (!track) {
        setBgMusicFromUrl(null, '');
        if (typeof window.toast === 'function') window.toast('该声部暂无范唱音频', 'error');
        return;
      }
      const label = PART_LABELS[track.part_name] || track.part_label || track.part_name;
      const title = `${currentSongDetail.title} · 范唱 · ${label}`;
      setBgMusicFromUrl(track.url, title);
    } else {
      setBgMusicFromUrl(null, '');
    }
  }

  /** 歌谱滚动区内可用于一页的最大 CSS 宽度（含 padding 扣除），用于 PDF 位图尺寸。 */
  function measureSheetScrollInnerMaxCssWidth() {
    if (!sheetScrollEl) return 296;
    const rect = sheetScrollEl.getBoundingClientRect();
    const w = rect.width > 0 ? rect.width : sheetScrollEl.clientWidth;
    return Math.min(Math.max(w || 320, 200) - 24, 920);
  }

  function setSheetNoSongPlaceholder() {
    if (!sheetScrollEl) return;
    sheetScrollEl.innerHTML = `
      <div class="recorder-sheet-no-song">
        <p class="recorder-sheet-no-song-text">请在右侧选择练唱歌曲；也可将图片或 PDF 拖入此区域作为本地歌谱</p>
        <button type="button" class="btn btn-primary recorder-sheet-pick-large recorder-mobile-only" id="recorder-sheet-first-pick-btn">选择练唱歌曲</button>
        <p class="recorder-sheet-no-song-hint-desktop">在右侧「练唱歌曲」中选择歌曲；支持将歌谱文件拖入左侧区域</p>
      </div>`;
  }

  async function renderOnePdfSource(pdfjsLib, docInit, globalNumRef, frag) {
    const pdf = await pdfjsLib.getDocument(docInit).promise;
    const numPages = pdf.numPages;
    await new Promise((r) => requestAnimationFrame(r));
    const maxW = measureSheetScrollInnerMaxCssWidth();
    const dpr = Math.min(window.devicePixelRatio || 1, 3);

    for (let p = 1; p <= numPages; p++) {
      globalNumRef.n++;
      const wrap = document.createElement('div');
      wrap.className = 'recorder-sheet-page';
      wrap.dataset.page = String(globalNumRef.n);
      const badge = document.createElement('div');
      badge.className = 'recorder-sheet-page-badge';
      badge.textContent = `第 ${globalNumRef.n} 页`;
      wrap.appendChild(badge);
      const canvas = document.createElement('canvas');
      canvas.style.display = 'block';
      canvas.style.width = '100%';
      canvas.style.height = 'auto';
      wrap.appendChild(canvas);
      frag.appendChild(wrap);

      const page = await pdf.getPage(p);
      const v1 = page.getViewport({ scale: 1 });
      const cssScale = Math.min(maxW / v1.width, 2.5);
      const viewportCss = page.getViewport({ scale: cssScale });
      const renderViewport = page.getViewport({ scale: cssScale * dpr });
      canvas.width = Math.max(1, renderViewport.width);
      canvas.height = Math.max(1, renderViewport.height);
      const cssW = Math.round(viewportCss.width) || 1;
      canvas.style.maxWidth = `${cssW}px`;
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      await page.render({ canvasContext: ctx, viewport: renderViewport }).promise;
    }
    await pdf.destroy();
  }

  async function renderMergedSheets(items) {
    sheetPageCount = 0;
    if (!sheetScrollEl) return;

    if (!items.length) {
      if (songSelectEl && songSelectEl.value) {
        sheetScrollEl.innerHTML = '<div class="recorder-sheet-empty">此歌曲暂无歌谱</div>';
      } else {
        setSheetNoSongPlaceholder();
      }
      updateSheetTitle(0, 0);
      return;
    }

    sheetScrollEl.innerHTML = '<div class="recorder-sheet-empty">正在加载歌谱…</div>';

    const globalNumRef = { n: 0 };
    const frag = document.createDocumentFragment();

    try {
      for (const item of items) {
        if (item.src === 'server') {
          const s = item.sheet;
          if (isPdfSheet(s)) {
            try {
              const pdfjsLib = await loadPdfJs();
              await renderOnePdfSource(pdfjsLib, { url: s.url, withCredentials: false }, globalNumRef, frag);
            } catch (err) {
              console.warn('PDF 渲染失败:', err);
              globalNumRef.n++;
              const wrap = document.createElement('div');
              wrap.className = 'recorder-sheet-page';
              wrap.dataset.page = String(globalNumRef.n);
              const badge = document.createElement('div');
              badge.className = 'recorder-sheet-page-badge';
              badge.textContent = `第 ${globalNumRef.n} 页`;
              const msg = document.createElement('div');
              msg.className = 'recorder-sheet-empty';
              msg.style.margin = '12px';
              msg.textContent = '无法在此显示 PDF，请在新窗口打开。';
              const a = document.createElement('a');
              a.href = s.url;
              a.target = '_blank';
              a.rel = 'noopener noreferrer';
              a.textContent = '打开 PDF';
              a.style.cssText =
                'margin:0 12px 12px;display:inline-block;color:var(--primary);text-decoration:underline;font-size:13px';
              wrap.appendChild(badge);
              wrap.appendChild(msg);
              wrap.appendChild(a);
              frag.appendChild(wrap);
            }
          } else {
            globalNumRef.n++;
            const wrap = document.createElement('div');
            wrap.className = 'recorder-sheet-page';
            wrap.dataset.page = String(globalNumRef.n);
            const badge = document.createElement('div');
            badge.className = 'recorder-sheet-page-badge';
            badge.textContent = `第 ${globalNumRef.n} 页`;
            wrap.appendChild(badge);
            const img = document.createElement('img');
            img.src = s.url;
            img.alt = `歌谱第 ${globalNumRef.n} 页`;
            img.loading = 'lazy';
            wrap.appendChild(img);
            frag.appendChild(wrap);
          }
        } else {
          const e = item.entry;
          if (e.kind === 'pdf') {
            try {
              const pdfjsLib = await loadPdfJs();
              const buf = await e.file.arrayBuffer();
              await renderOnePdfSource(pdfjsLib, { data: buf }, globalNumRef, frag);
            } catch (err) {
              console.warn('本地 PDF 渲染失败:', err);
              globalNumRef.n++;
              const wrap = document.createElement('div');
              wrap.className = 'recorder-sheet-page';
              wrap.dataset.page = String(globalNumRef.n);
              const badge = document.createElement('div');
              badge.className = 'recorder-sheet-page-badge';
              badge.textContent = `第 ${globalNumRef.n} 页`;
              const msg = document.createElement('div');
              msg.className = 'recorder-sheet-empty';
              msg.style.margin = '12px';
              msg.textContent = '无法渲染此本地 PDF，请尝试转换为图片。';
              wrap.appendChild(badge);
              wrap.appendChild(msg);
              frag.appendChild(wrap);
            }
          } else {
            globalNumRef.n++;
            const wrap = document.createElement('div');
            wrap.className = 'recorder-sheet-page';
            wrap.dataset.page = String(globalNumRef.n);
            const badge = document.createElement('div');
            badge.className = 'recorder-sheet-page-badge';
            badge.textContent = `第 ${globalNumRef.n} 页 · 本地`;
            wrap.appendChild(badge);
            const img = document.createElement('img');
            img.src = e.blobUrl;
            img.alt = `本地歌谱第 ${globalNumRef.n} 页`;
            img.loading = 'lazy';
            wrap.appendChild(img);
            frag.appendChild(wrap);
          }
        }
      }

      sheetScrollEl.innerHTML = '';
      sheetScrollEl.appendChild(frag);
      sheetPageCount = globalNumRef.n;
      sheetScrollEl.scrollTop = 0;
      updateSheetTitle(sheetPageCount ? 1 : 0, sheetPageCount);
      requestAnimationFrame(updateCurrentSheetPageFromScroll);
    } catch (e) {
      console.error(e);
      sheetScrollEl.innerHTML = '<div class="recorder-sheet-empty">歌谱加载失败</div>';
      updateSheetTitle(0, 0);
    }
  }

  function updateSheetTitle(current, total) {
    if (!sheetTitleEl) return;
    if (!total) {
      sheetTitleEl.textContent = '歌谱（暂无）';
      return;
    }
    sheetTitleEl.textContent = `歌谱 · 第 ${current} / ${total} 页`;
  }

  function updateCurrentSheetPageFromScroll() {
    if (!sheetScrollEl || sheetPageCount <= 0) return;
    const pages = sheetScrollEl.querySelectorAll('.recorder-sheet-page');
    if (!pages.length) return;
    const mid = sheetScrollEl.scrollTop + sheetScrollEl.clientHeight / 2;
    let bestIdx = 0;
    let bestDist = Infinity;
    pages.forEach((el, i) => {
      const top = el.offsetTop;
      const h = el.offsetHeight || 1;
      const center = top + h / 2;
      const d = Math.abs(center - mid);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    });
    updateSheetTitle(bestIdx + 1, sheetPageCount);
  }

  let sheetScrollRaf = null;
  function onSheetScroll() {
    if (sheetScrollRaf) return;
    sheetScrollRaf = requestAnimationFrame(() => {
      sheetScrollRaf = null;
      updateCurrentSheetPageFromScroll();
    });
  }

  async function loadPracticeSongList() {
    songSelectEl.innerHTML = '<option value="">加载中…</option>';
    songSelectEl.disabled = true;
    try {
      const res = await fetch(`${PUBLIC_SONGS_API}?page=1&limit=100`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || '加载失败');
      practiceSongs = json.data || [];
      songSelectEl.innerHTML = '';
      songSelectEl.appendChild(new Option('请选择练唱歌曲', '', true, true));
      practiceSongs.forEach((s) => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = s.title + (s.artist ? ` — ${s.artist}` : '');
        songSelectEl.appendChild(opt);
      });
    } catch (e) {
      songSelectEl.innerHTML = '';
      songSelectEl.appendChild(new Option('加载失败，请刷新重试', '', true, true));
      if (typeof window.toast === 'function') window.toast(e.message || String(e), 'error');
    } finally {
      songSelectEl.disabled = recordingState === 'recording';
      syncPicksToMobile();
      updateMobileAccButtonsState();
      void refreshSheets();
    }
  }

  async function onSongSelected(songId) {
    suspendBgOutputOnly();
    currentSongDetail = null;
    if (audioTrackSelectEl) {
      audioTrackSelectEl.innerHTML = '';
      audioTrackSelectEl.appendChild(new Option('请先选择歌曲', '', true, true));
      audioTrackSelectEl.disabled = true;
    }
    if (bgHintEl) bgHintEl.hidden = false;
    bgMetaEl.hidden = true;
    if (!songId) {
      buildAudioTrackSelectOptions();
      const firstOpt = audioTrackSelectEl?.options[0];
      if (firstOpt && firstOpt.value) {
        audioTrackSelectEl.value = firstOpt.value;
        applyAudioTrackValue(firstOpt.value);
      } else {
        setBgMusicFromUrl(null, '');
      }
      syncBgMetaVisibility();
      void refreshSheets();
      syncPicksToMobile();
      updateMobileAccButtonsState();
      return;
    }

    if (sheetScrollEl) {
      sheetScrollEl.innerHTML = '<div class="recorder-sheet-empty">正在加载歌谱…</div>';
    }

    if (audioTrackSelectEl) {
      audioTrackSelectEl.innerHTML = '<option value="">加载详情…</option>';
      audioTrackSelectEl.disabled = true;
    }
    syncPicksToMobile();
    try {
      const res = await fetch(`${PUBLIC_SONGS_API}/${encodeURIComponent(songId)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || '加载失败');
      currentSongDetail = json.data;
      buildAudioTrackSelectOptions();
      const first = audioTrackSelectEl?.options[0];
      if (first && first.value) {
        audioTrackSelectEl.value = first.value;
        applyAudioTrackValue(first.value);
        syncBgMetaVisibility();
      }
      syncPicksToMobile();
      updateMobileAccButtonsState();
      await refreshSheets();
    } catch (e) {
      if (typeof window.toast === 'function') window.toast(e.message || String(e), 'error');
      if (audioTrackSelectEl) {
        audioTrackSelectEl.innerHTML = '';
        audioTrackSelectEl.appendChild(new Option('加载失败', '', true, true));
        audioTrackSelectEl.disabled = true;
      }
      syncPicksToMobile();
      void refreshSheets();
    }
    updateMobileAccButtonsState();
  }

  function syncBgMetaVisibility() {
    const has = Boolean(bgMusicUrl);
    if (bgHintEl) bgHintEl.hidden = has;
    bgMetaEl.hidden = !has;
    if (bgLabelEl) bgLabelEl.classList.toggle('hidden', !has);
    if (clearBgBtn) {
      clearBgBtn.disabled = recordingState === 'recording' || !has;
      clearBgBtn.classList.toggle('hidden', !has || recordingState === 'recording');
    }
    updateMobileAccButtonsState();
  }

  function cloneSelectState(from, to) {
    if (!from || !to) return;
    const v = from.value;
    const dis = from.disabled;
    to.innerHTML = '';
    for (let i = 0; i < from.options.length; i++) {
      const o = from.options[i];
      to.add(new Option(o.text, o.value, o.defaultSelected, o.selected));
    }
    try {
      to.value = v;
    } catch {
      if (to.options.length) to.selectedIndex = 0;
    }
    to.disabled = dis;
  }

  function syncPicksToMobile() {
    cloneSelectState(songSelectEl, songSelectMobile);
    cloneSelectState(audioTrackSelectEl, audioTrackSelectModal);
  }

  function updateMobileAccButtonsState() {
    if (openSongModalBtn) openSongModalBtn.disabled = recordingState === 'recording';
    if (localBgBtn) localBgBtn.disabled = recordingState === 'recording';
    if (modalLocalSheetsBtn) modalLocalSheetsBtn.disabled = recordingState === 'recording';
    if (modalLocalBgBtn) modalLocalBgBtn.disabled = recordingState === 'recording';
    if (modalClearLocalSheetsBtn) modalClearLocalSheetsBtn.disabled = recordingState === 'recording';
    if (audioTrackSelectModal) {
      const hasPlayableTrack =
        audioTrackSelectEl &&
        [...audioTrackSelectEl.options].some((o) => o.value && !o.disabled);
      audioTrackSelectModal.disabled = recordingState === 'recording' || !hasPlayableTrack;
    }
    syncSongPickButtonsVisibility();
  }

  function closePickModal() {
    if (!pickModalEl) return;
    pickModalEl.classList.add('hidden');
    pickModalEl.setAttribute('aria-hidden', 'true');
    syncPicksToMobile();
  }

  function openPickModal() {
    if (!pickModalEl || !modalSongBlock) return;
    syncPicksToMobile();
    updateMobileAccButtonsState();
    if (pickModalTitleEl) pickModalTitleEl.textContent = '选择歌曲';
    pickModalEl.classList.remove('hidden');
    pickModalEl.setAttribute('aria-hidden', 'false');
  }

  function clearBgMusic() {
    if (recordingState === 'recording') return;
    setBgMusicFromUrl(null, '');
    buildAudioTrackSelectOptions();
    if (
      currentSongDetail &&
      audioTrackSelectEl &&
      [...audioTrackSelectEl.options].some((o) => o.value && !o.disabled)
    ) {
      const ph = document.createElement('option');
      ph.value = '';
      ph.textContent = '请选择参考音频';
      ph.selected = true;
      audioTrackSelectEl.insertBefore(ph, audioTrackSelectEl.firstChild);
    }
    syncPicksToMobile();
    syncBgMetaVisibility();
    updateMobileAccButtonsState();
  }

  async function startRecording() {
    try {
      const desiredSampleRate = 48000;
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          autoGainControl: true,
          noiseSuppression: false,
          sampleRate: desiredSampleRate,
        },
      });

      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      let ctx;
      try {
        ctx = new AudioContextCtor({ sampleRate: desiredSampleRate });
      } catch {
        ctx = new AudioContextCtor();
      }
      audioContext = ctx;
      try {
        await audioContext.resume();
      } catch (resumeErr) {
        console.error(resumeErr);
        alert('无法激活音频上下文，请重试。');
        micStream.getTracks().forEach((t) => t.stop());
        return;
      }

      const destination = audioContext.createMediaStreamDestination();

      micAnalyser = audioContext.createAnalyser();
      micAnalyser.fftSize = 2048;
      const micSource = audioContext.createMediaStreamSource(micStream);
      micSource.connect(micAnalyser);

      mixAnalyser = audioContext.createAnalyser();
      mixAnalyser.fftSize = 2048;

      if (bgMusicUrl) {
        bgCurrentTime = 0;
        bgDuration = 0;

        const bgAudio = new Audio();
        bgAudio.src = bgMusicUrl;
        bgAudio.loop = true;
        if (bgMusicUrl && !String(bgMusicUrl).startsWith('blob:')) {
          bgAudio.crossOrigin = 'anonymous';
        }
        bgAudioElement = bgAudio;

        const onBgLoadedMetadata = () => {
          const d = bgAudio.duration;
          if (Number.isFinite(d) && d > 0) bgDuration = d;
          updateBgProgressUI();
        };
        const onBgTimeUpdate = () => {
          const t = bgAudio.currentTime;
          if (Number.isFinite(t) && t >= 0) bgCurrentTime = t;
          const d = bgAudio.duration;
          if (Number.isFinite(d) && d > 0) bgDuration = d;
          updateBgProgressUI();
        };
        bgMetaHandler = onBgLoadedMetadata;
        bgTimeHandler = onBgTimeUpdate;
        bgAudio.addEventListener('loadedmetadata', onBgLoadedMetadata);
        bgAudio.addEventListener('timeupdate', onBgTimeUpdate);

        const bgSourceNode = audioContext.createMediaElementSource(bgAudio);
        const gainNode = audioContext.createGain();
        gainNode.gain.value = bgVolume;
        bgGainNode = gainNode;

        bgAnalyser = audioContext.createAnalyser();
        bgAnalyser.fftSize = 2048;

        bgSourceNode.connect(gainNode);
        gainNode.connect(bgAnalyser);
        gainNode.connect(audioContext.destination);

        if (isHeadphoneMode) {
          gainNode.connect(mixAnalyser);
          gainNode.connect(destination);
          micSource.connect(destination);
          micSource.connect(mixAnalyser);
        } else {
          micSource.connect(destination);
          micSource.connect(mixAnalyser);
        }

        bgAudio.play().catch((err) => console.warn('伴奏播放失败:', err));
      } else {
        bgAnalyser = null;
        micSource.connect(destination);
        micSource.connect(mixAnalyser);
      }

      pcmChunks.length = 0;
      pcmSampleRate = audioContext.sampleRate;
      try {
        const pcmSource = audioContext.createMediaStreamSource(destination.stream);
        const processor = audioContext.createScriptProcessor(4096, 1, 1);
        const zeroGain = audioContext.createGain();
        zeroGain.gain.value = 0;
        pcmSource.connect(processor);
        processor.connect(zeroGain);
        zeroGain.connect(audioContext.destination);
        processor.onaudioprocess = (ev) => {
          const channelData = ev.inputBuffer.getChannelData(0);
          pcmChunks.push(new Float32Array(channelData));
        };
        pcmSourceNode = pcmSource;
        pcmCaptureNode = processor;
        pcmZeroGain = zeroGain;
      } catch (e) {
        console.warn('PCM 采集失败（不影响录音导出）:', e);
      }

      audioChunks.length = 0;
      micHistory.length = 0;
      bgHistory.length = 0;
      mixHistory.length = 0;
      micAllHistory.length = 0;
      bgAllHistory.length = 0;
      mixAllHistory.length = 0;
      micReplayHistory = [];
      bgReplayHistory = [];
      mixReplayHistory = [];
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
        audioUrl = null;
      }

      const preferredMimeTypes = canRecordM4a
        ? ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/webm']
        : ['audio/webm;codecs=opus', 'audio/webm'];
      const mimeType = preferredMimeTypes.find((t) => MediaRecorder.isTypeSupported(t));

      mediaRecorder = new MediaRecorder(destination.stream, {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: 192000,
      });
      const recordedMimeType = mediaRecorder.mimeType || 'audio/webm';
      outputExt =
        recordedMimeType && (recordedMimeType.includes('mp4') || recordedMimeType.includes('aac')) ? '.m4a' : '.webm';

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunks.push(e.data);
      };
      mediaRecorder.onstop = () => {
        audioBlob = new Blob(audioChunks, { type: recordedMimeType });
        audioUrl = URL.createObjectURL(audioBlob);
        playbackAudioEl.src = audioUrl;
        micStream.getTracks().forEach((t) => t.stop());
        syncStoppedUI();
        startReplayLoop();
      };

      mediaRecorder.start();
      recordingState = 'recording';
      duration = 0;
      currentTime = 0;
      timerId = window.setInterval(() => {
        duration += 1;
        updateTimeDisplay();
      }, 1000);
      isRecordingFlag = true;
      drawWaveformsLoop();

      songSelectEl.disabled = true;
      if (audioTrackSelectEl) audioTrackSelectEl.disabled = true;
      if (songSelectMobile) songSelectMobile.disabled = true;
      if (audioTrackSelectModal) audioTrackSelectModal.disabled = true;
      if (clearBgBtn) clearBgBtn.disabled = true;
      updateMobileAccButtonsState();
      headphoneEl.disabled = true;
      startBtn.classList.add('hidden');
      stopBtn.classList.remove('hidden');
      stoppedActionsEl.classList.add('hidden');
      playbackRowEl.classList.add('hidden');
      setRecordingDotsVisible(true);
      updateTimeDisplay();
      syncBgMetaVisibility();
    } catch (err) {
      console.error(err);
      alert('无法访问麦克风，请确保已授予权限。');
    }
  }

  function stopRecording() {
    if (!mediaRecorder || recordingState !== 'recording') return;
    isRecordingFlag = false;
    if (bgAudioElement) {
      if (bgTimeHandler) bgAudioElement.removeEventListener('timeupdate', bgTimeHandler);
      if (bgMetaHandler) bgAudioElement.removeEventListener('loadedmetadata', bgMetaHandler);
      bgAudioElement.pause();
      bgAudioElement = null;
    }
    bgTimeHandler = null;
    bgMetaHandler = null;
    bgCurrentTime = 0;
    mediaRecorder.stop();
    recordingState = 'stopped';
    if (timerId) clearInterval(timerId);
    timerId = null;
    if (animationId) cancelAnimationFrame(animationId);
    animationId = null;

    if (pcmCaptureNode) {
      pcmCaptureNode.disconnect();
      pcmCaptureNode.onaudioprocess = null;
      pcmCaptureNode = null;
    }
    if (pcmSourceNode) {
      pcmSourceNode.disconnect();
      pcmSourceNode = null;
    }
    if (pcmZeroGain) {
      pcmZeroGain.disconnect();
      pcmZeroGain = null;
    }
    if (audioContext) {
      audioContext.close();
      audioContext = null;
    }

    const targetPoints = replayBitmapTargetPoints();
    micReplayHistory = resamplePeaks(micAllHistory, targetPoints);
    bgReplayHistory = resamplePeaks(bgAllHistory, targetPoints);
    mixReplayHistory = resamplePeaks(mixAllHistory, targetPoints);

    const cursorRatio = duration > 0 ? currentTime / duration : 0;
    if (useMobileWaveLayout()) {
      if (comboCanvas) drawMobileComboReplay(comboCanvas, mixReplayHistory, micReplayHistory, cursorRatio);
    } else {
      if (micCanvas) drawWaveUnified(micCanvas, micReplayHistory, '#f472b6', '#ec4899', cursorRatio, 'replay');
      if (bgCanvas && bgMusicUrl) drawWaveUnified(bgCanvas, bgReplayHistory, '#60a5fa', '#3b82f6', cursorRatio, 'replay');
      if (mixCanvas) drawWaveUnified(mixCanvas, mixReplayHistory, '#4ade80', '#22c55e', cursorRatio, 'replay');
    }

    setRecordingDotsVisible(false);
    stopBtn.classList.add('hidden');
    songSelectEl.disabled = false;
    if (audioTrackSelectEl) {
      audioTrackSelectEl.disabled =
        recordingState === 'recording' ||
        [...audioTrackSelectEl.options].every((o) => !o.value || o.disabled);
    }
    syncPicksToMobile();
    if (clearBgBtn) clearBgBtn.disabled = !bgMusicUrl;
    headphoneEl.disabled = false;
    updateMobileAccButtonsState();
  }

  function syncStoppedUI() {
    if (recordingState !== 'stopped' || !audioUrl) return;
    startBtn.classList.add('hidden');
    stopBtn.classList.add('hidden');
    stoppedActionsEl.classList.remove('hidden');
    playbackRowEl.classList.remove('hidden');
    const a = playbackAudioEl;
    duration = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : duration;
    seekEl.max = String(duration > 0 ? duration : 0);
    updateTimeDisplay();
  }

  function resetRecording() {
    if (bgAudioElement) {
      if (bgTimeHandler) bgAudioElement.removeEventListener('timeupdate', bgTimeHandler);
      if (bgMetaHandler) bgAudioElement.removeEventListener('loadedmetadata', bgMetaHandler);
      bgAudioElement.pause();
      bgAudioElement = null;
    }
    bgTimeHandler = null;
    bgMetaHandler = null;
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    audioUrl = null;
    audioBlob = null;
    playbackAudioEl.removeAttribute('src');
    recordingState = 'idle';
    duration = 0;
    currentTime = 0;
    isPlaying = false;
    bgCurrentTime = 0;
    outputExt = '';
    audioChunks.length = 0;
    pcmChunks.length = 0;
    pcmSampleRate = 0;
    isRecordingFlag = false;
    micHistory.length = 0;
    bgHistory.length = 0;
    mixHistory.length = 0;
    micAllHistory.length = 0;
    bgAllHistory.length = 0;
    mixAllHistory.length = 0;
    micReplayHistory = [];
    bgReplayHistory = [];
    mixReplayHistory = [];

    initWaveCanvas(micCanvas, '#f472b6');
    initWaveCanvas(bgCanvas, '#60a5fa');
    initWaveCanvas(mixCanvas, '#4ade80');
    if (comboCanvas) initWaveCanvas(comboCanvas, '#4ade80');

    startBtn.classList.remove('hidden');
    stopBtn.classList.add('hidden');
    stoppedActionsEl.classList.add('hidden');
    playbackRowEl.classList.add('hidden');
    seekFillEl.style.width = '0%';
    songSelectEl.disabled = false;
    if (audioTrackSelectEl) {
      audioTrackSelectEl.disabled =
        recordingState === 'recording' ||
        [...audioTrackSelectEl.options].every((o) => !o.value || o.disabled);
    }
    syncPicksToMobile();
    if (clearBgBtn) clearBgBtn.disabled = !bgMusicUrl;
    headphoneEl.disabled = false;
    updateMobileAccButtonsState();
    setPlayButtonUi(false);
    updateTimeDisplay();
    syncBgMetaVisibility();
    if (replayRafId) {
      cancelAnimationFrame(replayRafId);
      replayRafId = null;
    }
  }

  function togglePlayback() {
    if (!playbackAudioEl || !audioUrl) return;
    if (isPlaying) playbackAudioEl.pause();
    else playbackAudioEl.play();
    isPlaying = !isPlaying;
    setPlayButtonUi(isPlaying);
  }

  function seekTo(time) {
    const audio = playbackAudioEl;
    if (!audio || !audioUrl) return;
    const dur = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : duration;
    if (!Number.isFinite(dur) || dur <= 0) return;
    const clamped = Math.max(0, Math.min(time, dur));
    audio.currentTime = clamped;
    currentTime = clamped;
  }

  function downloadRecording() {
    if (!audioBlob) return;
    const safeDate = new Date().toLocaleString('zh-CN').replace(/[/:]/g, '-');
    const ext = outputExt || (audioBlob.type.includes('mp4') ? '.m4a' : '.webm');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(audioBlob);
    a.download = `录音_${safeDate}${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }

  function shareWithTimeout(fn, timeoutMs) {
    return Promise.race([
      fn(),
      new Promise((_, reject) => {
        window.setTimeout(() => reject(new Error('share timeout')), timeoutMs);
      }),
    ]);
  }

  async function shareRecording() {
    if (!audioUrl || !audioBlob) return;
    const safeDate = new Date().toLocaleString('zh-CN').replace(/[/:]/g, '-');
    const ext = outputExt || (audioBlob.type.includes('mp4') ? '.m4a' : '.webm');
    const fileName = `录音_${safeDate}${ext}`;
    const file = new File([audioBlob], fileName, { type: audioBlob.type || 'application/octet-stream' });

    if (typeof navigator.share !== 'function') {
      downloadRecording();
      return;
    }

    try {
      if (navigator.canShare && !navigator.canShare({ files: [file] })) {
        await shareWithTimeout(() => navigator.share({ url: audioUrl, title: fileName }), 10000);
        return;
      }
      await shareWithTimeout(
        () =>
          navigator.share({
            files: [file],
            title: fileName,
            text: '录音分享',
          }),
        10000
      );
    } catch {
      downloadRecording();
    }
  }

  function startReplayLoop() {
    if (replayRafId) cancelAnimationFrame(replayRafId);
    const tick = () => {
      const audio = playbackAudioEl;
      if (!audio || !audioUrl || recordingState !== 'stopped') return;
      const dur = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : duration;
      const t = audio.currentTime;
      currentTime = t;
      const cursorRatio = dur > 0 ? t / dur : 0;
      if (useMobileWaveLayout()) {
        if (comboCanvas) drawMobileComboReplay(comboCanvas, mixReplayHistory, micReplayHistory, cursorRatio);
      } else {
        if (micCanvas) drawWaveUnified(micCanvas, micReplayHistory, '#f472b6', '#ec4899', cursorRatio, 'replay');
        if (bgCanvas && bgMusicUrl) drawWaveUnified(bgCanvas, bgReplayHistory, '#60a5fa', '#3b82f6', cursorRatio, 'replay');
        if (mixCanvas) drawWaveUnified(mixCanvas, mixReplayHistory, '#4ade80', '#22c55e', cursorRatio, 'replay');
      }
      seekFillEl.style.width = `${Math.max(0, Math.min(1, cursorRatio)) * 100}%`;
      seekEl.value = String(t);
      replayRafId = requestAnimationFrame(tick);
    };
    replayRafId = requestAnimationFrame(tick);
  }

  function openRecorder() {
    rootEl.classList.remove('hidden');
    rootEl.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => {
      resizeCanvasToLayout();
      requestAnimationFrame(() => resizeCanvasToLayout());
    });
    if (!practiceSongs.length) loadPracticeSongList();
    updateMobileAccButtonsState();
  }

  function closeRecorder() {
    if (recordingState === 'recording') return;
    closePickModal();
    rootEl.classList.add('hidden');
    rootEl.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    if (replayRafId) {
      cancelAnimationFrame(replayRafId);
      replayRafId = null;
    }
  }

  function bind() {
    openBtn.addEventListener('click', openRecorder);
    closeBtn.addEventListener('click', closeRecorder);
    rootEl.addEventListener('click', (e) => {
      if (e.target === rootEl) closeRecorder();
    });

    async function handleSongChangeFromDesktop() {
      await onSongSelected(songSelectEl.value);
      syncBgMetaVisibility();
    }

    songSelectEl.addEventListener('change', () => {
      void handleSongChangeFromDesktop();
    });

    if (songSelectMobile) {
      songSelectMobile.addEventListener('change', () => {
        songSelectEl.value = songSelectMobile.value;
        void handleSongChangeFromDesktop();
      });
    }

    function handleAudioTrackChange() {
      if (!audioTrackSelectEl) return;
      const v = audioTrackSelectEl.value;
      if (audioTrackSelectModal) audioTrackSelectModal.value = v;
      if (v) applyAudioTrackValue(v);
      else setBgMusicFromUrl(null, '');
      syncBgMetaVisibility();
    }

    if (audioTrackSelectEl) {
      audioTrackSelectEl.addEventListener('change', handleAudioTrackChange);
    }

    if (audioTrackSelectModal && audioTrackSelectEl) {
      audioTrackSelectModal.addEventListener('change', () => {
        audioTrackSelectEl.value = audioTrackSelectModal.value;
        handleAudioTrackChange();
      });
    }

    if (openSongModalBtn) {
      openSongModalBtn.addEventListener('click', () => openPickModal());
    }
    if (sheetScrollEl) {
      sheetScrollEl.addEventListener('click', (e) => {
        if (recordingState === 'recording') return;
        if (e.target.closest('#recorder-sheet-first-pick-btn')) openPickModal();
      });
    }
    if (pickModalDoneBtn) {
      pickModalDoneBtn.addEventListener('click', () => closePickModal());
    }
    if (pickModalBackdrop) {
      pickModalBackdrop.addEventListener('click', () => closePickModal());
    }

    if (localSheetsInput) {
      localSheetsInput.addEventListener('change', () => {
        if (localSheetsInput.files?.length) ingestLocalSheetFiles(localSheetsInput.files);
        localSheetsInput.value = '';
      });
    }
    if (modalClearLocalSheetsBtn) {
      modalClearLocalSheetsBtn.addEventListener('click', () => clearLocalSheets());
    }
    if (modalLocalSheetsBtn && localSheetsInput) {
      modalLocalSheetsBtn.addEventListener('click', () => {
        if (recordingState === 'recording') return;
        localSheetsInput.click();
      });
    }

    if (localBgBtn && localBgInput) {
      localBgBtn.addEventListener('click', () => {
        if (recordingState === 'recording') return;
        localBgInput.click();
      });
    }
    if (localBgInput) {
      localBgInput.addEventListener('change', () => {
        const f = localBgInput.files?.[0];
        if (f) setLocalAccompanimentFile(f);
        localBgInput.value = '';
      });
    }
    if (modalLocalBgBtn && localBgInput) {
      modalLocalBgBtn.addEventListener('click', () => {
        if (recordingState === 'recording') return;
        localBgInput.click();
      });
    }

    initRecorderDragDrop();

    if (clearBgBtn) clearBgBtn.addEventListener('click', clearBgMusic);

    bgVolEl.addEventListener('input', () => {
      bgVolume = parseFloat(bgVolEl.value) || 0;
      bgVolPctEl.textContent = `${Math.round(bgVolume * 100)}%`;
      if (bgGainNode) bgGainNode.gain.value = bgVolume;
    });

    headphoneEl.addEventListener('change', () => {
      isHeadphoneMode = headphoneEl.checked;
      mixLabelEl.textContent = isHeadphoneMode ? '混合输出' : '录音输出';
    });

    startBtn.addEventListener('click', startRecording);
    stopBtn.addEventListener('click', stopRecording);
    resetBtn.addEventListener('click', resetRecording);
    playBtn.addEventListener('click', togglePlayback);
    downloadBtn.addEventListener('click', downloadRecording);
    shareBtn.addEventListener('click', () => shareRecording());

    sheetScrollEl.addEventListener('scroll', onSheetScroll, { passive: true });

    playbackAudioEl.addEventListener('timeupdate', () => {
      if (isSeeking) return;
      currentTime = playbackAudioEl.currentTime;
    });
    playbackAudioEl.addEventListener('ended', () => {
      isPlaying = false;
      setPlayButtonUi(false);
      currentTime = 0;
    });
    playbackAudioEl.addEventListener('loadedmetadata', () => {
      if (playbackAudioEl.duration && Number.isFinite(playbackAudioEl.duration)) {
        duration = playbackAudioEl.duration;
        seekEl.max = String(duration);
      }
      updateTimeDisplay();
      if (recordingState === 'stopped' && audioUrl) startReplayLoop();
    });

    seekEl.addEventListener('pointerdown', () => {
      if (duration <= 0) return;
      isSeeking = true;
    });
    seekEl.addEventListener('pointerup', () => {
      isSeeking = false;
      if (playbackAudioEl) currentTime = playbackAudioEl.currentTime;
    });
    seekEl.addEventListener('pointercancel', () => {
      isSeeking = false;
    });
    function onSeekInput() {
      const v = parseFloat(seekEl.value);
      seekTo(v);
      isSeeking = true;
    }
    seekEl.addEventListener('input', onSeekInput);
    seekEl.addEventListener('change', onSeekInput);

    window.addEventListener('resize', () => {
      if (window.matchMedia('(min-width: 901px)').matches) closePickModal();
      if (!rootEl.classList.contains('hidden')) resizeCanvasToLayout();
    });

    document.addEventListener('visibilitychange', () => {
      if (recordingState === 'stopped' && audioUrl && !document.hidden) startReplayLoop();
    });
  }

  function init() {
    rootEl = document.getElementById('recorder-root');
    if (!rootEl) return;

    songSelectEl = document.getElementById('recorder-song-select');
    audioTrackSelectEl = document.getElementById('recorder-audio-track-select');
    songSelectMobile = document.getElementById('recorder-mobile-song-select');
    audioTrackSelectModal = document.getElementById('recorder-modal-audio-track-select');
    pickModalEl = document.getElementById('recorder-pick-modal');
    pickModalTitleEl = document.getElementById('recorder-pick-modal-title');
    pickModalBackdrop = document.getElementById('recorder-pick-modal-backdrop');
    pickModalDoneBtn = document.getElementById('recorder-pick-modal-done');
    modalSongBlock = document.getElementById('recorder-modal-song-block');
    openSongModalBtn = document.getElementById('recorder-open-song-modal');
    localSheetsInput = document.getElementById('recorder-local-sheets-input');
    localBgBtn = document.getElementById('recorder-local-bg-btn');
    localBgInput = document.getElementById('recorder-local-bg-input');
    modalLocalSheetsBtn = document.getElementById('recorder-modal-local-sheets-btn');
    modalLocalBgBtn = document.getElementById('recorder-modal-local-bg-btn');
    modalClearLocalSheetsBtn = document.getElementById('recorder-modal-clear-local-sheets-btn');
    sheetScrollEl = document.getElementById('recorder-sheet-scroll');
    wavesEl = document.getElementById('recorder-waves');
    sheetTitleEl = document.getElementById('recorder-sheet-title');
    bgHintEl = document.getElementById('recorder-bg-hint');
    bgMetaEl = document.getElementById('recorder-bg-meta');
    bgLabelEl = document.getElementById('recorder-bg-label');
    bgVolEl = document.getElementById('recorder-bg-volume');
    bgVolPctEl = document.getElementById('recorder-bg-volume-pct');
    bgProgressEl = document.getElementById('recorder-bg-progress');
    clearBgBtn = document.getElementById('recorder-clear-bg-btn');
    headphoneEl = document.getElementById('recorder-headphone-mode');
    mixLabelEl = document.getElementById('recorder-mix-label');
    timeDisplayEl = document.getElementById('recorder-time-display');
    micCanvas = document.getElementById('recorder-canvas-mic');
    bgCanvas = document.getElementById('recorder-canvas-bg');
    mixCanvas = document.getElementById('recorder-canvas-mix');
    comboCanvas = document.getElementById('recorder-canvas-combo');
    micDotEl = document.getElementById('recorder-mic-dot');
    micDotComboEl = document.getElementById('recorder-mic-dot-combo');
    seekEl = document.getElementById('recorder-seek');
    seekFillEl = document.getElementById('recorder-seek-fill');
    playbackRowEl = document.getElementById('recorder-playback-row');
    startBtn = document.getElementById('recorder-start-btn');
    stopBtn = document.getElementById('recorder-stop-btn');
    stoppedActionsEl = document.getElementById('recorder-stopped-actions');
    playBtn = document.getElementById('recorder-play-btn');
    resetBtn = document.getElementById('recorder-reset-btn');
    shareBtn = document.getElementById('recorder-share-btn');
    downloadBtn = document.getElementById('recorder-download-btn');
    playbackAudioEl = document.getElementById('recorder-playback-audio');
    openBtn = document.getElementById('open-recorder-btn');
    closeBtn = document.getElementById('recorder-close-btn');

    bgVolPctEl.textContent = `${Math.round(bgVolume * 100)}%`;
    updateTimeDisplay();
    initWaveCanvas(micCanvas, '#f472b6');
    initWaveCanvas(bgCanvas, '#60a5fa');
    initWaveCanvas(mixCanvas, '#4ade80');
    initWaveCanvas(comboCanvas, '#4ade80');
    syncPicksToMobile();
    updateMobileAccButtonsState();
    setPlayButtonUi(false);
    bind();
    updateClearLocalSheetsBtn();
    void refreshSheets();

    const obs = new MutationObserver(() => {
      if (!rootEl.classList.contains('hidden')) resizeCanvasToLayout();
    });
    obs.observe(rootEl, { attributes: true, attributeFilter: ['class'] });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

