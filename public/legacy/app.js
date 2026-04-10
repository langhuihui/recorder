// ===== 状态管理 =====
let currentSongId = null;
let currentPage = 1;
let sheetFiles = []; // 待上传的歌谱文件
let albumPage = 1;
let editingAlbumId = null; // 编辑模式下的专辑 ID
let selectedAlbumSongs = []; // 专辑中选中的歌曲 [{id, title, artist}]
let albumCoverFile = null; // 待上传的封面文件
let allSongsCache = []; // 歌曲搜索缓存
let detailBackTarget = 'list'; // 详情页返回目标

const API = '/api';
const PARTS = ['soprano', 'alto', 'tenor', 'bass'];
const PART_LABELS = {
  soprano: '高音',
  alto: '中音',
  tenor: '次中音',
  bass: '低音',
};
const TRACK_TYPE_LABELS = {
  accompaniment: '伴奏',
  vocal: '范唱',
};

// ===== 工具函数 =====
function toast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

function showOverlay(text) {
  document.getElementById('upload-progress-text').textContent = text;
  document.getElementById('upload-progress-bar').style.width = '0%';
  document.getElementById('upload-overlay').classList.remove('hidden');
}

function hideOverlay() {
  document.getElementById('upload-overlay').classList.add('hidden');
}

function setProgress(percent) {
  document.getElementById('upload-progress-bar').style.width = `${percent}%`;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

// ===== 视图切换 =====
function switchView(viewName) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(`view-${viewName}`).classList.add('active');

  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const navBtn = document.querySelector(`.nav-btn[data-view="${viewName}"]`);
  if (navBtn) navBtn.classList.add('active');

  if (viewName === 'list') {
    loadSongs(currentPage);
  } else if (viewName === 'albums') {
    loadAlbums(albumPage);
  } else if (viewName === 'create-album') {
    if (!editingAlbumId) {
      resetAlbumForm();
    }
  }
}

// ===== 步骤切换 =====
function goStep(step) {
  document.querySelectorAll('.step-content').forEach(s => s.classList.remove('active'));
  const stepEl = document.getElementById(`step-${step}`);
  if (stepEl) stepEl.classList.add('active');
  else document.getElementById('step-done').classList.add('active');

  // 更新步骤指示器
  document.querySelectorAll('.step').forEach((s) => {
    const sNum = parseInt(s.dataset.step);
    s.classList.remove('active', 'done');
    if (sNum === step) s.classList.add('active');
    else if (sNum < step) s.classList.add('done');
  });
}

