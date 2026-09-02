// Pelias is open-source, so this points at a hosted instance by default
// (geocode.earth, which needs an API key) but is fully overridable via
// PELIAS_URL for a self-hosted deployment — self-hosted Pelias typically
// needs no key at all.
const PELIAS_URL = process.env.PELIAS_URL || 'https://api.geocode.earth/v1/autocomplete';
const USING_HOSTED_DEFAULT = !process.env.PELIAS_URL;

async function search(query, { limit = 5, lat, lon, countryCode, apiKey } = {}) {
  // Only the default geocode.earth host requires a key — a self-hosted
  // instance (PELIAS_URL override) typically doesn't. Fail fast here with
  // the same "is not configured" phrasing the other providers use, so it's
  // reported/skipped consistently instead of hitting geocode.earth for a
  // real 401 on every request.
  if (USING_HOSTED_DEFAULT && !apiKey) {
    throw new Error(
      'pelias is not configured: missing PELIAS_API_KEY (required for the default geocode.earth host — ' +
      'or set PELIAS_URL to point at a self-hosted instance that needs no key)'
    );
  }

  const params = new URLSearchParams({
    text: query,
    size: String(limit),
  });

  if (apiKey) params.set('api_key', apiKey);
  if (lat != null && lon != null) {
    params.set('focus.point.lat', String(lat));
    params.set('focus.point.lon', String(lon));
  }
  if (countryCode) {
    params.set('boundary.country', countryCode.toUpperCase());
  }

  const res = await fetch(`${PELIAS_URL}?${params.toString()}`);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Pelias request failed (${res.status}): ${extractErrorMessage(body)}`);
  }
  const data = await res.json();

  return (data.features || []).map(normalizePeliasFeature);
}

// Pelias/geocode.earth error bodies are nested JSON, e.g.
// {"meta":{...},"results":{"error":{"type":"KeyError","message":"No api_key specified."}}}
// — surface just the message instead of dumping the raw JSON blob.
function extractErrorMessage(body) {
  try {
    const parsed = JSON.parse(body);
    return (parsed.results && parsed.results.error && parsed.results.error.message)
      || (parsed.error && parsed.error.message)
      || parsed.message
      || body;
  } catch {
    return body;
  }
}

function normalizePeliasFeature(feature) {
  const props = feature.properties || {};
  const [lon, lat] = (feature.geometry && feature.geometry.coordinates) || [null, null];
  return {
    id: props.id || null,
    provider: 'pelias',
    label: props.label || '',
    houseNumber: props.housenumber || null,
    street: props.street || null,
    city: props.locality || props.county || null,
    state: props.region || null,
    postalCode: props.postalcode || null,
    country: props.country || null,
    countryCode: props.country_a || null,
    lat,
    lon,
  };
}

module.exports = { search };
