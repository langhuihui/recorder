import { renderPdfInto, hydrateAdminPdfPreviews } from '../lib/pdfPreview';

const API = '/api';
const PARTS = ['soprano', 'alto', 'tenor', 'bass'];
const PART_LABELS: Record<string, string> = {
  soprano: '女高音（Soprano）',
  alto: '女低音（Alto）',
  tenor: '男高音（Tenor）',
  bass: '男低音（Bass）',
};
/** 伴奏在系统中用单一轨存储（与 API upload 一致） */
const ACC_PART = 'default';

let currentSongId: string | null = null;
let currentPage = 1;
let sheetFiles: File[] = [];
let pendingAudio: Record<string, File> = {};

function toast(msg: string, type = 'info') {
  const c = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  c?.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}
function showOverlay(text: string) {
  document.getElementById('upload-progress-text')!.textContent = text;
  (document.getElementById('upload-progress-bar') as HTMLElement).style.width = '0%';
  document.getElementById('upload-overlay')!.classList.remove('hidden');
}
function hideOverlay() { document.getElementById('upload-overlay')!.classList.add('hidden'); }
function setProgress(p: number) { (document.getElementById('upload-progress-bar') as HTMLElement).style.width = p + '%'; }
function formatDate(s: string) { return s ? new Date(s).toLocaleDateString('zh-CN') : ''; }
function escapeHtml(s: string) {
  if (!s) return '';
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function audioKey(trackType: string, part: string) {
  return `${trackType}:${part}`;
}

function switchView(name: string) {
  ['list','upload','detail'].forEach(v => {
    const el = document.getElementById(`view-${v}`);
    if (el) el.style.display = v === name ? 'block' : 'none';
  });
  if (name === 'list') loadSongs(currentPage);
  if (name === 'upload') resetUploadForm();
}

async function loadSongs(page = 1) {
  currentPage = page;
  const listEl = document.getElementById('song-list')!;
  listEl.innerHTML = '<div class="loading">加载中...</div>';
  try {
    const res = await fetch(`${API}/songs?page=${page}&limit=12&song_kind=practice`);
    const { data, pagination } = await res.json();
    if (!data || data.length === 0) {
      listEl.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon"><i class="icon icon-music icon-3xl"></i></div><p>还没有练唱歌曲</p><button class="btn btn-primary" onclick="switchView('upload')">+ 新建练唱歌曲</button></div>`;
      document.getElementById('pagination')!.innerHTML = '';
      return;
    }
    listEl.innerHTML = data.map((song: any) => `
      <div class="song-card" style="cursor:pointer" onclick="viewSong('${song.id}')">
        <div class="song-card-cover"><i class="icon icon-music icon-xl"></i></div>
        <div class="song-card-body">
          <div class="song-card-title">${escapeHtml(song.title)}</div>
          <div class="song-card-artist">${escapeHtml(song.artist) || '未知作者'}</div>
          <div class="song-card-tags">
            ${song.sheets?.length ? `<span class="tag"><i class="icon icon-file-text"></i> ${song.sheets.length}张</span>` : ''}
            ${song.tracks?.filter((t: any) => t.track_type === 'accompaniment').length ? `<span class="tag"><i class="icon icon-piano"></i> 伴奏</span>` : ''}
            ${song.tracks?.filter((t: any) => t.track_type === 'vocal').length ? `<span class="tag"><i class="icon icon-mic"></i> 范唱</span>` : ''}
          </div>
          <div class="song-card-actions">
            <button type="button" class="btn btn-sm btn-danger" onclick="event.stopPropagation();deleteSong('${song.id}','${escapeHtml(song.title)}')">删除整首</button>
          </div>
        </div>
      </div>
    `).join('');
    renderPagination(pagination);
  } catch(e: any) { listEl.innerHTML = `<div class="loading">加载失败: ${e.message}</div>`; }
}

function renderPagination({ page, totalPages }: any) {
  const el = document.getElementById('pagination')!;
  if (totalPages <= 1) { el.innerHTML = ''; return; }
  let html = '';
  for (let i = 1; i <= totalPages; i++) {
    html += `<button type="button" class="page-btn${i===page?' active':''}" onclick="loadSongs(${i})">${i}</button>`;
  }
  el.innerHTML = html;
}

function updateSongIdBadge() {
  const el = document.getElementById('song-id-badge')!;
  if (currentSongId) {
    el.style.display = 'block';
    el.textContent = `已创建练唱条目，可继续上传文件。`;
  } else {
    el.style.display = 'none';
    el.textContent = '';
  }
}

function ingestSheetFiles(files: FileList | File[]) {
  const arr = [...files].filter(f =>
    f.type.startsWith('image/') || f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
  );
  if (!arr.length) {
    toast('没有可上传的歌谱格式文件', 'error');
    return;
  }
  if (!currentSongId) {
    arr.forEach(f => sheetFiles.push(f));
    void renderSheetPreviews();
    toast(`已加入 ${arr.length} 个文件，保存信息后将上传`, 'info');
    return;
  }
  uploadSheetsNow(arr);
}

async function renderSheetPreviews() {
  const c = document.getElementById('sheet-preview')!;
  c.innerHTML = '';
  for (let i = 0; i < sheetFiles.length; i++) {
    const file = sheetFiles[i];
    const thumb = document.createElement('div');
    thumb.style.cssText = 'position:relative;display:inline-block;vertical-align:top;margin:4px';
    if (file.type.startsWith('image/')) {
      const img = document.createElement('img');
      img.src = URL.createObjectURL(file);
      img.className = 'sheet-thumb';
      thumb.appendChild(img);
    } else {
      const mount = document.createElement('div');
      mount.className = 'sheet-thumb';
      mount.style.cssText =
        'width:120px;min-height:100px;display:flex;align-items:center;justify-content:center;background:var(--bg);border:1.5px solid var(--border);border-radius:8px;overflow:hidden;flex-direction:column;font-size:0.72rem;color:var(--text-muted)';
      mount.textContent = 'PDF 渲染中…';
      thumb.appendChild(mount);
      try {
        const buf = await file.arrayBuffer();
        mount.textContent = '';
        await renderPdfInto(mount, { data: buf }, { maxPages: 1, maxWidth: 112 });
      } catch {
        mount.innerHTML = '<i class="icon icon-file-text icon-xl"></i>';
      }
    }
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.textContent = '×';
    rm.style.cssText =
      'position:absolute;top:-4px;right:-4px;width:18px;height:18px;border-radius:50%;background:#dc2626;color:#fff;border:none;font-size:0.75rem;cursor:pointer;line-height:1;display:flex;align-items:center;justify-content:center';
    const idx = i;
    rm.onclick = () => {
      sheetFiles.splice(idx, 1);
      void renderSheetPreviews();
    };
    thumb.appendChild(rm);
    c.appendChild(thumb);
  }
}

async function uploadSheetsNow(files: File[]) {
  if (!currentSongId || !files.length) return;
  try {
    showOverlay('正在上传歌谱...');
    const form = new FormData();
    form.append('type', 'sheet');
    files.forEach(f => form.append('files', f));
    const res = await fetch(`${API}/songs/${currentSongId}/upload`, { method: 'POST', body: form });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error);
    setProgress(100);
    hideOverlay();
    toast('歌谱上传成功', 'success');
  } catch(e: any) { hideOverlay(); toast(`上传失败: ${e.message}`, 'error'); }
}

