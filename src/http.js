// Small helpers for the API handlers: validated query parameters and replies.
// The handlers run unchanged on Vercel (api/*.js) and on the local dev server.
// AI-assisted: written with Claude Code (Anthropic).
export class BadRequest extends Error {}

export const query = (req) => new URL(req.url, 'http://localhost').searchParams;

/** A finite number inside [lo, hi], or a BadRequest. */
export function num(q, name, lo, hi) {
  const raw = q.get(name);
  const v = raw === null || raw.trim() === '' ? NaN : Number(raw);
  if (!Number.isFinite(v) || v < lo || v > hi) throw new BadRequest(`"${name}" must be a number from ${lo} to ${hi}`);
  return v;
}

export function sendJson(res, status, body, cacheSeconds = 0) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', cacheSeconds ? `public, max-age=${Math.min(cacheSeconds, 3600)}, s-maxage=${cacheSeconds}` : 'no-store');
  res.end(JSON.stringify(body));
}

/** Wrap a handler so that errors become clean JSON replies. */
export function api(fn) {
  return async (req, res) => {
    try {
      if (req.method && req.method !== 'GET') return sendJson(res, 405, { error: 'Use GET' });
      await fn(req, res);
    } catch (e) {
      if (e instanceof BadRequest) return sendJson(res, 400, { error: e.message });
      const timeout = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
      sendJson(res, 502, { error: timeout ? 'The NASA archive (IRSA) took too long to answer. Try again.' : String((e && e.message) || e) });
    }
  };
}
