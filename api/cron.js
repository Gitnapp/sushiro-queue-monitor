const https = require('https');
const { getRedis } = require('../lib/redis');

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
      await r.set('sushiro:stores', JSON.stringify(payload), { ex: 60 });
      result.cached = true;

      // Timeline: prepend to JSON array
      const snap = { time: payload.time, waiting: totalWaiting, open: openCount };
      const raw = await r.get('sushiro:history');
      const history = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : [];
      history.unshift(snap);
      if (history.length > 1440) history.length = 1440; // 24h at 1min
      await r.set('sushiro:history', JSON.stringify(history));
      result.stored = true;
    }

    // Store per-store snapshots (max 5 stores, to avoid KV rate limits)
    if (r) {
      const top = [...stores].sort((a, b) => (b.wait || 0) - (a.wait || 0)).slice(0, 10);
      for (const s of top) {
        try {
          const key = `sushiro:store:${s.id}:history`;
          const raw = await r.get(key);
          const arr = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : [];
          arr.unshift({
            time: new Date().toISOString(),
            wait: s.wait || 0,
            status: s.storeStatus,
          });
          if (arr.length > 288) arr.length = 288; // ~5h at 1min
          await r.set(key, JSON.stringify(arr));
        } catch {}
      }
    }

    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};