// ===== 加载歌曲列表 =====
async function loadSongs(page = 1) {
  currentPage = page;
  const listEl = document.getElementById('song-list');
  listEl.innerHTML = '<div class="loading">加载中...</div>';

  try {
    const res = await fetch(`${API}/songs?page=${page}&limit=12`);
    const { data, pagination } = await res.json();

    if (!data || data.length === 0) {
      listEl.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🎵</div>
          <p>还没有歌曲，点击上传按钮添加第一首歌曲吧</p>
          <button class="btn btn-primary" onclick="switchView('upload')">+ 上传歌曲</button>
        </div>
      `;
      document.getElementById('pagination').innerHTML = '';
      return;
    }

    listEl.innerHTML = data.map(song => `
      <div class="song-card" onclick="viewSong('${song.id}')">
        <div class="song-card-date">${formatDate(song.created_at)}</div>
        <div class="song-card-title">${escapeHtml(song.title)}</div>
        <div class="song-card-artist">${escapeHtml(song.artist) || '未知作者'}</div>
        <div class="song-card-meta">
          ${song.sheets?.length ? `<span class="meta-tag sheets">📄 ${song.sheets.length}张歌谱</span>` : ''}
          ${song.tracks?.filter(t => t.track_type === 'accompaniment').length ? `<span class="meta-tag audio">🎹 ${song.tracks.filter(t => t.track_type === 'accompaniment').length}个伴奏</span>` : ''}
          ${song.tracks?.filter(t => t.track_type === 'vocal').length ? `<span class="meta-tag vocal">🎤 ${song.tracks.filter(t => t.track_type === 'vocal').length}个范唱</span>` : ''}
        </div>
        <button class="btn-icon" onclick="event.stopPropagation(); deleteSong('${song.id}', '${escapeHtml(song.title)}')" title="删除">🗑️</button>
      </div>
    `).join('');

    // 渲染分页
    renderPagination(pagination);
  } catch (e) {
    listEl.innerHTML = `<div class="loading">加载失败: ${e.message}</div>`;
  }
}

function renderPagination({ page, totalPages }) {
  const el = document.getElementById('pagination');
  if (totalPages <= 1) {
    el.innerHTML = '';
    return;
  }

  let html = `<button class="page-btn" onclick="loadSongs(${page - 1})" ${page <= 1 ? 'disabled' : ''}>上一页</button>`;

  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || Math.abs(i - page) <= 2) {
      html += `<button class="page-btn ${i === page ? 'active' : ''}" onclick="loadSongs(${i})">${i}</button>`;
    } else if (Math.abs(i - page) === 3) {
      html += `<span style="color:var(--text-dim)">...</span>`;
    }
  }

  html += `<button class="page-btn" onclick="loadSongs(${page + 1})" ${page >= totalPages ? 'disabled' : ''}>下一页</button>`;
  el.innerHTML = html;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ===== 创建歌曲 =====
async function createSong() {
  const title = document.getElementById('song-title').value.trim();
  const artist = document.getElementById('song-artist').value.trim();
  const description = document.getElementById('song-desc').value.trim();

  if (!title) {
    toast('请输入歌曲标题', 'error');
    document.getElementById('song-title').focus();
    return;
  }

  try {
    showOverlay('正在创建歌曲...');
    const res = await fetch(`${API}/songs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, artist, description }),
    });

    const result = await res.json();
    if (!res.ok) throw new Error(result.error);

    currentSongId = result.data.id;
    hideOverlay();
    toast('歌曲创建成功', 'success');
    goStep(2);
  } catch (e) {
    hideOverlay();
    toast(`创建失败: ${e.message}`, 'error');
  }
}

// ===== 歌谱文件选择和预览 =====
function initSheetUpload() {
  const zone = document.getElementById('sheet-upload-zone');
  const input = document.getElementById('sheet-files');

  zone.addEventListener('click', () => input.click());

  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('dragover');
  });

  zone.addEventListener('dragleave', () => {
    zone.classList.remove('dragover');
  });

  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('dragover');
    addSheetFiles(e.dataTransfer.files);
  });

  input.addEventListener('change', () => {
    addSheetFiles(input.files);
    input.value = '';
  });
}

function addSheetFiles(fileList) {
  for (const file of fileList) {
    if (file.type.startsWith('image/') || file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
      sheetFiles.push(file);
    } else {
      toast(`不支持的文件格式: ${file.name}`, 'error');
    }
  }
  renderSheetPreviews();
}

function renderSheetPreviews() {
  const container = document.getElementById('sheet-preview');
  container.innerHTML = '';

  sheetFiles.forEach((file, index) => {
    const thumb = document.createElement('div');
    thumb.className = 'sheet-thumb';

    if (file.type.startsWith('image/')) {
      const img = document.createElement('img');
      img.src = URL.createObjectURL(file);
      thumb.appendChild(img);
    } else {
      const icon = document.createElement('div');
      icon.className = 'pdf-icon';
      icon.textContent = '📑';
      thumb.appendChild(icon);
    }

    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-btn';
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', () => {
      sheetFiles.splice(index, 1);
      renderSheetPreviews();
    });
    thumb.appendChild(removeBtn);

    container.appendChild(thumb);
  });
}

