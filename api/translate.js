// Free server-side translation proxy (Google gtx endpoint, no API key).
// Used by the on-page "Translate to English" button in the reader.
// POST { q: "<text>", source: "auto"|"fr"|... , target: "en" } -> { translated, source }

const GTX = "https://translate.googleapis.com/translate_a/single";

// gtx caps each request at ~5k chars of URL; chunk on paragraph boundaries.
function chunkText(text, max = 1800) {
  const paras = text.split(/\n\n+/);
  const chunks = [];
  let buf = "";
  for (const p of paras) {
    if (p.length > max) {
      // hard-split an oversized paragraph on sentence-ish boundaries
      if (buf) { chunks.push(buf); buf = ""; }
      let rest = p;
      while (rest.length > max) {
        let cut = rest.lastIndexOf(". ", max);
        if (cut < max * 0.5) cut = max;
        chunks.push(rest.slice(0, cut + 1));
        rest = rest.slice(cut + 1);
      }
      if (rest) buf = rest;
    } else if ((buf + "\n\n" + p).length > max) {
      if (buf) chunks.push(buf);
      buf = p;
    } else {
      buf = buf ? buf + "\n\n" + p : p;
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
}

async function translateChunk(q, source, target) {
  const url = `${GTX}?client=gtx&sl=${encodeURIComponent(source)}&tl=${encodeURIComponent(
    target
  )}&dt=t&q=${encodeURIComponent(q)}`;
  const r = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (OpenStacks translate proxy)" },
  });
  if (!r.ok) throw new Error("gtx " + r.status);
  const data = await r.json();
  const detected = data[2] || source;
  const out = (data[0] || []).map((seg) => (seg && seg[0]) || "").join("");
  return { out, detected };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const q = (body && body.q) || "";
  const source = (body && body.source) || "auto";
  const target = (body && body.target) || "en";
  if (!q || q.length > 100000)
    return res.status(400).json({ error: "q missing or too long" });

  try {
    const chunks = chunkText(q);
    const results = [];
    let detected = source;
    // small concurrency to stay polite yet fast
    const POOL = 4;
    for (let i = 0; i < chunks.length; i += POOL) {
      const slice = chunks.slice(i, i + POOL);
      const done = await Promise.all(
        slice.map((c) => translateChunk(c, source, target))
      );
      done.forEach((d) => {
        results.push(d.out);
        if (d.detected && detected === "auto") detected = d.detected;
      });
    }
    res.setHeader("cache-control", "s-maxage=86400, stale-while-revalidate=604800");
    return res.status(200).json({ translated: results.join("\n\n"), source: detected });
  } catch (e) {
    return res.status(502).json({ error: "translation failed: " + e.message });
  }
}
