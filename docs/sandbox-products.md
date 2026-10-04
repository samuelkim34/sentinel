# Sandbox product catalog

100 products and service examples across 50 merchants. All USD prices are fictional, fixed, tax-and-fee-inclusive demo totals chosen to be plausible; they are not checked live retailer prices. Brands identify sandbox examples, not affiliations. Service entries are one-time simulated charges with no actual booking, delivery, activation, renewal or stock guarantee.

## Use

1. Start Sentinel from the updated project folder with `npm run dev`.
2. Open Settings → Sync Nessie merchants. Missing sample merchants are created automatically; no terminal command is needed.
3. Review and confirm the suggested merchant categories together in Settings, or assign them individually. Products appear automatically under Sandbox products; no separate product import is needed.
4. Create or select a suitable active agent allowance. In agent chat select Purchase permission for this message, then say “Buy an eraser from Staples under $10.” Alternatively create a Purchase task with that desired outcome and allowance. Queue instruction is only for follow-ups.
5. Review the proposal/payment status. No purchase is complete merely because Grok says so.

The on-site agent has `search_products` and `submit_product_proposal`. The server resolves product IDs, quantity, merchant mapping and integer-cent prices, rejects ambiguous/unmapped merchants and over-budget totals, and passes proposals through existing policy checks. The product ID, name, quantity and price are snapshotted in the persisted proposal reason. The cap supplied to the product tool is model-interpreted from the request; authoritative hard spending limits remain the saved allowance. The older arbitrary-amount proposal tool remains for noncatalog payments. No agents, accounts, allowances or payments are automatically created by this feature.

The catalog is a versioned server-side source file, `src/banking/sandbox-products.ts`, not data hosted by Nessie. To change the fixed assortment, edit that file and restart. There is no product editor, cart, stock management or live retail integration. Product IDs must stay stable. Catalog revisions must not be treated as permission to retry an existing purchase.

This update also includes `status: "pending"` in future Nessie purchase POST requests. It does not repair already malformed upstream transactions or clear unresolved payments. Preserve existing databases and do not resubmit uncertain purchases.

## Assortment

