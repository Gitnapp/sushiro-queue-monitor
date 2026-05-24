const { getRedis } = require('../lib/redis');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const r = getRedis();
  const id = req.query.id;
  if (!id) return res.status(400).json({ ok: false, error: 'Missing ?id=' });
  if (!r) return res.status(503).json({ ok: false, error: 'Redis 未配置' });

  try {
    const hours = parseInt(req.query.hours) || 6;
    const since = Date.now() - hours * 3600000;
    const key = `sushiro:store:${id}:history`;
    const raw = await r.zrangebyscore(key, since, Date.now());

    const timeline = [];
    for (const item of raw) {
      try { timeline.push(typeof item === 'string' ? JSON.parse(item) : item); } catch {}
    }

    res.setHeader('Cache-Control', 'public, max-age=60');
    res.status(200).json({ ok: true, storeId: id, hours, dataPoints: timeline.length, timeline });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};
