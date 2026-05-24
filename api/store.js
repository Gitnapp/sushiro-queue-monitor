// Vercel Serverless: GET /api/store?id=1012 — 单门店详情
const https = require('https');

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
        catch(e) { reject(new Error(`Parse error: ${data.slice(0,200)}`)); }
      });
    }).on('error', reject);
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=60');

  const { id } = req.query;
  if (!id) {
    return res.status(400).json({ ok: false, error: 'Missing ?id= parameter' });
  }

  try {
    const store = await sushiroApi(`/wechat/api/2.0/getStoreById?storeId=${id}`);

    res.status(200).json({
      ok: true,
      store: {
        id: store.id,
        name: store.name,
        city: store.nameKana,
        address: store.address,
        area: store.area,
        lat: store.latitude,
        lng: store.longitude,
        status: store.storeStatus,
        ticket: store.netTicketStatus,
        wait: store.wait || 0,
        waitCounter: store.waitTimeCounter,
        waitCap: store.waitTimeCap,
        reservation: store.reservationStatus,
        tables: store.tablesCapacity,
        counters: store.countersCapacity,
        groupQueues: store.groupQueues,
        groupQueuesCount: store.groupQueuesCount,
      },
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};
