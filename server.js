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
import PDFDocument from "pdfkit";
import * as cheerio from "cheerio";
import OpenAI from "openai";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.post("/api/pdf", (req, res) => {
  try {
    const title = req.body && req.body.title
      ? req.body.title
      : "Instagram Kanal Strateji Raporu";

    const content = req.body && req.body.content
      ? req.body.content
      : "";

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition"
      "attachment; filename=shadowos-report.pdf"
    );

    const doc = new PDFDocument({ margin: 40 });
    doc.pipe(res);

    doc.fontSize(20).text(title, { align: "center" });
    doc.moveDown();
    doc.fontSize(12).text(content, { lineGap: 6 });

    doc.end();
  } catch (err) {
    res.status(500).json({ error: "PDF oluşturulamadı" });
  }
});
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
function buildSystemPrompt() {
  return `
Sen üst seviye bir Instagram Growth, Content Strategy ve Digital Product uzmanı bir AIsin.

GENEL KURALLAR:
- Asla genel geçer cevaplar verme
- Her analiz SADECE bu profile özel olmalı
- Aynı link bile gelse farklı açılardan düşün
- Varsayım yapıyorsan bunu açıkça belirt
- Nişi kullanıcıdan ASLA sorma, sen çıkar

ÇIKTI ZORUNLULUKLARI:
- Her bölümde somut gerekçe yaz
- Örnekler üret (hook, başlık, CTA)
- Dijital ürüne dönüştürülebilir şekilde anlat

ROLÜN:
Bir danışman gibi konuş, rapor hazırlar gibi yaz.
`;



function buildUserPrompt(meta) {
  return `function buildUserPrompt(meta) {
  return `
Aşağıdaki Instagram profil verilerine göre DERİN bir analiz yap:

PROFİL VERİLERİ:
- Sayfa başlığı: ${meta.title || "Bilinmiyor"}
- Açıklama (bio): ${meta.description || "Yok"}
- Sayfa dili ve tonu: çıkarım yap
- Tekrar eden temalar: çıkarım yap

İSTENEN ÇIKTI:

1) NET NİŞ ANALİZİ  
- Ana niş
- Alt nişler
- Hedef kitlenin temel problemi

2) KANITLI İÇERİK OKUMASI  
- Bio’dan çıkarımlar
- Dil ve konumlandırma
- En az 5 somut sinyal

3) GAP (EKSİK) ANALİZİ  
- Üretilmeyen ama ihtiyaç olan 5 konu
- Her konu neden kritik?

4) 3 KADEMELİ DİJİTAL ÜRÜN  
🟢 PDF (ucuz)
🟡 Video eğitim (orta)
🔴 1:1 mentorluk (premium)

Her paket için:
- Ürün adı
- Ne çözer
- Neden alınmalı

5) 30 GÜNLÜK İÇERİK PLANI  
Her gün için:
- Konu
- Hook
- Ana mesaj
- CTA

Türkçe yaz.
Profesyonel, mentor tonu kullan.
`;

app.listen(PORT, () => {
  console.log(`ShadowOS backend running on http://localhost:${PORT}`);
});
