import { load } from "cheerio";
import fs from "fs/promises";

const SOURCE_URL =
  "https://app.rentsmart.com/phd-property-management/";

const OUTPUT_DIR = "docs";

await fs.mkdir(OUTPUT_DIR, { recursive: true });

function clean(value = "") {
  return String(value)
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function absoluteUrl(href) {
  try {
    return new URL(href, SOURCE_URL).href;
  } catch {
    return "";
  }
}

function isPropertyUrl(url) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/+$/, "");

    if (parsed.hostname !== "app.rentsmart.com") {
      return false;
    }

    if (!path.startsWith("/phd-property-management/")) {
      return false;
    }

    return (
      path.replace("/phd-property-management/", "").length > 0
    );
  } catch {
    return false;
  }
}

function getNumber(text, regex) {
  const match = text.match(regex);

  if (!match) return null;

  return Number(match[1].replace(/,/g, ""));
}

console.log("Downloading RentSmart listings...");

const response = await fetch(SOURCE_URL, {
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36",
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
  },
});

if (!response.ok) {
  throw new Error(
    `RentSmart returned HTTP ${response.status}`
  );
}

const html = await response.text();

if (/confirm you are human|not a robot/i.test(html)) {
  throw new Error(
    "RentSmart returned a human-verification page."
  );
}

console.log(`Downloaded ${html.length} characters.`);

const $ = load(html);

const propertyLinks = [];

$("a[href]").each((_, element) => {
  const href = absoluteUrl($(element).attr("href"));

  if (isPropertyUrl(href)) {
    propertyLinks.push({
      element,
      url: href.replace(/\/+$/, ""),
    });
  }
});

console.log(
  `Found ${propertyLinks.length} property-link occurrences.`
);

const rentals = [];
const processedUrls = new Set();

