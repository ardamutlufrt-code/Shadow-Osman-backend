/**
 * ShadowOS AI Backend (PRO) - server.js
 * - POST /api/analyze  { url }  -> returns structured JSON (EN)
 * - POST /api/pdf      { title, content } -> returns a simple PDF
 * - GET  /health       -> ok
 */

import express from "express";
import cors from "cors";
import * as cheerio from "cheerio";
import OpenAI from "openai";
import PDFDocument from "pdfkit";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 10000;

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "",
});

function isValidInstagramUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace("www.", "");
    if (!["instagram.com", "instagr.am"].includes(host)) return false;
    return true;
  } catch {
    return false;
  }
}

async function fetchPublicMeta(url) {
  // Best-effort: Instagram may block bots sometimes.
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  };

  let html = "";
  try {
    const r = await fetch(url, { method: "GET", headers, redirect: "follow" });
    html = await r.text();
  } catch {
    html = "";
  }

  const $ = cheerio.load(html || "");
  const get = (sel, attr = "content") => $(sel).attr(attr) || "";

  const title =
    get('meta[property="og:title"]') ||
    get("title", "text") ||
    $("title").text() ||
    "";
  const description =
    get('meta[property="og:description"]') ||
    get('meta[name="description"]') ||
    "";

  const canonical = $('link[rel="canonical"]').attr("href") || "";

  const ogImage = get('meta[property="og:image"]') || "";

  return {
    inputUrl: url,
    canonical,
    title: (title || "").trim(),
    description: (description || "").trim(),
    ogImage: (ogImage || "").trim(),
    fetched: Boolean(html),
    notes: html
      ? "Public meta fetched (best-effort)."
      : "Could not fetch HTML (Instagram may block). Using best-effort inference.",
  };
}

function buildSystemPrompt() {
  return `
You are "ShadowOS", a world-class Instagram growth strategist and digital-product consultant.
You MUST respond in ENGLISH.
You MUST output STRICT JSON ONLY (no markdown, no comments, no extra keys).
Be specific and actionable. Do not ask the user questions. Infer intelligently from the provided page meta.
If data is missing, make clearly labeled best-effort assumptions with low-risk recommendations.

Return JSON with EXACTLY this schema:

{
  "niche": "string",
  "audience": {
    "primary": "string",
    "secondary": "string"
  },
  "positioning": {
    "one_liner": "string",
    "value_proposition": "string",
    "differentiators": ["string", "string", "string"]
  },
  "content_pillars": [
    { "name": "string", "topics": ["string","string","string","string","string"] },
    { "name": "string", "topics": ["string","string","string","string","string"] },
    { "name": "string", "topics": ["string","string","string","string","string"] }
  ],
  "gaps_and_opportunities": [
    { "gap": "string", "why_it_matters": "string", "fix": "string" },
    { "gap": "string", "why_it_matters": "string", "fix": "string" },
    { "gap": "string", "why_it_matters": "string", "fix": "string" }
  ],
  "digital_product": {
    "tier1_pdf": {
      "name": "string",
      "promise": "string",
      "outline": ["string","string","string","string","string","string"],
      "price_suggestion_usd": 0
    },
    "tier2_video_course": {
      "name": "string",
      "promise": "string",
      "modules": ["string","string","string","string","string","string"],
      "price_suggestion_usd": 0
    },
    "tier3_1to1": {
      "name": "string",
      "deliverables": ["string","string","string","string","string"],
      "price_suggestion_usd": 0
    }
  },
  "30_day_plan": [
    {
      "day": 1,
      "format": "Reel|Carousel|Story|Live",
      "hook": "string",
      "idea": "string",
      "cta": "string"
    }
  ],
  "profile_optimization": {
    "bio_template": "string",
    "highlights": ["string","string","string","string","string"],
    "link_in_bio_funnel": ["string","string","string"]
  },
  "confidence": {
    "level": "low|medium|high",
    "reason": "string"
  }
}

Rules:
- 30_day_plan MUST contain exactly 30 items with day 1..30.
- Keep hooks short and punchy.
- Provide realistic, revenue-focused product ideas.
`.trim();
}

function buildUserPrompt(meta) {
  return `
Analyze this Instagram account based on public meta (best-effort). Produce the JSON schema.

META:
${JSON.stringify(meta, null, 2)}
`.trim();
}

app.get("/health", (req, res) => res.json({ ok: true }));

app.post("/api/analyze", async (req, res) => {
  try {
    const { url } = req.body || {};

    if (!url || !isValidInstagramUrl(url)) {
      return res.status(400).json({ error: "Please provide a valid Instagram URL." });
    }
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY on the server." });
    }

    const meta = await fetchPublicMeta(url);

    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      temperature: 0.7,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: buildSystemPrompt() },
        { role: "user", content: buildUserPrompt(meta) },
      ],
    });

    const raw = completion.choices?.[0]?.message?.content || "{}";

    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return res.status(500).json({
        error: "Model returned non-JSON output.",
        raw,
      });
    }

    return res.json({
      meta,
      analysis: data,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error." });
  }
});

app.post("/api/pdf", (req, res) => {
  try {
    const title = (req.body?.title || "Instagram Strategy Report").toString();
    const content = (req.body?.content || "").toString();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="shadowos-report.pdf"');

    const doc = new PDFDocument({ margin: 40 });
    doc.pipe(res);

    doc.fontSize(20).text(title, { align: "center" });
    doc.moveDown();
    doc.fontSize(12).text(content || "No content provided.");
    doc.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "PDF error" });
  }
});

app.listen(PORT, () => {
  console.log(`ShadowOS backend running on port ${PORT}`);
});
