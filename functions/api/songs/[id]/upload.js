// POST /api/songs/:id/upload - 上传文件（歌谱图片/PDF/伴奏/范唱）

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function onRequestPost(context) {
  const { env, params, request } = context;
  const { id } = params;

  try {
    // 验证歌曲存在
    const song = await env.ASC_DB.prepare('SELECT * FROM songs WHERE id = ?').bind(id).first();
    if (!song) {
      return json({ error: '歌曲不存在' }, 404);
    }

    const formData = await request.formData();
    const fileType = formData.get('type'); // 'sheet', 'accompaniment', 'vocal'
    const partName = formData.get('part_name') || 'default'; // 声部名称
    const partLabel = formData.get('part_label') || ''; // 声部中文名（如：女高、女低、男高、男低）
    const files = formData.getAll('files');

    if (!files || files.length === 0) {
      return json({ error: '没有上传文件' }, 400);
    }

    if (!['sheet', 'accompaniment', 'vocal'].includes(fileType)) {
      return json({ error: '无效的文件类型，支持: sheet, accompaniment, vocal' }, 400);
    }

    const results = [];

    for (const file of files) {
      const isPdf = file.type === 'application/pdf' || file.name.endsWith('.pdf');

      if (fileType === 'sheet') {
        if (isPdf) {
          // PDF 转图片处理
          const pdfImages = await convertPdfToImages(env, file, id);
          results.push(...pdfImages);
        } else {
          // 直接上传图片
          const result = await uploadSheetImage(env, file, id);
          results.push(result);
        }
      } else {
        // 上传音频
        const result = await uploadAudioTrack(env, file, id, fileType, partName, partLabel);
        results.push(result);
      }
    }

    return json({ data: results }, 201);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

async function uploadSheetImage(env, file, songId) {
  const id = crypto.randomUUID();
  const ext = file.name.split('.').pop().toLowerCase();
  const fileKey = `songs/${songId}/sheets/${id}.${ext}`;

  // 上传到 R2
  const arrayBuffer = await file.arrayBuffer();
  await env.ASC_BUCKET.put(fileKey, arrayBuffer, {
    httpMetadata: { contentType: file.type },
  });

  // 获取当前最大排序值
  const maxOrder = await env.ASC_DB.prepare(
    'SELECT MAX(sort_order) as max_order FROM sheet_images WHERE song_id = ?'
  ).bind(songId).first();
  const sortOrder = (maxOrder?.max_order ?? -1) + 1;

  // 插入数据库
  await env.ASC_DB.prepare(
    'INSERT INTO sheet_images (id, song_id, file_key, sort_order) VALUES (?, ?, ?, ?)'
  ).bind(id, songId, fileKey, sortOrder).run();

  return { id, type: 'sheet', file_key: fileKey, sort_order: sortOrder };
}

async function uploadAudioTrack(env, file, songId, trackType, partName, partLabel) {
  const id = crypto.randomUUID();
  const ext = file.name.split('.').pop().toLowerCase();
  const fileKey = `songs/${songId}/audio/${trackType}/${partName}.${ext}`;

  // 上传到 R2
  const arrayBuffer = await file.arrayBuffer();
  await env.ASC_BUCKET.put(fileKey, arrayBuffer, {
    httpMetadata: { contentType: file.type || 'audio/mpeg' },
  });

  // 检查是否已存在同类型同声部
  const existing = await env.ASC_DB.prepare(
    'SELECT id, file_key FROM audio_tracks WHERE song_id = ? AND track_type = ? AND part_name = ?'
  ).bind(songId, trackType, partName).first();

  if (existing) {
    // 删除旧文件
    await env.ASC_BUCKET.delete(existing.file_key);
    // 更新记录
    await env.ASC_DB.prepare(
      'UPDATE audio_tracks SET file_key = ?, file_size = ?, part_label = ? WHERE id = ?'
    ).bind(fileKey, arrayBuffer.byteLength, partLabel, existing.id).run();
    return { id: existing.id, type: trackType, part_name: partName, part_label: partLabel, file_key: fileKey, updated: true };
  }

  // 插入新记录
  await env.ASC_DB.prepare(
    'INSERT INTO audio_tracks (id, song_id, track_type, part_name, part_label, file_key, file_size) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, songId, trackType, partName, partLabel, fileKey, arrayBuffer.byteLength).run();

  return { id, type: trackType, part_name: partName, part_label: partLabel, file_key: fileKey };
}

async function convertPdfToImages(env, file, songId) {
  // 使用 pdf.js 在 Worker 环境中将 PDF 转换为图片
  // Cloudflare Workers 支持 OffscreenCanvas
  const arrayBuffer = await file.arrayBuffer();
  const results = [];

  try {
    // 动态导入 pdfjs-dist（需在构建时打包）
    const pdfjsLib = await import('pdfjs-dist');

    // Worker 环境无需设置 workerSrc
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
    const numPages = pdf.numPages;

    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: 2.0 }); // 2x 缩放保证清晰

      // 使用 OffscreenCanvas
      const canvas = new OffscreenCanvas(viewport.width, viewport.height);
      const ctx = canvas.getContext('2d');

      await page.render({ canvasContext: ctx, viewport }).promise;

      // 转换为 PNG
      const blob = await canvas.convertToBlob({ type: 'image/png' });
      const imgArrayBuffer = await blob.arrayBuffer();

      // 上传到 R2
      const id = crypto.randomUUID();
      const fileKey = `songs/${songId}/sheets/${id}.png`;
      await env.ASC_BUCKET.put(fileKey, imgArrayBuffer, {
        httpMetadata: { contentType: 'image/png' },
      });

      // 获取排序值
      const maxOrder = await env.ASC_DB.prepare(
        'SELECT MAX(sort_order) as max_order FROM sheet_images WHERE song_id = ?'
      ).bind(songId).first();
      const sortOrder = (maxOrder?.max_order ?? -1) + 1;

      // 插入数据库
      await env.ASC_DB.prepare(
        'INSERT INTO sheet_images (id, song_id, file_key, sort_order, width, height) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(id, songId, fileKey, sortOrder, Math.round(viewport.width), Math.round(viewport.height)).run();

      results.push({
        id,
        type: 'sheet',
        file_key: fileKey,
        sort_order: sortOrder,
        width: Math.round(viewport.width),
        height: Math.round(viewport.height),
        page: pageNum,
      });
    }

    page?.cleanup?.();
    pdf.destroy();
  } catch (e) {
    // PDF 转换失败时，保存原始 PDF 文件并记录
    console.error('PDF conversion failed:', e.message);
    const id = crypto.randomUUID();
    const fileKey = `songs/${songId}/sheets/${id}.pdf`;
    await env.ASC_BUCKET.put(fileKey, arrayBuffer, {
      httpMetadata: { contentType: 'application/pdf' },
    });

    const maxOrder = await env.ASC_DB.prepare(
      'SELECT MAX(sort_order) as max_order FROM sheet_images WHERE song_id = ?'
    ).bind(songId).first();
    const sortOrder = (maxOrder?.max_order ?? -1) + 1;

    await env.ASC_DB.prepare(
      'INSERT INTO sheet_images (id, song_id, file_key, sort_order) VALUES (?, ?, ?, ?)'
    ).bind(id, songId, fileKey, sortOrder).run();

    results.push({
      id,
      type: 'sheet',
      file_key: fileKey,
      sort_order: sortOrder,
      note: 'PDF 自动转换失败，已保存原始 PDF',
    });
  }

  return results;
}
