// Fixed fictional USD totals for sandbox testing, not live retailer quotes.
// Services are one-time simulated charges: no booking, fulfillment or renewal.
export type SandboxProduct = { id: string; merchant: string; name: string; unitPriceCents: number };
export const SANDBOX_PRODUCTS: readonly SandboxProduct[] = [
  {
    "id": "staples-1",
    "merchant": "Staples",
    "name": "Pink eraser, 3-pack",
    "unitPriceCents": 349
  },
  {
    "id": "staples-2",
    "merchant": "Staples",
    "name": "Five Star notebook, 1 subject",
    "unitPriceCents": 599
  },
  {
    "id": "office-depot-1",
    "merchant": "Office Depot",
    "name": "Copy paper, 500 sheets",
    "unitPriceCents": 849
  },
  {
    "id": "office-depot-2",
    "merchant": "Office Depot",
    "name": "Sharpie permanent markers, 2-pack",
    "unitPriceCents": 399
  },
  {
    "id": "walmart-1",
    "merchant": "Walmart",
    "name": "Great Value whole milk, 1 gallon",
    "unitPriceCents": 389
  },
  {
    "id": "walmart-2",
    "merchant": "Walmart",
    "name": "Bounty paper towels, 2 rolls",
    "unitPriceCents": 599
  },
  {
    "id": "target-1",
    "merchant": "Target",
    "name": "Good & Gather eggs, 12 count",
    "unitPriceCents": 399
  },
  {
    "id": "target-2",
    "merchant": "Target",
    "name": "Tide liquid detergent, 46 fl oz",
    "unitPriceCents": 1199
  },
  {
    "id": "costco-1",
    "merchant": "Costco",
    "name": "Kirkland bottled water, 40-pack",
    "unitPriceCents": 599
  },
  {
    "id": "costco-2",
    "merchant": "Costco",
    "name": "Kirkland bath tissue, 30 rolls",
    "unitPriceCents": 2299
  },
  {
    "id": "amazon-1",
    "merchant": "Amazon",
    "name": "Amazon Basics AA batteries, 20-pack",
    "unitPriceCents": 999
  },
  {
    "id": "amazon-2",
    "merchant": "Amazon",
    "name": "Amazon Basics HDMI cable, 6 feet",
    "unitPriceCents": 799
  },
  {
    "id": "best-buy-1",
    "merchant": "Best Buy",
    "name": "Logitech wired USB keyboard",
    "unitPriceCents": 1999
  },
  {
    "id": "best-buy-2",
    "merchant": "Best Buy",
    "name": "SanDisk USB flash drive, 64 GB",
    "unitPriceCents": 999
  },
  {
    "id": "apple-1",
    "merchant": "Apple",
    "name": "USB-C charge cable, 1 meter",
    "unitPriceCents": 1999
  },
  {
    "id": "apple-2",
    "merchant": "Apple",
    "name": "20W USB-C power adapter",
    "unitPriceCents": 1999
  },
  {
    "id": "the-home-depot-1",
    "merchant": "The Home Depot",
    "name": "HDX storage tote, 27 gallon",
    "unitPriceCents": 1299
  },
  {
    "id": "the-home-depot-2",
    "merchant": "The Home Depot",
    "name": "Husky tape measure, 25 feet",
    "unitPriceCents": 1499
  },
  {
    "id": "lowe-s-1",
    "merchant": "Lowe's",
    "name": "Kobalt claw hammer, 16 oz",
    "unitPriceCents": 1499
  },
  {
    "id": "lowe-s-2",
    "merchant": "Lowe's",
    "name": "LED light bulbs, 4-pack",
    "unitPriceCents": 999
  },
  {
    "id": "ikea-1",
    "merchant": "IKEA",
    "name": "FRAKTA large shopping bag",
    "unitPriceCents": 199
  },
  {
    "id": "ikea-2",
    "merchant": "IKEA",
    "name": "LACK side table",
    "unitPriceCents": 1499
  },
  {
    "id": "ace-hardware-1",
    "merchant": "Ace Hardware",
    "name": "Duct tape, 1 roll",
    "unitPriceCents": 699
  },
  {
    "id": "ace-hardware-2",
    "merchant": "Ace Hardware",
    "name": "AA batteries, 8-pack",
    "unitPriceCents": 899
  },
  {
    "id": "kroger-1",
    "merchant": "Kroger",
    "name": "Bananas, 1 lb",
    "unitPriceCents": 69
  },
  {
    "id": "kroger-2",
    "merchant": "Kroger",
    "name": "Kroger whole milk, 1 gallon",
    "unitPriceCents": 379
  },
  {
    "id": "whole-foods-market-1",
    "merchant": "Whole Foods Market",
    "name": "365 organic whole milk, half gallon",
    "unitPriceCents": 499
  },
  {
    "id": "whole-foods-market-2",
    "merchant": "Whole Foods Market",
    "name": "365 rolled oats, 18 oz",
    "unitPriceCents": 399
  },
  {
    "id": "trader-joe-s-1",
    "merchant": "Trader Joe's",
    "name": "Mandarin Orange Chicken, 22 oz",
    "unitPriceCents": 599
  },
  {
    "id": "trader-joe-s-2",
    "merchant": "Trader Joe's",
    "name": "Everything but the Bagel seasoning",
    "unitPriceCents": 249
  },
  {
    "id": "aldi-1",
    "merchant": "ALDI",
    "name": "Friendly Farms whole milk, 1 gallon",
    "unitPriceCents": 349
  },
  {
    "id": "aldi-2",
    "merchant": "ALDI",
    "name": "Baker Corner flour, 5 lb",
    "unitPriceCents": 249
  },
  {
    "id": "publix-1",
    "merchant": "Publix",
    "name": "Publix whole milk, 1 gallon",
    "unitPriceCents": 449
  },
  {
    "id": "publix-2",
    "merchant": "Publix",
    "name": "Publix bakery sandwich bread",
    "unitPriceCents": 349
  },
  {
    "id": "safeway-1",
    "merchant": "Safeway",
    "name": "Signature Select spaghetti, 16 oz",
    "unitPriceCents": 199
  },
  {
    "id": "safeway-2",
    "merchant": "Safeway",
    "name": "Signature Select pasta sauce, 24 oz",
    "unitPriceCents": 299
  },
  {
    "id": "wegmans-1",
    "merchant": "Wegmans",
    "name": "Wegmans eggs, 12 count",
    "unitPriceCents": 349
  },
  {
    "id": "wegmans-2",
    "merchant": "Wegmans",
    "name": "Wegmans spring water, 24-pack",
    "unitPriceCents": 499
  },
  {
    "id": "starbucks-1",
    "merchant": "Starbucks",
    "name": "Caffe Latte, grande",
    "unitPriceCents": 595
  },
  {
    "id": "starbucks-2",
    "merchant": "Starbucks",
    "name": "Butter croissant",
    "unitPriceCents": 425
  },
  {
    "id": "dunkin-1",
    "merchant": "Dunkin'",
    "name": "Original Blend hot coffee, medium",
    "unitPriceCents": 299
  },
  {
    "id": "dunkin-2",
    "merchant": "Dunkin'",
    "name": "Glazed donut",
    "unitPriceCents": 179
  },
  {
    "id": "mcdonald-s-1",
    "merchant": "McDonald's",
    "name": "Big Mac sandwich",
    "unitPriceCents": 599
  },
  {
    "id": "mcdonald-s-2",
    "merchant": "McDonald's",
    "name": "French fries, medium",
    "unitPriceCents": 349
  },
  {
    "id": "chick-fil-a-1",
    "merchant": "Chick-fil-A",
    "name": "Chicken sandwich",
    "unitPriceCents": 549
  },
  {
    "id": "chick-fil-a-2",
    "merchant": "Chick-fil-A",
    "name": "Waffle fries, medium",
    "unitPriceCents": 299
  },
  {
    "id": "chipotle-1",
    "merchant": "Chipotle",
    "name": "Chicken burrito bowl",
    "unitPriceCents": 1099
  },
  {
    "id": "chipotle-2",
    "merchant": "Chipotle",
    "name": "Chips and guacamole",
    "unitPriceCents": 499
  },
  {
    "id": "subway-1",
    "merchant": "Subway",
    "name": "Turkey sandwich, 6 inch",
    "unitPriceCents": 749
  },
  {
    "id": "subway-2",
    "merchant": "Subway",
    "name": "Chocolate chip cookie",
    "unitPriceCents": 99
  },
  {
    "id": "taco-bell-1",
    "merchant": "Taco Bell",
    "name": "Crunchy taco",
    "unitPriceCents": 199
  },
  {
    "id": "taco-bell-2",
    "merchant": "Taco Bell",
    "name": "Crunchwrap Supreme",
    "unitPriceCents": 599
  },
  {
    "id": "panera-bread-1",
    "merchant": "Panera Bread",
    "name": "Broccoli cheddar soup, cup",
    "unitPriceCents": 699
  },
  {
    "id": "panera-bread-2",
    "merchant": "Panera Bread",
    "name": "Plain bagel",
    "unitPriceCents": 199
  },
  {
    "id": "domino-s-1",
    "merchant": "Domino's",
    "name": "Cheese pizza, medium",
    "unitPriceCents": 1199
  },
  {
    "id": "domino-s-2",
    "merchant": "Domino's",
    "name": "Parmesan Bread Bites, 16 count",
    "unitPriceCents": 599
  },
  {
    "id": "wendy-s-1",
    "merchant": "Wendy's",
    "name": "Daves Single burger",
    "unitPriceCents": 599
  },
  {
    "id": "wendy-s-2",
    "merchant": "Wendy's",
    "name": "Small Frosty",
    "unitPriceCents": 249
  },
  {
    "id": "burger-king-1",
    "merchant": "Burger King",
    "name": "Whopper sandwich",
    "unitPriceCents": 649
  },
  {
    "id": "burger-king-2",
    "merchant": "Burger King",
    "name": "French fries, medium",
    "unitPriceCents": 329
  },
  {
    "id": "cvs-pharmacy-1",
    "merchant": "CVS Pharmacy",
    "name": "Colgate toothpaste, 4 oz",
    "unitPriceCents": 399
  },
  {
    "id": "cvs-pharmacy-2",
    "merchant": "CVS Pharmacy",
    "name": "Band-Aid adhesive bandages, 30 count",
    "unitPriceCents": 499
  },
  {
    "id": "walgreens-1",
    "merchant": "Walgreens",
    "name": "Crest toothpaste, 4 oz",
    "unitPriceCents": 399
  },
  {
    "id": "walgreens-2",
    "merchant": "Walgreens",
    "name": "Kleenex tissues, 1 box",
    "unitPriceCents": 249
  },
  {
    "id": "shell-1",
    "merchant": "Shell",
    "name": "Regular gasoline, fixed 1 gallon",
    "unitPriceCents": 359
  },
  {
    "id": "shell-2",
    "merchant": "Shell",
    "name": "Bottled water, 20 fl oz",
    "unitPriceCents": 199
  },
  {
    "id": "exxon-1",
    "merchant": "Exxon",
    "name": "Regular gasoline, fixed 1 gallon",
    "unitPriceCents": 349
  },
  {
    "id": "exxon-2",
    "merchant": "Exxon",
    "name": "Coffee, 16 fl oz",
    "unitPriceCents": 249
  },
  {
    "id": "chevron-1",
    "merchant": "Chevron",
    "name": "Regular gasoline, fixed 1 gallon",
    "unitPriceCents": 379
  },
  {
    "id": "chevron-2",
    "merchant": "Chevron",
    "name": "Bottled water, 20 fl oz",
    "unitPriceCents": 199
  },
  {
    "id": "uber-1",
    "merchant": "Uber",
    "name": "Simulated local ride, fixed fare",
    "unitPriceCents": 1500
  },
  {
    "id": "uber-2",
    "merchant": "Uber",
    "name": "Simulated airport ride, fixed fare",
    "unitPriceCents": 4500
  },
  {
    "id": "lyft-1",
    "merchant": "Lyft",
    "name": "Simulated local ride, fixed fare",
    "unitPriceCents": 1400
  },
  {
    "id": "lyft-2",
    "merchant": "Lyft",
    "name": "Simulated airport ride, fixed fare",
    "unitPriceCents": 4200
  },
  {
    "id": "microsoft-1",
    "merchant": "Microsoft",
    "name": "Microsoft 365 Personal, simulated 1 month",
    "unitPriceCents": 999
  },
  {
    "id": "microsoft-2",
    "merchant": "Microsoft",
    "name": "Xbox Game Pass, simulated 1 month",
    "unitPriceCents": 1499
  },
  {
    "id": "adobe-1",
    "merchant": "Adobe",
    "name": "Acrobat subscription, simulated 1 month",
    "unitPriceCents": 1999
  },
  {
    "id": "adobe-2",
    "merchant": "Adobe",
    "name": "Photoshop subscription, simulated 1 month",
    "unitPriceCents": 2299
  },
  {
    "id": "zoom-1",
    "merchant": "Zoom",
    "name": "Zoom Pro seat, simulated 1 month",
    "unitPriceCents": 1599
  },
  {
    "id": "zoom-2",
    "merchant": "Zoom",
    "name": "Zoom Workplace seat, simulated 1 month",
    "unitPriceCents": 2199
  },
  {
    "id": "dropbox-1",
    "merchant": "Dropbox",
    "name": "Dropbox Plus, simulated 1 month",
    "unitPriceCents": 1199
  },
  {
    "id": "dropbox-2",
    "merchant": "Dropbox",
    "name": "Dropbox Professional, simulated 1 month",
    "unitPriceCents": 1999
  },
  {
    "id": "intuit-1",
    "merchant": "Intuit",
    "name": "QuickBooks starter plan, simulated 1 month",
    "unitPriceCents": 3500
  },
  {
    "id": "intuit-2",
    "merchant": "Intuit",
    "name": "QuickBooks higher-tier plan, simulated 1 month",
    "unitPriceCents": 6500
  },
  {
    "id": "netflix-1",
    "merchant": "Netflix",
    "name": "Ad-supported streaming, simulated 1 month",
    "unitPriceCents": 799
  },
  {
    "id": "netflix-2",
    "merchant": "Netflix",
    "name": "Standard streaming, simulated 1 month",
    "unitPriceCents": 1799
  },
  {
    "id": "spotify-1",
    "merchant": "Spotify",
    "name": "Individual Premium, simulated 1 month",
    "unitPriceCents": 1199
  },
  {
    "id": "spotify-2",
    "merchant": "Spotify",
    "name": "Duo Premium, simulated 1 month",
    "unitPriceCents": 1699
  },
  {
    "id": "airbnb-1",
    "merchant": "Airbnb",
    "name": "Simulated private room, 1 night",
    "unitPriceCents": 8500
  },
  {
    "id": "airbnb-2",
    "merchant": "Airbnb",
    "name": "Simulated apartment, 1 night",
    "unitPriceCents": 15000
  },
  {
    "id": "marriott-1",
    "merchant": "Marriott",
    "name": "Simulated standard room, 1 night",
    "unitPriceCents": 15900
  },
  {
    "id": "marriott-2",
    "merchant": "Marriott",
    "name": "Simulated suite, 1 night",
    "unitPriceCents": 24900
  },
  {
    "id": "hilton-1",
    "merchant": "Hilton",
    "name": "Simulated standard room, 1 night",
    "unitPriceCents": 14900
  },
  {
    "id": "hilton-2",
    "merchant": "Hilton",
    "name": "Simulated suite, 1 night",
    "unitPriceCents": 22900
  },
  {
    "id": "delta-air-lines-1",
    "merchant": "Delta Air Lines",
    "name": "Simulated domestic economy flight, one way",
    "unitPriceCents": 19900
  },
  {
    "id": "delta-air-lines-2",
    "merchant": "Delta Air Lines",
    "name": "Simulated checked bag, 1 bag",
    "unitPriceCents": 3500
  },
  {
    "id": "united-airlines-1",
    "merchant": "United Airlines",
    "name": "Simulated domestic economy flight, one way",
    "unitPriceCents": 18900
  },
  {
    "id": "united-airlines-2",
    "merchant": "United Airlines",
    "name": "Simulated checked bag, 1 bag",
    "unitPriceCents": 3500
  },
  {
    "id": "american-airlines-1",
    "merchant": "American Airlines",
    "name": "Simulated domestic economy flight, one way",
    "unitPriceCents": 17900
  },
  {
    "id": "american-airlines-2",
    "merchant": "American Airlines",
    "name": "Simulated checked bag, 1 bag",
    "unitPriceCents": 3500
  }
];
export function searchProducts(search = "") {
  const words = search.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return SANDBOX_PRODUCTS.filter(p => words.every(w => `${p.name} ${p.merchant}`.toLowerCase().includes(w)));
}
