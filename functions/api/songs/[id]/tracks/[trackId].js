// DELETE /api/songs/:id/tracks/:trackId - 删除音频轨道

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
  const { id, trackId } = params;

  try {
    const track = await env.DB.prepare(
      'SELECT * FROM audio_tracks WHERE id = ? AND song_id = ?'
    ).bind(trackId, id).first();

    if (!track) {
      return json({ error: '音频轨道不存在' }, 404);
    }

    // 从 R2 删除
    await env.SONG_BUCKET.delete(track.file_key);

    // 从数据库删除
    await env.DB.prepare('DELETE FROM audio_tracks WHERE id = ?').bind(trackId).run();

    return json({ message: '删除成功' });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
