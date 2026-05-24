// Shared Redis helper — Vercel KV (Upstash Redis REST)
let redis = null;
function getRedis() {
  if (redis === null) {
    try {
      const { Redis } = require('@upstash/redis');
      if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
        redis = new Redis({
          url: process.env.KV_REST_API_URL,
          token: process.env.KV_REST_API_TOKEN,
        });
        console.log('Redis connected');
      } else {
        redis = false;
        console.log('Redis skipped (no env vars)');
      }
    } catch {
      redis = false;
    }
  }
  return redis || null;
}

module.exports = { getRedis };
