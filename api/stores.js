// Vercel Serverless: GET /api/stores — 所有门店排队 (可选 Redis 缓存 + 历史快照)
const https = require('https');

// Lazy Redis — works with or without Upstash
let redis = null;
function getRedis() {
  if (redis === null) {
    try {
      const { Redis } = require('@upstash/redis');
      if (process.env.UPSTASH_REDIS_REST_URL) {
        redis = Redis.fromEnv();
        console.log('Redis connected');
      } else {
        redis = false; // Mark as unavailable
        console.log('Redis skipped (no env vars)');
      }
    } catch {
      redis = false;
      console.log('Redis skipped (no package)');
    }
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
const CACHE_KEY = 'sushiro:stores';
const CACHE_TTL = 60;

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

function normalize(raw) {
  let stores = raw;
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    for (const v of Object.values(raw)) {
      if (Array.isArray(v) && v.length > 0 && v[0] && typeof v[0] === 'object') {
        stores = v;
        break;
      }
    }
  }
  return stores;
}

function build(storeList) {
  const cities = {};
  for (const s of storeList) {
    const city = s.nameKana || 'Unknown';
    if (!cities[city]) cities[city] = [];
    cities[city].push({
      id: s.id, name: s.name,
      status: s.storeStatus, ticket: s.netTicketStatus,
      wait: s.wait || 0, waitCap: s.waitTimeCap || 0,
      address: s.address || '',
    });
  }
  const totalWaiting = storeList.reduce((sum, s) => sum + (s.wait || 0), 0);
  const openCount = storeList.filter(s => s.storeStatus === 'OPEN').length;
  return {
    ok: true, time: new Date().toISOString(),
    total: storeList.length, open: openCount, waiting: totalWaiting,
    cached: false, cities,
  };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const r = getRedis();

  try {
    // Try cache
    if (r) {
      const cached = await r.get(CACHE_KEY);
      if (cached) {
        const data = typeof cached === 'string' ? JSON.parse(cached) : cached;
        data.cached = true;
        res.setHeader('Cache-Control', 'public, max-age=30');
        return res.status(200).json(data);
      }
    }

    // Fetch from Sushiro
    const raw = await sushiroApi('/wechat/api/2.0/stores?latitude=1&longitude=1&numresults=10000');
    const stores = normalize(raw);
    const resp = build(stores);

    // Cache + snapshot
    if (r) {
      await r.set(CACHE_KEY, JSON.stringify(resp), { ex: CACHE_TTL });
      const snap = { time: resp.time, waiting: resp.waiting, open: resp.open };
      await r.zadd('sushiro:history:timeline', { score: Date.now(), member: JSON.stringify(snap) });
      await r.zremrangebyscore('sushiro:history:timeline', 0, Date.now() - 7 * 86400000);
    }

    res.setHeader('Cache-Control', 'public, max-age=30');
    res.status(200).json(resp);
  } catch (err) {
    if (r) {
      const stale = await r.get(CACHE_KEY);
      if (stale) {
        const data = typeof stale === 'string' ? JSON.parse(stale) : stale;
        data.cached = true; data.stale = true;
        return res.status(200).json(data);
      }
    }
    res.status(500).json({ ok: false, error: err.message });
  }
};
