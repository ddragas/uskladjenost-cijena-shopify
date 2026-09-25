/** Configuration from the environment; `load()` throws on a missing required value. */

const REQUIRED = ['PC_TOKEN', 'PC_MERCHANT_ID', 'PC_CHANNEL_CODE', 'SHOPIFY_SHOP', 'SHOPIFY_API_SECRET'];

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {{ requireAdmin?: boolean }} [options] the Admin token is needed only by the full sync
 */
export function load(env = process.env, { requireAdmin = false } = {}) {
  const missing = REQUIRED.filter((k) => !env[k]);
  if (requireAdmin && !env.SHOPIFY_ADMIN_TOKEN) missing.push('SHOPIFY_ADMIN_TOKEN');
  if (missing.length) throw new Error(`Missing environment: ${missing.join(', ')}`);
  return {
    pcToken: env.PC_TOKEN,
    pcBaseUrl: env.PC_BASE_URL || 'https://uskladjenost-cijena.com',
    merchantId: env.PC_MERCHANT_ID,
    channelCode: env.PC_CHANNEL_CODE,
    currency: (env.PC_CURRENCY || 'EUR').toUpperCase(),
    shop: env.SHOPIFY_SHOP,
    adminToken: env.SHOPIFY_ADMIN_TOKEN || '',
    apiSecret: env.SHOPIFY_API_SECRET,
    webhookSecret: env.SHOPIFY_WEBHOOK_SECRET || env.SHOPIFY_API_SECRET,
    port: Number(env.PORT || 3000),
    stateDir: env.PC_STATE_DIR || 'data',
    cacheTtlMs: Number(env.PC_CACHE_TTL_SECONDS || 6 * 3600) * 1000,
  };
}
