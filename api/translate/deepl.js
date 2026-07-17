export default async function handler(req, res) {
  const origin = req.headers.origin || "";
  if (origin) res.setHeader("Access-Control-Allow-Origin", origin.includes("theopenstacks.apolochees.me") ? origin : "https://theopenstacks.apolochees.me");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  const { text, sourceLang } = body || {};
  if (!text || !sourceLang) return res.status(400).json({ error: "text and sourceLang required" });
  if (text.length > 15000) return res.status(400).json({ error: "text too long (max 15000 chars)" });

  const DEEPL_KEY = process.env.DEEPL_KEY;
  if (!DEEPL_KEY) return res.status(503).json({ error: "DeepL not configured" });

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
      const detail = await resp.text();
      return res.status(resp.status).json({ error: `DeepL ${resp.status}`, detail });
    }
    const d = await resp.json();
    res.setHeader("cache-control", "s-maxage=86400, stale-while-revalidate=604800");
    return res.status(200).json({ translated: d.translations[0].text, source: "DeepL" });
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
}
