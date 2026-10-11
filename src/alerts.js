/**
 * Developer alerts for failures in third-party services.
 *
 * Sends an email to DEVELOPER_EMAIL through Resend (RESEND_API_KEY). Identical
 * errors are grouped and sent at most once per ALERT_WINDOW_MS, so an outage
 * produces one email rather than one per request.
 *
 * Secrets (API keys, tokens) and phone numbers are removed before anything is
 * logged or emailed. This module never throws: alerting must not break the
 * request that triggered it.
 */

const ALERT_WINDOW_MS = Number(process.env.ALERT_WINDOW_MS) || 15 * 60 * 1000;
const lastSent = new Map();

function scrub(text) {
  return String(text ?? '')
    .replace(/([?&](?:key|apikey|api_key|access_token|token|secret|password)=)[^&\s"']+/gi, '$1[redacted]')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]+/gi, '$1[redacted]')
    .replace(/(authorization["']?\s*[:=]\s*["']?)[^"',\s}]+/gi, '$1[redacted]')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, '[phone redacted]')
    .slice(0, 1000);
}

function groupKey(service, message) {
  // Digits are masked so "timeout after 5012ms" and "timeout after 4870ms" group together.
  return `${service}|${String(message).replace(/\d+/g, '#').slice(0, 200)}`;
}

async function sendEmail(subject, text) {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.DEVELOPER_EMAIL;
  if (!apiKey || !to) return false;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.ALERT_FROM_EMAIL || 'ErrandLocal Alerts <onboarding@resend.dev>',
      to: [to],
      subject,
      text,
    }),
  });
  if (!res.ok) throw new Error(`Resend responded ${res.status}`);
  return true;
}

/**
 * @param {object} p
 * @param {string} p.service    e.g. "here", "signalwire", "africastalking", "address-service"
 * @param {string} [p.operation] what was being attempted, e.g. "autocomplete", "send sms"
 * @param {number} [p.status]   HTTP status if known
 * @param {string} p.message    the error message (scrubbed before use)
 */
function reportThirdPartyError({ service, operation, status, message }) {
  try {
    const cleanMessage = scrub(message);
    const key = groupKey(service, cleanMessage);
    const now = Date.now();
    const last = lastSent.get(key);
    if (last && now - last < ALERT_WINDOW_MS) return;
    lastSent.set(key, now);

    console.error(`[alert] ${service}${operation ? ` ${operation}` : ''}${status ? ` (${status})` : ''}: ${cleanMessage}`);

    const subject = `[ErrandLocal] ${service} error${status ? ` (${status})` : ''}`;
    const text = [
      `Service: ${service}`,
      `Operation: ${operation || 'n/a'}`,
      `Status: ${status ?? 'n/a'}`,
      `Time: ${new Date(now).toISOString()}`,
      '',
      cleanMessage,
    ].join('\n');

    sendEmail(subject, text).catch((err) => console.error('[alert] email failed:', err.message));
  } catch (err) {
    console.error('[alert] could not report:', err.message);
  }
}

module.exports = { reportThirdPartyError, scrub };
