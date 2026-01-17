import express from "express";
import cors from "cors";
import PDFDocument from "pdfkit";

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// PDF endpoint
app.post("/api/pdf", (req, res) => {
  try {
    const title = req.body?.title || "Instagram Kanal Strateji Raporu";
    const content = req.body?.content || "Rapor içeriği boş.";

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=shadowos-report.pdf"
    );

    const doc = new PDFDocument({ margin: 40 });
    doc.pipe(res);

    doc.fontSize(20).text(title, { align: "center" });
    doc.moveDown();
    doc.fontSize(12).text(content);

    doc.end();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "PDF error" });
  }
});

// SERVER START (SADECE 1 KERE)
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
