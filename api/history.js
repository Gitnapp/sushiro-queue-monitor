// Vercel Serverless: GET /api/history — 排队历史趋势 (需要 Redis)
const https = require('https');

let redis = null;
function getRedis() {
  if (redis === null) {
    try {
      const { Redis } = require('@upstash/redis');
      if (process.env.UPSTASH_REDIS_REST_URL) {
        redis = Redis.fromEnv();
      } else {
        redis = false;
      }
    } catch { redis = false; }
  }
  return redis || null;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const r = getRedis();
  if (!r) {
    return res.status(503).json({ ok: false, error: 'Redis 未配置。在 Vercel Dashboard → Integrations → 添加 Upstash Redis' });
  }

  try {
    const hours = parseInt(req.query.hours) || 6;
    const since = Date.now() - hours * 3600000;
    const raw = await r.zrangebyscore('sushiro:history:timeline', since, Date.now());

    const timeline = [];
    for (const item of raw) {
      try { timeline.push(typeof item === 'string' ? JSON.parse(item) : item); } catch {}
    }

    // Aggregate by hour
    const hourly = {};
    for (const p of timeline) {
      const h = p.time.slice(0, 13); // "2026-05-24T15"
      if (!hourly[h] || hourly[h].waiting < p.waiting) hourly[h] = p;
    }

    res.setHeader('Cache-Control', 'public, max-age=60');
    res.status(200).json({
      ok: true, hours, dataPoints: timeline.length,
      timeline,
      hourly: Object.values(hourly).sort((a, b) => a.time.localeCompare(b.time)),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};
