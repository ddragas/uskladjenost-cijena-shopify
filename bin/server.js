#!/usr/bin/env node
/** Starts the webhook + app-proxy server: `node bin/server.js` (PORT, default 3000). */
import { load } from '../src/config.js';
import { PcClient } from '../src/pc-client.js';
import { ProductState } from '../src/state.js';
import { TtlCache } from '../src/cache.js';
import { Sync } from '../src/sync.js';
import { listen } from '../src/server.js';

const config = load(process.env);
const pc = new PcClient(config.pcToken, { baseUrl: config.pcBaseUrl });
const sync = new Sync({ pc, state: new ProductState(config.stateDir), cache: new TtlCache(config.cacheTtlMs), config });

const ping = await pc.ping().catch((error) => ({ error }));
if (ping.error) {
  console.error(`Usklađenost cijena: token refused: ${ping.error.message}`);
  process.exit(1);
}
console.log(`Usklađenost cijena: connected as ${ping.data?.client} (${ping.data?.tenant}), scopes ${(ping.data?.scopes || []).join(', ')}`);

const server = await listen({ sync, apiSecret: config.apiSecret, webhookSecret: config.webhookSecret }, config.port);
console.log(`listening on :${config.port} for ${config.shop}, channel ${config.channelCode}`);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
