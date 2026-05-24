// Vercel Cron: 每 3 分钟自动快照排队数据到 Redis
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

const TOKEN = '4OI44O844Kv44Oz5qSc6Ki855So77yad2VjaGF05YWx6YCa4';
const HEADERS = {
  'Authorization': `Bearer ${TOKEN}`,
  'Content-Type': 'application/x-www-form-urlencoded',
  'Accept': '*/*',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  'Referer': 'https://servicewechat.com/wx7ac31ef6c073a7ed/159/page-frame.html',
};

function sushiroApi(path) {
  return new Promise((resolve, reject) => {
    https.get(`https://crm-cn-prd.sushiro.com.cn${path}`, { headers: HEADERS }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error(`Parse: ${data.slice(0,200)}`)); }
      });
    }).on('error', reject);
  });
}

module.exports = async (req, res) => {
  // Cron job auth — Vercel sends Authorization header
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const r = getRedis();
  const result = { ok: true, cached: false, stored: false, stores: 0, waiting: 0 };

  try {
    // Fetch from Sushiro
    const raw = await sushiroApi('/wechat/api/2.0/stores?latitude=1&longitude=1&numresults=10000');

    let stores = raw;
    if (typeof raw === 'object' && !Array.isArray(raw)) {
      for (const v of Object.values(raw)) {
        if (Array.isArray(v) && v.length > 0 && v[0] && typeof v[0] === 'object') {
          stores = v; break;
        }
      }
    }

    const totalWaiting = stores.reduce((sum, s) => sum + (s.wait || 0), 0);
    const openCount = stores.filter(s => s.storeStatus === 'OPEN').length;

    // Build cache payload
    const cities = {};
    for (const s of stores) {
      const city = s.nameKana || 'Unknown';
      if (!cities[city]) cities[city] = [];
      cities[city].push({
        id: s.id, name: s.name,
        status: s.storeStatus, ticket: s.netTicketStatus,
        wait: s.wait || 0, address: s.address || '',
      });
    }

    const payload = {
      ok: true,
      time: new Date().toISOString(),
      total: stores.length, open: openCount, waiting: totalWaiting,
      cached: false, cities,
    };

    result.stores = stores.length;
    result.waiting = totalWaiting;

    // Store to Redis
    if (r) {
      // Cache
      await r.set('sushiro:stores', JSON.stringify(payload), { ex: 120 });
      result.cached = true;

      // Timeline snapshot
      const snap = { time: payload.time, waiting: totalWaiting, open: openCount };
      await r.zadd('sushiro:history:timeline', { score: Date.now(), member: JSON.stringify(snap) });
      // Keep 7 days
      await r.zremrangebyscore('sushiro:history:timeline', 0, Date.now() - 7 * 86400000);
      result.stored = true;
    }

    // Store per-store snapshots for individual store history
    if (r && stores.length > 0) {
      const pipeline = [];
      const now = Date.now();
      for (const s of stores) {
        const snap = JSON.stringify({
          time: new Date().toISOString(),
          wait: s.wait || 0,
          status: s.storeStatus,
          ticket: s.netTicketStatus,
        });
        pipeline.push(r.zadd(`sushiro:store:${s.id}:history`, { score: now, member: snap }));
      }
      await Promise.allSettled(pipeline);
    }

    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};
