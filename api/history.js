const { getRedis } = require('../lib/redis');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const r = getRedis();
  if (!r) {
    return res.status(503).json({ ok: false, error: 'Redis 未配置' });
  }

  try {
    const hours = parseInt(req.query.hours) || 6;
    const city = (req.query.city || '').trim();
    const raw = await r.get('sushiro:history');
    let history = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : [];

    // Filter by time window
    const since = new Date(Date.now() - hours * 3600000).toISOString();
    let timeline = history.filter(p => p.time >= since);

    // If city specified, drop snapshots that pre-date the per-city rollout
    // (no `cities` field) so the chart shows truthful gaps, not fake zeros.
    if (city) {
      timeline = timeline
        .filter(p => p.cities && Object.prototype.hasOwnProperty.call(p.cities, city))
        .map(p => ({ time: p.time, waiting: p.cities[city].waiting, open: p.cities[city].open }));
    }

    // Aggregate by hour
    const hourly = {};
    for (const p of timeline) {
      const h = p.time.slice(0, 13);
      if (!hourly[h] || hourly[h].waiting < p.waiting) hourly[h] = p;
    }

    res.setHeader('Cache-Control', 'public, max-age=60');
    res.status(200).json({
      ok: true, hours, city: city || null, dataPoints: timeline.length,
      timeline: timeline.reverse(), // chronological
      hourly: Object.values(hourly).sort((a, b) => a.time.localeCompare(b.time)),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};
