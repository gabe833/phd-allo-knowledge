import fs from "fs/promises";

const SOURCE_URL =
  "https://app.rentsmart.com/phd-property-management/";

const OUTPUT_DIR = "docs";

await fs.mkdir(OUTPUT_DIR, { recursive: true });

function clean(value = "") {
  return String(value)
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#038;/gi, "&")
    .replace(/&#8211;/g, "–")
    .replace(/&#8217;/g, "'")
    .replace(/&quot;/gi, '"')
    .replace(/<[^>]+>/g, " ")
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

/*
 * Convert enough HTML structure to line breaks that the
 * listing-card text is easier to analyze.
 */
const readable = html
  .replace(/<br\s*\/?>/gi, "\n")
  .replace(/<\/(?:div|p|li|h1|h2|h3|h4|section|article)>/gi, "\n");

const text = clean(
  readable.replace(/\n+/g, " \n ")
);

/*
 * Locate property addresses appearing in the page.
 */
const addressRegex =
  /\b(\d{1,6}\s+[A-Za-z0-9 .,'#-]+?\s(?:Street|St|Drive|Dr|Road|Rd|Avenue|Ave|Lane|Ln|Court|Ct|Way|Boulevard|Blvd|Circle|Cir|Place|Pl|Highway|Hwy|Trail|Trl|Terrace|Ter|Parkway|Pkwy)(?:,\s*(?:Unit|Apt|#)\s*[A-Za-z0-9-]+)?)\s+([A-Za-z .'-]+,\s*SC,?\s*\d{5})/gi;

const addressMatches = [...text.matchAll(addressRegex)];

console.log(
  `Found ${addressMatches.length} address occurrences.`
);

const rentals = [];

for (const match of addressMatches) {
  const street = clean(match[1]);
  const cityStateZip = clean(match[2]);

  /*
   * Get the surrounding listing-card text so we can extract
   * rent, beds, baths, and square footage.
   */
  const index = match.index ?? 0;
  const nearby = text.slice(
    Math.max(0, index - 1000),
    Math.min(text.length, index + 700)
  );

  const rentMatch = nearby.match(
    /\$([\d,]+(?:\.\d{2})?)\s*(?:\/\s*)?(?:mo|month)\b/i
  );

  const bedMatch = nearby.match(
    /(\d+(?:\.\d+)?)\s*bed\b/i
  );

  const bathMatch = nearby.match(
    /(\d+(?:\.\d+)?)\s*bath\b/i
  );

  const sqftMatch = nearby.match(
    /([\d,]+)\s*(?:sqft|sq\.?\s*ft\.?|square feet)\b/i
  );

  if (!rentMatch) {
    continue;
  }

  /*
   * Find links near this property's address in the original HTML.
   * Prefer an individual RentSmart property URL.
   */
  const escapedStreet = street
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .split(/\s+/)
    .slice(0, 3)
    .join("[\\s\\S]{0,100}");

  const propertyAreaRegex = new RegExp(
    `[\\s\\S]{0,2500}${escapedStreet}[\\s\\S]{0,2500}`,
    "i"
  );

  const propertyArea =
    html.match(propertyAreaRegex)?.[0] || "";

  const hrefs = [
    ...propertyArea.matchAll(
      /href=["']([^"']+)["']/gi
    ),
  ]
    .map((m) => absoluteUrl(m[1]))
    .filter(Boolean);

  let listingUrl =
    hrefs.find((url) => {
      try {
        const u = new URL(url);

        return (
          u.hostname === "app.rentsmart.com" &&
          u.pathname.startsWith(
            "/phd-property-management/"
          ) &&
          u.pathname.replace(
            "/phd-property-management/",
            ""
          ).length > 0
        );
      } catch {
        return false;
      }
    }) || "";

  /*
   * Do NOT invent an individual URL if RentSmart does not
   * publish one in the page.
   */
  if (!listingUrl) {
    listingUrl = SOURCE_URL;
  }

  const rental = {
    address: `${street}, ${cityStateZip}`,
    street,
    city_state_zip: cityStateZip,
    rent: Number(
      rentMatch[1].replace(/,/g, "")
    ),
    bedrooms: bedMatch
      ? Number(bedMatch[1])
      : null,
    bathrooms: bathMatch
      ? Number(bathMatch[1])
      : null,
    square_feet: sqftMatch
      ? Number(
          sqftMatch[1].replace(/,/g, "")
        )
      : null,
    listing_url: listingUrl,
  };

  /*
   * Prevent duplicate matches for the same address.
   */
  if (
    !rentals.some(
      (existing) =>
        existing.address.toLowerCase() ===
        rental.address.toLowerCase()
    )
  ) {
    rentals.push(rental);
  }
}

if (rentals.length === 0) {
  await fs.writeFile(
    "rentsmart-debug.html",
    html
  );

  throw new Error(
    "The RentSmart page loaded, but no rental listings could be parsed."
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
    `- ${rental.address} | $${rental.rent}/mo | ${rental.listing_url}`
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

const propertySections = rentals
  .map(
    (rental) => `
<section>
  <h2>${escapeHtml(rental.address)}</h2>

  <p><strong>Status:</strong> Currently listed for rent</p>

  <p>
    <strong>Monthly Rent:</strong>
    $${rental.rent.toLocaleString("en-US")}
  </p>

  ${
    rental.bedrooms !== null
      ? `<p><strong>Bedrooms:</strong> ${rental.bedrooms}</p>`
      : ""
  }

  ${
    rental.bathrooms !== null
      ? `<p><strong>Bathrooms:</strong> ${rental.bathrooms}</p>`
      : ""
  }

  ${
    rental.square_feet !== null
      ? `<p><strong>Square Feet:</strong> ${rental.square_feet.toLocaleString(
          "en-US"
        )}</p>`
      : ""
  }

  <p>
    <strong>RentSmart Listing:</strong>
    <a href="${escapeHtml(
      rental.listing_url
    )}">
      ${escapeHtml(rental.listing_url)}
    </a>
  </p>

  <p>
    Use the RentSmart listing for current photos,
    additional details, application information, and
    available showing or self-showing options.
  </p>
</section>
<hr>
`
  )
  .join("\n");

const outputHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta
    name="viewport"
    content="width=device-width, initial-scale=1"
  >
  <title>PHD Properties Current Rentals</title>
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
      This page is automatically generated from the
      current PHD Property Management RentSmart listings.
    </p>

    ${propertySections}

    <h2>AI Receptionist Instructions</h2>

    <p>
      Use this page as the current source of truth for
      rental availability, rent, bedrooms, bathrooms,
      square footage, and approved RentSmart listing links.
    </p>

    <p>
      Do not rely on memory for changing rental information.
    </p>

    <p>
      Minor speech-recognition differences may be matched
      when there is only one clear current property match.
      For example, "115 Catherine Drive" may mean
      "115 Kathryn Drive."
    </p>

    <p>
      For normal rental inquiries, answer the caller's
      question and offer to text the RentSmart listing link.
      Transfer to Property Management only when the caller
      needs help beyond normal listing information or
      explicitly requests Property Management.
    </p>
  </main>
</body>
</html>`;

await fs.writeFile(
  `${OUTPUT_DIR}/index.html`,
  outputHtml
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