| Merchant | Product / simulated service | Fixed USD total |
| --- | --- | ---: |
| Staples | Pink eraser, 3-pack | $3.49 |
| Staples | Five Star notebook, 1 subject | $5.99 |
| Office Depot | Copy paper, 500 sheets | $8.49 |
| Office Depot | Sharpie permanent markers, 2-pack | $3.99 |
| Walmart | Great Value whole milk, 1 gallon | $3.89 |
| Walmart | Bounty paper towels, 2 rolls | $5.99 |
| Target | Good & Gather eggs, 12 count | $3.99 |
| Target | Tide liquid detergent, 46 fl oz | $11.99 |
| Costco | Kirkland bottled water, 40-pack | $5.99 |
| Costco | Kirkland bath tissue, 30 rolls | $22.99 |
| Amazon | Amazon Basics AA batteries, 20-pack | $9.99 |
| Amazon | Amazon Basics HDMI cable, 6 feet | $7.99 |
| Best Buy | Logitech wired USB keyboard | $19.99 |
| Best Buy | SanDisk USB flash drive, 64 GB | $9.99 |
| Apple | USB-C charge cable, 1 meter | $19.99 |
| Apple | 20W USB-C power adapter | $19.99 |
| The Home Depot | HDX storage tote, 27 gallon | $12.99 |
| The Home Depot | Husky tape measure, 25 feet | $14.99 |
| Lowe's | Kobalt claw hammer, 16 oz | $14.99 |
| Lowe's | LED light bulbs, 4-pack | $9.99 |
| IKEA | FRAKTA large shopping bag | $1.99 |
| IKEA | LACK side table | $14.99 |
| Ace Hardware | Duct tape, 1 roll | $6.99 |
| Ace Hardware | AA batteries, 8-pack | $8.99 |
| Kroger | Bananas, 1 lb | $0.69 |
| Kroger | Kroger whole milk, 1 gallon | $3.79 |
| Whole Foods Market | 365 organic whole milk, half gallon | $4.99 |
| Whole Foods Market | 365 rolled oats, 18 oz | $3.99 |
| Trader Joe's | Mandarin Orange Chicken, 22 oz | $5.99 |
| Trader Joe's | Everything but the Bagel seasoning | $2.49 |
| ALDI | Friendly Farms whole milk, 1 gallon | $3.49 |
| ALDI | Baker Corner flour, 5 lb | $2.49 |
| Publix | Publix whole milk, 1 gallon | $4.49 |
| Publix | Publix bakery sandwich bread | $3.49 |
| Safeway | Signature Select spaghetti, 16 oz | $1.99 |
| Safeway | Signature Select pasta sauce, 24 oz | $2.99 |
| Wegmans | Wegmans eggs, 12 count | $3.49 |
| Wegmans | Wegmans spring water, 24-pack | $4.99 |
| Starbucks | Caffe Latte, grande | $5.95 |
| Starbucks | Butter croissant | $4.25 |
| Dunkin' | Original Blend hot coffee, medium | $2.99 |
| Dunkin' | Glazed donut | $1.79 |
| McDonald's | Big Mac sandwich | $5.99 |
| McDonald's | French fries, medium | $3.49 |
| Chick-fil-A | Chicken sandwich | $5.49 |
| Chick-fil-A | Waffle fries, medium | $2.99 |
| Chipotle | Chicken burrito bowl | $10.99 |
| Chipotle | Chips and guacamole | $4.99 |
| Subway | Turkey sandwich, 6 inch | $7.49 |
| Subway | Chocolate chip cookie | $0.99 |
| Taco Bell | Crunchy taco | $1.99 |
| Taco Bell | Crunchwrap Supreme | $5.99 |
| Panera Bread | Broccoli cheddar soup, cup | $6.99 |
| Panera Bread | Plain bagel | $1.99 |
| Domino's | Cheese pizza, medium | $11.99 |
| Domino's | Parmesan Bread Bites, 16 count | $5.99 |
| Wendy's | Daves Single burger | $5.99 |
| Wendy's | Small Frosty | $2.49 |
| Burger King | Whopper sandwich | $6.49 |
| Burger King | French fries, medium | $3.29 |
| CVS Pharmacy | Colgate toothpaste, 4 oz | $3.99 |
| CVS Pharmacy | Band-Aid adhesive bandages, 30 count | $4.99 |
| Walgreens | Crest toothpaste, 4 oz | $3.99 |
| Walgreens | Kleenex tissues, 1 box | $2.49 |
| Shell | Regular gasoline, fixed 1 gallon | $3.59 |
| Shell | Bottled water, 20 fl oz | $1.99 |
| Exxon | Regular gasoline, fixed 1 gallon | $3.49 |
| Exxon | Coffee, 16 fl oz | $2.49 |
| Chevron | Regular gasoline, fixed 1 gallon | $3.79 |
| Chevron | Bottled water, 20 fl oz | $1.99 |
| Uber | Simulated local ride, fixed fare | $15.00 |
| Uber | Simulated airport ride, fixed fare | $45.00 |
| Lyft | Simulated local ride, fixed fare | $14.00 |
| Lyft | Simulated airport ride, fixed fare | $42.00 |
| Microsoft | Microsoft 365 Personal, simulated 1 month | $9.99 |
| Microsoft | Xbox Game Pass, simulated 1 month | $14.99 |
| Adobe | Acrobat subscription, simulated 1 month | $19.99 |
| Adobe | Photoshop subscription, simulated 1 month | $22.99 |
| Zoom | Zoom Pro seat, simulated 1 month | $15.99 |
| Zoom | Zoom Workplace seat, simulated 1 month | $21.99 |
| Dropbox | Dropbox Plus, simulated 1 month | $11.99 |
| Dropbox | Dropbox Professional, simulated 1 month | $19.99 |
| Intuit | QuickBooks starter plan, simulated 1 month | $35.00 |
| Intuit | QuickBooks higher-tier plan, simulated 1 month | $65.00 |
| Netflix | Ad-supported streaming, simulated 1 month | $7.99 |
| Netflix | Standard streaming, simulated 1 month | $17.99 |
| Spotify | Individual Premium, simulated 1 month | $11.99 |
| Spotify | Duo Premium, simulated 1 month | $16.99 |
| Airbnb | Simulated private room, 1 night | $85.00 |
| Airbnb | Simulated apartment, 1 night | $150.00 |
| Marriott | Simulated standard room, 1 night | $159.00 |
| Marriott | Simulated suite, 1 night | $249.00 |
| Hilton | Simulated standard room, 1 night | $149.00 |
| Hilton | Simulated suite, 1 night | $229.00 |
| Delta Air Lines | Simulated domestic economy flight, one way | $199.00 |
| Delta Air Lines | Simulated checked bag, 1 bag | $35.00 |
| United Airlines | Simulated domestic economy flight, one way | $189.00 |
| United Airlines | Simulated checked bag, 1 bag | $35.00 |
| American Airlines | Simulated domestic economy flight, one way | $179.00 |
| American Airlines | Simulated checked bag, 1 bag | $35.00 |
