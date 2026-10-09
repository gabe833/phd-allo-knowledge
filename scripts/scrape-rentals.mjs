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

    const slug = path.replace(
      "/phd-property-management/",
      ""
    );

    return slug.length > 0 && !slug.includes("/");
  } catch {
    return false;
  }
}

function getNumber(text, regex) {
  const match = text.match(regex);

  if (!match) return null;

  return Number(
    match[1].replace(/,/g, "")
  );
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

console.log(
  `Downloaded ${html.length} characters.`
);

const $ = load(html);

function textWithSpaces(node) {
  const inner = node.html() || "";

  const spaced = inner.replace(
    /<[^>]+>/g,
    " "
  );

  const decoder = load(
    `<div>${spaced}</div>`
  );

  return clean(decoder("div").text());
}

function propertyUrlsInside(node) {
  const urls = new Set();

  function inspect(element) {
    const href = absoluteUrl(
      $(element).attr("href")
    );

    if (isPropertyUrl(href)) {
      urls.add(
        href.replace(/\/+$/, "")
      );
    }
  }

  if (node.is("a[href]")) {
    inspect(node.get(0));
  }

  node.find("a[href]").each(
    (_, element) => inspect(element)
  );

  return urls;
}

function findCard(startElement) {
  let node = $(startElement);

  for (let level = 0; level < 12; level++) {
    const urls =
      propertyUrlsInside(node);

    /*
     * Once an ancestor contains multiple
     * different rental URLs, we've climbed
     * into the listings grid instead of one card.
     */
    if (urls.size > 1) {
      return null;
    }

    const text = textWithSpaces(node);

    const hasRent =
      /\$[\d,]+(?:\.\d{2})?\s*\/?\s*mo\b/i.test(
        text
      );

    const hasBeds =
      /\d+(?:\.\d+)?\s*bed\b/i.test(
        text
      );

    const hasBaths =
      /\d+(?:\.\d+)?\s*bath\b/i.test(
        text
      );

    const hasSqft =
      /[\d,]+\s*sqft\b/i.test(
        text
      );

    const hasState =
      /\bSC,?\s*\d{5}\b/i.test(
        text
      );

    if (
      urls.size === 1 &&
      hasRent &&
      hasBeds &&
      hasBaths &&
      hasSqft &&
      hasState
    ) {
      return node;
    }

    node = node.parent();

    if (!node.length) {
      return null;
    }
  }

  return null;
}

function getElementTexts(node) {
  const results = [];

  const elements = [
    node.get(0),
    ...node.find("*").toArray(),
  ].filter(Boolean);

  for (const element of elements) {
    const text = clean(
      $(element).text()
    );

    if (text) {
      results.push(text);
    }
  }

  return [...new Set(results)];
}

const streetSuffix =
  "(?:Street|St|Drive|Dr|Road|Rd|Avenue|Ave|Lane|Ln|Court|Ct|Way|Boulevard|Blvd|Circle|Cir|Place|Pl|Highway|Hwy|Trail|Trl|Terrace|Ter|Parkway|Pkwy)";

const streetRegex = new RegExp(
  `^\\d{1,6}\\s+.+?\\b${streetSuffix}\\b(?:[ ,–—-]+(?:Unit|Apt|#)?\\s*[A-Za-z0-9-]+)?$`,
  "i"
);

const cityRegex =
  /^[A-Za-z][A-Za-z .'-]+,\s*SC,?\s*\d{5}$/i;

const rawPropertyLinks = [];

$("a[href]").each((_, element) => {
  const url = absoluteUrl(
    $(element).attr("href")
  ).replace(/\/+$/, "");

  if (isPropertyUrl(url)) {
    rawPropertyLinks.push({
      element,
      url,
    });
  }
});

console.log(
  `Found ${rawPropertyLinks.length} property-link occurrences.`
);

const rentals = [];
const processedUrls = new Set();

for (const item of rawPropertyLinks) {
  if (processedUrls.has(item.url)) {
    continue;
  }

  const card = findCard(item.element);

  if (!card) {
    console.log(
      `Could not isolate card for ${item.url}`
    );
    continue;
  }

  const cardText = textWithSpaces(card);

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

  const elementTexts =
    getElementTexts(card);

  /*
   * Find the smallest individual DOM element
   * that looks like the street address.
   */
  const streetCandidates =
    elementTexts
      .filter((text) => {
        if (text.length > 120) {
          return false;
        }

        if (
          /\$|bed|bath|sqft|For Rent/i.test(
            text
          )
        ) {
          return false;
        }

        return streetRegex.test(text);
      })
      .sort(
        (a, b) => a.length - b.length
      );

  /*
   * Same idea for City, SC ZIP.
   */
  const cityCandidates =
    elementTexts
      .filter(
        (text) =>
          text.length < 100 &&
          cityRegex.test(text)
      )
      .sort(
        (a, b) => a.length - b.length
      );

  const street =
    streetCandidates[0];

  const cityStateZip =
    cityCandidates[0];

  if (!street || !cityStateZip) {
    console.log(
      `Could not parse address for ${item.url}`
    );
    console.log(
      `CARD TEXT: ${cardText}`
    );
    continue;
  }

  const normalizedCity =
    cityStateZip.replace(
      /,\s*SC\s+/i,
      ", SC, "
    );

  const normalizedStreet =
    street
      .replace(
        /\s*[–—-]\s*Unit\s*,?\s*/i,
        ", Unit "
      )
      .replace(
        /,\s*Unit,\s*/i,
        ", Unit "
      );

  const address =
    `${normalizedStreet}, ${normalizedCity}`;

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

  rentals.push({
    address,
    rent,
    bedrooms,
    bathrooms,
    square_feet: squareFeet,
    listing_url: item.url,
  });

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

const urls = rentals.map(
  (rental) => rental.listing_url
);

if (
  new Set(urls).size !== urls.length
) {
  throw new Error(
    "Duplicate property URLs detected. Refusing to publish."
  );
}

console.log(
  `Parsed ${rentals.length} current rentals:`
);

for (const rental of rentals) {
  console.log(
    `- ${rental.address} | $${rental.rent}/mo | ${rental.bedrooms} bed | ${rental.bathrooms} bath | ${rental.square_feet} sqft | ${rental.listing_url}`
  );
}

const updatedAt =
  new Intl.DateTimeFormat(
    "en-US",
    {
      timeZone:
        "America/New_York",
      dateStyle: "long",
      timeStyle: "short",
    }
  ).format(new Date());

const sections = rentals
  .map(
    (rental) => `
<section>
  <h2>${escapeHtml(
    rental.address
  )}</h2>

  <p>
    <strong>Status:</strong>
    Available for rent
  </p>

  <p>
    <strong>Monthly Rent:</strong>
    $${rental.rent.toLocaleString(
      "en-US"
    )}
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
    ${rental.square_feet.toLocaleString(
      "en-US"
    )}
  </p>

  <p>
    <strong>RentSmart Listing:</strong>
    <a href="${escapeHtml(
      rental.listing_url
    )}">
      ${escapeHtml(
        rental.listing_url
      )}
    </a>
  </p>

  <p>
    Use the RentSmart property page
    for photos, additional details,
    application information, and
    showing or self-showing options.
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

  <title>
    PHD Properties Current Rental Listings
  </title>
</head>

<body>
  <main>
    <h1>
      PHD Properties Current Rental Listings
    </h1>

    <p>
      <strong>Last updated:</strong>
      ${escapeHtml(updatedAt)}
    </p>

    <p>
      <strong>Current rental count:</strong>
      ${rentals.length}
    </p>

    <p>
      Automatically generated from
      PHD Property Management's current
      RentSmart listings.
    </p>

    ${sections}

    <h2>
      AI Receptionist Instructions
    </h2>

    <p>
      Use this page as the source of truth
      for current rental availability,
      rent, bedrooms, bathrooms, square
      footage, and RentSmart listing links.
    </p>

    <p>
      Do not rely on memory for changing
      rental information.
    </p>

    <p>
      Minor speech-recognition differences
      may be matched when there is only one
      clear current listing. For example,
      "115 Catherine Drive" may mean
      "115 Kathryn Drive."
    </p>

    <p>
      For normal rental inquiries, answer
      the caller's question and offer to
      text the exact RentSmart property link.
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
      updated_at:
        new Date().toISOString(),
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
