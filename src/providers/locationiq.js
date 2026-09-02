const LOCATIONIQ_URL = 'https://api.locationiq.com/v1/autocomplete';

async function search(query, { limit = 5, lat, lon, countryCode, apiKey } = {}) {
  if (!apiKey) throw new Error('LOCATIONIQ_API_KEY is not configured');

  const params = new URLSearchParams({
    key: apiKey,
    q: query,
    limit: String(limit),
    format: 'json',
    addressdetails: '1',
  });

  if (lat != null && lon != null) {
    // LocationIQ uses viewbox for a soft bias toward this area.
    params.set('viewbox', `${lon},${lat},${lon},${lat}`);
  }
  if (countryCode) {
    params.set('countrycodes', countryCode.toLowerCase());
  }

  const res = await fetch(`${LOCATIONIQ_URL}?${params.toString()}`);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`LocationIQ request failed (${res.status}): ${body}`);
  }
  const data = await res.json();

  return (Array.isArray(data) ? data : []).map(normalizeLocationIqItem);
}

function normalizeLocationIqItem(item) {
  const addr = item.address || {};
  return {
    id: item.place_id != null ? String(item.place_id) : null,
    provider: 'locationiq',
    label: item.display_name || '',
    houseNumber: addr.house_number || null,
    street: addr.road || null,
    city: addr.city || addr.town || addr.village || null,
    state: addr.state || null,
    postalCode: addr.postcode || null,
    country: addr.country || null,
    countryCode: addr.country_code ? addr.country_code.toUpperCase() : null,
    lat: item.lat != null ? parseFloat(item.lat) : null,
    lon: item.lon != null ? parseFloat(item.lon) : null,
  };
}

module.exports = { search };