function slotIds(kind: string, part: string) {
  const prefix = kind === 'acc' ? 'acc' : 'voc';
  return { name: `${prefix}-${part}-name`, status: `${prefix}-${part}-status`, input: `${prefix}-${part}` };
}

function setAudioSlotUI(kind: string, part: string, fileName: string, done?: boolean) {
  const { name, status } = slotIds(kind, part);
  const nameEl = document.getElementById(name)!;
  const stEl = document.getElementById(status)!;
  nameEl.textContent = fileName.length > 18 ? fileName.slice(0, 16) + '…' : fileName;
  if (done) {
    stEl.textContent = '✓ 已上传';
    stEl.style.color = '#16a34a';
  } else {
    stEl.textContent = '待上传';
    stEl.style.color = 'var(--text-muted)';
  }
}

function clearAudioSlotUI(kind: string, part: string) {
  const { name, status } = slotIds(kind, part);
  document.getElementById(name)!.textContent = '拖入或点击';
  const st = document.getElementById(status)!;
  st.textContent = '';
  st.style.color = '';
}

async function uploadOneTrack(trackType: string, part: string, file: File) {
  if (!currentSongId) return;
  const form = new FormData();
  form.append('type', trackType);
  form.append('part_name', part);
  form.append('files', file);
  const res = await fetch(`${API}/songs/${currentSongId}/upload`, { method: 'POST', body: form });
  const result = await res.json();
  if (!res.ok) throw new Error(result.error);
}

