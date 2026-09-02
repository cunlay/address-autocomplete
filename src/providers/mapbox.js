const MAPBOX_URL = 'https://api.mapbox.com/geocoding/v5/mapbox.places';

async function search(query, { limit = 5, lat, lon, countryCode, apiKey } = {}) {
  if (!apiKey) throw new Error('MAPBOX_ACCESS_TOKEN is not configured');

  const params = new URLSearchParams({
    access_token: apiKey,
    autocomplete: 'true',
    limit: String(limit),
    types: 'address,place,postcode,locality,neighborhood',
  });

  if (lat != null && lon != null) {
    params.set('proximity', `${lon},${lat}`);
  }
  if (countryCode) {
    params.set('country', countryCode.toLowerCase());
  }

  const encoded = encodeURIComponent(query);
  const res = await fetch(`${MAPBOX_URL}/${encoded}.json?${params.toString()}`);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Mapbox request failed (${res.status}): ${body}`);
  }
  const data = await res.json();

  return (data.features || []).map(normalizeMapboxFeature);
}

function contextValue(context, prefix) {
  const entry = (context || []).find((c) => c.id && c.id.startsWith(prefix));
  return entry ? entry.text : null;
}

function normalizeMapboxFeature(feature) {
  const context = feature.context || [];
  const [lon, lat] = feature.center || [null, null];
  return {
    id: feature.id || null,
    provider: 'mapbox',
    label: feature.place_name || feature.text || '',
    houseNumber: feature.address || null,
    street: feature.text || null,
    city: contextValue(context, 'place'),
    state: contextValue(context, 'region'),
    postalCode: contextValue(context, 'postcode'),
    country: contextValue(context, 'country'),
    countryCode: (feature.properties && feature.properties.short_code) || null,
    lat,
    lon,
  };
}

module.exports = { search };
