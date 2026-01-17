import express from "express";
import cors from "cors";
import * as cheerio from "cheerio";
import OpenAI from "openai";
import PDFDocument from "pdfkit";

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const PORT = process.env.PORT || 10000;

// OpenAI client (set in Render Environment: OPENAI_API_KEY)
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function isValidInstagramUrl(url) {
  try {
    const u = new URL(url);
    return (
      ["instagram.com", "www.instagram.com"].includes(u.hostname) &&
      u.pathname &&
      u.pathname !== "/"
    );
  } catch {
    return false;
  }
}

async function fetchPublicMeta(url) {
  // Best-effort: Instagram may block requests sometimes.
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
  const title = $("title").text() || "";

  return { ogTitle, ogDesc, title, fetched: true };
}

function buildSystemPrompt() {
  return `
You are an expert Instagram growth strategist.
Return ONLY valid JSON (no markdown, no extra text). Language: English.

Schema:
{
  "niche": string,
  "topics": string[],
  "strengths": string[],
  "gaps": string[],
  "digital_products": {
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
Analyze this Instagram account using only public metadata.
If metadata is limited, make best-effort inferences and be explicit in "notes".

Instagram URL: ${url}

Public metadata:
- og:title: ${meta.ogTitle}
- og:description: ${meta.ogDesc}
- title tag: ${meta.title}

Return JSON only.
`.trim();
}

// Healthcheck
app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "ShadowOS-backend",
    time: new Date().toISOString(),
  });
});

// Main analyze endpoint (frontend should call this)
app.post("/api/analyze", async (req, res) => {
  try {
    const { url } = req.body || {};

    if (!url || !isValidInstagramUrl(url)) {
      return res.status(400).json({ error: "Please provide a valid Instagram URL." });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({
        error:
          "OPENAI_API_KEY is missing. Add it in Render > Settings > Environment.",
      });
    }

    // Fetch metadata best-effort
    let meta = { ogTitle: "", ogDesc: "", title: "", fetched: false };
    try {
      meta = await fetchPublicMeta(url);
    } catch {
      // If Instagram blocks, we still proceed with AI using empty meta
      meta = { ogTitle: "", ogDesc: "", title: "", fetched: false };
    }

    const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";

    const completion = await openai.chat.completions.create({
      model,
      temperature: 0.7,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: buildSystemPrompt() },
        { role: "user", content: buildUserPrompt(url, meta) },
      ],
    });

    const raw = completion.choices?.[0]?.message?.content || "{}";

    let result;
    try {
      result = JSON.parse(raw);
    } catch {
      result = { error: "AI returned non-JSON output", raw };
    }

    return res.json({ meta, result });
  } catch (err) {
    console.error("Analyze error:", err);
    return res.status(500).json({
      error: "Server error",
      detail: String(err?.message || err),
    });
  }
});

// PDF endpoint (frontend can call this to download a PDF)
app.post("/api/pdf", (req, res) => {
  try {
    const title = req.body?.title || "Instagram Strategy Report";
    const content = req.body?.content || "No content provided.";

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="shadowos-report.pdf"');

    const doc = new PDFDocument({ margin: 40 });
    doc.pipe(res);

    doc.fontSize(20).text(title, { align: "center" });
    doc.moveDown();
    doc.fontSize(12).text(content);

    doc.end();
  } catch (e) {
    console.error("PDF error:", e);
    res.status(500).json({ error: "PDF generation failed." });
  }
});

app.listen(PORT, () => {
  console.log(`ShadowOS backend running on port ${PORT}`);
});
