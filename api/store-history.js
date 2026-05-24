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
    const raw = await r.get(`sushiro:store:${id}:history`);
    let history = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : [];

    const since = new Date(Date.now() - hours * 3600000).toISOString();
    const timeline = history.filter(p => p.time >= since);

    res.setHeader('Cache-Control', 'public, max-age=60');
    res.status(200).json({
      ok: true, storeId: id, hours,
      dataPoints: timeline.length,
      timeline: timeline.reverse(),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};
