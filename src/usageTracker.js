/**
 * Tracks provider usage against free-tier quotas so the "auto" endpoint can
 * skip a provider once it's exhausted for the current period, instead of
 * running up overage charges or hammering the upstream API for 429s.
 *
 * In-memory + single-process, reset on restart. For multi-instance
 * deployments, back this with Redis (INCR + EXPIRE per provider/window)
 * so all instances share one counter — the increment/isExhausted/status
 * surface below is intentionally small so that's a drop-in swap.
 */

// Free-tier ceilings as published by each provider. Override any of these
// via env vars (see server.js) if a provider changes its plan.
const DEFAULT_LIMITS = {
  here: { limit: 250000, window: 'month' }, // HERE Geocoding & Search free tier
  mapbox: { limit: 100000, window: 'month' }, // Mapbox temporary geocoding free tier
  locationiq: { limit: 5000, window: 'day' }, // LocationIQ free tier
  opencage: { limit: 2500, window: 'day' }, // OpenCage free tier
  geoapify: { limit: 3000, window: 'day' }, // Geoapify free tier
  pelias: null, // hosted (geocode.earth) plans vary / self-hosted has none — set PELIAS_FREE_LIMIT if you want tracking
  photon: null, // public instance: keyless, no account-level quota to track
  nominatim: null, // public instance: keyless; governed by rate limit, not a request quota
};

function windowStartMs(window, now) {
  return window === 'day'
    ? Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    : Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
}

function windowEndMs(window, now) {
  return window === 'day'
    ? Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
    : Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
}

class UsageTracker {
  constructor(limits = DEFAULT_LIMITS) {
    this.limits = limits;
    this.counters = new Map(); // provider -> { count, windowStartMs }
  }

  _config(provider) {
    return this.limits[provider] || null;
  }

  // Returns the counter for the provider's *current* window, rolling it
  // over to a fresh count if we've crossed into a new day/month.
  _currentCounter(provider) {
    const config = this._config(provider);
    if (!config) return null;

    const now = new Date();
    const start = windowStartMs(config.window, now);
    let counter = this.counters.get(provider);

    if (!counter || counter.windowStartMs !== start) {
      counter = { count: 0, windowStartMs: start };
      this.counters.set(provider, counter);
    }
    return counter;
  }

  increment(provider, amount = 1) {
    const counter = this._currentCounter(provider);
    if (!counter) return; // unmetered provider (e.g. Photon)
    counter.count += amount;
  }

  isExhausted(provider) {
    const config = this._config(provider);
    if (!config) return false;
    return this._currentCounter(provider).count >= config.limit;
  }

  status(provider) {
    const config = this._config(provider);
    if (!config) {
      return { provider, metered: false, limit: null, used: 0, remaining: null, exhausted: false, resetsAt: null };
    }
    const counter = this._currentCounter(provider);
    return {
      provider,
      metered: true,
      limit: config.limit,
      window: config.window,
      used: counter.count,
      remaining: Math.max(config.limit - counter.count, 0),
      exhausted: counter.count >= config.limit,
      resetsAt: new Date(windowEndMs(config.window, new Date())).toISOString(),
    };
  }

  allStatuses() {
    return Object.keys(this.limits).map((provider) => this.status(provider));
  }

  reset(provider) {
    this.counters.delete(provider);
  }

  resetAll() {
    this.counters.clear();
  }
}

module.exports = { UsageTracker, DEFAULT_LIMITS };
