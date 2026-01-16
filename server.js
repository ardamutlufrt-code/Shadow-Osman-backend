/**
 * ShadowOS AI Backend (MVP)
 * - Fetches public Instagram page HTML (best-effort)
 * - Extracts meta tags (og:title, og:description)
 * - Uses OpenAI to infer niche/topics/gaps + 3-tier product + content plan
 *
 * Run:
 *   cd backend
 *   npm i
 *   OPENAI_API_KEY=xxxxx npm start
 */
import express from "express";
import cors from "cors";
import * as cheerio from "cheerio";
import OpenAI from "openai";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 8787;
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function isValidInstagramUrl(url) {
  try {
    const u = new URL(url);
    return (
      (u.hostname === "www.instagram.com" || u.hostname === "instagram.com") &&
      u.pathname.length > 1
    );
  } catch {
    return false;
  }
}

async function fetchPublicMeta(url) {
  // Best-effort: IG may block some server fetches. We try with headers.
  const res = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0 Safari/537.36",
      "accept":
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "accept-language": "tr-TR,tr;q=0.9,en;q=0.8",
    },
    redirect: "follow",
  });

  const html = await res.text();
  const $ = cheerio.load(html);

  const ogTitle = $('meta[property="og:title"]').attr("content") || "";
  const ogDesc =
    $('meta[property="og:description"]').attr("content") ||
    $('meta[name="description"]').attr("content") ||
    "";

  const ogImage = $('meta[property="og:image"]').attr("content") || "";
  const canonical = $('link[rel="canonical"]').attr("href") || url;

  return {
    canonical,
    ogTitle,
    ogDesc,
    ogImage,
    fetched: Boolean(ogTitle || ogDesc),
    status: res.status,
  };
}

function buildSystemPrompt() {
  return `
Sen "Shadow Operator" adında elit bir Creator Intelligence analizcisisin.
GÖREV: Sadece verilen Instagram linki + sayfa meta verisinden (bio/başlık/özet) yola çıkarak:
1) Kanalın nişini (niche) ve hedef kitlesini kendin tespit et (kullanıcıdan niş sorma).
2) Kanalın hangi konularda içerik ürettiğini çıkar (topic clusters).
3) İçerik boşluklarını ve eksikleri tespit et (özellikle "biliyorum ama yapamıyorum" boşluğu).
4) 3 kademeli ürün modeli üret:
   - Ucuz: PDF / yazılı rehber (9-29$ bandı)
   - Orta: video eğitim paketi (49-149$ bandı)
   - Premium: üreticiyle 1:1 görüşme (199-999$ bandı)
5) Bu ürün modeline hizmet eden 30 günlük Instagram Reels planı üret:
   - Her gün için: Başlık, Hook (ilk 3 sn), Kısa senaryo özeti, CTA
6) Çıktı kesinlikle kopya/şablon gibi görünmesin. Her seferinde linke göre özgün çıkarım yap.

Kısıtlar:
- Yanıt dili Türkçe.
- Jargon kullanma. Somut öneri + net paketler.
- Instagram’a uygun kısa cümleler ama analiz kısmı detaylı.
- Meta veri yetersizse (boşsa), kullanıcıya dürüstçe "kısıtlı veri" de ve en iyi tahmini yap.
`;
}

function buildUserPrompt(meta) {
  return `Instagram URL: ${meta.canonical}
og:title: ${meta.ogTitle}
og:description: ${meta.ogDesc}

Bu meta veriden yola çıkarak analiz + ürün + içerik planı üret.
Çıktıyı aşağıdaki JSON şemasına UYGUN döndür. Başka metin yazma.

JSON Şeması:
{
  "detected_niche": "string",
  "audience": {
    "who": "string",
    "level": "beginner|intermediate|advanced",
    "main_pain_points": ["string", "string", "string"]
  },
  "topic_clusters": [
    {"cluster":"string","weight_pct": number,"example_angles":["string","string","string"]}
  ],
  "missing_gaps": ["string","string","string","string","string"],
  "positioning_sentence": "string",
  "product_ladder": {
    "entry_pdf": {
      "name":"string",
      "price_range":"string",
      "deliverables":["string","string","string"],
      "outline":["string","string","string","string","string"]
    },
    "mid_video": {
      "name":"string",
      "price_range":"string",
      "modules":[{"title":"string","minutes": number,"outcome":"string"}],
      "bonuses":["string","string"]
    },
    "premium_1on1": {
      "name":"string",
      "price_range":"string",
      "who_its_for":["string","string","string"],
      "format":"string",
      "call_structure":["string","string","string","string"]
    }
  },
  "content_plan_30d": [
    {"day":1,"title":"string","hook":"string","script":"string","cta":"string"}
  ]
}
`;
}

app.post("/api/analyze", async (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url || !isValidInstagramUrl(url)) {
      return res.status(400).json({ error: "Geçerli bir Instagram linki gir." });
    }

    const meta = await fetchPublicMeta(url);

    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      temperature: 0.8,
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
      data = { error: "AI çıktısı parse edilemedi.", raw };
    }

    res.json({ meta, data });
  } catch (e) {
    res.status(500).json({ error: "Sunucu hatası", details: String(e?.message || e) });
  }
});

app.get("/health", (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`ShadowOS backend running on http://localhost:${PORT}`);
});
