const GEOAPIFY_URL = 'https://api.geoapify.com/v1/geocode/autocomplete';

async function search(query, { limit = 5, lat, lon, countryCode, apiKey } = {}) {
  if (!apiKey) throw new Error('GEOAPIFY_API_KEY is not configured');

  const params = new URLSearchParams({
    text: query,
    apiKey,
    limit: String(limit),
  });

  if (lat != null && lon != null) {
    params.set('bias', `proximity:${lon},${lat}`);
  }
  if (countryCode) {
    params.set('filter', `countrycode:${countryCode.toLowerCase()}`);
  }

  const res = await fetch(`${GEOAPIFY_URL}?${params.toString()}`);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Geoapify request failed (${res.status}): ${body}`);
  }
  const data = await res.json();

  return (data.features || []).map(normalizeGeoapifyFeature);
}

function normalizeGeoapifyFeature(feature) {
  const props = feature.properties || {};
  const [geomLon, geomLat] = (feature.geometry && feature.geometry.coordinates) || [null, null];
  return {
    id: props.place_id || null,
    provider: 'geoapify',
    label: props.formatted || '',
    houseNumber: props.housenumber || null,
    street: props.street || null,
    city: props.city || null,
    state: props.state || null,
    postalCode: props.postcode || null,
    country: props.country || null,
    countryCode: props.country_code ? props.country_code.toUpperCase() : null,
    lat: props.lat != null ? props.lat : geomLat,
    lon: props.lon != null ? props.lon : geomLon,
  };
}

module.exports = { search };
