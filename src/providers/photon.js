// No API key required. Defaults to the free public Komoot instance;
// override with PHOTON_URL for a self-hosted instance in production
// (the public instance is rate-limited and not meant for heavy traffic).
const PHOTON_URL = process.env.PHOTON_URL || 'https://photon.komoot.io/api/';

async function search(query, { limit = 5, lat, lon } = {}) {
  const params = new URLSearchParams({
    q: query,
    limit: String(limit),
  });

  if (lat != null && lon != null) {
    params.set('lat', String(lat));
    params.set('lon', String(lon));
  }

  const res = await fetch(`${PHOTON_URL}?${params.toString()}`);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Photon request failed (${res.status}): ${body}`);
  }
  const data = await res.json();

  return (data.features || []).map(normalizePhotonFeature);
}

function normalizePhotonFeature(feature) {
  const props = feature.properties || {};
  const [lon, lat] = (feature.geometry && feature.geometry.coordinates) || [null, null];

  const labelParts = [
    props.name,
    [props.street, props.housenumber].filter(Boolean).join(' '),
    props.city,
    props.state,
    props.country,
  ].filter(Boolean);

  return {
    id: props.osm_id != null ? `${props.osm_type || 'osm'}:${props.osm_id}` : null,
    provider: 'photon',
    label: [...new Set(labelParts)].join(', '),
    houseNumber: props.housenumber || null,
    street: props.street || null,
    city: props.city || null,
    state: props.state || null,
    postalCode: props.postcode || null,
    country: props.country || null,
    countryCode: props.countrycode || null,
    lat,
    lon,
  };
}

module.exports = { search };
