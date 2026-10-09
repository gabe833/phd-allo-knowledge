const url = "https://app.rentsmart.com/phd-property-management/";

const response = await fetch(url, {
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36",
    "Accept":
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
  },
});

const html = await response.text();

console.log("Status:", response.status);
console.log("HTML length:", html.length);

console.log(
  "Human challenge:",
  /confirm you are human|not a robot/i.test(html)
);

console.log(
  "Found Kathryn:",
  /115\s+Kathryn\s+Drive/i.test(html)
);

console.log(
  "Found Groveland:",
  /1992\s+Groveland\s+Avenue/i.test(html)
);

console.log(
  "Found rental count:",
  /\b4\s+Rentals\b/i.test(html)
);
