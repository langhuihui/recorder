// DELETE /api/songs/:id/sheets/:sheetId - 删除歌谱图片

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'DELETE, OPTIONS',
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

export async function onRequestDelete(context) {
  const { env, params } = context;
  const { id, sheetId } = params;

  try {
    const sheet = await env.DB.prepare(
      'SELECT * FROM sheet_images WHERE id = ? AND song_id = ?'
    ).bind(sheetId, id).first();

    if (!sheet) {
      return json({ error: '歌谱图片不存在' }, 404);
    }

    // 从 R2 删除
    await env.SONG_BUCKET.delete(sheet.file_key);

    // 从数据库删除
    await env.DB.prepare('DELETE FROM sheet_images WHERE id = ?').bind(sheetId).run();

    return json({ message: '删除成功' });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
