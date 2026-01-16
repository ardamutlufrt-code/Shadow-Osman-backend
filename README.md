# ShadowOS AI Backend (MVP)

Bu backend, Instagram linkinden (best-effort) sayfa meta verilerini çeker ve OpenAI ile:
- Niş tespiti
- Konu kümeleri
- Eksik/gap analizi
- 3 kademeli ürün (PDF → Video → 1:1)
- 30 günlük içerik planı
üretir.

## Kurulum
1) Node.js 18+ kurulu olsun
2) Terminal:

```bash
cd backend
npm install
export OPENAI_API_KEY="YOUR_KEY"
# isteğe bağlı: export OPENAI_MODEL="gpt-4.1-mini"
npm start
```

Backend varsayılan olarak: http://localhost:8787

## Not
Instagram bazen bot isteklerini engelleyebilir. Meta veriler boş dönerse sistem yine tahmini analiz üretir
ama doğruluk düşebilir.
