export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  const { text, sourceLang } = body || {};
  if (!text || !sourceLang) return res.status(400).json({ error: "text and sourceLang required" });

  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.slice(0, 500))}&langpair=${sourceLang}|en`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`MyMemory ${resp.status}`);
    const d = await resp.json();
    if (d.responseStatus !== 200) return res.status(502).json({ error: d.responseDetails });
    res.setHeader("cache-control", "s-maxage=86400, stale-while-revalidate=604800");
    return res.status(200).json({ translated: d.responseData.translatedText, source: "MyMemory" });
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
}
