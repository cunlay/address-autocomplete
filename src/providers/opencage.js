const OPENCAGE_URL = 'https://api.opencagedata.com/geocode/v1/json';

async function search(query, { limit = 5, lat, lon, countryCode, apiKey } = {}) {
  if (!apiKey) throw new Error('OPENCAGE_API_KEY is not configured');

  const params = new URLSearchParams({
    q: query,
    key: apiKey,
    limit: String(limit),
    no_annotations: '1',
  });

  if (lat != null && lon != null) {
    params.set('proximity', `${lat},${lon}`);
  }
  if (countryCode) {
    params.set('countrycode', countryCode.toLowerCase());
  }

  const res = await fetch(`${OPENCAGE_URL}?${params.toString()}`);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenCage request failed (${res.status}): ${body}`);
  }
  const data = await res.json();

  return (data.results || []).map(normalizeOpenCageResult);
}

function normalizeOpenCageResult(item) {
  const c = item.components || {};
  const geo = item.geometry || {};
  return {
    id: item.annotations && item.annotations.geohash ? item.annotations.geohash : null,
    provider: 'opencage',
    label: item.formatted || '',
    houseNumber: c.house_number || null,
    street: c.road || c.street || null,
    city: c.city || c.town || c.village || null,
    state: c.state || null,
    postalCode: c.postcode || null,
    country: c.country || null,
    countryCode: c.country_code ? c.country_code.toUpperCase() : null,
    lat: geo.lat != null ? geo.lat : null,
    lon: geo.lng != null ? geo.lng : null,
  };
}

module.exports = { search };