// ===== 上传歌谱 =====
async function uploadSheets() {
  if (sheetFiles.length === 0) {
    toast('请选择歌谱文件', 'error');
    return;
  }

  if (!currentSongId) {
    toast('请先创建歌曲', 'error');
    return;
  }

  try {
    showOverlay('正在上传歌谱...');
    const formData = new FormData();
    formData.append('type', 'sheet');
    sheetFiles.forEach(file => formData.append('files', file));

    const res = await fetch(`${API}/songs/${currentSongId}/upload`, {
      method: 'POST',
      body: formData,
    });

    const result = await res.json();
    if (!res.ok) throw new Error(result.error);

    setProgress(100);
    hideOverlay();

    const converted = result.data.filter(d => d.page);
    const pdfs = result.data.filter(d => d.note);

    if (converted.length > 0) {
      toast(`PDF 已转换为 ${converted.length} 张图片`, 'success');
    }
    if (pdfs.length > 0) {
      toast(pdfs[0].note, 'info');
    }

    toast('歌谱上传成功', 'success');
    sheetFiles = [];
    renderSheetPreviews();
    goStep(3);
  } catch (e) {
    hideOverlay();
    toast(`上传失败: ${e.message}`, 'error');
  }
}

// ===== 音频文件选择 =====
function initAudioInputs() {
  const types = ['acc', 'voc'];
  types.forEach(prefix => {
    PARTS.forEach(part => {
      const input = document.getElementById(`${prefix}-${part}`);
      if (!input) return;
      input.addEventListener('change', () => {
        const file = input.files[0];
        const nameEl = document.getElementById(`${prefix}-${part}-name`);
        if (file) {
          nameEl.textContent = file.name;
          nameEl.title = file.name;
        }
      });
    });
  });
}

// ===== 上传音频 =====
async function uploadAudio() {
  if (!currentSongId) {
    toast('请先创建歌曲', 'error');
    return;
  }

  const tasks = [];

  // 收集伴奏文件
  PARTS.forEach(part => {
    const input = document.getElementById(`acc-${part}`);
    if (input?.files[0]) {
      tasks.push({ type: 'accompaniment', part, file: input.files[0], prefix: 'acc' });
    }
  });

  // 收集范唱文件
  PARTS.forEach(part => {
    const input = document.getElementById(`voc-${part}`);
    if (input?.files[0]) {
      tasks.push({ type: 'vocal', part, file: input.files[0], prefix: 'voc' });
    }
  });

  if (tasks.length === 0) {
    // 没有音频也可以完成
    toast('未选择音频文件，歌曲上传完成', 'info');
    goStep('done');
    return;
  }

  try {
    showOverlay(`正在上传音频 (0/${tasks.length})...`);

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      document.getElementById('upload-progress-text').textContent =
        `正在上传 ${TRACK_TYPE_LABELS[task.type]} - ${PART_LABELS[task.part]} (${i + 1}/${tasks.length})...`;
      setProgress((i / tasks.length) * 100);

      const formData = new FormData();
      formData.append('type', task.type);
      formData.append('part_name', task.part);
      formData.append('files', task.file);

      const res = await fetch(`${API}/songs/${currentSongId}/upload`, {
        method: 'POST',
        body: formData,
      });

      const result = await res.json();
      if (!res.ok) throw new Error(result.error);

      // 更新状态指示
      const statusEl = document.getElementById(`${task.prefix}-${task.part}-status`);
      if (statusEl) {
        statusEl.textContent = '✓ 已上传';
        statusEl.className = 'part-status success';
      }
    }

    setProgress(100);
    hideOverlay();
    toast(`${tasks.length} 个音频文件上传成功`, 'success');
    goStep('done');
  } catch (e) {
    hideOverlay();
    toast(`上传失败: ${e.message}`, 'error');
  }
}

// ===== 重置上传 =====
function resetUpload() {
  currentSongId = null;
  sheetFiles = [];

  document.getElementById('song-title').value = '';
  document.getElementById('song-artist').value = '';
  document.getElementById('song-desc').value = '';

  renderSheetPreviews();

  // 重置音频输入
  ['acc', 'voc'].forEach(prefix => {
    PARTS.forEach(part => {
      const input = document.getElementById(`${prefix}-${part}`);
      if (input) input.value = '';
      const nameEl = document.getElementById(`${prefix}-${part}-name`);
      if (nameEl) nameEl.textContent = '未选择';
      const statusEl = document.getElementById(`${prefix}-${part}-status`);
      if (statusEl) {
        statusEl.textContent = '';
        statusEl.className = 'part-status';
      }
    });
  });

  goStep(1);
}