async function handleAudioSlotFile(kind: string, part: string, file: File) {
  const trackType = kind === 'acc' ? 'accompaniment' : 'vocal';
  const key = audioKey(trackType, part);
  if (!currentSongId) {
    pendingAudio[key] = file;
    setAudioSlotUI(kind, part, file.name, false);
    toast('已选择音频，保存信息后将上传', 'info');
    return;
  }
  try {
    showOverlay('正在上传音频...');
    await uploadOneTrack(trackType, part, file);
    hideOverlay();
    setAudioSlotUI(kind, part, file.name, true);
    toast('音频已上传', 'success');
  } catch(e: any) {
    hideOverlay();
    toast(e.message, 'error');
  }
}

async function flushQueuedUploads() {
  if (!currentSongId) return;
  if (sheetFiles.length) {
    const batch = sheetFiles.slice();
    sheetFiles = [];
    void renderSheetPreviews();
    await uploadSheetsNow(batch);
  }
  const entries = Object.entries(pendingAudio);
  pendingAudio = {};
  if (entries.length) {
    showOverlay(`正在上传排队音频 (0/${entries.length})...`);
    for (let i = 0; i < entries.length; i++) {
      const [key, file] = entries[i];
      const [trackType, part] = key.split(':');
      setProgress((i / entries.length) * 100);
      document.getElementById('upload-progress-text')!.textContent = `上传音频 ${i + 1}/${entries.length}`;
      await uploadOneTrack(trackType, part, file);
      const kind = trackType === 'accompaniment' ? 'acc' : 'voc';
      setAudioSlotUI(kind, part, file.name, true);
    }
    setProgress(100);
    hideOverlay();
    toast('排队中的音频已上传', 'success');
  }
}

async function saveSongInfo(): Promise<boolean> {
  const title = (document.getElementById('song-title') as HTMLInputElement).value.trim();
  const artist = (document.getElementById('song-artist') as HTMLInputElement).value.trim();
  const description = (document.getElementById('song-desc') as HTMLTextAreaElement).value.trim();
  if (!title) { toast('请输入歌曲标题', 'error'); return false; }

  try {
    if (!currentSongId) {
      showOverlay('正在保存...');
      const res = await fetch(`${API}/songs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, artist, description, song_kind: 'practice' }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      currentSongId = result.data.id;
      updateSongIdBadge();
      await flushQueuedUploads();
      hideOverlay();
      toast('歌曲信息已保存', 'success');
      return true;
    } else {
      showOverlay('正在更新...');
      const res = await fetch(`${API}/songs/${currentSongId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, artist, description }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      await flushQueuedUploads();
      hideOverlay();
      toast('信息已更新', 'success');
      return true;
    }
  } catch(e: any) {
    hideOverlay();
    toast(e.message, 'error');
    return false;
  }
}

function hasPendingQueues() {
  return sheetFiles.length > 0 || Object.keys(pendingAudio).length > 0;
}

async function finishAndBack() {
  if (!currentSongId && hasPendingQueues()) {
    toast('请先点击「保存歌曲信息」，或清空排队文件后再返回', 'error');
    return;
  }
  if (currentSongId && hasPendingQueues()) {
    if (!confirm('尚有未上传的排队文件，是否保存并上传后再返回？')) return;
    const ok = await saveSongInfo();
    if (ok) {
      resetUploadForm();
      switchView('list');
    }
    return;
  }
  resetUploadForm();
  switchView('list');
}

function resetUploadForm() {
  currentSongId = null;
  sheetFiles = [];
  pendingAudio = {};
  updateSongIdBadge();
  (document.getElementById('song-title') as HTMLInputElement).value = '';
  (document.getElementById('song-artist') as HTMLInputElement).value = '';
  (document.getElementById('song-desc') as HTMLTextAreaElement).value = '';
  void renderSheetPreviews();
  clearAudioSlotUI('acc', ACC_PART);
  PARTS.forEach(part => clearAudioSlotUI('voc', part));
}

function initSheetZone() {
  const zone = document.getElementById('sheet-upload-zone')!;
  const input = document.getElementById('sheet-files') as HTMLInputElement;
  zone.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('input')) return;
    input.click();
  });
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    if (e.dataTransfer?.files?.length) ingestSheetFiles(e.dataTransfer.files);
  });
  input.addEventListener('change', () => {
    if (input.files?.length) ingestSheetFiles(input.files);
    input.value = '';
  });
}

