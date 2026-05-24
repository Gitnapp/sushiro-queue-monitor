// Shared Redis helper — prefers REDIS_URL (full Redis), falls back to Vercel KV
let redis = null;
function getRedis() {
  if (redis === null) {
    try {
      const { Redis } = require('@upstash/redis');

      // REDIS_URL gives full Redis (including sorted sets)
      if (process.env.REDIS_URL) {
        redis = new Redis({ url: process.env.REDIS_URL });
        console.log('Redis connected (REDIS_URL)');
      }
      // KV_REST_API_URL is Vercel KV (may lack sorted sets)
      else if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
        redis = new Redis({
          url: process.env.KV_REST_API_URL,
          token: process.env.KV_REST_API_TOKEN,
        });
        console.log('Redis connected (KV REST)');
      }
      // Fallback for native Upstash
      else if (process.env.UPSTASH_REDIS_REST_URL) {
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
