// server.js (Render-ready, ESM)
// Required env: OPENAI_API_KEY
// Optional env: OPENAI_MODEL (default: gpt-4.1-mini)

import express from "express";
import cors from "cors";
import * as cheerio from "cheerio";
import OpenAI from "openai";

const app = express();

app.use(cors()); // MVP: allow all
app.use(express.json({ limit: "1mb" }));

// Health check
app.get("/health", (req, res) => res.json({ ok: true }));

// Helpers
function normalizeUrl(u) {
  const s = String(u || "").trim();
  if (!s) return "";
  if (s.startsWith("http://") || s.startsWith("https://")) return s;
  return "https://" + s;
}

function isValidInstagramUrl(u) {
  try {
    const url = new URL(u);
    if (!["instagram.com", "www.instagram.com"].includes(url.hostname)) return false;
    return !!url.pathname && url.pathname.length > 1;
  } catch {
    return false;
  }
}

async function fetchPublicMeta(url) {
  // Best-effort with timeout (Instagram may block; that's OK)
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 12000);

  try {
    const resp = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; ShadowOSBot/1.0; +https://shadowos-backend.onrender.com)",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    const html = await resp.text();
    const $ = cheerio.load(html);

    const get = (sel, attr = "content") => $(sel).attr(attr) || "";

    const title =
      get('meta[property="og:title"]') ||
      $("title").text() ||
      get('meta[name="title"]');

    const description =
      get('meta[property="og:description"]') ||
      get('meta[name="description"]');

    const image = get('meta[property="og:image"]');
    const siteName = get('meta[property="og:site_name"]');

    return {
      url,
      title: (title || "").trim(),
      description: (description || "").trim(),
      image: (image || "").trim(),
      siteName: (siteName || "").trim(),
      fetchedOk: resp.ok,
      status: resp.status,
    };
  } catch (e) {
    return {
      url,
      title: "",
      description: "",
      image: "",
      siteName: "",
      fetchedOk: false,
      status: 0,
      error: String(e?.message || e),
    };
  } finally {
    clearTimeout(t);
  }
}

function buildSystemPrompt() {
  return `
You are an Instagram growth strategist.
You will be given best-effort public metadata (title/description) from an Instagram URL.
If data is limited or missing, still provide a reasonable strategy based on assumptions.

Return ONLY a valid JSON object with exactly these keys:
- "niche": string
- "topics": array of 8-15 strings
- "gaps": array of 6-12 strings (content gaps/opportunities)
- "productIdea": string (simple digital product idea)
- "plan30": array of 30 items; each item is an object with:
    - "day": number (1..30)
    - "content": string (post idea)
    - "format": string (Reel/Carousel/Story/Live)
    - "hook": string (first 1-2 lines)
    - "cta": string

Rules:
- Write everything in English.
- Be specific and actionable.
- Do not include extra keys.
`.trim();
}

function buildUserPrompt(meta) {
  return `
Instagram URL: ${meta.url}

Public metadata (best-effort):
- title: ${meta.title || "(empty)"}
- description: ${meta.description || "(empty)"}
- siteName: ${meta.siteName || "(empty)"}

If metadata is empty, infer likely niche from the URL path and propose a generic but useful plan.
`.trim();
}

function safeJsonParse(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, value: text };
  }
}

// API: Analyze
app.post("/api/analyze", async (req, res) => {
  try {
    const inputUrl = normalizeUrl(req.body?.url);

    if (!inputUrl || !isValidInstagramUrl(inputUrl)) {
      return res.status(400).json({ ok: false, error: "Please provide a valid instagram.com URL." });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ ok: false, error: "OPENAI_API_KEY is not set on the server." });
    }

    const meta = await fetchPublicMeta(inputUrl);

    const client = new OpenAI({ apiKey });

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
    const parsed = safeJsonParse(raw);

    if (!parsed.ok) {
      return res.status(500).json({
        ok: false,
        error: "Model did not return valid JSON.",
        raw,
      });
    }

    // IMPORTANT: wrap result the way your Analyzer UI expects
    return res.json({
      ok: true,
      inputUrl,
      meta,
      result: parsed.value,
    });
  } catch (e) {
    console.error("Analyze error:", e);
    return res.status(500).json({
      ok: false,
      error: "Analyze failed.",
      details: String(e?.message || e),
    });
  }
});

// Start server (Render uses PORT env)
const PORT = Number(process.env.PORT || 10000);
app.listen(PORT, () => {
  console.log("ShadowOS backend running on port", PORT);
});
