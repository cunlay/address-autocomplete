/**
 * Cache backend selector.
 *
 * - REDIS_URL set  -> Redis (persists across restarts and deploys). Entries
 *                     expire automatically after the TTL.
 * - REDIS_URL unset -> the in-memory TTLCache (fine for local development).
 *
 * Both expose the same async surface: get / set / clear / stats. If Redis is
 * unreachable, callers treat reads as misses and writes as no-ops, so a cache
 * outage only costs speed, never a failed search.
 */
const { TTLCache } = require('./cache');

const KEY_PREFIX = 'addr:';

function createCache({ ttlMs, maxSize }) {
  if (process.env.REDIS_URL) {
    const Redis = require('ioredis');
    const client = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 2000,
    });
    client.on('error', (err) => console.error('[cache] redis error:', err.message));

    return {
      kind: 'redis',
      async get(key) {
        const raw = await client.get(key);
        return raw ? JSON.parse(raw) : undefined;
      },
      async set(key, value, ttl = ttlMs) {
        await client.set(key, JSON.stringify(value), 'PX', ttl);
      },
      async clear() {
        let cursor = '0';
        do {
          const [next, keys] = await client.scan(cursor, 'MATCH', `${KEY_PREFIX}*`, 'COUNT', 500);
          cursor = next;
          if (keys.length) await client.del(...keys);
        } while (cursor !== '0');
      },
      async stats() {
        return { kind: 'redis', ttlMs };
      },
    };
  }

  const memory = new TTLCache({ ttlMs, maxSize });
  return {
    kind: 'memory',
    async get(key) {
      return memory.get(key);
    },
    async set(key, value, ttl = ttlMs) {
      memory.set(key, value, ttl);
    },
    async clear() {
      memory.clear();
    },
    async stats() {
      return { kind: 'memory', ...memory.stats() };
    },
  };
}

module.exports = { createCache, KEY_PREFIX };
