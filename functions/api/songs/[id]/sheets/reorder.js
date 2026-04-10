// PUT /api/songs/:id/sheets/reorder - 重新排序歌谱图片

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'PUT, OPTIONS',
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

export async function onRequestPut(context) {
  const { env, params, request } = context;
  const { id } = params;

  try {
    const body = await request.json();
    const { order } = body; // 数组: [sheet_id_1, sheet_id_2, ...]

    if (!Array.isArray(order)) {
      return json({ error: 'order 必须是数组' }, 400);
    }

    // 批量更新排序
    const stmts = order.map((sheetId, index) =>
      env.DB.prepare('UPDATE sheet_images SET sort_order = ? WHERE id = ? AND song_id = ?')
        .bind(index, sheetId, id)
    );

    await env.DB.batch(stmts);

    return json({ message: '排序更新成功' });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