function initAudioSlots() {
  document.querySelectorAll('#view-upload .audio-slot-card').forEach(card => {
    const kind = card.getAttribute('data-slot-kind')!;
    const part = card.getAttribute('data-part')!;
    const input = card.querySelector('input[type=file]') as HTMLInputElement;
    card.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      input?.click();
    });
    card.addEventListener('dragover', e => { e.preventDefault(); card.classList.add('drag-over'); });
    card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
    card.addEventListener('drop', e => {
      e.preventDefault();
      card.classList.remove('drag-over');
      const f = e.dataTransfer?.files?.[0];
      if (f) handleAudioSlotFile(kind, part, f);
    });
    input.addEventListener('change', () => {
      const f = input.files?.[0];
      if (f) handleAudioSlotFile(kind, part, f);
      input.value = '';
    });
  });
}

function buildDetailAudioSlot(
  songId: string,
  trackType: string,
  partName: string,
  label: string,
  track: { id: string; url: string } | null,
  suffix: string,
) {
  const L = escapeHtml(label);
  if (track) {
    return `<div class="detail-supply-slot upload-zone has-audio" data-track-type="${trackType}" data-part="${partName}">
      <div class="detail-slot-label" style="font-weight:700;font-size:0.85rem;margin-bottom:6px">${L}</div>
      <audio controls preload="none" src="${track.url}" style="width:100%;margin-bottom:8px"></audio>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <button type="button" class="btn btn-sm btn-danger" onclick="deleteTrack('${songId}','${track.id}')">删除</button>
        <input type="file" class="detail-slot-file" id="detail-file-${suffix}" accept="audio/*" hidden>
        <button type="button" class="btn btn-sm btn-outline" onclick="document.getElementById('detail-file-${suffix}').click()">替换</button>
      </div>
    </div>`;
  }
  return `<div class="detail-supply-slot upload-zone" data-track-type="${trackType}" data-part="${partName}">
    <div class="detail-slot-label" style="font-weight:700;font-size:0.85rem;margin-bottom:6px">${L}</div>
    <p class="hint" style="margin:4px 0 8px 0;font-size:0.78rem">拖入音频或点击上传</p>
    <input type="file" class="detail-slot-file" id="detail-file-${suffix}" accept="audio/*" hidden>
    <button type="button" class="btn btn-sm btn-primary" onclick="document.getElementById('detail-file-${suffix}').click()">上传</button>
  </div>`;
}

async function uploadDetailSheetFiles(songId: string, files: FileList) {
  const arr = [...files].filter(f =>
    f.type.startsWith('image/') || f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'),
  );
  if (!arr.length) {
    toast('没有可上传的歌谱文件', 'error');
    return;
  }
  try {
    showOverlay('上传歌谱…');
    const form = new FormData();
    form.append('type', 'sheet');
    arr.forEach(f => form.append('files', f));
    const res = await fetch(`${API}/songs/${songId}/upload`, { method: 'POST', body: form });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error);
    hideOverlay();
    toast('歌谱已上传', 'success');
    viewSong(songId);
  } catch(e: any) {
    hideOverlay();
    toast(e.message, 'error');
  }
}

async function uploadDetailTrackAudio(songId: string, trackType: string, partName: string, file: File) {
  try {
    showOverlay('上传音频…');
    const form = new FormData();
    form.append('type', trackType);
    form.append('part_name', partName);
    form.append('files', file);
    const res = await fetch(`${API}/songs/${songId}/upload`, { method: 'POST', body: form });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error);
    hideOverlay();
    toast('音频已上传', 'success');
    viewSong(songId);
  } catch(e: any) {
    hideOverlay();
    toast(e.message, 'error');
  }
}

