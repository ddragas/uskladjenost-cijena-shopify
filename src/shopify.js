/**
 * Shopify's two signatures and its Admin REST API. The signature checks are
 * pure functions over the raw request; the Admin client pages products.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const API_VERSION = '2024-10';

/**
 * Webhook: X-Shopify-Hmac-Sha256 is base64(HMAC-SHA256(secret, raw body)).
 * @param {string} secret the app's API secret key
 * @param {string|Buffer} rawBody the body exactly as received
 * @param {string|undefined} header the X-Shopify-Hmac-Sha256 header
 */
export function verifyWebhookHmac(secret, rawBody, header) {
  if (!secret || typeof header !== 'string' || header === '') return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  let given;
  try {
    given = Buffer.from(header, 'base64');
  } catch {
    return false;
  }
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** The webhook signature as Shopify would compute it (for tests and local replay). */
export function signWebhook(secret, rawBody) {
  return createHmac('sha256', secret).update(rawBody).digest('base64');
}

/**
 * App proxy: every query parameter except `signature`, sorted by name,
 * joined as key=value with no separator (repeated keys joined by a comma),
 * HMAC-SHA256 hex with the app secret.
 * @param {string} secret
 * @param {Record<string, string|string[]>|URLSearchParams} query
 */
export function verifyProxySignature(secret, query) {
  const params = toParams(query);
  const signature = params.signature;
  if (!secret || typeof signature !== 'string' || !/^[0-9a-f]{64}$/i.test(signature)) return false;
  const expected = Buffer.from(proxyDigest(secret, params), 'hex');
  const given = Buffer.from(signature, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** The proxy signature as Shopify would compute it (for tests). */
export function signProxy(secret, query) {
  return proxyDigest(secret, toParams(query));
}

function proxyDigest(secret, params) {
  const message = Object.keys(params)
    .filter((k) => k !== 'signature')
    .sort()
    .map((k) => `${k}=${Array.isArray(params[k]) ? params[k].join(',') : params[k]}`)
    .join('');
  return createHmac('sha256', secret).update(message).digest('hex');
}

/** URLSearchParams → { key: value | [values] }; a plain object passes through. */
export function toParams(query) {
  if (!(query instanceof URLSearchParams)) return { ...query };
  const out = {};
  for (const [key, value] of query) {
    if (key in out) out[key] = [].concat(out[key], value);
    else out[key] = value;
  }
  return out;
}

/** The Admin REST API with a custom-app access token; `products()` walks every page. */
export class AdminClient {
  /**
   * @param {{ shop: string, accessToken: string, fetch?: typeof fetch, apiVersion?: string }} options
   */
  constructor({ shop, accessToken, fetch: fetchImpl, apiVersion }) {
    if (!shop || !accessToken) throw new Error('SHOPIFY_SHOP and SHOPIFY_ADMIN_TOKEN are required.');
    this.shop = shop.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    this.accessToken = accessToken;
    this.fetch = fetchImpl || globalThis.fetch;
    this.apiVersion = apiVersion || API_VERSION;
  }

  async get(path, query = {}) {
    const url = new URL(`https://${this.shop}/admin/api/${this.apiVersion}${path}`);
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    const response = await this.fetch(url, { headers: { 'X-Shopify-Access-Token': this.accessToken, Accept: 'application/json' } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Shopify ${response.status} on ${path}: ${JSON.stringify(body.errors ?? body)}`);
    return { body, link: response.headers.get('link') || '' };
  }

  /** Every product, one page of 250 at a time, following the Link header's page_info cursor. */
  async *products({ status = 'active', fields } = {}) {
    let query = { limit: 250, status, fields };
    for (;;) {
      const { body, link } = await this.get('/products.json', query);
      for (const product of body.products || []) yield product;
      const next = nextPageInfo(link);
      if (!next) return;
      query = { limit: 250, page_info: next };
    }
  }

  async product(id) {
    const { body } = await this.get(`/products/${encodeURIComponent(id)}.json`);
    return body.product;
  }
}

/** The page_info of rel="next" out of a Link header, or null on the last page. */
export function nextPageInfo(link) {
  for (const part of String(link || '').split(',')) {
    const match = part.match(/<([^>]+)>;\s*rel="next"/);
    if (match) return new URL(match[1]).searchParams.get('page_info');
  }
  return null;
}
