// POST { originalSlug, originalPath, originalTitle, translatedTitle,
//        translatedBody, translatedFrom, translatedType }
// Opens a PR on open-stacks-library with the translated markdown file.

const OWNER = "taynotfound";
const REPO = "open-stacks-library";
const BASE_BRANCH = "main";
const ALLOWED_ORIGIN = "https://theopenstacks.apolochees.me";

// Simple in-memory rate limit: max 3 PRs per IP per hour
const rateLimitMap = new Map();
function checkRateLimit(ip) {
  const now = Date.now();
  const window = 60 * 60 * 1000; // 1 hour
  const max = 3;
  const entry = rateLimitMap.get(ip) || { count: 0, reset: now + window };
  if (now > entry.reset) { entry.count = 0; entry.reset = now + window; }
  if (entry.count >= max) return false;
  entry.count++;
  rateLimitMap.set(ip, entry);
  return true;
}

// Sanitize a string for YAML frontmatter value (no newlines, no quotes)
const sanitizeYaml = s => String(s || "").replace(/[\r\n]/g, " ").replace(/"/g, "'").slice(0, 200);

export default async function handler(req, res) {
  const origin = req.headers.origin || "";
  res.setHeader("Access-Control-Allow-Origin", origin === ALLOWED_ORIGIN ? ALLOWED_ORIGIN : ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  // Rate limit by IP
  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || "unknown";
  if (!checkRateLimit(ip)) return res.status(429).json({ error: "Too many contributions. Try again later." });

  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  if (!GITHUB_TOKEN) return res.status(503).json({ error: "GitHub token not configured" });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }

  const { originalSlug, originalPath, originalTitle, translatedTitle,
          translatedBody, translatedFrom, translatedType } = body || {};

  if (!originalSlug || !originalPath || !translatedBody || !translatedFrom || !translatedType)
    return res.status(400).json({ error: "Missing required fields" });

  // Validate types
  const allowedEngines = ["deepl", "mymemory", "google"];
  if (!allowedEngines.includes(translatedType))
    return res.status(400).json({ error: "Invalid translatedType" });
  if (!/^[a-z]{2}(-[A-Z]{2})?$/.test(translatedFrom))
    return res.status(400).json({ error: "Invalid translatedFrom language code" });
  if (translatedBody.length > 200000)
    return res.status(400).json({ error: "translatedBody too large" });

  const gh = (path, opts = {}) => fetch(`https://api.github.com${path}`, {
    ...opts,
    headers: {
      "Authorization": `Bearer ${GITHUB_TOKEN}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...(opts.headers || {})
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });

  try {
    // 1. Get base branch SHA
    const baseRef = await (await gh(`/repos/${OWNER}/${REPO}/git/ref/heads/${BASE_BRANCH}`)).json();
    const baseSha = baseRef.object?.sha;
    if (!baseSha) return res.status(502).json({ error: "Could not get base branch SHA", detail: baseRef });

    // 2. Create new branch
    const branchName = `translation/${originalSlug}-en-${Date.now()}`;
    const createBranch = await gh(`/repos/${OWNER}/${REPO}/git/refs`, {
      method: "POST",
      body: { ref: `refs/heads/${branchName}`, sha: baseSha }
    });
    if (!createBranch.ok) {
      const d = await createBranch.json();
      return res.status(502).json({ error: "Could not create branch", detail: d });
    }

    // 3. Build translated markdown file
    const category = (originalPath.split("/")[1] || "general").replace(/[^a-zA-Z0-9_-]/g, "");
    const filePath = `books/${category}/${originalSlug}-en.md`;
    const now = new Date().toISOString().split("T")[0];
    const engineLabel = { deepl: "DeepL", mymemory: "MyMemory", google: "Google Translate" }[translatedType] || translatedType;

    const safeTitle = sanitizeYaml(translatedTitle || originalTitle || originalSlug);
    const fileContent = `---\ntitle: "${safeTitle}"\nlanguage: en\ntranslatedType: ${translatedType}\ntranslatedFrom: ${translatedFrom}\noriginalSlug: ${originalSlug}\ntranslationDate: "${now}"\n---\n\n${translatedBody}\n`;

    // 4. Commit the file
    const encoded = Buffer.from(fileContent, "utf8").toString("base64");
    const commitResp = await gh(`/repos/${OWNER}/${REPO}/contents/${filePath}`, {
      method: "PUT",
      body: {
        message: `[Translation] add EN translation of ${originalSlug} (${engineLabel})`,
        content: encoded,
        branch: branchName
      }
    });
    if (!commitResp.ok) {
      const d = await commitResp.json();
      return res.status(502).json({ error: "Could not commit file", detail: d });
    }

    // 5. Open PR
    const prResp = await gh(`/repos/${OWNER}/${REPO}/pulls`, {
      method: "POST",
      body: {
        title: `[Translation] ${safeTitle} (EN, ${engineLabel})`,
        head: branchName,
        base: BASE_BRANCH,
        body: `## Translation Contribution\n\n**Original slug:** \`${originalSlug}\`\n**Original language:** ${translatedFrom}\n**Translation engine:** ${engineLabel}\n**Date:** ${now}\n\nPlease review for accuracy before merging.`
      }
    });
    const pr = await prResp.json();
    if (!prResp.ok) return res.status(502).json({ error: "Could not open PR", detail: pr });

    return res.status(200).json({ prUrl: pr.html_url, prNumber: pr.number });
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
}
