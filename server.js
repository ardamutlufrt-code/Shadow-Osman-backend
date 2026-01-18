import express from "express";
import cors from "cors";

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// ✅ Test için: tarayıcıdan açınca çalıştığını görürsün
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

// ✅ Analyzer sayfan buraya istek atacak
app.post("/api/analyze", async (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: "Instagram URL is required" });

  // Şimdilik test sonucu döndürüyor (hatasız çalışsın diye)
  return res.json({
    ok: true,
    inputUrl: url,
    result: {
      niche: "Test output",
      note: "Server is working. Next step: enable real OpenAI analysis."
    }
  });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("Server running on", PORT));
