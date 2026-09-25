/**
 * Products and prices out of Shopify: one product per webhook (the item
 * of every variant, then its price) and the whole catalogue in bulk. A
 * variant that vanished from a product, or a deleted product, is
 * deactivated in the API.
 */
import { mapProduct, label as labelOf } from './mapper.js';

export class Sync {
  /**
   * @param {{ pc: import('./pc-client.js').PcClient, state: import('./state.js').ProductState, cache: import('./cache.js').TtlCache, config: ReturnType<typeof import('./config.js').load>, log?: (line: string) => void }} deps
   */
  constructor({ pc, state, cache, config, log = console.log }) {
    this.pc = pc;
    this.state = state;
    this.cache = cache;
    this.config = config;
    this.log = log;
  }

  /** products/create and products/update: every variant, then the ones that disappeared. */
  async product(product) {
    const { merchantId, channelCode, currency } = this.config;
    const rows = mapProduct(product, { merchantId, channelCode, currency });
    const seen = {};
    for (const row of rows) {
      await this.pc.upsertItem(row.external_id, row.item);
      if (row.price) await this.pc.recordPriceByExternal(row.external_id, row.price);
      this.cache.delete(this.cacheKey(row.external_id));
      seen[row.external_id] = row.item.name;
    }
    const before = this.state.variants(product.id);
    for (const [variantId, name] of Object.entries(before)) {
      if (!(variantId in seen)) await this.deactivate(variantId, name);
    }
    this.state.remember(product.id, seen);
    this.log(`product ${product.id}: ${rows.length} variants sent, ${Object.keys(before).filter((v) => !(v in seen)).length} deactivated`);
    return rows.length;
  }

  /** products/delete carries only { id }; the variants come from what was remembered. */
  async deleted(productId) {
    const variants = this.state.variants(productId);
    for (const [variantId, name] of Object.entries(variants)) await this.deactivate(variantId, name);
    this.state.forget(productId);
    this.log(`product ${productId} deleted: ${Object.keys(variants).length} variants deactivated`);
    return Object.keys(variants).length;
  }

  async deactivate(variantId, name) {
    const { merchantId, channelCode } = this.config;
    await this.pc.upsertItem(variantId, { merchant_id: merchantId, kind: 'product', name, active: false, is_available: false, channel_code: channelCode });
    this.cache.delete(this.cacheKey(variantId));
  }

  /** The label for a variant on the webshop channel, cached; a refusal is cached five minutes. */
  async label(variantId) {
    const key = this.cacheKey(variantId);
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    try {
      const decision = await this.pc.complianceByExternal(variantId, { channel_code: this.config.channelCode, locale: 'hr' });
      return this.cache.set(key, labelOf(decision.data ?? decision));
    } catch (error) {
      this.log(`compliance ${variantId}: ${error.message}`);
      return this.cache.set(key, null, 5 * 60 * 1000);
    }
  }

  cacheKey(variantId) {
    return `${this.config.channelCode}|${variantId}`;
  }

  /**
   * The whole catalogue: items in batches of 500 through POST /items/bulk,
   * their prices through POST /price-events/bulk with the offer ids the
   * first call answered. `products` is any async iterable of products.
   */
  async all(products) {
    const { merchantId, channelCode, currency } = this.config;
    const summary = { products: 0, items: 0, prices: 0, errors: 0 };
    let items = [];
    let prices = {};
    const flush = async () => {
      if (!items.length) return;
      const result = await this.pc.bulkItems(items);
      const events = [];
      for (const row of result.data || []) {
        if (row.status === 'error') {
          summary.errors++;
          this.log(`item ${row.external_id}: ${row.error?.message || 'error'}`);
          continue;
        }
        summary.items++;
        const offerId = row.data?.offer_id ?? row.offer_id;
        if (prices[row.external_id] && offerId) events.push({ ...prices[row.external_id], offer_id: offerId });
      }
      for (let i = 0; i < events.length; i += 1000) {
        const priced = await this.pc.bulkPrices(events.slice(i, i + 1000));
        summary.prices += Number(priced.summary?.created ?? 0) + Number(priced.summary?.duplicate ?? 0);
        summary.errors += Number(priced.summary?.errors ?? 0);
      }
      items = [];
      prices = {};
    };
    for await (const product of products) {
      summary.products++;
      const seen = {};
      for (const row of mapProduct(product, { merchantId, channelCode, currency })) {
        items.push({ ...row.item, external_id: row.external_id });
        if (row.price) {
          const { channel_code, ...event } = row.price;
          prices[row.external_id] = event;
        }
        this.cache.delete(this.cacheKey(row.external_id));
        seen[row.external_id] = row.item.name;
      }
      this.state.remember(product.id, seen);
      if (items.length >= 500) await flush();
    }
    await flush();
    return summary;
  }
}
