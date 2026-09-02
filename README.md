# Unified Address Autocomplete

A single JavaScript integration that normalizes address autocomplete across
**HERE**, **Mapbox**, **LocationIQ**, **OpenCage**, **Geoapify**, **Pelias**,
**Photon** (Komoot), and **OpenStreetMap Nominatim** — with server-side
response caching, free-tier quota tracking with automatic fallback, and a
side-by-side comparison endpoint. Plain JavaScript throughout — no
TypeScript, no build step.

## Why

Each provider has a different request shape, auth scheme, response format,
and — critically — different address coverage. No single provider has
every address everywhere: a rural route might be in HERE's commercial data
but missing from OpenStreetMap, while a small European village might be
better mapped on OSM (LocationIQ/Photon/Nominatim/Pelias) than in a
commercial dataset. This wraps all eight behind one API and one client-side
widget, so you can swap providers, fail over between them, or query all of
them at once to see which actually has the address you're looking for.

## Project layout

```
address-autocomplete/
├── package.json
├── .env.example
├── src/
│   ├── server.js           # Express app: routes, caching, fallback, compare
│   ├── cache.js             # In-memory TTL cache (swap for Redis in prod)
│   ├── usageTracker.js      # Free-tier quota tracking per provider
│   ├── matchScore.js        # Heuristic query-vs-result match scoring
│   └── providers/
│       ├── here.js          # HERE Autosuggest adapter
│       ├── mapbox.js        # Mapbox Geocoding adapter
│       ├── locationiq.js    # LocationIQ Autocomplete adapter
│       ├── opencage.js      # OpenCage Geocoding adapter
│       ├── geoapify.js      # Geoapify Autocomplete adapter
│       ├── pelias.js        # Pelias adapter (geocode.earth or self-hosted)
│       ├── photon.js        # Photon (Komoot) adapter — no API key needed
│       ├── nominatim.js     # OpenStreetMap Nominatim adapter — no key needed
│       └── index.js         # Provider registry + config lookup
└── public/
    ├── index.html            # Demo page: autocomplete + usage + compare panel
    ├── autocomplete.js       # Framework-free widget (AddressAutocomplete)
    └── styles.css
```

## Setup

```bash
npm install
cp .env.example .env
# fill in the API keys you have — Photon works with none
npm start
```

Open `http://localhost:3000`. Requires Node.js 18+ (uses the built-in
`fetch`).

## API keys

| Provider   | Env var                | Get a key                          |
|------------|-------------------------|-------------------------------------|
| HERE       | `HERE_API_KEY`          | developer.here.com                  |
| Mapbox     | `MAPBOX_ACCESS_TOKEN`   | account.mapbox.com                  |
| LocationIQ | `LOCATIONIQ_API_KEY`    | locationiq.com/register             |
| OpenCage   | `OPENCAGE_API_KEY`      | opencagedata.com                    |
| Geoapify   | `GEOAPIFY_API_KEY`      | geoapify.com                        |
| Pelias     | `PELIAS_API_KEY`        | geocode.earth (or self-host, no key)|
| Photon     | *(none required)*       | uses the free public Komoot instance|
| Nominatim  | *(none required)*       | uses the free public OSM instance   |

You don't need all eight configured — `/api/providers` reports which ones
are active, and both "auto" mode and the compare endpoint simply skip
unconfigured providers.

> **Photon & Nominatim note:** both public instances are rate-limited and
> meant for light/dev use, not production autocomplete volume — Nominatim's
> usage policy caps it around 1 request/second and requires a descriptive
> `User-Agent` (set via `NOMINATIM_USER_AGENT`). Self-host either one for
> real traffic.

## Server API

### `GET /api/providers`
Lists all providers and whether each is configured.

### `GET /api/autocomplete?provider=<name>&q=<query>`
Query one specific provider (`here` | `mapbox` | `locationiq` | `photon`).

Optional params: `limit` (default 5, max 10), `lat`, `lon` (bias/anchor
results near a point), `country` (ISO 3166-1 alpha-2 code to restrict
results).

```
GET /api/autocomplete?provider=mapbox&q=1600+Amphitheatre&limit=5&lat=37.4&lon=-122.1
```

```json
{
  "provider": "mapbox",
  "query": "1600 Amphitheatre",
  "cached": false,
  "results": [
    {
      "id": "address.123456",
      "provider": "mapbox",
      "label": "1600 Amphitheatre Pkwy, Mountain View, California 94043, United States",
      "houseNumber": "1600",
      "street": "Amphitheatre Pkwy",
      "city": "Mountain View",
      "state": "California",
      "postalCode": "94043",
      "country": "United States",
      "countryCode": "us",
      "lat": 37.42199,
      "lon": -122.08405
    }
  ]
}
```

