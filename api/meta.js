// Server-rendered SEO/OG meta for /book/:slug and /gallery/:slug.
// Crawlers (Discord, Twitter, Google) do not run app.js, so we inject
// per-item meta tags into index.html here. Humans get the same HTML and
// the SPA hydrates over it normally.
const OWNER = "taynotfound", REPO = "open-stacks-library", BRANCH = "main";
const RAW = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}`;
const ORIGIN = "https://theopenstacks.apolochees.me";

let cache = null, cacheAt = 0;
async function loadIndex(){
  if(cache && Date.now()-cacheAt < 300000) return cache; // 5 min cache
  const r = await fetch(`${RAW}/index.json`, { headers:{ "accept":"application/json" } });
  if(!r.ok) throw new Error("index.json "+r.status);
  const data = await r.json();
  cache = Array.isArray(data) ? data : (data.books || data.items || []);
  cacheAt = Date.now();
  return cache;
}

const esc = s => String(s==null?"":s)
  .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
  .replace(/"/g,"&quot;");

function pickCover(b){
  // prefer an explicit cover, then a hosted image file, then a gallery image
  if(b.cover) return b.cover.startsWith("http") ? b.cover : `${RAW}/${b.cover}`;
  const cov = (b.files||[]).find(f=>f.hosted && /\.(png|jpe?g|webp|gif)$/i.test(f.url||f.name||""));
  if(cov) return cov.url;
  const img = (b.images||[])[0];
  if(img) return img;
  return `${ORIGIN}/favicon.svg`;
}

export default async function handler(req, res){
  const url = new URL(req.url, ORIGIN);
  const parts = url.pathname.split("/").filter(Boolean); // ["book","slug"]
  const kind = parts[0] || "book";
  const slug = decodeURIComponent(parts[1] || "");

  let html;
  try {
    const r = await fetch("https://raw.githubusercontent.com/taynotfound/the-open-stacks/master/index.html");
    if (!r.ok) throw new Error("index.html fetch " + r.status);
    html = await r.text();
  } catch(e){
    res.status(500).send("index load failed");
    return;
  }

  let b = null;
  try {
    const books = await loadIndex();
    b = books.find(x => x.slug === slug);
  } catch(e){ /* fall through: serve default html */ }

  if(b){
    const title = `${b.title}${b.author?` by ${b.author}`:""} - The Open Stacks`;
    const rawDesc = b.desc || `${b.title}${b.author?` by ${b.author}`:""}, archived on The Open Stacks. Free download, no paywall.`;
    const desc = rawDesc.length>300 ? rawDesc.slice(0,297)+"..." : rawDesc;
    const canon = `${ORIGIN}/${kind}/${encodeURIComponent(b.slug)}`;
    const cover = pickCover(b);
    const isGallery = kind === "gallery" || b.pageType === "gallery";
    const kw = [b.category, b.author, ...(b.tags||[])].filter(Boolean).join(", ");

    const T=esc(title), D=esc(desc), U=esc(canon), IMG=esc(cover), KW=esc(kw);
    const card = "summary_large_image";

    const meta = `
<title>${T}</title>
<meta name="description" content="${D}">
<meta name="keywords" content="${KW}">
<link rel="canonical" href="${U}">
<meta property="og:type" content="${isGallery?"website":"book"}">
<meta property="og:title" content="${T}">
<meta property="og:description" content="${D}">
<meta property="og:url" content="${U}">
<meta property="og:image" content="${IMG}">
<meta property="og:site_name" content="The Open Stacks">
<meta name="twitter:card" content="${card}">
<meta name="twitter:title" content="${T}">
<meta name="twitter:description" content="${D}">
<meta name="twitter:image" content="${IMG}">`.trim();

    // Replace the <title>...</title> and drop the site-default canonical/og
    // block, then inject our per-item block right after <head>.
    html = html.replace(/<title>[\s\S]*?<\/title>/i, "");
    html = html.replace(/<meta name="description"[^>]*>/i, "");
    html = html.replace(/<link rel="canonical"[^>]*>/i, "");
    html = html.replace(/<meta property="og:(title|description|url|type)"[^>]*>/gi, "");
    html = html.replace(/<meta name="twitter:(title|description|card)"[^>]*>/gi, "");
    html = html.replace(/<meta property="og:image"[^>]*>/i, "");
    html = html.replace(/<head>/i, `<head>\n${meta}`);
  }

  res.setHeader("content-type", "text/html; charset=utf-8");
  res.setHeader("cache-control", "public, max-age=0, s-maxage=600, stale-while-revalidate=86400");
  res.status(200).send(html);
}
