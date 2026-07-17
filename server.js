const express = require("express");
const fetch = require("node-fetch");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3232;
const DEEPL_KEY = process.env.DEEPL_KEY || "REDACTED";

app.use(express.json({ limit: "1mb" }));

// Serve static frontend files
app.use(express.static(path.join(__dirname), {
  index: "index.html",
  extensions: ["html"]
}));

// Translation proxy - DeepL
app.post("/api/translate/deepl", async (req, res) => {
  const { text, sourceLang } = req.body || {};
  if (!text || !sourceLang) return res.status(400).json({ error: "text and sourceLang required" });
  try {
    const resp = await fetch("https://api-free.deepl.com/v2/translate", {
      method: "POST",
      headers: {
        "Authorization": `DeepL-Auth-Key ${DEEPL_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ text: [text], source_lang: sourceLang.toUpperCase(), target_lang: "EN" })
    });
    if (!resp.ok) {
      const body = await resp.text();
      return res.status(resp.status).json({ error: `DeepL ${resp.status}`, detail: body });
    }
    const d = await resp.json();
    res.json({ translated: d.translations[0].text, source: "DeepL" });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Translation proxy - MyMemory (no key needed, just proxying to avoid CORS)
app.post("/api/translate/mymemory", async (req, res) => {
  const { text, sourceLang } = req.body || {};
  if (!text || !sourceLang) return res.status(400).json({ error: "text and sourceLang required" });
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.slice(0, 500))}&langpair=${sourceLang}|en`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`MyMemory ${resp.status}`);
    const d = await resp.json();
    if (d.responseStatus !== 200) return res.status(502).json({ error: d.responseDetails });
    res.json({ translated: d.responseData.translatedText, source: "MyMemory" });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));

// SPA fallback - clean paths like /book/slug -> index.html
app.use((req, res) => {
  if (req.path.includes(".")) return res.status(404).send("Not found");
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => console.log(`The Open Stacks running on http://localhost:${PORT}`));