### `GET /api/autocomplete/auto?q=<query>`
Tries providers in priority order (default `here, mapbox, locationiq,
photon`, override with `order=mapbox,photon`) and returns the first
non-empty result set. Skips providers that aren't configured **or have
exhausted their free-tier quota for the current period** (see below),
and returns a `skippedProviders` array explaining why each one was
skipped. Useful as a resilient default so a single missing key, a
provider outage, or running out of free requests doesn't break the UI.

### `GET /api/compare?q=<query>`
Fires **every configured provider in parallel** for the same query, times
each one, and scores how well its best result actually matches what was
typed. This is the tool for the actual question — "which provider has this
exact address" — rather than trusting one static ranking, since coverage
genuinely varies by provider and by region.

Optional: `providers=here,mapbox,pelias` to compare a subset (default: all
eight). Same `limit`/`lat`/`lon`/`country` params as the other endpoints.

```
GET /api/compare?q=1600+Amphitheatre+Parkway,+Mountain+View,+CA
```

```json
{
  "query": "1600 Amphitheatre Parkway, Mountain View, CA",
  "ranked": ["mapbox", "here", "geoapify", "locationiq"],
  "comparisons": [
    {
      "provider": "mapbox",
      "status": "ok",
      "latencyMs": 142,
      "cached": false,
      "resultCount": 3,
      "hasMatch": true,
      "exactMatch": true,
      "bestMatch": {
        "label": "1600 Amphitheatre Pkwy, Mountain View, California 94043, United States",
        "match": { "score": 1, "exact": true, "recall": 1, "precision": 0.75, "houseNumberMatch": true }
      },
      "results": ["... top 5, each with a .match block ..."]
    },
    { "provider": "opencage", "status": "not_configured" },
    { "provider": "pelias", "status": "quota_exhausted", "quota": { "...": "..." } },
    { "provider": "nominatim", "status": "error", "latencyMs": 803, "error": "..." }
  ]
}
```

`status` per provider is one of `ok`, `not_configured`, `quota_exhausted`,
or `error` — so you can see at a glance *why* a provider didn't produce a
result, not just that it didn't.

`ranked` orders providers that returned a plausible match: exact matches
first, then by match score, then by latency as the tiebreaker. Providers
that errored or came back empty are excluded from `ranked` but still
listed in `comparisons`.

**On the match score:** it's a heuristic (token recall/precision between
your query and each result, with an explicit penalty for a wrong house
number) — good enough to sort "clearly right" from "clearly wrong" and
catch an obviously mismatched result, not a certified accuracy benchmark.
Spot-check anything you're relying on.

### `GET /api/cache/stats` / `POST /api/cache/clear`
Inspect or reset the server-side cache.

### `GET /api/usage`
Free-tier usage snapshot for every provider: requests used, remaining,
the reset time, and whether it's currently exhausted.

### `POST /api/usage/reset`
Resets usage counters (body `{"provider": "locationiq"}`, or omit
`provider` to reset all). Intended for local testing/ops — there's no
auth on this route, so don't expose it publicly as-is.

## Auto-switching after a provider's free tier runs out

`src/usageTracker.js` counts requests per provider against each one's
published free-tier ceiling, on the correct billing cadence for that
provider:

| Provider   | Default limit         | Resets     |
|------------|------------------------|------------|
| HERE       | 250,000 requests        | monthly    |
| Mapbox     | 100,000 requests        | monthly    |
| LocationIQ | 5,000 requests          | daily      |
| OpenCage   | 2,500 requests          | daily      |
| Geoapify   | 3,000 requests          | daily      |
| Pelias     | unmetered by default (set `PELIAS_FREE_LIMIT` to track) | — |
| Photon     | unmetered (public, keyless instance) | — |
| Nominatim  | unmetered (rate-limited instead, ~1 req/sec) | — |

Override any of these with `HERE_FREE_LIMIT`, `MAPBOX_FREE_LIMIT`,
`LOCATIONIQ_FREE_LIMIT`, `OPENCAGE_FREE_LIMIT`, `GEOAPIFY_FREE_LIMIT`, or
`PELIAS_FREE_LIMIT` in `.env` — e.g. if you're on a paid plan with a
higher ceiling.

How it behaves:
- **`/api/autocomplete/auto`** skips a provider once it's exhausted and
  moves to the next one in the chain automatically — no code changes
  needed when a key runs dry mid-month.