function initDetailSupplyInteractions(songId: string) {
  const sheetZone = document.getElementById('detail-sheet-zone');
  const sheetInput = document.getElementById('detail-sheet-input') as HTMLInputElement | null;
  if (sheetZone && sheetInput) {
    sheetZone.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('input')) return;
      sheetInput.click();
    });
    sheetZone.addEventListener('dragover', e => {
      e.preventDefault();
      sheetZone.classList.add('drag-over');
    });
    sheetZone.addEventListener('dragleave', () => sheetZone.classList.remove('drag-over'));
    sheetZone.addEventListener('drop', e => {
      e.preventDefault();
      sheetZone.classList.remove('drag-over');
      const fl = e.dataTransfer?.files;
      if (fl?.length) uploadDetailSheetFiles(songId, fl);
    });
    sheetInput.addEventListener('change', () => {
      if (sheetInput.files?.length) uploadDetailSheetFiles(songId, sheetInput.files);
      sheetInput.value = '';
    });
  }

  document.querySelectorAll('.detail-supply-slot[data-track-type]').forEach(el => {
    const slot = el as HTMLElement;
    const type = slot.getAttribute('data-track-type')!;
    const part = slot.getAttribute('data-part')!;
    const input = slot.querySelector('.detail-slot-file') as HTMLInputElement | null;
    if (!input) return;
    slot.addEventListener('dragover', e => {
      e.preventDefault();
      slot.classList.add('drag-over');
    });
    slot.addEventListener('dragleave', () => slot.classList.remove('drag-over'));
    slot.addEventListener('drop', e => {
      e.preventDefault();
      slot.classList.remove('drag-over');
      const f = e.dataTransfer?.files?.[0];
      if (f && f.type.startsWith('audio/')) uploadDetailTrackAudio(songId, type, part, f);
      else if (f) toast('请拖入音频文件', 'error');
    });
    input.addEventListener('change', () => {
      const f = input.files?.[0];
      if (f) uploadDetailTrackAudio(songId, type, part, f);
      input.value = '';
    });
  });
}

async function viewSong(songId: string) {
  switchView('detail');
  (document.getElementById('detail-back-btn') as HTMLButtonElement).onclick = () => switchView('list');
  const contentEl = document.getElementById('detail-content')!;
  contentEl.innerHTML = '<div class="loading">加载中...</div>';
  try {
    const songRes = await fetch(`${API}/songs/${songId}`);
    const { data: song } = await songRes.json();

    document.getElementById('detail-title')!.textContent = song.title;
    const accs = (song.tracks || []).filter((t: any) => t.track_type === 'accompaniment');
    const vocs = (song.tracks || []).filter((t: any) => t.track_type === 'vocal');
    const accDefault = accs.find((t: any) => t.part_name === ACC_PART) || null;
    const accLegacy = accs.filter((t: any) => t.part_name !== ACC_PART);

    let html = `<div class="card">
      <div class="flex items-center justify-between flex-wrap gap-2" style="margin-bottom:16px">
        <div>
          <div style="font-size:0.9rem;color:var(--text-muted)"><i class="icon icon-user"></i> ${escapeHtml(song.artist) || '未知作者'}</div>
          ${song.description ? `<div style="font-size:0.88rem;color:var(--text-muted);margin-top:4px">${escapeHtml(song.description)}</div>` : ''}
          <div style="font-size:0.78rem;color:var(--text-light);margin-top:4px">创建于 ${formatDate(song.created_at)} · 练唱歌曲</div>
        </div>
        <button type="button" class="btn btn-sm btn-danger" onclick="deleteSong('${song.id}','${escapeHtml(song.title)}')"><i class="icon icon-trash"></i> 删除整首及全部素材</button>
      </div>`;

    if (song.sheets?.length) {
      html += `<div style="margin-bottom:16px"><h3 style="font-size:0.95rem;font-weight:700;margin-bottom:10px"><i class="icon icon-file-text"></i> 已上传歌谱 (${song.sheets.length}张)</h3><div style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-start">`;
      song.sheets.forEach((s: any) => {
        const del = `<button type="button" class="btn btn-sm btn-danger" style="margin-top:4px" onclick="deleteSheet('${song.id}','${s.id}')">删除</button>`;
        if (s.file_key.endsWith('.pdf')) {
          html += `<div style="display:flex;flex-direction:column;gap:4px;align-items:flex-start">
            <div data-admin-pdf-url=${JSON.stringify(s.url)} style="min-height:72px;min-width:120px;border-radius:6px;border:1.5px solid var(--border);background:var(--bg);display:flex;align-items:center;justify-content:center;font-size:0.75rem;color:var(--text-muted);padding:8px">PDF 预览加载中…</div>
            <a href="${escapeHtml(s.url)}" target="_blank" rel="noopener" class="btn btn-sm btn-outline"><i class="icon icon-file-text"></i> 新窗口打开</a>
            ${del}
          </div>`;
        } else {
          html += `<div style="display:flex;flex-direction:column;gap:4px"><img src="${s.url}" style="height:80px;border-radius:6px;object-fit:cover;border:1.5px solid var(--border)" alt="">${del}</div>`;
        }
      });
      html += '</div></div>';
    }

    html += `</div><div class="card" style="margin-top:16px">
      <h3 style="font-size:0.95rem;font-weight:700;margin:0 0 14px 0"><i class="icon icon-package"></i> 管理素材</h3>
      <h4 style="font-size:0.88rem;margin:0 0 8px 0"><i class="icon icon-file-text"></i> 歌谱</h4>
      <div id="detail-sheet-zone" class="detail-supply-slot upload-zone detail-sheet-drop">
        <p class="hint" style="margin:0 0 8px 0">拖入图片 / PDF，支持多文件</p>
        <input type="file" id="detail-sheet-input" multiple accept="image/*,.pdf" hidden>
        <button type="button" class="btn btn-sm btn-primary" onclick="document.getElementById('detail-sheet-input').click()">上传歌谱</button>
      </div>
      <h4 style="font-size:0.88rem;margin:16px 0 8px 0"><i class="icon icon-piano"></i> 伴奏（整曲一条）</h4>
      ${buildDetailAudioSlot(song.id, 'accompaniment', ACC_PART, '伴奏', accDefault, 'acc')}
      ${accLegacy.length ? `<div style="margin-top:12px;padding:10px;background:var(--bg);border-radius:8px;border:1px solid var(--border)"><p class="hint" style="margin:0 0 8px 0">以下为按声部存储的旧数据，可删除后统一使用上方「默认」伴奏轨。</p>${accLegacy.map((t: any) => `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px"><span style="font-size:0.82rem">${escapeHtml(PART_LABELS[t.part_name] || t.part_name)}</span><audio controls preload="none" src="${t.url}" style="flex:1;min-width:180px;max-width:280px;height:36px"></audio><button type="button" class="btn btn-sm btn-danger" onclick="deleteTrack('${song.id}','${t.id}')">删除</button></div>`).join('')}</div>` : ''}
      <h4 style="font-size:0.88rem;margin:16px 0 8px 0"><i class="icon icon-mic"></i> 四部范唱（SATB）</h4>
      <div class="detail-vocal-slots">
        ${PARTS.map((part) => {
          const vt = vocs.find((t: any) => t.part_name === part) || null;
          return buildDetailAudioSlot(song.id, 'vocal', part, PART_LABELS[part] || part, vt, `voc-${part}`);
        }).join('')}
      </div>
    </div>`;

    contentEl.innerHTML = html;
    initDetailSupplyInteractions(songId);
    void hydrateAdminPdfPreviews(contentEl);
  } catch(e: any) { contentEl.innerHTML = `<div class="loading">加载失败: ${e.message}</div>`; }
}

