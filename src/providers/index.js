const here = require('./here');
const mapbox = require('./mapbox');
const locationiq = require('./locationiq');
const photon = require('./photon');
const pelias = require('./pelias');
const opencage = require('./opencage');
const geoapify = require('./geoapify');
const nominatim = require('./nominatim');

const PROVIDERS = {
  here: {
    search: here.search,
    apiKeyEnv: 'HERE_API_KEY',
    requiresApiKey: true,
  },
  mapbox: {
    search: mapbox.search,
    apiKeyEnv: 'MAPBOX_ACCESS_TOKEN',
    requiresApiKey: true,
  },
  locationiq: {
    search: locationiq.search,
    apiKeyEnv: 'LOCATIONIQ_API_KEY',
    requiresApiKey: true,
  },
  opencage: {
    search: opencage.search,
    apiKeyEnv: 'OPENCAGE_API_KEY',
    requiresApiKey: true,
  },
  geoapify: {
    search: geoapify.search,
    apiKeyEnv: 'GEOAPIFY_API_KEY',
    requiresApiKey: true,
  },
  pelias: {
    search: pelias.search,
    apiKeyEnv: 'PELIAS_API_KEY',
    // Optional in the generic sense (a self-hosted instance usually needs
    // no key) — but the default host (geocode.earth) does require one, so
    // "configured" needs its own check rather than the simple requiresApiKey
    // flag every other provider uses.
    requiresApiKey: false,
    isConfigured: () => Boolean(process.env.PELIAS_API_KEY) || Boolean(process.env.PELIAS_URL),
  },
  photon: {
    search: photon.search,
    apiKeyEnv: null,
    requiresApiKey: false,
  },
  nominatim: {
    search: nominatim.search,
    apiKeyEnv: null,
    requiresApiKey: false,
  },
};

function listProviders() {
  return Object.entries(PROVIDERS).map(([name, cfg]) => ({
    name,
    configured: cfg.isConfigured
      ? cfg.isConfigured()
      : !cfg.requiresApiKey || Boolean(process.env[cfg.apiKeyEnv]),
  }));
}

function getProvider(name) {
  const provider = PROVIDERS[name];
  if (!provider) {
    throw new Error(`Unknown provider "${name}". Valid providers: ${Object.keys(PROVIDERS).join(', ')}`);
  }
  return provider;
}

async function runProvider(name, query, options = {}) {
  const provider = getProvider(name);
  const apiKey = provider.apiKeyEnv ? process.env[provider.apiKeyEnv] : undefined;
  if (provider.requiresApiKey && !apiKey) {
    throw new Error(`${name} is not configured: missing ${provider.apiKeyEnv}`);
  }
  return provider.search(query, { ...options, apiKey });
}

module.exports = { PROVIDERS, listProviders, getProvider, runProvider };
