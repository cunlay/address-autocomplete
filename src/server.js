require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { TTLCache } = require('./cache');
const { UsageTracker, DEFAULT_LIMITS } = require('./usageTracker');
const { scoreMatch } = require('./matchScore');
const { listProviders, runProvider, PROVIDERS } = require('./providers');

const app = express();
const PORT = process.env.PORT || 3000;

const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS) || 5 * 60 * 1000; // 5 min
const CACHE_MAX_SIZE = Number(process.env.CACHE_MAX_SIZE) || 1000;
const MIN_QUERY_LENGTH = Number(process.env.MIN_QUERY_LENGTH) || 2;

const cache = new TTLCache({ ttlMs: CACHE_TTL_MS, maxSize: CACHE_MAX_SIZE });

// Parses an env var as a non-negative integer, falling back to `fallback`
// when unset/invalid. Deliberately NOT `Number(x) || fallback` — that
// treats an explicit "0" override as falsy and silently ignores it.
function envInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

// Free-tier ceilings, overridable per deployment (e.g. if you're on a paid
// plan with a higher limit, or a provider changes its published quota).
const USAGE_LIMITS = {
  here: { limit: envInt('HERE_FREE_LIMIT', DEFAULT_LIMITS.here.limit), window: 'month' },
  mapbox: { limit: envInt('MAPBOX_FREE_LIMIT', DEFAULT_LIMITS.mapbox.limit), window: 'month' },
  locationiq: { limit: envInt('LOCATIONIQ_FREE_LIMIT', DEFAULT_LIMITS.locationiq.limit), window: 'day' },
  opencage: { limit: envInt('OPENCAGE_FREE_LIMIT', DEFAULT_LIMITS.opencage.limit), window: 'day' },
  geoapify: { limit: envInt('GEOAPIFY_FREE_LIMIT', DEFAULT_LIMITS.geoapify.limit), window: 'day' },
  // Unmetered unless explicitly given a limit — hosted Pelias plans and
  // self-hosted setups vary too much to assume a default.
  pelias: process.env.PELIAS_FREE_LIMIT ? { limit: envInt('PELIAS_FREE_LIMIT', 0), window: 'day' } : null,
  photon: null,
  nominatim: null,
};
const usageTracker = new UsageTracker(USAGE_LIMITS);

// Roughly most-accurate/production-grade first, open-data providers last —
// see the README for the reasoning and caveats. Override per request with
// ?order=... on /api/autocomplete/auto, or just use /api/compare to see
// what actually wins for a specific query.
const DEFAULT_PROVIDER_ORDER = ['here', 'mapbox', 'opencage', 'geoapify', 'locationiq', 'pelias', 'photon', 'nominatim'];