// ===== 查看歌曲详情 =====
async function viewSong(songId) {
  switchView('detail');
  // 默认返回歌曲列表（从专辑进入时会被 viewSongFromAlbum 覆盖）
  document.getElementById('detail-back-btn').onclick = function() { switchView('list'); };
  const contentEl = document.getElementById('detail-content');
  contentEl.innerHTML = '<div class="loading">加载中...</div>';

  try {
    const res = await fetch(`${API}/songs/${songId}`);
    const { data: song } = await res.json();

    document.getElementById('detail-title').textContent = song.title;

    let html = `
      <div class="card">
        <div class="detail-info">
          <div class="detail-artist">👤 ${escapeHtml(song.artist) || '未知作者'}</div>
          ${song.description ? `<div class="detail-desc">${escapeHtml(song.description)}</div>` : ''}
          <div style="font-size:12px;color:var(--text-dim);margin-top:8px">创建于 ${formatDate(song.created_at)}</div>
        </div>
    `;

    // 歌谱部分
    if (song.sheets?.length > 0) {
      html += `
        <div class="detail-section">
          <h3>📄 歌谱 (${song.sheets.length}张)</h3>
          <div class="detail-sheets">
            ${song.sheets.map(s => {
              if (s.file_key.endsWith('.pdf')) {
                return `<a href="${s.url}" target="_blank" class="btn btn-outline btn-sm">📑 查看 PDF</a>`;
              }
              return `<img src="${s.url}" class="detail-sheet-img" onclick="window.open('${s.url}','_blank')" alt="歌谱">`;
            }).join('')}
          </div>
        </div>
      `;
    }

    // 音频部分
    const accompaniments = song.tracks?.filter(t => t.track_type === 'accompaniment') || [];
    const vocals = song.tracks?.filter(t => t.track_type === 'vocal') || [];

    if (accompaniments.length > 0) {
      html += `
        <div class="detail-section">
          <h3>🎹 伴奏 (${accompaniments.length}个声部)</h3>
          <div class="detail-tracks">
            ${accompaniments.map(t => `
              <div class="track-card">
                <div class="track-type">伴奏</div>
                <div class="track-part">${PART_LABELS[t.part_name] || t.part_name}</div>
                <audio controls preload="none" src="${t.url}"></audio>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    if (vocals.length > 0) {
      html += `
        <div class="detail-section">
          <h3>🎤 范唱 (${vocals.length}个声部)</h3>
          <div class="detail-tracks">
            ${vocals.map(t => `
              <div class="track-card">
                <div class="track-type">范唱</div>
                <div class="track-part">${PART_LABELS[t.part_name] || t.part_name}</div>
                <audio controls preload="none" src="${t.url}"></audio>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    if (!song.sheets?.length && !accompaniments.length && !vocals.length) {
      html += `<p style="color:var(--text-muted);text-align:center;padding:24px">暂无文件</p>`;
    }

    html += `
        <div class="form-actions" style="margin-top:24px;border-top:1px solid var(--border);padding-top:20px">
          <button class="btn btn-danger btn-sm" onclick="deleteSong('${song.id}', '${escapeHtml(song.title)}')">🗑️ 删除歌曲</button>
        </div>
      </div>
    `;

    contentEl.innerHTML = html;
  } catch (e) {
    contentEl.innerHTML = `<div class="loading">加载失败: ${e.message}</div>`;
  }
}

// ===== 删除歌曲 =====
async function deleteSong(songId, title) {
  if (!confirm(`确定要删除歌曲「${title}」吗？此操作不可恢复。`)) return;

  try {
    const res = await fetch(`${API}/songs/${songId}`, { method: 'DELETE' });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error);

    toast('删除成功', 'success');
    switchView('list');
  } catch (e) {
    toast(`删除失败: ${e.message}`, 'error');
  }
}

// ===== 加载专辑列表 =====
async function loadAlbums(page = 1) {
  albumPage = page;
  const listEl = document.getElementById('album-list');
  listEl.innerHTML = '<div class="loading">加载中...</div>';

  try {
    const res = await fetch(`${API}/albums?page=${page}&limit=12`);
    const { data, pagination } = await res.json();

    if (!data || data.length === 0) {
      listEl.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">💿</div>
          <p>还没有专辑，点击创建按钮添加第一个专辑吧</p>
          <button class="btn btn-primary" onclick="switchView('create-album')">+ 创建专辑</button>
        </div>
      `;
      document.getElementById('album-pagination').innerHTML = '';
      return;
    }

    listEl.innerHTML = data.map(album => {
      let coverHtml = '';
      if (album.cover_url) {
        coverHtml = `<div class="album-cover has-cover"><img src="${album.cover_url}" alt="封面"></div>`;
      } else if (album.preview_covers && album.preview_covers.length > 0) {
        const cells = [];
        for (let i = 0; i < 4; i++) {
          const pc = album.preview_covers[i];
          if (pc && pc.cover_url) {
            cells.push(`<div class="album-cover-cell"><img src="${pc.cover_url}" alt="${escapeHtml(pc.title)}"></div>`);
          } else {
            cells.push(`<div class="album-cover-cell"><span class="placeholder">🎵</span></div>`);
          }
        }
        coverHtml = `<div class="album-cover">${cells.join('')}</div>`;
      } else {
        coverHtml = `<div class="album-cover-empty">💿</div>`;
      }

      return `
        <div class="album-card" onclick="viewAlbum('${album.id}')">
          ${coverHtml}
          <div class="album-card-body">
            <div class="album-card-title">${escapeHtml(album.title)}</div>
            <div class="album-card-meta">
              <span class="album-card-count">${album.song_count} 首歌曲</span>
              <span class="album-card-date">${formatDate(album.created_at)}</span>
            </div>
          </div>
          <button class="btn-icon" onclick="event.stopPropagation(); deleteAlbum('${album.id}', '${escapeHtml(album.title)}')" title="删除">🗑️</button>
        </div>
      `;
    }).join('');

    // 渲染分页
    renderAlbumPagination(pagination);
  } catch (e) {
    listEl.innerHTML = `<div class="loading">加载失败: ${e.message}</div>`;
  }
}

function renderAlbumPagination({ page, totalPages }) {
  const el = document.getElementById('album-pagination');
  if (totalPages <= 1) {
    el.innerHTML = '';
    return;
  }

  let html = `<button class="page-btn" onclick="loadAlbums(${page - 1})" ${page <= 1 ? 'disabled' : ''}>上一页</button>`;

  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || Math.abs(i - page) <= 2) {
      html += `<button class="page-btn ${i === page ? 'active' : ''}" onclick="loadAlbums(${i})">${i}</button>`;
    } else if (Math.abs(i - page) === 3) {
      html += `<span style="color:var(--text-dim)">...</span>`;
    }
  }

  html += `<button class="page-btn" onclick="loadAlbums(${page + 1})" ${page >= totalPages ? 'disabled' : ''}>下一页</button>`;
  el.innerHTML = html;
}

// ===== 查看专辑详情 =====
async function viewAlbum(albumId) {
  switchView('album-detail');
  const contentEl = document.getElementById('album-detail-content');
  contentEl.innerHTML = '<div class="loading">加载中...</div>';

  try {
    const res = await fetch(`${API}/albums/${albumId}`);
    const { data: album } = await res.json();

    document.getElementById('album-detail-title').textContent = album.title;

    const coverImg = album.cover_url
      ? `<img src="${album.cover_url}" alt="封面">`
      : `<span class="empty-cover">💿</span>`;

    let html = `
      <div class="card">
        <div class="album-detail-header">
          <div class="album-detail-cover">${coverImg}</div>
          <div class="album-detail-info">
            <h2>${escapeHtml(album.title)}</h2>
            ${album.description ? `<div class="album-detail-desc">${escapeHtml(album.description)}</div>` : ''}
            <div class="album-detail-stats">
              <span>📀 ${album.songs?.length || 0} 首歌曲</span>
              <span>📅 创建于 ${formatDate(album.created_at)}</span>
            </div>
            <div class="album-detail-actions">
              <button class="btn btn-outline btn-sm" onclick="editAlbum('${album.id}')">✏️ 编辑</button>
              <button class="btn btn-danger btn-sm" onclick="deleteAlbum('${album.id}', '${escapeHtml(album.title)}')">🗑️ 删除</button>
            </div>
          </div>
        </div>
    `;

    if (album.songs && album.songs.length > 0) {
      html += `
        <div class="detail-section">
          <h3>🎵 歌曲列表</h3>
          <div class="album-song-list">
            ${album.songs.map((song, index) => {
              const sheetCount = song.sheets?.length || 0;
              const trackCount = song.tracks?.length || 0;
              return `
                <div class="album-song-item" onclick="viewSongFromAlbum('${song.id}', '${album.id}')">
                  <div class="album-song-num">${index + 1}</div>
                  <div class="album-song-info">
                    <div class="album-song-title">${escapeHtml(song.title)}</div>
                    <div class="album-song-artist">${escapeHtml(song.artist) || '未知作者'}</div>
                  </div>
                  <div class="album-song-tags">
                    ${sheetCount ? `<span class="meta-tag sheets">📄 ${sheetCount}</span>` : ''}
                    ${trackCount ? `<span class="meta-tag audio">🎵 ${trackCount}</span>` : ''}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    } else {
      html += `<p style="color:var(--text-muted);text-align:center;padding:24px">专辑中还没有歌曲，点击编辑按钮添加歌曲</p>`;
    }

    html += `</div>`;
    contentEl.innerHTML = html;
  } catch (e) {
    contentEl.innerHTML = `<div class="loading">加载失败: ${e.message}</div>`;
  }
}

// 从专辑进入歌曲详情，记住返回目标
function viewSongFromAlbum(songId, albumId) {
  detailBackTarget = 'album-detail';
  window._returnAlbumId = albumId;
  document.getElementById('detail-back-btn').onclick = function() {
    viewAlbum(albumId);
  };
  viewSong(songId);
}

// ===== 创建/编辑专辑 =====
function resetAlbumForm() {
  editingAlbumId = null;
  selectedAlbumSongs = [];
  albumCoverFile = null;
  document.getElementById('album-form-title').textContent = '创建专辑';
  document.getElementById('album-submit-btn').textContent = '创建专辑';
  document.getElementById('album-title').value = '';
  document.getElementById('album-desc').value = '';
  document.getElementById('album-song-search').value = '';
  document.getElementById('album-song-candidates').innerHTML = '';
  document.getElementById('album-song-candidates').classList.remove('show');
  renderSelectedSongs();
  renderCoverPreview();
}

async function editAlbum(albumId) {
  try {
    showOverlay('加载专辑信息...');
    const res = await fetch(`${API}/albums/${albumId}`);
    const { data: album } = await res.json();
    hideOverlay();

    editingAlbumId = albumId;
    document.getElementById('album-form-title').textContent = '编辑专辑';
    document.getElementById('album-submit-btn').textContent = '保存修改';
    document.getElementById('album-title').value = album.title;
    document.getElementById('album-desc').value = album.description || '';

    selectedAlbumSongs = (album.songs || []).map(s => ({
      id: s.id,
      title: s.title,
      artist: s.artist,
    }));
    renderSelectedSongs();

    albumCoverFile = null;
    renderCoverPreview(album.cover_url);

    switchView('create-album');
  } catch (e) {
    hideOverlay();
    toast(`加载失败: ${e.message}`, 'error');
  }
}

async function submitAlbum() {
  const title = document.getElementById('album-title').value.trim();
  const description = document.getElementById('album-desc').value.trim();

  if (!title) {
    toast('请输入专辑标题', 'error');
    document.getElementById('album-title').focus();
    return;
  }

  try {
    showOverlay(editingAlbumId ? '正在保存...' : '正在创建专辑...');

    let albumId;

    if (editingAlbumId) {
      // 更新专辑信息
      const res = await fetch(`${API}/albums/${editingAlbumId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      albumId = editingAlbumId;

      // 更新歌曲关联：先获取当前歌曲，计算差异
      const detailRes = await fetch(`${API}/albums/${albumId}`);
      const { data: detail } = await detailRes.json();
      const currentSongIds = (detail.songs || []).map(s => s.id);
      const newSongIds = selectedAlbumSongs.map(s => s.id);

      // 移除不在新列表中的歌曲
      const toRemove = currentSongIds.filter(id => !newSongIds.includes(id));
      if (toRemove.length > 0) {
        await fetch(`${API}/albums/${albumId}/songs`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ song_ids: toRemove }),
        });
      }

      // 添加新歌曲
      const toAdd = newSongIds.filter(id => !currentSongIds.includes(id));
      if (toAdd.length > 0) {
        await fetch(`${API}/albums/${albumId}/songs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ song_ids: toAdd }),
        });
      }

      // 更新排序
      if (newSongIds.length > 0) {
        await fetch(`${API}/albums/${albumId}/songs`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ order: newSongIds }),
        });
      }
    } else {
      // 创建新专辑
      const res = await fetch(`${API}/albums`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      albumId = result.data.id;

      // 添加歌曲
      if (selectedAlbumSongs.length > 0) {
        await fetch(`${API}/albums/${albumId}/songs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ song_ids: selectedAlbumSongs.map(s => s.id) }),
        });
      }
    }

    // 上传封面
    if (albumCoverFile) {
      const formData = new FormData();
      formData.append('file', albumCoverFile);
      await fetch(`${API}/albums/${albumId}/cover`, {
        method: 'POST',
        body: formData,
      });
    }

    setProgress(100);
    hideOverlay();
    toast(editingAlbumId ? '专辑已更新' : '专辑创建成功', 'success');
    editingAlbumId = null;
    switchView('albums');
  } catch (e) {
    hideOverlay();
    toast(`操作失败: ${e.message}`, 'error');
  }
}

