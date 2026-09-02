// Nominatim's usage policy (https://operations.osmfoundation.org/policies/nominatim/)
// requires a descriptive User-Agent and caps public-instance traffic at
// roughly 1 request/second — it's meant for light/dev use, not production
// autocomplete volume. Self-host Nominatim and set NOMINATIM_URL for
// anything beyond that.
const NOMINATIM_URL = process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = process.env.NOMINATIM_USER_AGENT || 'unified-address-autocomplete/1.0';

async function search(query, { limit = 5, lat, lon, countryCode } = {}) {
  const params = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    addressdetails: '1',
    limit: String(limit),
  });

  if (countryCode) {
    params.set('countrycodes', countryCode.toLowerCase());
  }
  if (process.env.NOMINATIM_EMAIL) {
    // Recommended (not required) by the usage policy for higher-volume use.
    params.set('email', process.env.NOMINATIM_EMAIL);
  }
  if (lat != null && lon != null) {
    // Nominatim has no true proximity bias param on this endpoint; a wide
    // viewbox (without "bounded=1") acts only as a soft nudge, not a filter.
    const delta = 0.5;
    params.set('viewbox', `${lon - delta},${lat + delta},${lon + delta},${lat - delta}`);
  }

  const res = await fetch(`${NOMINATIM_URL}?${params.toString()}`, {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Nominatim request failed (${res.status}): ${body}`);
  }
  const data = await res.json();

  return (Array.isArray(data) ? data : []).map(normalizeNominatimItem);
}

function normalizeNominatimItem(item) {
  const addr = item.address || {};
  return {
    id: item.place_id != null ? String(item.place_id) : null,
    provider: 'nominatim',
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
