#!/usr/bin/env node
/**
 * Sends the whole catalogue: every active product's variants through
 * POST /items/bulk, then their prices through POST /price-events/bulk.
 *
 *   node bin/sync-all.js            active products
 *   node bin/sync-all.js --all      every status (draft and archived too)
 */
import { load } from '../src/config.js';
import { PcClient } from '../src/pc-client.js';
import { AdminClient } from '../src/shopify.js';
import { ProductState } from '../src/state.js';
import { TtlCache } from '../src/cache.js';
import { Sync } from '../src/sync.js';

const config = load(process.env, { requireAdmin: true });
const pc = new PcClient(config.pcToken, { baseUrl: config.pcBaseUrl });
const admin = new AdminClient({ shop: config.shop, accessToken: config.adminToken });
const sync = new Sync({ pc, state: new ProductState(config.stateDir), cache: new TtlCache(config.cacheTtlMs), config });

const status = process.argv.includes('--all') ? undefined : 'active';
const started = Date.now();
const summary = await sync.all(admin.products({ status, fields: 'id,title,vendor,product_type,status,variants' }));
console.log(`${summary.products} products, ${summary.items} items sent, ${summary.prices} prices recorded, ${summary.errors} errors, ${((Date.now() - started) / 1000).toFixed(1)} s`);
process.exit(summary.errors ? 2 : 0);
