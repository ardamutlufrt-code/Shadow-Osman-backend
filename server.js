Harika ✅ O zaman server.js’yi sıfırdan, temiz ve Render uyumlu hale getiriyoruz.

Aşağıdaki adımları aynen yap:

⸻

1) GitHub’da server.js → TAMAMINI SİL → BUNU YAPIŞTIR

import express from "express";
import cors from "cors";
import * as cheerio from "cheerio";
import OpenAI from "openai";
import PDFDocument from "pdfkit";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Render PORT
const PORT = process.env.PORT || 10000;

// OpenAI (Render Env: OPENAI_API_KEY)
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function isValidInstagramUrl(url) {
  try {
    const u = new URL(url);
    return (
      ["instagram.com", "www.instagram.com"].includes(u.hostname) &&
      u.pathname.length > 1
    );
  } catch {
    return false;
  }
}

async function fetchPublicMeta(url) {
  // Instagram bazen botları engeller; bu best-effort
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
    },
  });

  const html = await res.text();
  const $ = cheerio.load(html);

  const ogTitle = $('meta[property="og:title"]').attr("content") || "";
  const ogDesc = $('meta[property="og:description"]').attr("content") || "";
  const ogType = $('meta[property="og:type"]').attr("content") || "";
  const title = $("title").text() || "";

  return {
    ogTitle,
    ogDesc,
    ogType,
    title,
    fetched: true,
  };
}

function buildSystemPrompt() {
  return `
You are an expert Instagram growth strategist.
Return ONLY valid JSON (no markdown, no extra text).
Language: English.

Schema:
{
  "niche": string,
  "topics": string[],
  "strengths": string[],
  "gaps": string[],
  "three_tier_offer": {
    "basic": {"name": string, "price_suggestion": string, "includes": string[]},
    "standard": {"name": string, "price_suggestion": string, "includes": string[]},
    "premium": {"name": string, "price_suggestion": string, "includes": string[]}
  },
  "content_plan_30_days": Array<{
    "day": number,
    "format": "Reel"|"Carousel"|"Story"|"Live",
    "title": string,
    "hook": string,
    "cta": string
  }>,
  "notes": string
}
`.trim();
}

function buildUserPrompt(url, meta) {
  return `
Analyze this Instagram account from public metadata.

URL: ${url}

Meta:
- og:title: ${meta.ogTitle}
- og:description: ${meta.ogDesc}
- title: ${meta.title}

If metadata is limited, make best-effort inferences and be explicit in "notes".
Return JSON only.
`.trim();
}

// Healthcheck
app.get("/", (req, res) => {
  res.json({ ok: true, service: "ShadowOS-backend", time: new Date().toISOString() });
});

// Main analyze endpoint (frontend bunu çağırıyor)
app.post("/api/analyze", async (req, res) => {
  try {
    const { url } = req.body || {};

    if (!url || !isValidInstagramUrl(url)) {
      return res.status(400).json({ error: "Geçerli bir Instagram linki gir." });
    }

    // OPENAI_API_KEY yoksa hızlı hata verelim (Render env kontrol)
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({
        error: "OPENAI_API_KEY eksik. Render > Settings > Environment'a ekle.",
      });
    }

    let meta = { fetched: false, ogTitle: "", ogDesc: "", ogType: "", title: "" };
    try {
      meta = await fetchPublicMeta(url);
    } catch (e) {
      // IG engellediyse meta boş kalabilir; yine de AI ile üretiriz
      meta = { fetched: false, ogTitle: "", ogDesc: "", ogType: "", title: "" };
    }

    const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";

    const completion = await openai.chat.completions.create({
      model,
      temperature: 0.7,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: buildSystemPrompt() },
        { role: "user", content: buildUserPrompt(url, meta)
