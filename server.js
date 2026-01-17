// server.js (FINAL - clean, single listen, English output, Render-ready)
// Requires package.json: "type": "module"
// Deps: express cors cheerio openai pdfkit
// Env: OPENAI_API_KEY (required), OPENAI_MODEL (optional, default gpt-4.1-mini)

import express from "express";
import cors from "cors";
import * as cheerio from "cheerio";
import OpenAI from "openai";
import PDFDocument from "pdfkit";

const app = express();

// ---- Middleware ----
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// ---- Config ----
const PORT = process.env.PORT || 10000;
const MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ---- Helpers ----
function isValidInstagramUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const okHost =
      host === "instagram.com" ||
      host.endsWith(".instagram.com") ||
      host === "www.instagram.com";
    if (!okHost) return false;

    // Allow profile / reel / p / tv
    const path = u.pathname || "/";
    return (
      /^\/[A-Za-z0-9._]+\/?$/.test(path) ||
      /^\/(reel|p|tv)\/[A-Za-z0-9_-]+\/?$/.test(path)
    );
  } catch {
    return false;
  }
}

async function fetchPublicMeta(url) {
  // Best-effort scraping (Instagram may block)
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  };

  try {
    const r = await fetch(url, { method: "GET", headers });
    const html = await r.text();
    const $ = cheerio.load(html);

    const ogTitle = $('meta[property="og:title"]').attr("content") || "";
    const ogDesc = $('meta[property="og:description"]').attr("content") || "";
    const ogSite = $('meta[property="og:site_name"]').attr("content") || "";
    const ogType = $('meta[property="og:type"]').attr("content") || "";
    const ogImage = $('meta[property="og:image"]').attr("content") || "";

    const title = $("title").text() || ogTitle;

    return {
      url,
      status: r.status,
      title: (title || "").slice(0, 500),
      ogTitle: (ogTitle || "").slice(0, 500),
      ogDescription: (ogDesc || "").slice(0, 1500),
      ogSiteName: (ogSite || "").slice(0, 200),
      ogType: (ogType || "").slice(0, 200),
      ogImage: (ogImage || "").slice(0, 500),
      blocked: false,
      note: "",
    };
  } catch (e) {
    return {
      url,
      status: 0,
      title: "",
      ogTitle: "",
      ogDescription: "",
      ogSiteName: "",
      ogType: "",
      ogImage: "",
      blocked: true,
      note:
        "Could not fetch page HTML (possibly blocked by Instagram) — analysis will be best-effort from limited signals.",
      error: String(e?.message || e),
    };
  }
}

function buildSystemPrompt() {
  return `
You are an elite Instagram Growth Strategist and Digital Product Architect.

Goal:
Given an Instagram link and any public meta you can extract, produce:
1) A crisp niche diagnosis (what this creator is about + target audience)
2) Topic clusters (content pillars)
3) Content gaps (what they should post but likely don't)
4) A "cheapest plan" digital product offer (ONLY the cheapest tier; no video production required)
5) A 30-day content plan (reels/posts) with hooks, angle, CTA, and what to sell

Constraints:
- Output MUST be valid JSON.
- Keep it practical, action-oriented, and monetization-focused.
- If scraping is blocked, clearly state assumptions and keep them reasonable.
- Don't mention that you are an AI or refer to OpenAI.
- Language: English.
JSON schema:
{
  "niche": string,
  "audience": string,
  "positioning": string,
  "topic_clusters": string[],
  "content_gaps": string[],
  "cheap_offer": {
    "name": string,
    "price_suggestion_usd": number,
    "deliverables": string[],
    "why_it_sells": string,
    "fulfillment_time": string
  },
  "thirty_day_plan": [
    {
      "day": number,
      "format": "reel" | "post" | "story",
      "hook": string,
      "angle": string,
      "outline": string[],
      "cta": string
    }
  ],
  "notes": string
}
`.trim();
}

function buildUserPrompt(meta) {
  return `
Instagram link: ${meta.url}

Public meta (best-effort):
- HTTP status: ${meta.status}
- title: ${meta.title}
- og:title: ${meta.ogTitle}
- og:description: ${meta.ogDescription}
- og:site_name: ${meta.ogSiteName}
- og:type: ${meta.ogType}
- og:image: ${meta.ogImage}
- blocked: ${meta.blocked}
- note: ${meta.note}

Task:
Infer niche, audience, positioning, topic clusters, content gaps, a cheap digital offer, and a 30-day plan.
Be specific but do not hallucinate detailed facts; if uncertain, phrase as assumptions in "notes".
Return JSON only.
`.trim();
}

function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    // Sometimes model returns code fences or extra text; try to extract first JSON object
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      const slice = text.slice(start, end + 1);
      return JSON.parse(slice);
    }
    throw new Error("Invalid JSON from model.");
  }
}

// ---- Routes ----
app.get("/", (req, res) => {
  res.json({ ok: true, service: "ShadowOS-backend", endpoints: ["/health", "/api/analyze", "/api/pdf"] });
});

app.get("/health", (req, res) => {
  res.json({ ok: true, status: "healthy" });
});

app.post("/api/analyze", async (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url || !isValidInstagramUrl(url)) {
      return res.status(400).json({ error: "Please provide a valid Instagram URL." });
    }
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "OPENAI_API_KEY is missing on the server." });
    }

    const meta = await fetchPublicMeta(url);

    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: 0.8,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: buildSystemPrompt() },
        { role: "user", content: buildUserPrompt(meta) },
      ],
    });

    const raw = completion.choices?.[0]?.message?.content || "{}";
    const data = safeParseJson(raw);

    res.json({
      ok: true,
      meta,
      result: data,
    });
  } catch (e) {
    console.error("Analyze error:", e);
    res.status(500).json({ error: "Analyze failed", details: String(e?.message || e) });
  }
});

// Optional: generate a simple PDF from supplied text
app.post("/api/pdf", (req, res) => {
  try {
    const title = req.body?.title || "Instagram Strategy Report";
    const content = req.body?.content || "";

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="shadowos-report.pdf"');

    const doc = new PDFDocument({ margin: 48 });
    doc.pipe(res);

    doc.fontSize(20).text(title, { align: "center" });
    doc.moveDown();
    doc.fontSize(12).text(content || "Report content is empty.");

    doc.end();
  } catch (e) {
    console.error("PDF error:", e);
    res.status(500).json({ error: "PDF failed", details: String(e?.message || e) });
  }
});

// ---- Start (single listen only) ----
app.listen(PORT, () => {
  console.log(`ShadowOS backend running on port ${PORT}`);
});