for (const item of propertyLinks) {
  if (processedUrls.has(item.url)) {
    continue;
  }

  let node = $(item.element);
  let cardText = "";

  /*
   * Walk upward from the property's link until we find
   * the individual card containing price, beds, baths,
   * square footage, and address.
   */
  for (let level = 0; level < 10; level++) {
    const text = clean(node.text());

    const hasRent =
      /\$[\d,]+(?:\.\d{2})?\s*\/?\s*mo\b/i.test(text);

    const hasBeds =
      /\d+(?:\.\d+)?\s*bed\b/i.test(text);

    const hasBaths =
      /\d+(?:\.\d+)?\s*bath\b/i.test(text);

    const hasSqft =
      /[\d,]+\s*sqft\b/i.test(text);

    const hasSC =
      /,\s*SC,?\s*\d{5}\b/i.test(text);

    if (
      hasRent &&
      hasBeds &&
      hasBaths &&
      hasSqft &&
      hasSC
    ) {
      cardText = text;
      break;
    }

    node = node.parent();

    if (!node.length) break;
  }

  if (!cardText) {
    continue;
  }

  const rent = getNumber(
    cardText,
    /\$([\d,]+(?:\.\d{2})?)\s*\/?\s*mo\b/i
  );

  const bedrooms = getNumber(
    cardText,
    /(\d+(?:\.\d+)?)\s*bed\b/i
  );

  const bathrooms = getNumber(
    cardText,
    /(\d+(?:\.\d+)?)\s*bath\b/i
  );

  const squareFeet = getNumber(
    cardText,
    /([\d,]+)\s*sqft\b/i
  );

  /*
   * The address follows the sqft value on RentSmart's
   * cards. Parsing only that tail prevents one card's
   * data from bleeding into another.
   */
  const sqftMatch = cardText.match(
    /[\d,]+\s*sqft\b/i
  );

  if (!sqftMatch) continue;

  const sqftEnd =
    sqftMatch.index + sqftMatch[0].length;

  const addressArea = cardText.slice(sqftEnd);

  const addressMatch = addressArea.match(
    /([1-9]\d{0,5}\s+.{1,80}?\b(?:Street|St|Drive|Dr|Road|Rd|Avenue|Ave|Lane|Ln|Court|Ct|Way|Boulevard|Blvd|Circle|Cir|Place|Pl|Highway|Hwy|Trail|Trl|Terrace|Ter|Parkway|Pkwy)\b(?:,\s*(?:Unit|Apt|#)\s*[A-Za-z0-9-]+)?(?:\s*[-–—]\s*[A-Za-z0-9 ]+?)?)\s+([A-Za-z][A-Za-z .'-]+,\s*SC,?\s*\d{5})\b/i
  );

  if (!addressMatch) {
    console.log(
      `Could not parse address for ${item.url}`
    );
    console.log(`Card: ${cardText}`);
    continue;
  }

  const street = clean(addressMatch[1]);
  const cityStateZip = clean(addressMatch[2])
    .replace(/,\s*SC\s+/i, ", SC, ");

  const address = `${street}, ${cityStateZip}`;

  const rental = {
    address,
    rent,
    bedrooms,
    bathrooms,
    square_feet: squareFeet,
    listing_url: item.url,
  };

  /*
   * Safety checks. Bad data should stop the automation
   * instead of being published to Allo.
   */
  if (
    rent === null ||
    bedrooms === null ||
    bathrooms === null ||
    squareFeet === null
  ) {
    throw new Error(
      `Missing listing data for ${address}`
    );
  }

  if (/\b(?:bed|bath|sqft)\b/i.test(address)) {
    throw new Error(
      `Invalid address detected: ${address}`
    );
  }

  rentals.push(rental);
  processedUrls.add(item.url);
}

if (rentals.length === 0) {
  throw new Error(
    "No current rental listings could be parsed."
  );
}

rentals.sort((a, b) =>
  a.address.localeCompare(b.address)
);

console.log(
  `Parsed ${rentals.length} current rentals:`
);

for (const rental of rentals) {
  console.log(
    `- ${rental.address} | $${rental.rent}/mo | ${rental.bedrooms} bed | ${rental.bathrooms} bath | ${rental.square_feet} sqft | ${rental.listing_url}`
  );
}

const urls = rentals.map(
  (rental) => rental.listing_url
);

if (new Set(urls).size !== urls.length) {
  throw new Error(
    "Duplicate property URLs detected. Refusing to publish."
  );
}

const updatedAt = new Intl.DateTimeFormat(
  "en-US",
  {
    timeZone: "America/New_York",
    dateStyle: "long",
    timeStyle: "short",
  }
).format(new Date());

const sections = rentals
  .map(
    (rental) => `
<section>
  <h2>${escapeHtml(rental.address)}</h2>

  <p><strong>Status:</strong> Available for rent</p>

  <p>
    <strong>Monthly Rent:</strong>
    $${rental.rent.toLocaleString("en-US")}
  </p>

  <p>
    <strong>Bedrooms:</strong>
    ${rental.bedrooms}
  </p>

  <p>
    <strong>Bathrooms:</strong>
    ${rental.bathrooms}
  </p>

  <p>
    <strong>Square Feet:</strong>
    ${rental.square_feet.toLocaleString("en-US")}
  </p>

  <p>
    <strong>RentSmart Listing:</strong>
    <a href="${escapeHtml(rental.listing_url)}">
      ${escapeHtml(rental.listing_url)}
    </a>
  </p>

  <p>
    Use the RentSmart property page for photos,
    additional details, application information,
    and available showing or self-showing options.
  </p>
</section>

<hr>
`
  )
  .join("\n");

const output = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta
    name="viewport"
    content="width=device-width, initial-scale=1"
  >
  <title>PHD Properties Current Rental Listings</title>
</head>

<body>
  <main>
    <h1>PHD Properties Current Rental Listings</h1>

    <p>
      <strong>Last updated:</strong>
      ${escapeHtml(updatedAt)}
    </p>

    <p>
      <strong>Current rental count:</strong>
      ${rentals.length}
    </p>

    <p>
      Automatically generated from the current
      PHD Property Management RentSmart listings.
    </p>

    ${sections}

    <h2>AI Receptionist Instructions</h2>

    <p>
      Use this page as the source of truth for current
      rental availability, rent, bedrooms, bathrooms,
      square footage, and RentSmart listing links.
    </p>

    <p>
      Do not rely on memory for changing rental information.
    </p>

    <p>
      Minor speech-recognition differences may be matched
      when there is only one clear current listing.
      For example, "115 Catherine Drive" may mean
      "115 Kathryn Drive."
    </p>

    <p>
      For normal rental inquiries, answer the caller's
      question and offer to text the exact RentSmart
      property link.
    </p>
  </main>
</body>
</html>`;

await fs.writeFile(
  `${OUTPUT_DIR}/index.html`,
  output
);

await fs.writeFile(
  `${OUTPUT_DIR}/rentals.json`,
  JSON.stringify(
    {
      updated_at: new Date().toISOString(),
      source: SOURCE_URL,
      count: rentals.length,
      rentals,
    },
    null,
    2
  )
);

console.log(
  "Created docs/index.html and docs/rentals.json"
);