// ===== 删除专辑 =====
async function deleteAlbum(albumId, title) {
  if (!confirm(`确定要删除专辑「${title}」吗？此操作不会删除专辑中的歌曲。`)) return;

  try {
    const res = await fetch(`${API}/albums/${albumId}`, { method: 'DELETE' });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error);

    toast('删除成功', 'success');
    switchView('albums');
  } catch (e) {
    toast(`删除失败: ${e.message}`, 'error');
  }
}

// ===== 专辑歌曲选择器 =====
async function searchSongsForAlbum(query) {
  const candidatesEl = document.getElementById('album-song-candidates');

  try {
    // 拉取所有歌曲（简单实现，也可加后端搜索）
    if (allSongsCache.length === 0) {
      const res = await fetch(`${API}/songs?page=1&limit=100`);
      const { data } = await res.json();
      allSongsCache = data || [];
    }

    let filtered = allSongsCache;
    if (query) {
      const q = query.toLowerCase();
      filtered = allSongsCache.filter(s =>
        s.title.toLowerCase().includes(q) || (s.artist && s.artist.toLowerCase().includes(q))
      );
    }

    if (filtered.length === 0) {
      candidatesEl.innerHTML = '<div style="padding:12px;color:var(--text-muted);text-align:center">没有找到歌曲</div>';
      candidatesEl.classList.add('show');
      return;
    }

    const selectedIds = selectedAlbumSongs.map(s => s.id);
    candidatesEl.innerHTML = filtered.map(song => {
      const isSelected = selectedIds.includes(song.id);
      return `
        <div class="song-candidate ${isSelected ? 'selected' : ''}" onclick="toggleAlbumSong('${song.id}', '${escapeHtml(song.title)}', '${escapeHtml(song.artist || '')}')">
          <div class="song-candidate-info">
            <div class="song-candidate-title">${escapeHtml(song.title)}</div>
            <div class="song-candidate-artist">${escapeHtml(song.artist) || '未知作者'}</div>
          </div>
          <span class="song-candidate-action">${isSelected ? '✓' : '+'}</span>
        </div>
      `;
    }).join('');

    candidatesEl.classList.add('show');
  } catch (e) {
    candidatesEl.innerHTML = `<div style="padding:12px;color:var(--danger)">加载失败: ${e.message}</div>`;
    candidatesEl.classList.add('show');
  }
}