- **`/api/autocomplete?provider=X`** (direct, single-provider call)
  returns `HTTP 429` with the current quota and a suggestion to use the
  `auto` endpoint instead, once `X` is exhausted.
- **Cache hits don't count against quota** — this stacks with the caching
  layer, since a cached response never touches the upstream API at all.
- A request that's rejected locally (e.g. a missing API key) also isn't
  counted, since it never reached the provider.
- Counters live in memory and reset on server restart. For a
  multi-instance deployment, back `UsageTracker` with Redis
  (`INCR` + `EXPIRE` per provider/window) — the module's surface
  (`increment` / `isExhausted` / `status`) is intentionally small so
  that's a drop-in swap, same as the cache.

## Unified result shape

Every provider adapter normalizes into the same object, regardless of the
upstream API's native format:

```js
{
  id: string | null,
  provider: 'here' | 'mapbox' | 'locationiq' | 'photon',
  label: string,          // full display string
  houseNumber: string | null,
  street: string | null,
  city: string | null,
  state: string | null,
  postalCode: string | null,
  country: string | null,
  countryCode: string | null,
  lat: number | null,
  lon: number | null,
}
```

## Comparing accuracy and speed across providers

There isn't one true accuracy ranking — it depends heavily on region and
on whether the provider's underlying dataset is commercial or
OpenStreetMap-derived:

- **HERE, Mapbox, OpenCage, Geoapify** — commercial-grade or aggregated
  datasets, generally stronger house-number-level ("rooftop") precision in
  well-covered markets (US, Western Europe), and typically faster/more
  consistent latency since they run dedicated infrastructure.
- **LocationIQ, Pelias, Photon, Nominatim** — all ultimately draw on
  OpenStreetMap (Pelias can also blend in OpenAddresses/WhosOnFirst).
  Quality tracks how well-mapped a given area is in OSM: excellent in
  dense, actively-mapped cities, noticeably weaker in sparse or rural
  areas. Nominatim's public instance also carries the tightest rate limit
  of the group, which shows up as latency/backoff under load, not
  necessarily inaccuracy.

That's a *prior*, not a verdict — this is exactly why `/api/compare`
exists instead of a hardcoded ranking. Run your own representative
addresses (especially from the regions you actually care about) through
it and let `ranked` plus the per-provider `latencyMs` tell you what's true
for your data, rather than trusting a generic ordering. It's completely
normal and expected for some providers to have an address that others
simply don't — that's the "some may have it, some may not" behavior this
is meant to surface, and the per-provider `status` (`ok` vs `error` vs an
empty `hasMatch`) makes each case explicit instead of hiding it behind a
silent empty result.

The default priority order used by `/api/autocomplete/auto` when no
`order=` is given (`here, mapbox, opencage, geoapify, locationiq, pelias,
photon, nominatim`) reflects the general prior above — commercial-grade
first, open-data providers last — but it's just a starting default,
easily overridden per request.

## Server-side caching

`src/cache.js` implements a small TTL + size-bounded cache (default 5 min
TTL, 1000 entries, both configurable via `.env`). Cache keys combine the
provider, normalized query text, result limit, a coordinate rounded to
~100m, and country filter — so nearby/duplicate keystrokes reuse a cached
response instead of hitting the upstream API and eating your rate limit.

This is in-memory and per-process. For a multi-instance deployment, swap
`TTLCache` for a Redis-backed implementation — the `get/set/delete/clear`
surface it exposes is intentionally small so that's a drop-in change in
`server.js` (`searchWithCache`).

## Frontend widget

`public/autocomplete.js` exports `AddressAutocomplete`, a dependency-free
class you can attach to any `<input>`:

```html
<script src="/autocomplete.js"></script>
<script>
  const ac = new AddressAutocomplete('#address-input', {
    provider: 'auto',       // or 'here' | 'mapbox' | 'locationiq' | 'photon'
    limit: 6,
    country: 'us',
    onSelect: (result) => console.log(result),
  });

  // Optional: bias results to a location, e.g. from geolocation
  ac.setLocation(37.4, -122.1);
  ac.setProvider('mapbox');
</script>
```

It handles debouncing, request cancellation on fast typing, keyboard
navigation (↑/↓/Enter/Esc), and ARIA combobox attributes. No React/Vue
required — drop it into any page.

## Extending

To add another provider: create `src/providers/<name>.js` exporting
`async search(query, options) -> normalizedResult[]`, then register it in
`src/providers/index.js`. The server, cache, and frontend widget all work
against the registry, so nothing else needs to change.
