# Usklađenost cijena za Shopify

Mala Node aplikacija (Node 18+, bez vanjskih ovisnosti) koja povezuje Shopify trgovinu sa servisom [Usklađenost cijena](https://uskladjenost-cijena.com): sidrene cijene i javni strojno čitljiv cjenik po NN 101/2026. Postavlja se kao **Custom app** u vašoj trgovini; nema Shopify App Store-a, nema OAuth-a.

Što radi:

- **Webhookovi proizvoda.** `products/create`, `products/update` i `products/delete` stižu na `POST /webhooks`, potpis `X-Shopify-Hmac-Sha256` se provjerava, a svaka varijanta ide u servis kao svoj artikl (`PUT /items/{variant_id}`, naziv „Proizvod – Varijanta”, SKU, barkod, vrsta *product*) i svoja cijena (`POST /prices/by-external/{variant_id}`). `compare_at_price` veći od `price` znači akciju: redovna cijena je `compare_at_price`, plaćena `price`. Varijanta koja nestane iz proizvoda ili obrisan proizvod deaktiviraju se u servisu.
- **App Proxy.** `GET /proxy/compliance?variant_id=…` provjerava Shopifyjev potpis proxyja i vraća `{ "label": "Cijena na dan 10. 9. 2026.: 12,50 €" }` iz `GET /compliance/by-external/{variant_id}` na kanalu webshopa; odgovor se kešira u memoriji 6 sati i briše kod svake sinkronizacije te varijante.
- **Liquid snippet** `snippets/uskladjenost-cijena.liquid` ispisuje taj tekst ispod cijene i osvježava ga kod promjene varijante.
- **Cijeli katalog** `node bin/sync-all.js`: prolazi Admin REST API (stranice po 250) i šalje serije od 500 artikala kroz `POST /items/bulk`, pa cijene kroz `POST /price-events/bulk` s vraćenim `offer_id`-jevima.

## Postavljanje

1. **U aplikaciji Usklađenost cijena:** trgovac → **Kanali** → kanal tipa *webshop* (šifra npr. `WEB`); **API pristup** → token s opsezima `catalog:write`, `prices:write`, `compliance:read`.
2. **U Shopify adminu → Settings → Apps and sales channels → Develop apps → Create an app:**
   - *Configuration → Admin API integration:* opseg `read_products` (i `write_products` nije potreban). Zapišite **Admin API access token** (`shpat_…`) i **API secret key** (`shpss_…`).
   - *Configuration → App proxy:* Subpath prefix `apps`, Subpath `uskladjenost`, Proxy URL `https://VAŠ-HOST/proxy`. Trgovina tada `/apps/uskladjenost/compliance` prosljeđuje na `https://VAŠ-HOST/proxy/compliance`.
   - Instalirajte aplikaciju u trgovinu.
3. **Webhookovi:** Settings → Notifications → Webhooks → dodajte `Product creation`, `Product update` i `Product deletion`, format JSON, URL `https://VAŠ-HOST/webhooks`, API verzija 2024-10. Webhookovi napravljeni tako, u adminu, potpisuju se *tajnom trgovine* koja piše ispod popisa webhookova („All your webhooks will be signed with …”): nju upišite u `SHOPIFY_WEBHOOK_SECRET`. Webhookovi napravljeni kroz Admin API tokenom aplikacije potpisuju se API secret key-em aplikacije; tada `SHOPIFY_WEBHOOK_SECRET` ostavite prazan.
4. **Pokretanje aplikacije** (bilo koji host s javnim HTTPS-om, npr. iza Caddyja ili nginx-a):

```bash
cp .env.example .env    # i popunite
set -a; . ./.env; set +a
node bin/server.js      # sluša na PORT (3000): /webhooks, /proxy/compliance, /health
node bin/sync-all.js    # jednom, cijeli katalog; --all šalje i draft/arhivirane
```

Varijable okoline:

| Varijabla | Značenje |
|---|---|
| `PC_TOKEN` | token `pc_live_…` / `pc_test_…` |
| `PC_BASE_URL` | `https://uskladjenost-cijena.com` (mijenja se samo za testni poslužitelj) |
| `PC_MERCHANT_ID` | ID trgovca iz aplikacije |
| `PC_CHANNEL_CODE` | šifra kanala webshopa, npr. `WEB` |
| `PC_CURRENCY` | valuta trgovine, zadano `EUR` |
| `SHOPIFY_SHOP` | `vasa-trgovina.myshopify.com` |
| `SHOPIFY_ADMIN_TOKEN` | Admin API access token (treba samo `sync-all`) |
| `SHOPIFY_API_SECRET` | API secret key aplikacije (potpis App Proxyja, i webhookova kad ih radi API) |
| `SHOPIFY_WEBHOOK_SECRET` | tajna trgovine za webhookove napravljene u adminu; prazno = `SHOPIFY_API_SECRET` |
| `PORT`, `PC_STATE_DIR`, `PC_CACHE_TTL_SECONDS` | port (3000), mapa za `products.json` (`data`), trajanje keša (21600) |

5. **Tema:** kopirajte `snippets/uskladjenost-cijena.liquid` u temu i u predložak proizvoda odmah iza cijene dodajte

```liquid
{% render 'uskladjenost-cijena', product: product, variant: product.selected_or_first_available_variant %}
```

Javni cjenik za webshop servis od tada gradi i objavljuje sam; snippet gumba „Cjenik” za temu je u aplikaciji pod Objava cjenika.

## Kako aplikacija pamti varijante

Shopifyjev `products/delete` nosi samo `id` proizvoda, a `products/update` ne kaže koje su varijante nestale. Aplikacija zato u `PC_STATE_DIR/products.json` pamti varijante svakog proizvoda (id → naziv) i iz toga ih deaktivira. Datoteka se puni webhookovima i punom sinkronizacijom; obrišete li je, ništa se ne gubi osim te deaktivacije.

## Razvoj

```bash
npm test   # node:test — mapper, oba potpisa, HTTP sloj s lažnim API-jem
```

Dokumentacija API-ja: `https://uskladjenost-cijena.com/api/docs` i `/api/swagger`. Licenca MIT, © Info Media d.o.o.

## Ostali SDK-ovi i dodaci

Ista obitelj za isti API, svaki u svom repozitoriju:

- [uskladjenost-cijena-php](https://github.com/ddragas/uskladjenost-cijena-php) – PHP SDK (Composer `infomedia/uskladjenost-cijena-php`)
- [uskladjenost-cijena-python](https://github.com/ddragas/uskladjenost-cijena-python) – Python SDK (`uskladjenost-cijena`)
- [uskladjenost-cijena-js](https://github.com/ddragas/uskladjenost-cijena-js) – JavaScript/TypeScript SDK (`uskladjenost-cijena`)
- [uskladjenost-cijena-woocommerce](https://github.com/ddragas/uskladjenost-cijena-woocommerce) – WooCommerce dodatak
- [uskladjenost-cijena-prestashop](https://github.com/ddragas/uskladjenost-cijena-prestashop) – PrestaShop 8 modul
