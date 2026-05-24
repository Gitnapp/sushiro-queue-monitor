// GET /api/skill — 返回 Agent 一键部署 Skill 的 markdown 内容
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=86400');

  const skill = `---
name: sushiro-queue-monitor
description: 一键部署寿司郎排队监控到 Vercel — 抓取官方 API、Redis 缓存、每分钟 cron 快照、公开 GitHub
version: 1.0.0
---

# 寿司郎排队监控 — Agent 一键部署

复制以下全部内容，粘贴给你的 AI Agent（Claude Code / Codex / Cursor 等），Agent 会自动执行部署。

\`\`\`
创建项目 sushiro-queue-monitor，部署到 Vercel：

mkdir -p sushiro-queue-monitor/{api,lib,public}

# lib/redis.js
cat > sushiro-queue-monitor/lib/redis.js << 'EOF'
let redis = null;
function getRedis() {
  if (redis === null) {
    try {
      const { Redis } = require('@upstash/redis');
      if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
        redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });
      } else { redis = false; }
    } catch { redis = false; }
  }
  return redis || null;
}
module.exports = { getRedis };
EOF

# api/stores.js — 核心 API
cat > sushiro-queue-monitor/api/stores.js << 'EOF'
const https = require('https');
const { getRedis } = require('../lib/redis');
const T = '4OI44O844Kv44Oz5qSc6Ki855So77yad2VjaGF05YWx6YCa4';
const H = { 'Authorization': \`Bearer \${T}\`, 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': '*/*', 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://servicewechat.com/wx7ac31ef6c073a7ed/159/page-frame.html' };

function fetchStores() {
  return new Promise((resolve, reject) => {
    https.get('https://crm-cn-prd.sushiro.com.cn/wechat/api/2.0/stores?latitude=1&longitude=1&numresults=10000', { headers: H }, (res) => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
    }).on('error', reject);
  });
}

function normalize(raw) {
  let stores = raw;
  if (typeof raw === 'object' && !Array.isArray(raw))
    for (const v of Object.values(raw))
      if (Array.isArray(v) && v.length > 0 && v[0]) { stores = v; break; }
  return stores;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const r = getRedis();
  try {
    if (r) { const c = await r.get('sushiro:stores'); if (c) { const d = JSON.parse(c); d.cached = true; return res.json(d); } }
    const stores = normalize(await fetchStores());
    const cities = {}; stores.forEach(s => { const c = s.nameKana || '?'; if (!cities[c]) cities[c] = []; cities[c].push({ id: s.id, name: s.name, status: s.storeStatus, ticket: s.netTicketStatus, wait: s.wait || 0, address: s.address || '' }); });
    const resp = { ok: true, time: new Date().toISOString(), total: stores.length, open: stores.filter(s => s.storeStatus === 'OPEN').length, waiting: stores.reduce((s,x) => s + (x.wait || 0), 0), cached: false, cities };
    if (r) await r.set('sushiro:stores', JSON.stringify(resp), { ex: 60 });
    res.json(resp);
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
};
EOF

# api/store.js / api/cron.js / api/history.js (精简)
cat > sushiro-queue-monitor/api/store.js << 'EOF'
const https = require('https');
const T = '4OI44O844Kv44Oz5qSc6Ki855So77yad2VjaGF05YWx6YCa4';
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (!req.query.id) return res.status(400).json({ error: '?id=' });
  https.get(\`https://crm-cn-prd.sushiro.com.cn/wechat/api/2.0/getStoreById?storeId=\${req.query.id}\`, { headers: { 'Authorization': \`Bearer \${T}\`, 'Referer': 'https://servicewechat.com/wx7ac31ef6c073a7ed/159/page-frame.html' } }, (r) => { let d = ''; r.on('data', c => d += c); r.on('end', () => res.json(JSON.parse(d))); }).on('error', e => res.status(500).json({ error: e.message }));
};
EOF

cat > sushiro-queue-monitor/api/cron.js << 'EOF'
const https = require('https');
const { getRedis } = require('../lib/redis');
const T = '4OI44O844Kv44Oz5qSc6Ki855So77yad2VjaGF05YWx6YCa4';
module.exports = async (req, res) => {
  const r = getRedis();
  https.get('https://crm-cn-prd.sushiro.com.cn/wechat/api/2.0/stores?latitude=1&longitude=1&numresults=10000', { headers: { 'Authorization': \`Bearer \${T}\`, 'Referer': 'https://servicewechat.com/wx7ac31ef6c073a7ed/159/page-frame.html' } }, (resp) => {
    let d = ''; resp.on('data', c => d += c);
    resp.on('end', async () => {
      let stores = JSON.parse(d);
      if (!Array.isArray(stores)) for (const v of Object.values(stores)) if (Array.isArray(v)) { stores = v; break; }
      if (r) {
        await r.set('sushiro:stores', JSON.stringify({ ok: true, time: new Date().toISOString(), waiting: stores.reduce((s,x) => s + (x.wait || 0), 0) }), { ex: 60 });
        const rawH = await r.get('sushiro:history');
        const history = rawH ? JSON.parse(rawH) : [];
        history.unshift({ time: new Date().toISOString(), waiting: stores.reduce((s,x) => s + (x.wait || 0), 0) });
        if (history.length > 1440) history.length = 1440;
        await r.set('sushiro:history', JSON.stringify(history));
      }
      res.json({ ok: true, stored: !!r, stores: stores.length });
    });
  }).on('error', e => res.status(500).json({ error: e.message }));
};
EOF

cat > sushiro-queue-monitor/api/history.js << 'EOF'
const { getRedis } = require('../lib/redis');
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const r = getRedis(); if (!r) return res.status(503).json({ error: 'Redis needed' });
  const raw = await r.get('sushiro:history');
  const history = raw ? JSON.parse(raw) : [];
  const hours = parseInt(req.query.hours) || 6;
  const since = new Date(Date.now() - hours * 3600000).toISOString();
  res.json({ ok: true, timeline: history.filter(p => p.time >= since).reverse() });
};
EOF

# package.json & vercel.json
echo '{ "name": "sushiro-queue-monitor", "private": true, "dependencies": { "@upstash/redis": "^1.0.0" } }' > sushiro-queue-monitor/package.json
echo '{ "headers": [{ "source": "/api/(.*)", "headers": [{ "key": "Access-Control-Allow-Origin", "value": "*" }] }], "crons": [{ "path": "/api/cron", "schedule": "*/1 * * * *" }] }' > sushiro-queue-monitor/vercel.json

# 前端（最小化）
cat > sushiro-queue-monitor/index.html << 'EOF'
<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>寿司郎排队</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,sans-serif;background:#1a1a2e;color:#eee}
header{background:#16213e;padding:16px 20px;display:flex;justify-content:space-between}
h1{font-size:1.2rem;color:#f6c445}#info{font-size:.8rem;color:#888}
#summary{padding:12px 20px;background:#0f3460;display:flex;gap:20px}
.num{color:#f6c445;font-weight:bold}
.city-block{margin:8px 16px;border-radius:8px;overflow:hidden}
.city-header{padding:10px 16px;background:#16213e;display:flex;justify-content:space-between;cursor:pointer}
.store-row{padding:8px 16px 8px 30px;border-bottom:1px solid #1a1a2e;display:flex;justify-content:space-between;font-size:.85rem}
.store-row:nth-child(odd){background:#1e1e3a}.store-row:nth-child(even){background:#222244}
.w-hi{background:#e94560;color:#fff;padding:2px 8px;border-radius:10px;font-size:.75rem}
.w-md{background:#f6c445;color:#1a1a2e;padding:2px 8px;border-radius:10px;font-size:.75rem}
.w-lo{background:#1a936f;color:#fff;padding:2px 8px;border-radius:10px;font-size:.75rem}
footer{padding:20px;text-align:center;font-size:.7rem;color:#555}
</style></head><body>
<script>fetch('/api/stores').then(r=>r.json()).then(d=>{
document.body.innerHTML='<header><h1>🍣 寿司郎排队</h1><span style="font-size:.8rem;color:#888">'+new Date(d.time).toLocaleTimeString('zh-CN')+'</span></header><div id="summary" style="padding:12px 20px;background:#0f3460"><span>门店: <span class="num">'+d.total+'</span></span><span>排队: <span class="num">'+d.waiting+'</span> 桌</span></div><div id="content"></div>';
let h='';for(const[c,s]of Object.entries(d.cities).sort()){let w=s.filter(x=>x.wait>0).length,tw=s.reduce((a,x)=>a+x.wait,0);
h+='<div class="city-block"><div class="city-header" onclick="this.nextSibling.style.display=this.nextSibling.style.display==\"none\"?\"block\":\"none\""><span>📍 '+c+'</span><span style="color:#888;font-size:.8rem">'+w+'排队 · '+tw+'桌</span></div><div style="display:block">';
s.sort((a,b)=>b.wait-a.wait).forEach(x=>{let bc='',bt=0;if(x.wait>200){bc='w-hi';bt=x.wait}else if(x.wait>50){bc='w-md';bt=x.wait}else if(x.wait>0){bc='w-lo';bt=x.wait}
h+='<div class="store-row"><span>'+(x.status=='OPEN'?'🟢':'🔴')+' '+x.name+'</span>'+(bt?'<span class="'+bc+'">'+bt+'桌</span>':'')+'</div>'});h+='</div></div>'}
document.getElementById('content').innerHTML=h})</script></body></html>
EOF

# 部署
cd sushiro-queue-monitor && npm install
git init && git add -A && git commit -m "Initial: 寿司郎排队监控"
gh repo create sushiro-queue-monitor --public --source=. --remote=origin --push
vercel --prod --yes
vercel git connect https://github.com/<你的用户名>/sushiro-queue-monitor --yes
vercel project protection disable --sso
# Redis: https://vercel.com/integrations/upstash
\`\`\`

## API

| 端点 | 说明 |
|------|------|
| GET /api/stores | 全门店排队 |
| GET /api/store?id=1012 | 单门店详情 |
| GET /api/history | 排队趋势（需 Redis） |
| GET /api/cron | 手动快照 |

## 技术细节

- 数据源: crm-cn-prd.sushiro.com.cn (Bearer token 硬编码)
- TLS: 必须 Node.js 原生 https (Python 被 CloudFront 拦)
- Cron: */1 * * * * 每分钟快照
- 免费: Vercel Hobby + Upstash 免费层
`;

  res.status(200).send(skill);
};
