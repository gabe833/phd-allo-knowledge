import { chromium } from "playwright";
import fs from "fs/promises";
import path from "path";

const BASE_URL =
  "https://app.rentsmart.com/phd-property-management/";

const OUTPUT_DIR = "docs";
const DEBUG_DIR = "debug";

await fs.mkdir(OUTPUT_DIR, { recursive: true });
await fs.mkdir(DEBUG_DIR, { recursive: true });

const browser = await chromium.launch({
  headless: true,
});

const context = await browser.newContext({
  viewport: {
    width: 1440,
    height: 1000,
  },
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36",
});

const page = await context.newPage();

function clean(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function slugToTitle(url) {
  try {
    const pathname = new URL(url).pathname;
    const slug = pathname
      .split("/")
      .filter(Boolean)
      .pop();

    return slug
      .split("-")
      .map((part) => {
        if (/^\d+$/.test(part)) return part;
        return part.charAt(0).toUpperCase() + part.slice(1);
      })
      .join(" ");
  } catch {
    return "Rental Property";
  }
}

function firstMatchingLine(lines, regexes) {
  for (const regex of regexes) {
    const line = lines.find((item) => regex.test(item));
    if (line) return line;
  }
  return "";
}

async function load(url) {
  console.log(`Loading ${url}`);

  await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  await page
    .waitForLoadState("networkidle", {
      timeout: 15000,
    })
    .catch(() => {});

  // Give client-side RentSmart content time to render.
  await page.waitForTimeout(4000);
}

try {
  await load(BASE_URL);

  // Find all individual PHD RentSmart property URLs.
  const rawLinks = await page.locator("a").evaluateAll((anchors) =>
    anchors.map((a) => a.href).filter(Boolean)
  );

  const listingUrls = unique(
    rawLinks
      .map((href) => {
        try {
          const url = new URL(href);
          url.hash = "";

          if (url.hostname !== "app.rentsmart.com") {
            return null;
          }

          const path = url.pathname.replace(/\/+$/, "");

          if (
            !path.startsWith(
              "/phd-property-management/"
            )
          ) {
            return null;
          }

          if (
            path === "/phd-property-management"
          ) {
            return null;
          }

          // Individual listing URLs should contain one slug
          // after /phd-property-management/
          const remainder = path.replace(
            "/phd-property-management/",
            ""
          );

          if (!remainder || remainder.includes("/")) {
            return null;
          }

          return `${url.origin}${path}`;
        } catch {
          return null;
        }
      })
      .filter(Boolean)
  );

  console.log(
    `Found ${listingUrls.length} property URLs`
  );

  if (listingUrls.length === 0) {
    await page.screenshot({
      path: path.join(
        DEBUG_DIR,
        "rentsmart-home.png"
      ),
      fullPage: true,
    });

    await fs.writeFile(
      path.join(DEBUG_DIR, "rentsmart-home.html"),
      await page.content()
    );

    throw new Error(
      "No RentSmart property links were found. Debug files were saved."
    );
  }

  const rentals = [];

  for (const url of listingUrls) {
    try {
      await load(url);

      const bodyText = await page
        .locator("body")
        .innerText();

      const lines = unique(
        bodyText
          .split("\n")
          .map(clean)
          .filter(Boolean)
      );

      const headings = await page
        .locator("h1, h2, h3")
        .allTextContents()
        .catch(() => []);

      const headingLines = headings
        .map(clean)
        .filter(Boolean);

      const streetRegex =
        /^\d{1,6}\s+.+\b(?:Street|St|Drive|Dr|Road|Rd|Avenue|Ave|Lane|Ln|Court|Ct|Way|Boulevard|Blvd|Circle|Cir|Place|Pl|Highway|Hwy|Trail|Trl|Terrace|Ter|Parkway|Pkwy)\b/i;

      let street =
        headingLines.find((line) =>
          streetRegex.test(line)
        ) ||
        lines.find((line) =>
          streetRegex.test(line)
        ) ||
        slugToTitle(url);

      const cityStateZip =
        lines.find((line) =>
          /[A-Za-z .'-]+,\s*SC(?:\s+\d{5})?/i.test(
            line
          )
        ) || "";

      let address = clean(street);

      if (
        cityStateZip &&
        !address
          .toLowerCase()
          .includes(
            cityStateZip.toLowerCase()
          )
      ) {
        address = `${address}, ${cityStateZip}`;
      }

      const rent = firstMatchingLine(lines, [
        /\$[\d,]+(?:\.\d{2})?\s*(?:\/\s*(?:mo|month)|per month)/i,
        /rent.{0,30}\$[\d,]+/i,
        /\$[\d,]+/,
      ]);

      const bedrooms = firstMatchingLine(lines, [
        /\b\d+(?:\.\d+)?\s*(?:bed|beds|bedroom|bedrooms)\b/i,
      ]);

      const bathrooms = firstMatchingLine(lines, [
        /\b\d+(?:\.\d+)?\s*(?:bath|baths|bathroom|bathrooms)\b/i,
      ]);

      const sqft = firstMatchingLine(lines, [
        /\b[\d,]+\s*(?:sq\.?\s*ft\.?|sqft|square feet)\b/i,
      ]);

      const status = firstMatchingLine(lines, [
        /\bavailable now\b/i,
        /\bavailable\b/i,
        /\bfor rent\b/i,
      ]);

      // Pull out useful live listing details without
      // dumping the whole RentSmart interface into Allo.
      const usefulDetails = unique(
        lines.filter((line) =>
          /(pet|showing|self.?show|tour|schedule|apply|application|deposit|available|move.?in|lease|parking|garage|laundry|utilities)/i.test(
            line
          )
        )
      ).slice(0, 20);

      rentals.push({
        address,
        rent,
        bedrooms,
        bathrooms,
        sqft,
        status,
        url,
        details: usefulDetails,
      });

      console.log(`✓ ${address}`);
    } catch (error) {
      console.error(
        `Could not scrape ${url}:`,
        error.message
      );
    }
  }

  if (rentals.length === 0) {
    throw new Error(
      "Property URLs were found, but no property pages could be scraped."
    );
  }

  rentals.sort((a, b) =>
    a.address.localeCompare(b.address)
  );

  const updatedAt = new Intl.DateTimeFormat(
    "en-US",
    {
      timeZone: "America/New_York",
      dateStyle: "long",
      timeStyle: "short",
    }
  ).format(new Date());

  const propertyHtml = rentals
    .map(
      (property) => `
      <section class="property">
        <h2>${escapeHtml(
          property.address
        )}</h2>

        <dl>
          ${
            property.status
              ? `<dt>Status</dt><dd>${escapeHtml(
                  property.status
                )}</dd>`
              : ""
          }

          ${
            property.rent
              ? `<dt>Current Rent</dt><dd>${escapeHtml(
                  property.rent
                )}</dd>`
              : ""
          }

          ${
            property.bedrooms
              ? `<dt>Bedrooms</dt><dd>${escapeHtml(
                  property.bedrooms
                )}</dd>`
              : ""
          }

          ${
            property.bathrooms
              ? `<dt>Bathrooms</dt><dd>${escapeHtml(
                  property.bathrooms
                )}</dd>`
              : ""
          }

          ${
            property.sqft
              ? `<dt>Square Feet</dt><dd>${escapeHtml(
                  property.sqft
                )}</dd>`
              : ""
          }
        </dl>

        ${
          property.details.length
            ? `
              <h3>Additional Current Listing Information</h3>
              <ul>
                ${property.details
                  .map(
                    (detail) =>
                      `<li>${escapeHtml(
                        detail
                      )}</li>`
                  )
                  .join("\n")}
              </ul>
            `
            : ""
        }

        <p>
          <strong>Current RentSmart Listing:</strong>
          <a href="${escapeHtml(
            property.url
          )}">
            ${escapeHtml(property.url)}
          </a>
        </p>

        <p>
          Full property details, application information,
          and available showing/self-showing options should
          be verified on the current RentSmart listing page.
        </p>
      </section>
    `
    )
    .join("\n");

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta
    name="viewport"
    content="width=device-width,initial-scale=1"
  >
  <title>PHD Properties Current Rental Listings</title>
</head>

<body>
  <main>
    <h1>PHD Properties Current Rental Listings</h1>

    <p>
      This page contains the current rental listings
      published by PHD Property Management.
    </p>

    <p>
      <strong>Last successfully updated:</strong>
      ${escapeHtml(updatedAt)}
    </p>

    <p>
      <strong>Number of current listings:</strong>
      ${rentals.length}
    </p>

    <p>
      Source:
      <a href="${BASE_URL}">
        ${BASE_URL}
      </a>
    </p>

    ${propertyHtml}

    <hr>

    <h2>Instructions for PHD Properties AI Receptionist</h2>

    <p>
      Treat this page as the current source of truth for
      PHD Properties rental listings.
    </p>

    <p>
      Do not rely on memory for changing rental information
      such as availability or rent.
    </p>

    <p>
      If a caller's spoken address differs slightly from a
      listing because of speech recognition, use the complete
      context to match it when there is only one clear property.
    </p>

    <p>
      When a caller asks about a current rental, answer normal
      listing questions from this page and offer to text the
      property's exact RentSmart listing URL.
    </p>

    <p>
      The RentSmart listing page is the destination for full
      details, application information, and available
      showing/self-showing options.
    </p>
  </main>
</body>
</html>`;

  await fs.writeFile(
    path.join(OUTPUT_DIR, "index.html"),
    html
  );

  await fs.writeFile(
    path.join(OUTPUT_DIR, "rentals.json"),
    JSON.stringify(
      {
        updated_at: new Date().toISOString(),
        source: BASE_URL,
        count: rentals.length,
        rentals,
      },
      null,
      2
    )
  );

  console.log(
    `Successfully created knowledge page with ${rentals.length} rentals.`
  );
} finally {
  await browser.close();
}