async function deleteSheet(songId: string, sheetId: string) {
  if (!confirm('确定删除此张歌谱？')) return;
  try {
    const res = await fetch(`${API}/songs/${songId}/sheets/${sheetId}`, { method: 'DELETE' });
    const r = await res.json();
    if (!res.ok) throw new Error(r.error);
    toast('已删除', 'success');
    viewSong(songId);
  } catch(e: any) { toast(e.message, 'error'); }
}

async function deleteTrack(songId: string, trackId: string) {
  if (!confirm('确定删除此条音轨？')) return;
  try {
    const res = await fetch(`${API}/songs/${songId}/tracks/${trackId}`, { method: 'DELETE' });
    const r = await res.json();
    if (!res.ok) throw new Error(r.error);
    toast('已删除', 'success');
    viewSong(songId);
  } catch(e: any) { toast(e.message, 'error'); }
}

async function deleteSong(id: string, title: string) {
  if (!confirm(`确定删除练唱歌曲「${title}」？将同时删除歌谱与全部范唱/伴奏音轨。`)) return;
  try {
    const res = await fetch(`${API}/songs/${id}`, { method: 'DELETE' });
    const r = await res.json();
    if (!res.ok) throw new Error(r.error);
    toast('已删除', 'success');
    switchView('list');
  } catch(e: any) { toast(`删除失败: ${e.message}`, 'error'); }
}

(window as any).switchView = switchView;
(window as any).saveSongInfo = saveSongInfo;
(window as any).finishAndBack = finishAndBack;
(window as any).resetUploadForm = resetUploadForm;
(window as any).viewSong = viewSong;
(window as any).deleteSong = deleteSong;
(window as any).loadSongs = loadSongs;
(window as any).deleteSheet = deleteSheet;
(window as any).deleteTrack = deleteTrack;

document.addEventListener('DOMContentLoaded', () => {
  initSheetZone();
  initAudioSlots();
  loadSongs();
});
