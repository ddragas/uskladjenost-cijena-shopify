/**
 * The Usklađenost cijena API over fetch; only the calls this app makes. A
 * refusal rejects with ApiError carrying the API's code, status and details.
 */
export const VERSION = '1.0.0';

export class ApiError extends Error {
  constructor(code, message, status, details = {}) {
    super(`${code} (${status}): ${message}`);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
    this.apiMessage = message;
  }
}

export class PcClient {
  /**
   * @param {string} token pc_live_… or pc_test_…
   * @param {{ baseUrl?: string, fetch?: typeof fetch, timeoutMs?: number }} [options]
   */
  constructor(token, options = {}) {
    if (!token) throw new Error('PC_TOKEN is required.');
    this.token = token;
    this.baseUrl = (options.baseUrl || 'https://uskladjenost-cijena.com').replace(/\/+$/, '');
    this.fetch = options.fetch || globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 30000;
  }

  ping() {
    return this.request('GET', '/api/v1/ping');
  }

  upsertItem(externalId, data) {
    return this.request('PUT', `/api/v1/items/${encodeURIComponent(externalId)}`, { json: data });
  }

  bulkItems(items) {
    return this.request('POST', '/api/v1/items/bulk', { json: { items } });
  }

  recordPriceByExternal(externalId, event, idempotencyKey) {
    const headers = idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {};
    return this.request('POST', `/api/v1/prices/by-external/${encodeURIComponent(externalId)}`, { json: event, headers });
  }

  bulkPrices(events) {
    return this.request('POST', '/api/v1/price-events/bulk', { json: { events } });
  }

  complianceByExternal(externalId, scope = {}) {
    return this.request('GET', `/api/v1/compliance/by-external/${encodeURIComponent(externalId)}`, { query: scope });
  }

  async request(method, path, { query, json, headers } = {}) {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try {
      response = await this.fetch(url, {
        method,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/json',
          'User-Agent': `uskladjenost-cijena-shopify/${VERSION}`,
          ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(headers || {}),
        },
        body: json !== undefined ? JSON.stringify(json) : undefined,
      });
    } catch (error) {
      throw new ApiError('transport', error.message, 0);
    } finally {
      clearTimeout(timer);
    }
    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = {};
    }
    if (response.status >= 400) {
      const error = data.error || {};
      throw new ApiError(error.code || `http_${response.status}`, error.message || `HTTP ${response.status}`, response.status, error.details || {});
    }
    return { ...data, _status: response.status };
  }
}
