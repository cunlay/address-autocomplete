/**
 * Heuristic scoring of how well a normalized result matches the original
 * search text. This exists so /api/compare can rank providers by "did this
 * one actually find the address", not to be a definitive geocoding-accuracy
 * benchmark. Treat scores as a starting point for eyeballing results, not
 * as ground truth.
 *
 * Design notes:
 * - Weighted toward RECALL (how much of what the user typed shows up in
 *   the result) over precision, because a correct, complete address
 *   legitimately adds tokens the user didn't type (zip code, country) —
 *   penalizing that symmetrically (plain Jaccard) makes a more complete,
 *   more correct result score *worse* than a vaguer one. That's backwards.
 * - A wrong house number is scored as an explicit penalty, not just the
 *   absence of a bonus — "1601 Main St" should score clearly lower than
 *   "1600 Main St" against a "1600 Main St" query, not just slightly lower.
 */

function normalize(text) {
  return (text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents/diacritics
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text) {
  return normalize(text).split(' ').filter(Boolean);
}

function extractLeadingHouseNumber(text) {
  const match = normalize(text).match(/^(\d+[a-z]?)\b/);
  return match ? match[1] : null;
}

function scoreMatch(query, result) {
  const queryTokens = tokenize(query);
  const labelTokens = tokenize(result.label);
  const labelTokenSet = new Set(labelTokens);
  const overlap = queryTokens.filter((t) => labelTokenSet.has(t)).length;

  const recall = queryTokens.length ? overlap / queryTokens.length : 0; // how much of the query is covered
  const precision = labelTokens.length ? overlap / labelTokens.length : 0; // how much of the result is "extra"

  let score = recall * 0.75 + precision * 0.25;

  const queryHouseNumber = extractLeadingHouseNumber(query);
  let houseNumberMatch = null; // null = not applicable (query or result has no house number to compare)
  if (queryHouseNumber && result.houseNumber) {
    houseNumberMatch = normalize(String(result.houseNumber)) === queryHouseNumber;
    score = houseNumberMatch ? Math.min(1, score + 0.15) : Math.max(0, score - 0.35);
  }

  const exactLabel = normalize(query) === normalize(result.label);
  if (exactLabel) score = 1;

  const exact = exactLabel || (recall >= 0.99 && houseNumberMatch !== false);

  return {
    score: Math.round(score * 1000) / 1000,
    exact,
    recall: Math.round(recall * 1000) / 1000,
    precision: Math.round(precision * 1000) / 1000,
    houseNumberMatch,
  };
}

module.exports = { scoreMatch, normalize, tokenize };
