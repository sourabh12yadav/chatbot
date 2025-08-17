const express = require("express");
const puppeteer = require("puppeteer");
const cors = require("cors");
const fs = require("fs");

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.static("public"));
app.use(express.json());

// Simple in-memory cache with TTL
let cache = { tracking: {}, tariff: {}, discounts: {} };

// Load cache if exists
if (fs.existsSync("cache.json")) {
  cache = JSON.parse(fs.readFileSync("cache.json"));
}

// Save cache periodically
setInterval(() => {
  fs.writeFileSync("cache.json", JSON.stringify(cache, null, 2));
}, 60000);

// Puppeteer browser instance
let browser;
(async () => {
  browser = await puppeteer.launch({ headless: true });
})();

// Utility: check cache TTL
function isCacheValid(entry, ttl) {
  return entry && (Date.now() - entry.timestamp < ttl);
}

/* ======================
   TRACKING
   ====================== */
app.post("/track", async (req, res) => {
  const { trackingNumber } = req.body;
  if (!trackingNumber) return res.json({ error: "No tracking number provided." });

  if (isCacheValid(cache.tracking[trackingNumber], 5 * 60 * 1000)) {
    return res.json(cache.tracking[trackingNumber].data);
  }

  try {
    const page = await browser.newPage();
    await page.goto(`https://www.ups.com/track?tracknum=${trackingNumber}`, {
      waitUntil: "networkidle2"
    });

    const status = await page.$eval(".tracking-summary", el => el.innerText).catch(() => null);
    await page.close();

    const data = status
      ? { type: "tracking", trackingNumber, status }
      : { type: "tracking", trackingNumber, status: "Could not fetch tracking info" };

    cache.tracking[trackingNumber] = { data, timestamp: Date.now() };
    res.json(data);

  } catch (err) {
    console.error(err);
    res.json({ error: "Error fetching tracking info." });
  }
});

/* ======================
   TARIFF
   ====================== */
app.get("/tariff/:country", async (req, res) => {
  const country = req.params.country.toLowerCase();

  if (isCacheValid(cache.tariff[country], 60 * 60 * 1000)) {
    return res.json(cache.tariff[country].data);
  }

  try {
    const page = await browser.newPage();
    await page.goto("https://www.ups.com/hk/en/shipping/zones-and-rates.page", {
      waitUntil: "networkidle2"
    });

    const result = await page.$$eval("table tr", rows => rows.map(r => r.innerText));
    await page.close();

    const info = result.find(r => r.toLowerCase().includes(country)) || `No tariff info found for ${country}`;
    const data = { type: "tariff", country, info };

    cache.tariff[country] = { data, timestamp: Date.now() };
    res.json(data);

  } catch (err) {
    console.error(err);
    res.json({ error: "Failed to fetch tariffs." });
  }
});

/* ======================
   DISCOUNTS
   ====================== */
app.get("/discounts", async (req, res) => {
  if (isCacheValid(cache.discounts.data, 60 * 60 * 1000)) {
    return res.json(cache.discounts.data.data);
  }

  try {
    const page = await browser.newPage();
    await page.goto("https://www.ups.com/hk/en/shipping/special-offers.page", {
      waitUntil: "networkidle2"
    });

    const offers = await page.$$eval(".ups-offer", els => els.map(e => e.innerText.trim()));
    await page.close();

    const data = offers.length
      ? { type: "discounts", offers }
      : { type: "discounts", offers: ["No current discounts found."] };

    cache.discounts.data = { data, timestamp: Date.now() };
    res.json(data);

  } catch (err) {
    console.error(err);
    const fallback = { type: "discounts", offers: ["US: 10%", "CA: 8%", "IL: 12%"] };
    res.json(fallback);
  }
});

/* ======================
   KNOWLEDGE BASE
   ====================== */
const knowledgeBase = {
  "shipping time": "UPS standard shipping time varies by country, typically 2–7 business days.",
  "service alerts": "Check https://www.ups.com/service-alerts for the latest service updates.",
  "packaging info": "UPS provides packaging guidelines at https://www.ups.com/packaging",
  "returns": "You can initiate a return at https://www.ups.com/returns",
  "international shipping": "For international shipments, check customs and documentation requirements on UPS.com"
};

app.post("/kb", (req, res) => {
  const { question } = req.body;
  if (!question) return res.json({ error: "No question provided." });

  const key = Object.keys(knowledgeBase).find(k => question.toLowerCase().includes(k));
  const reply = key
    ? { type: "kb", question, answer: knowledgeBase[key] }
    : { type: "kb", question, answer: "Sorry, I don't have an answer for that." };

  res.json(reply);
});

/* ======================
   SERVER START
   ====================== */
app.listen(PORT, () => console.log(`🚀 UPS Chatbot Server running at http://localhost:${PORT}`));