function toggleAlbumSong(songId, title, artist) {
  const index = selectedAlbumSongs.findIndex(s => s.id === songId);
  if (index >= 0) {
    selectedAlbumSongs.splice(index, 1);
  } else {
    selectedAlbumSongs.push({ id: songId, title, artist });
  }
  renderSelectedSongs();
  // 刷新候选列表中的选中状态
  const query = document.getElementById('album-song-search').value.trim();
  searchSongsForAlbum(query);
}

function removeAlbumSong(songId) {
  selectedAlbumSongs = selectedAlbumSongs.filter(s => s.id !== songId);
  renderSelectedSongs();
  // 如果候选列表可见，也要刷新
  const candidatesEl = document.getElementById('album-song-candidates');
  if (candidatesEl.classList.contains('show')) {
    const query = document.getElementById('album-song-search').value.trim();
    searchSongsForAlbum(query);
  }
}

function renderSelectedSongs() {
  const container = document.getElementById('album-selected-songs');
  if (selectedAlbumSongs.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = selectedAlbumSongs.map((song, index) => `
    <div class="selected-song-item">
      <div class="selected-song-order">${index + 1}</div>
      <div class="selected-song-info">
        <div class="selected-song-title">${escapeHtml(song.title)}</div>
        <div class="selected-song-artist">${escapeHtml(song.artist) || '未知作者'}</div>
      </div>
      <button class="selected-song-remove" onclick="removeAlbumSong('${song.id}')" title="移除">×</button>
    </div>
  `).join('');
}

// ===== 专辑封面预览 =====
function renderCoverPreview(existingUrl) {
  const previewEl = document.getElementById('album-cover-preview');
  if (albumCoverFile) {
    previewEl.innerHTML = `<img src="${URL.createObjectURL(albumCoverFile)}" alt="封面预览">`;
  } else if (existingUrl) {
    previewEl.innerHTML = `<img src="${existingUrl}" alt="封面">`;
  } else {
    previewEl.innerHTML = `
      <div class="upload-icon">🖼️</div>
      <p>点击选择封面图片</p>
    `;
  }
}

function initAlbumCoverUpload() {
  const zone = document.getElementById('album-cover-zone');
  const input = document.getElementById('album-cover-input');

  zone.addEventListener('click', () => input.click());

  input.addEventListener('change', () => {
    const file = input.files[0];
    if (file && file.type.startsWith('image/')) {
      albumCoverFile = file;
      renderCoverPreview();
    }
    input.value = '';
  });
}

function initAlbumSongSearch() {
  const searchInput = document.getElementById('album-song-search');
  let debounceTimer;

  searchInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const query = searchInput.value.trim();
      searchSongsForAlbum(query);
    }, 300);
  });

  searchInput.addEventListener('focus', () => {
    searchSongsForAlbum(searchInput.value.trim());
  });

  // 点击外部关闭候选列表
  document.addEventListener('click', (e) => {
    const picker = document.querySelector('.album-song-picker');
    if (picker && !picker.contains(e.target)) {
      document.getElementById('album-song-candidates').classList.remove('show');
    }
  });
}

// ===== 导航事件绑定 =====
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    switchView(btn.dataset.view);
  });
});

// ===== 初始化 =====
document.addEventListener('DOMContentLoaded', () => {
  initSheetUpload();
  initAudioInputs();
  initAlbumCoverUpload();
  initAlbumSongSearch();
  loadSongs();
});
