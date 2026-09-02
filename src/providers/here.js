const HERE_URL = 'https://autosuggest.search.hereapi.com/v1/autosuggest';

async function search(query, { limit = 5, lat, lon, countryCode, apiKey } = {}) {
  if (!apiKey) throw new Error('HERE_API_KEY is not configured');

  const params = new URLSearchParams({
    q: query,
    limit: String(limit),
    apiKey,
  });

  // HERE's Autosuggest API requires an anchor point ("at") or bounding box.
  // Results are ranked around it, so pass the user's location when known.
  params.set('at', lat != null && lon != null ? `${lat},${lon}` : '0,0');

  if (countryCode) {
    params.set('in', `countryCode:${countryCode.toUpperCase()}`);
  }

  const res = await fetch(`${HERE_URL}?${params.toString()}`);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HERE request failed (${res.status}): ${body}`);
  }
  const data = await res.json();

  return (data.items || []).map(normalizeHereItem);
}

function normalizeHereItem(item) {
  const addr = item.address || {};
  return {
    id: item.id || null,
    provider: 'here',
    label: item.title || addr.label || '',
    houseNumber: addr.houseNumber || null,
    street: addr.street || null,
    city: addr.city || null,
    state: addr.state || null,
    postalCode: addr.postalCode || null,
    country: addr.countryName || null,
    countryCode: addr.countryCode || null,
    lat: item.position ? item.position.lat : null,
    lon: item.position ? item.position.lng : null,
  };
}

module.exports = { search };