class QuotaExhaustedError extends Error {
  constructor(provider, quotaStatus) {
    super(`${provider} has used its free-tier quota for this period (resets ${quotaStatus.resetsAt}).`);
    this.name = 'QuotaExhaustedError';
    this.provider = provider;
    this.quotaStatus = quotaStatus;
  }
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

function buildCacheKey(provider, query, { limit, lat, lon, countryCode }) {
  const normalizedQuery = query.trim().toLowerCase();
  // Round coordinates so nearby requests share a cache entry instead of
  // missing on every pixel of GPS jitter.
  const roundedLat = lat != null ? Number(lat).toFixed(3) : '';
  const roundedLon = lon != null ? Number(lon).toFixed(3) : '';
  return [provider, normalizedQuery, limit, roundedLat, roundedLon, countryCode || ''].join('|');
}

async function searchWithCache(provider, query, options) {
  const key = buildCacheKey(provider, query, options);

  // A cache hit costs zero quota — this is the first line of defense
  // against exhausting a free tier, before we even look at usage.
  const cached = cache.get(key);
  if (cached) {
    return { results: cached, cached: true, quota: usageTracker.status(provider) };
  }

  if (usageTracker.isExhausted(provider)) {
    throw new QuotaExhaustedError(provider, usageTracker.status(provider));
  }

  try {
    const results = await runProvider(provider, query, options);
    // Only count it once the request actually reached the upstream API.
    usageTracker.increment(provider);
    cache.set(key, results);
    return { results, cached: false, quota: usageTracker.status(provider) };
  } catch (err) {
    // Requests rejected locally (e.g. missing API key) never left our
    // server, so they shouldn't count against the provider's quota.
    if (!/is not configured/.test(err.message)) {
      usageTracker.increment(provider);
    }
    throw err;
  }
}

function parseOptions(req) {
  const { limit, lat, lon, country } = req.query;
  return {
    limit: limit ? Math.min(Number(limit), 10) : 5,
    lat: lat != null && lat !== '' ? Number(lat) : undefined,
    lon: lon != null && lon !== '' ? Number(lon) : undefined,
    countryCode: country || undefined,
  };
}

app.get('/api/providers', (req, res) => {
  res.json({ providers: listProviders() });
});

// Usage/quota snapshot for every provider.
app.get('/api/usage', (req, res) => {
  const providers = listProviders().map((p) => ({
    ...p,
    quota: usageTracker.status(p.name),
  }));
  res.json({ providers });
});

// Testing/ops helper — resets in-memory counters. No auth: don't expose
// this route publicly in production without locking it down.
app.post('/api/usage/reset', (req, res) => {
  const { provider } = req.body || {};
  if (provider) {
    usageTracker.reset(provider);
  } else {
    usageTracker.resetAll();
  }
  res.json({ reset: provider || 'all' });
});

// Single-provider lookup: GET /api/autocomplete?provider=here&q=1600+Amphitheatre
app.get('/api/autocomplete', async (req, res) => {
  const { provider, q } = req.query;
  const query = (q || '').trim();

  if (!provider) {
    return res.status(400).json({ error: 'Missing required "provider" query parameter.' });
  }
  if (!PROVIDERS[provider]) {
    return res.status(400).json({
      error: `Unknown provider "${provider}". Valid providers: ${Object.keys(PROVIDERS).join(', ')}`,
    });
  }
  if (query.length < MIN_QUERY_LENGTH) {
    return res.json({ provider, query, results: [], cached: false });
  }

  const options = parseOptions(req);

  try {
    const { results, cached, quota } = await searchWithCache(provider, query, options);
    res.json({ provider, query, cached, quota, results });
  } catch (err) {
    if (err.name === 'QuotaExhaustedError') {
      return res.status(429).json({
        error: err.message,
        provider,
        query,
        quota: err.quotaStatus,
        suggestion: 'Use /api/autocomplete/auto to fall back to another configured provider automatically.',
      });
    }
    console.error(`[autocomplete] ${provider} error:`, err.message);
    res.status(502).json({ error: err.message, provider, query });
  }
});

// Fallback-chain lookup: tries providers in order, skipping any that are
// unconfigured or have exhausted their free-tier quota, until one returns
// results. GET /api/autocomplete/auto?q=...&order=here,mapbox,locationiq,photon
app.get('/api/autocomplete/auto', async (req, res) => {
  const { q, order } = req.query;
  const query = (q || '').trim();

  if (query.length < MIN_QUERY_LENGTH) {
    return res.json({ provider: null, query, results: [], cached: false });
  }

  const priority = (order ? order.split(',') : DEFAULT_PROVIDER_ORDER)
    .map((p) => p.trim())
    .filter((p) => PROVIDERS[p]);

  const options = parseOptions(req);
  const configuredNames = new Set(listProviders().filter((p) => p.configured).map((p) => p.name));
  const tried = [];
  const skipped = [];

  for (const provider of priority) {
    if (!configuredNames.has(provider)) {
      skipped.push({ provider, reason: 'not_configured' });
      continue;
    }
    if (usageTracker.isExhausted(provider)) {
      skipped.push({ provider, reason: 'quota_exhausted', quota: usageTracker.status(provider) });
      continue;
    }

    try {
      const { results, cached, quota } = await searchWithCache(provider, query, options);
      tried.push(provider);
      if (results.length > 0) {
        return res.json({
          provider,
          query,
          cached,
          quota,
          results,
          triedProviders: tried,
          skippedProviders: skipped,
        });
      }
    } catch (err) {
      tried.push(provider);
      if (err.name === 'QuotaExhaustedError') {
        skipped.push({ provider, reason: 'quota_exhausted', quota: err.quotaStatus });
      } else {
        skipped.push({ provider, reason: 'error', error: err.message });
      }
    }
  }

  res.json({ provider: null, query, results: [], cached: false, triedProviders: tried, skippedProviders: skipped });
});

// Fires every configured provider in parallel for the same query, times
// each one, and scores how well its best result actually matches what was
// typed. This is the tool for "which provider actually has this address"
// rather than picking one static answer — some providers simply won't have
// a given address (sparse OSM coverage, a not-yet-indexed new build, etc.)
// while others will, and that varies by region and by query.
// GET /api/compare?q=...&providers=here,mapbox,pelias (default: all registered)
app.get('/api/compare', async (req, res) => {
  const { q, providers: providersParam } = req.query;
  const query = (q || '').trim();

  if (query.length < MIN_QUERY_LENGTH) {
    return res.json({ query, comparisons: [], ranked: [] });
  }

  const targetProviders = (providersParam ? providersParam.split(',') : Object.keys(PROVIDERS))
    .map((p) => p.trim())
    .filter((p) => PROVIDERS[p]);

  const options = parseOptions(req);
  const configuredNames = new Set(listProviders().filter((p) => p.configured).map((p) => p.name));

  const comparisons = await Promise.all(
    targetProviders.map(async (provider) => {
      if (!configuredNames.has(provider)) {
        return { provider, status: 'not_configured' };
      }
      if (usageTracker.isExhausted(provider)) {
        return { provider, status: 'quota_exhausted', quota: usageTracker.status(provider) };
      }

      const startedAt = Date.now();
      try {
        const { results, cached, quota } = await searchWithCache(provider, query, options);
        const latencyMs = Date.now() - startedAt;
        const scored = results
          .map((r) => ({ ...r, match: scoreMatch(query, r) }))
          .sort((a, b) => b.match.score - a.match.score);

        return {
          provider,
          status: 'ok',
          latencyMs,
          cached,
          quota,
          resultCount: results.length,
          hasMatch: scored.length > 0,
          exactMatch: scored.length > 0 && scored[0].match.exact,
          bestMatch: scored[0] || null,
          results: scored.slice(0, 5),
        };
      } catch (err) {
        return { provider, status: 'error', latencyMs: Date.now() - startedAt, error: err.message };
      }
    })
  );

  // Ranking: found the exact address first, then by match quality, then by
  // speed as the tiebreaker. Providers that errored or came back empty sink
  // to the bottom — that's the "some providers just don't have it" case.
  const ranked = [...comparisons]
    .filter((c) => c.status === 'ok' && c.hasMatch)
    .sort((a, b) => {
      if (a.exactMatch !== b.exactMatch) return a.exactMatch ? -1 : 1;
      const scoreDiff = b.bestMatch.match.score - a.bestMatch.match.score;
      if (scoreDiff !== 0) return scoreDiff;
      return a.latencyMs - b.latencyMs;
    })
    .map((c) => c.provider);

  res.json({ query, comparisons, ranked });
});

app.get('/api/cache/stats', (req, res) => {
  res.json(cache.stats());
});

app.post('/api/cache/clear', (req, res) => {
  cache.clear();
  res.json({ cleared: true });
});

app.listen(PORT, () => {
  const providerStatus = listProviders()
    .map((p) => `${p.name}${p.configured ? '' : ' (not configured)'}`)
    .join(', ');
  console.log(`Address autocomplete server running at http://localhost:${PORT}`);
  console.log(`Configured providers: ${providerStatus}`);
});
