// Shared Redis helper — uses Vercel KV (Upstash) env vars
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
      } else if (process.env.UPSTASH_REDIS_REST_URL) {
        redis = Redis.fromEnv();
        console.log('Redis connected (Upstash native)');
      } else {
        redis = false;
        console.log('Redis skipped (no env vars)');
      }
    } catch {
      redis = false;
      console.log('Redis skipped (no package)');
    }
  }
  return redis || null;
}

module.exports = { getRedis };
