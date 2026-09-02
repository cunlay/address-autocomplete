/**
 * Minimal in-memory TTL cache with size-bounded eviction.
 *
 * Insertion order in the underlying Map is used as a cheap LRU proxy:
 * every read re-inserts the entry so it moves to the "most recent" end,
 * and when the cache is full we evict from the "oldest" end.
 *
 * Swap this out for a Redis-backed implementation in multi-instance
 * deployments — the get/set/delete/clear surface is intentionally small.
 */
class TTLCache {
  constructor({ ttlMs = 5 * 60 * 1000, maxSize = 500 } = {}) {
    this.ttlMs = ttlMs;
    this.maxSize = maxSize;
    this.store = new Map();
  }

  _isExpired(entry) {
    return Date.now() > entry.expiresAt;
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) return undefined;

    if (this._isExpired(entry)) {
      this.store.delete(key);
      return undefined;
    }

    // Refresh recency.
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set(key, value, ttlMs = this.ttlMs) {
    if (this.store.size >= this.maxSize && !this.store.has(key)) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) this.store.delete(oldestKey);
    }
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  delete(key) {
    this.store.delete(key);
  }

  clear() {
    this.store.clear();
  }

  get size() {
    return this.store.size;
  }

  stats() {
    return { size: this.store.size, maxSize: this.maxSize, ttlMs: this.ttlMs };
  }
}

module.exports = { TTLCache };
