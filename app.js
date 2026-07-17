/* Open Stacks - repo-watching client.
 * Lazy skeleton loading, honest file labels, per-page SEO,
 * inline HTML/image rendering, big galleries, target=_blank everywhere.
 */
const OWNER = "taynotfound", REPO = "open-stacks-library", BRANCH = "main";
const API = `https://api.github.com/repos/${OWNER}/${REPO}`;
const RAW = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}`;
const ZIPBALL = `https://github.com/${OWNER}/${REPO}/archive/refs/heads/${BRANCH}.zip`;
const ORIGIN = (typeof location!=="undefined" && location.origin && location.origin.startsWith("http")) ? location.origin : "https://theopenstacks.apolochees.me";
const DEEPL_KEY = "REDACTED";
const DEEPL_URL = "https://api-free.deepl.com/v2/translate";
const TX_PROXY = ""; // same-origin — calls go to /api/translate/*

const el = id => document.getElementById(id);
let books = [], fState = "all", fCat = null, fLang = null, fSort = "alpha", bySlug = {};
const LANG_NAMES = {en:"English",de:"Deutsch",fr:"Francais",es:"Espanol",it:"Italiano",pt:"Portugues",zh:"Chinese",ru:"Russian",bg:"Bulgarian",nl:"Nederlands",pl:"Polski"};

// ---- translation (multi-source: DeepL Free -> MyMemory fallback) ----
const TX_CACHE_PREFIX = "os_tx_";

async function translateDeepL(text, sourceLang) {
  const resp = await fetch(`${TX_PROXY}/translate/deepl`, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({text, sourceLang})
  });
  if (!resp.ok) throw new Error(`DeepL proxy ${resp.status}`);
  const d = await resp.json();
  if (d.error) throw new Error(d.error);
  return d.translated;
}

async function translateMyMemory(text, sourceLang) {
  const resp = await fetch(`${TX_PROXY}/api/translate/mymemory`, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({text, sourceLang})
  });
  if (!resp.ok) throw new Error(`MyMemory proxy ${resp.status}`);
  const d = await resp.json();
  if (d.error) throw new Error(d.error);
  return d.translated;
}

// Google Translate (unofficial API - sends data to Google servers)
async function translateGoogle(text, sourceLang) {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sourceLang}&tl=en&dt=t&q=${encodeURIComponent(text.slice(0,4500))}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Google ${resp.status}`);
  const d = await resp.json();
  // response is nested arrays: [[["translated","original",...],...],...]
  return d[0].map(seg => seg[0]).join("");
}

// Splits text into chunks of ~4000 chars at paragraph boundaries, translates each, rejoins.
async function translateText(text, sourceLang, engine) {
  const cacheKey = TX_CACHE_PREFIX + engine + "_" + sourceLang + "_" + btoa(encodeURIComponent(text.slice(0,80))).slice(0,32);
  const cached = localStorage.getItem(cacheKey);
  if (cached) return {text: cached, source: "cache"};

  // chunk at blank lines, max ~4000 chars per chunk
  const paras = text.split(/\n{2,}/);
  const chunks = [];
  let cur = "";
  for (const p of paras) {
    if (cur.length + p.length > 3800 && cur) { chunks.push(cur.trim()); cur = ""; }
    cur += (cur ? "\n\n" : "") + p;
  }
  if (cur.trim()) chunks.push(cur.trim());

  const translated = [];
  for (const chunk of chunks) {
    let result, usedSource;
    if (engine === "google") {
      result = await translateGoogle(chunk, sourceLang);
      usedSource = "Google Translate";
    } else {
      try {
        result = await translateDeepL(chunk, sourceLang);
        usedSource = "DeepL";
      } catch(e) {
        console.warn("DeepL failed, trying MyMemory:", e.message);
        try {
          result = await translateMyMemory(chunk, sourceLang);
          usedSource = "MyMemory";
        } catch(e2) {
          result = `[Translation failed: ${e2.message}]`;
          usedSource = "error";
        }
      }
    }
    translated.push({text: result, source: usedSource});
  }

  const full = translated.map(t => t.text).join("\n\n");
  const sources = [...new Set(translated.map(t => t.source).filter(s => s !== "error"))];
  localStorage.setItem(cacheKey, full);
  return {text: full, source: sources.join(" + ") || "error"};
}
const BMK_KEY = "os_bookmarks";
let bookmarks = new Set();
try{ bookmarks = new Set(JSON.parse(localStorage.getItem(BMK_KEY)||"[]")); }catch(e){}
function isBmk(slug){ return bookmarks.has(slug); }
function toggleBmk(slug){
  if(bookmarks.has(slug)) bookmarks.delete(slug); else bookmarks.add(slug);
  try{ localStorage.setItem(BMK_KEY, JSON.stringify([...bookmarks])); }catch(e){}
  return bookmarks.has(slug);
}
// ---- reading progress (localStorage) ----
const RP_KEY = "os_progress";
let progress = {};
try{ progress = JSON.parse(localStorage.getItem(RP_KEY)||"{}"); }catch(e){}
function saveProgress(slug, pct){ progress[slug]=pct; try{ localStorage.setItem(RP_KEY, JSON.stringify(progress)); }catch(e){} }

// ---- Lunr full-text index (built lazily from search-index.json) ----
let lunrIdx = null, lunrDocs = {}, lunrLoading = null;
function loadLunr(){
  if(lunrIdx || lunrLoading) return lunrLoading || Promise.resolve();
  if(typeof lunr==="undefined") return Promise.resolve();
  lunrLoading = fetch(`${RAW}/search-index.json`).then(r=>r.ok?r.json():null).then(data=>{
    if(!data || !data.docs) return;
    lunrIdx = lunr(function(){
      this.ref("slug"); this.field("title",{boost:6}); this.field("author",{boost:3});
      this.field("tags",{boost:2}); this.field("text");
      data.docs.forEach(d=>{ lunrDocs[d.slug]=d; this.add(d); });
    });
  }).catch(()=>{});
  return lunrLoading;
}
const PAGE = 100;   // books rendered per page; search still indexes ALL of them
let shown = PAGE, lastView = [];
function resetAndRender(){ shown = PAGE; renderList(); }

function parseFront(md){
  const m = md.match(/^---\n([\s\S]*?)\n---/);
  if(!m) return {meta:{}, body:md};
  const body = md.slice(m[0].length).trim();
  const lines = m[1].split("\n");
  const meta = {tags:[], files:[], images:[], links:[]};
  let mode=null, cur=null;
  const unq = s => s.replace(/^["']|["']$/g,"").replace(/\\"/g,'"');
  for(const ln of lines){
    if(/^tags:\s*$/.test(ln)){mode="tags";continue;}
    if(/^files:\s*$/.test(ln)){mode="files";continue;}
    if(/^images:\s*$/.test(ln)){mode="images";continue;}
    if(/^links:\s*$/.test(ln)){mode="links";continue;}
    if(/^(files|tags|images|links):\s*\[\]/.test(ln)){mode=null;continue;}
    if(mode==="tags" && /^\s*-\s/.test(ln)){meta.tags.push(unq(ln.replace(/^\s*-\s*/,"")));continue;}
    if(mode==="images" && /^\s*-\s/.test(ln)){meta.images.push(unq(ln.replace(/^\s*-\s*/,"")));continue;}
    if(mode==="links"){
      if(/^\s*-\s*url:/.test(ln)){cur={};meta.links.push(cur);cur.url=unq(ln.split(/url:/)[1].trim());continue;}
      const lm = ln.match(/^\s+(text):\s*(.*)$/);
      if(lm && cur){cur.text=unq(lm[2].trim());continue;}
    }
    if(mode==="files"){
      if(/^\s*-\s*name:/.test(ln)){cur={};meta.files.push(cur);cur.name=unq(ln.split(/name:/)[1].trim());continue;}
      const fm = ln.match(/^\s+(type|url|hosted):\s*(.*)$/);
      if(fm && cur){cur[fm[1]] = fm[1]==="hosted" ? /true/.test(fm[2]) : unq(fm[2].trim());continue;}
    }
    const kv = ln.match(/^(\w+):\s*(.*)$/);
    if(kv){mode=null;meta[kv[1]] = unq(kv[2].trim());}
  }
  return {meta, body};
}

function firstPara(body){
  const lines = body.split("\n").filter(l=>l.trim() && !l.startsWith("#") && !l.startsWith("**") && !l.startsWith("- ") && !l.startsWith("["));
  return lines[0] ? lines[0] : "";
}
const esc = s => (s||"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const slugify = s => s.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,80);

// honest file-type label from name/url/type
function fileLabel(f){
  const src = (f.name||"")+" "+(f.url||"");
  const m = src.match(/\.(pdf|epub|mobi|azw3|doc|docx|odt|rtf|txt|html?|zip)(\?|#|$)/i);
  if(m) return m[1].toUpperCase().replace("HTM","HTML");
  if(/html/i.test(f.type||"")) return "HTML";
  return (f.type||"FILE").toUpperCase();
}

function humanSize(n){
  if(!n || n<0) return "";
  const u=["B","KB","MB","GB","TB"]; let i=0;
  while(n>=1024 && i<u.length-1){ n/=1024; i++; }
  return (i===0? Math.round(n) : n.toFixed(1))+" "+u[i];
}

async function loadTree(){
  const head = await fetch(`${API}/commits/${BRANCH}`).then(r=>r.json());
  const sha = head.sha;
  const cacheKey = "libcom_index_"+sha;
  const cached = localStorage.getItem(cacheKey);
  if(cached){ return {books: JSON.parse(cached), sha, cached:true}; }
  // ONE request: prebuilt index.json (metadata only, no bodies). Bodies are lazy-loaded per book.
  el("sub").textContent = "loading index…";
  const out = await fetch(`${RAW}/index.json`).then(r=>{
    if(!r.ok) throw new Error("index.json "+r.status);
    return r.json();
  });
  Object.keys(localStorage).filter(k=>k.startsWith("libcom_books_")||k.startsWith("libcom_index_")).forEach(k=>localStorage.removeItem(k));
  try{ localStorage.setItem(cacheKey, JSON.stringify(out)); }catch(e){}
  return {books: out, sha, cached:false};
}

// lazy-load a single book's full body (markdown after front-matter) only when opened
async function ensureBody(b){
  if(b.body!==undefined) return b.body;
  if(!b.hasBody){ b.body=""; return ""; }
  try{
    const txt = await fetch(`${RAW}/${b.path.split("/").map(encodeURIComponent).join("/")}`).then(r=>r.ok?r.text():"");
    b.body = parseFront(txt).body || "";
  }catch(e){ b.body=""; }
  return b.body;
}

function coverEl(b, big){
  if(b.cover) return `<img class="cover${big?' big':''}" src="${esc(b.cover)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'cover ph${big?' big':''}'}))">`;
  return `<div class="cover ph${big?' big':''}"></div>`;
}

function itemKind(b){ return (b.pageType==="gallery" || (b.images && b.images.length && !(b.files&&b.files.length))) ? "gallery" : "book"; }
function itemPath(b){ return `/${itemKind(b)}/${encodeURIComponent(b.slug)}`; }
function itemHash(b){ return itemPath(b); }

function cardHTML(b){
  const pct = progress[b.slug];
  return `<a class="card" href="${itemHash(b)}">
      ${coverEl(b)}
      <button class="bmk cardbmk${isBmk(b.slug)?' on':''}" data-bmk="${esc(b.slug)}" title="Save" aria-label="Save"><i class="fa-${isBmk(b.slug)?'solid':'regular'} fa-bookmark"></i></button>
      ${b.atRisk?`<span class="risk"><i class="fa-solid fa-triangle-exclamation fa-inline"></i>at risk</span>`:""}
      ${b.pageType==="gallery"?`<span class="gtag"><i class="fa-solid fa-images fa-inline"></i>gallery</span>`:""}
      <div class="cardbody">
        <div class="ctitle"><span class="dot ${b.state}"></span>${esc(b.title)}</div>
        <div class="cmeta">${b.author?esc(b.author)+" · ":""}${b.files.length} file(s)${pct?` · <span class="rp">${pct}% read</span>`:""}</div>
      </div>
    </a>`;
}
function skeletonHTML(){
  return `<div class="card skel"><div class="cover sk"></div><div class="cardbody"><div class="sk line"></div><div class="sk line short"></div></div></div>`;
}

let io = null;
function renderList(){
  setSEO("The Open Stacks - an anti-censorship library","Host what they'd erase. A growing, multi-source archive of books and articles at risk of being taken down.", location.href.split("#")[0]);
  const q = el("q").value.toLowerCase().trim();
  // Recently-added strip only makes sense on the unfiltered home view.
  const rc = el("recent");
  if(rc) rc.style.display = (!q && fState==="all" && !fCat && !fLang) ? "" : "none";
  // Full-text rank set (Lunr) - only when a query is present AND index is ready.
  let ftRank = null;
  if(q && lunrIdx){
    try{
      const hits = lunrIdx.search(q.split(/\s+/).map(t=>t.length>1?t+"*":t).join(" "));
      ftRank = new Map(hits.map((h,i)=>[h.ref, i]));
    }catch(e){ ftRank = null; }
  }
  let view = books.filter(b=>{
    if(fState==="saved"){ if(!isBmk(b.slug)) return false; }
    else if(fState==="risk"){ if(!b.atRisk) return false; }
    else if(fState!=="all" && b.state!==fState) return false;
    if(fCat && b.category!==fCat) return false;
    if(fLang && (b.language||"en")!==fLang) return false;
    if(q){
      // Lunr full-text match (title/author/tags/BODY) OR cheap metadata substring fallback.
      const metaHit = (b.title+" "+b.author+" "+b.tags.join(" ")).toLowerCase().includes(q);
      if(ftRank){ if(!ftRank.has(b.slug) && !metaHit) return false; }
      else if(!metaHit) return false;
    }
    return true;
  });
  if(ftRank){
    // rank by full-text relevance; metadata-only hits sink to the bottom, then alpha
    view.sort((a,b)=>{
      const ra = ftRank.has(a.slug)?ftRank.get(a.slug):1e9;
      const rb = ftRank.has(b.slug)?ftRank.get(b.slug):1e9;
      return ra!==rb ? ra-rb : (a.title.toLowerCase()<b.title.toLowerCase()?-1:1);
    });
  } else if(fSort === "newest") {
    view.sort((a,b)=>(b.added||0)-(a.added||0));
  } else if(fSort === "oldest") {
    view.sort((a,b)=>(a.added||0)-(b.added||0));
  } else if(fSort === "lang") {
    view.sort((a,b)=>{
      const la = a.language||"en", lb = b.language||"en";
      return la!==lb ? la.localeCompare(lb) : a.title.toLowerCase().localeCompare(b.title.toLowerCase());
    });
  } else {
    view.sort((a,b)=>a.title.toLowerCase()<b.title.toLowerCase()?-1:1);
  }
  lastView = view;
  // paginate: render up to `shown` (grows by PAGE), but search still indexed ALL books above
  const page = view.slice(0, shown);
  el("count").textContent = view.length===page.length
    ? `${view.length} item${view.length===1?"":"s"}`
    : `showing ${page.length} of ${view.length} items`;
  el("list").className = "grid";
  // lazy skeleton render: place skeletons, swap in real cards as they scroll near viewport
  if(io) io.disconnect();
  el("list").innerHTML = page.map((b,i)=>`<div class="slot card skel" data-i="${i}"><div class="cover sk"></div><div class="cardbody"><div class="sk line"></div><div class="sk line short"></div></div></div>`).join("") || `<div class="loading">No books match.</div>`;
  const slots = [...el("list").querySelectorAll(".slot")];
  io = new IntersectionObserver((entries,obs)=>{
    entries.forEach(en=>{
      if(en.isIntersecting){
        const i = +en.target.dataset.i;
        en.target.outerHTML = cardHTML(page[i]);
        obs.unobserve(en.target);
      }
    });
  }, {rootMargin:"600px"});
  slots.forEach(s=>io.observe(s));
  // load-more control
  let more = el("more");
  if(!more){ more = document.createElement("div"); more.id="more"; el("list").after(more); }
  if(view.length > page.length){
    more.innerHTML = `<button id="moreBtn">Load more (${view.length-page.length} more)</button>`;
    el("moreBtn").addEventListener("click",()=>{ shown += PAGE; renderList(); });
    more.style.display="";
  } else { more.style.display="none"; }
}

// safe markdown->html for scraped body.
// headings, blockquotes, hr, ordered/unordered lists, bold, italic, code,
// footnote refs, links, images. XSS-safe: everything is escaped, then a small
// whitelist of inline formatting is re-applied via placeholder tokens.
function mdInline(s){
  // s is already HTML-escaped. Restore a whitelist of inline formatting.
  // links + images were pre-extracted to tokens by the block pass.
  // code spans first so their contents aren't further formatted
  s = s.replace(/`([^`]+)`/g, (m,c)=>`<code>${c}</code>`);
  // bold (**x** or __x__) then italic (*x* or _x_)
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  s = s.replace(/(^|[^\w_])_([^_\n]+)_(?![\w_])/g, "$1<em>$2</em>");
  // footnote refs like [1] or [12] -> subtle superscript
  s = s.replace(/\[(\d{1,3})\]/g, '<sup class="fnref">$1</sup>');
  return s;
}
function headSlug(s){
  return "h-" + String(s).toLowerCase().replace(/<[^>]+>/g,"").replace(/[^\w\s-]/g,"").trim().replace(/\s+/g,"-").slice(0,60);
}
// build a table-of-contents from rendered content HTML (h2/h3 with ids)
function buildTOC(contentHtml){
  const heads = [...contentHtml.matchAll(/<h([234]) id="([^"]+)">(.*?)<\/h[234]>/g)]
    .map(m=>({lv:+m[1], id:m[2], txt:m[3].replace(/<[^>]+>/g,"").trim()}))
    .filter(h=>h.txt);
  if(heads.length < 3) return "";  // only worth it for long, multi-chapter texts
  const min = Math.min(...heads.map(h=>h.lv));
  const items = heads.map(h=>`<li class="toc-l${h.lv-min+2}"><a href="#${h.id}">${esc(h.txt)}</a></li>`).join("");
  return `<details class="toc" open><summary><i class="fa-solid fa-list-ul fa-inline"></i>Contents (${heads.length})</summary><ul>${items}</ul></details>`;
}
function mdToHtml(md){
  if(!md) return "";
  // 1) extract links + images to placeholder tokens BEFORE escaping so their
  //    URLs/text survive escaping and inline formatting untouched.
  const tokens = [];
  const stash = html => { tokens.push(html); return `\u0000${tokens.length-1}\u0000`; };
  md = md.replace(/!\[([^\]]*)\]\(<?(https?:\/\/[^)\s>]+)>?\)/g,
    (m,alt,u)=>stash(`<img class="inl" loading="lazy" src="${esc(u)}" alt="${esc(alt)}">`));
  md = md.replace(/\[([^\]]+)\]\(<?(https?:\/\/[^)\s>]+)>?\)/g,
    (m,tx,u)=>stash(`<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(tx)}</a>`));

  const restore = s => s.replace(/\u0000(\d+)\u0000/g,(m,i)=>tokens[+i]);
  // ensure ATX headings / hr sitting on their own line become their own block
  // even when the source only left a single newline around them.
  md = md.replace(/([^\n])\n(#{1,6}\s)/g, "$1\n\n$2").replace(/(#{1,6}[^\n]*)\n(?!\n)/g, "$1\n\n");
  const out = [];
  const blocks = md.split(/\n{2,}/);
  for(let raw of blocks){
    let t = raw.replace(/\s+$/,"");
    if(!t.trim()) continue;

    // horizontal rule
    if(/^\s*([-*_])\s*(\1\s*){2,}$/.test(t.trim())){ out.push("<hr>"); continue; }

    // heading
    const h = t.trim().match(/^(#{1,6})\s+(.*)$/);
    if(h){ const lv=Math.min(h[1].length+1,6); const txt=restore(mdInline(esc(h[2].trim()))); const id=headSlug(h[2].trim()); out.push(`<h${lv} id="${id}">${txt}</h${lv}>`); continue; }

    // blockquote (one or more > lines)
    if(/^\s*>/.test(t)){
      const inner = t.split("\n").map(l=>l.replace(/^\s*>\s?/,"")).join("\n");
      out.push(`<blockquote>${restore(mdInline(esc(inner)).replace(/\n/g,"<br>"))}</blockquote>`);
      continue;
    }

    // unordered list
    if(/^\s*[-*+]\s+/.test(t) && t.split("\n").every(l=>/^\s*[-*+]\s+/.test(l)||!l.trim())){
      const lis = t.split("\n").filter(l=>l.trim()).map(l=>`<li>${restore(mdInline(esc(l.replace(/^\s*[-*+]\s+/,""))))}</li>`).join("");
      out.push(`<ul>${lis}</ul>`); continue;
    }
    // ordered list
    if(/^\s*\d+[.)]\s+/.test(t) && t.split("\n").every(l=>/^\s*\d+[.)]\s+/.test(l)||!l.trim())){
      const lis = t.split("\n").filter(l=>l.trim()).map(l=>`<li>${restore(mdInline(esc(l.replace(/^\s*\d+[.)]\s+/,""))))}</li>`).join("");
      out.push(`<ol>${lis}</ol>`); continue;
    }

    // pure image paragraph
    const esced = restore(mdInline(esc(t)));
    if(/^\s*<img/.test(esced)) { out.push(`<p class="imgwrap">${esced}</p>`); continue; }

    out.push(`<p>${esced.replace(/\n/g,"<br>")}</p>`);
  }
  return out.join("");
}

function setSEO(title, desc, url){
  document.title = title;
  const set=(sel,attr,val)=>{let e=document.head.querySelector(sel);if(!e){e=document.createElement(sel.startsWith("link")?"link":"meta");if(sel.startsWith("link"))e.rel="canonical";else if(sel.includes("property"))e.setAttribute("property",sel.match(/"(.*?)"/)[1]);else e.name=sel.match(/"(.*?)"/)[1];document.head.appendChild(e);}e.setAttribute(attr,val);};
  set('meta[name="description"]',"content",desc);
  set('meta[property="og:title"]',"content",title);
  set('meta[property="og:description"]',"content",desc);
  set('meta[property="og:url"]',"content",url);
  set('meta[name="twitter:title"]',"content",title);
  set('meta[name="twitter:description"]',"content",desc);
  set('link[rel="canonical"]',"href",url);
}

// inject per-item structured data (JSON-LD) so each work is independently indexable
function setItemJsonLd(b, url){
  let s = document.getElementById("item-jsonld");
  if(!s){ s=document.createElement("script"); s.type="application/ld+json"; s.id="item-jsonld"; document.head.appendChild(s); }
  const isGallery = b.pageType==="gallery";
  const data = {
    "@context":"https://schema.org",
    "@type": isGallery ? "ImageGallery" : (b.files && b.files.length ? "Book" : "Article"),
    "name": b.title,
    "headline": b.title,
    "url": url,
    "mainEntityOfPage": url,
    "description": b.desc || `${b.title}${b.author?" by "+b.author:""}, archived on The Open Stacks.`,
    "isPartOf": {"@type":"CollectionPage","name":"The Open Stacks","url":ORIGIN+"/"},
    "publisher": {"@type":"Organization","name":"The Open Stacks","url":ORIGIN+"/"},
    "genre": b.category,
    "keywords": (b.tags||[]).join(", ")
  };
  if(b.author) data.author = {"@type":"Person","name":b.author};
  if(b.sourceName) data.sourceOrganization = {"@type":"Organization","name":b.sourceName};
  if(b.source) data.sameAs = b.source;
  const dl = (b.files||[]).find(f=>f.hosted);
  if(dl) data.associatedMedia = {"@type":"MediaObject","contentUrl":dl.url};
  Object.keys(data).forEach(k=>{ if(data[k]===undefined||data[k]==="") delete data[k]; });
  s.textContent = JSON.stringify(data);
}
function clearItemJsonLd(){ const s=document.getElementById("item-jsonld"); if(s) s.textContent="{}"; }

async function renderBook(slug){
  const b = bySlug[slug];
  if(!b){ el("list").className=""; el("list").innerHTML = `<div class="loading">Not found. <a href="#/"><i class="fa-solid fa-arrow-left fa-inline"></i>back</a></div>`; return; }
  await ensureBody(b);
  const canon = `${ORIGIN}${itemPath(b)}`;
  setSEO(`${b.title} - The Open Stacks`, b.desc || `${b.title}${b.author?" by "+b.author:""}, archived on The Open Stacks.`, canon);
  setItemJsonLd(b, canon);
  el("list").className = "detail";
  const gallery = b.pageType==="gallery" || (b.images.length && !b.files.length);
  const srcName = b.sourceName || (b.source.includes("libcom.org") ? "libcom.org" : (b.source.match(/\/\/([^\/]+)/)||[])[1] || "source");

  const files = b.files.map(f=>{
    const cls = f.hosted?' class="host"':'';
    const sz = f.size?humanSize(f.size):"";
    const tag = (f.hosted?" · self-hosted":"") + (sz?" · "+sz:"");
    return `<a${cls} href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">${esc(fileLabel(f))}<span class="fn">${esc(f.name)}${tag}</span></a>`;
  }).join("");
  const tags = b.tags.map(t=>`<span class="tag">${esc(t)}</span>`).join("");
  const imgs = b.images.length ? `<div class="gallery${gallery?' big':''}" id="gal">${b.images.map((u,i)=>`<a href="${esc(u)}" data-lb="${i}"><img loading="lazy" src="${esc(u)}" alt=""></a>`).join("")}</div>` : "";
  const outlinks = b.links.length ? `<h3 class="dh">Links from this page</h3><ul class="outlinks">${b.links.map(l=>`<li><a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.text||l.url)} <i class="fa-solid fa-arrow-up-right-from-square"></i></a></li>`).join("")}</ul>` : "";
  const contentHtml = b.body && b.body.length>40 ? mdToHtml(b.body) : "";
  const content = contentHtml ? `<div class="content">${contentHtml}</div>` : "";
  const toc = contentHtml ? buildTOC(contentHtml) : "";
  // downloads block, reused at top (and we drop the old bottom one)
  const dlBlock = files ? `<h3 class="dh">Downloads</h3><div class="dlfiles">${files}</div>` : "";
  // self-hosted HTML files -> read inline. raw/jsDelivr force text/plain, so we fetch and inject via srcdoc (renders as HTML).
  const htmlFile = b.files.find(f=>f.hosted && /\.html?($|\?|#)/i.test((f.url||"")+ " " + (f.name||"")) || (f.hosted && /html/i.test(f.type||"")));
  const reader = htmlFile ? `<h3 class="dh">Read here</h3><div class="reader"><iframe id="htmlReader" loading="lazy" title="${esc(b.title)}" sandbox="allow-popups allow-popups-to-escape-sandbox"></iframe></div><p class="cmeta"><a href="${esc(htmlFile.url)}" target="_blank" rel="noopener noreferrer">Open raw file in new tab <i class="fa-solid fa-arrow-up-right-from-square"></i></a></p>` : "";

  const hostedFiles = b.files.filter(f=>f.hosted);
  const needsTranslation = b.language && b.language !== "en";
  // find any already-merged translations for this book (originalSlug === b.slug)
  const existingTranslations = (window.__IDX||[]).filter(e => e.originalSlug === b.slug && e.language === "en");
  const langSwitcher = existingTranslations.length
    ? `<div class="lang-switcher"><i class="fa-solid fa-earth-europe fa-inline"></i>Available in: <strong>${(LANG_NAMES[b.language]||b.language.toUpperCase())}</strong>${existingTranslations.map(t=>`<a href="/book/${t.slug}" class="lang-link">English (${t.translatedType||'translated'})</a>`).join("")}</div>`
    : "";
  const dlActs = `<div class="detail-acts">
      <button id="printBtn"><i class="fa-solid fa-print fa-inline"></i>Print / PDF</button>
      ${hostedFiles.length?`<button id="dlItemBtn"><i class="fa-solid fa-download fa-inline"></i>Download file${hostedFiles.length>1?'s ('+hostedFiles.length+')':''}</button>`:""}
      ${needsTranslation?`<span class="tx-row"><button id="txBtn"><i class="fa-solid fa-language fa-inline"></i>Translate to English</button><select id="txSrc" title="Translation source"><option value="deepl">DeepL + MyMemory</option><option value="google" class="tx-google-opt">Google Translate ⚠</option></select></span>`:""}
    </div>`;

  el("list").innerHTML = `
    <a class="back" href="#/"><i class="fa-solid fa-arrow-left fa-inline"></i>all books</a>
    ${b.atRisk?`<div class="riskbar"><i class="fa-solid fa-triangle-exclamation fa-inline"></i><strong>Mirrored because it's at risk.</strong> This work faces takedown, banning, or restricted access somewhere. We keep a readable copy.</div>`:""}
    <div class="bookhead">
      ${gallery?"":coverEl(b, true)}
      <div class="bookinfo">
        <h2><span class="dot ${b.state}"></span>${esc(b.title)}</h2>
        ${b.author?`<div class="cmeta">by ${esc(b.author)}</div>`:""}
        <div class="cmeta">in <a href="#/">${esc(b.category)}</a>${gallery?' · <i class=\"fa-solid fa-images\"></i> image page':""}</div>
        <div class="cmeta srcline">source: <a href="${esc(b.source)}" target="_blank" rel="noopener noreferrer">${esc(srcName)}</a></div>
        <div class="tags">${tags}</div>
        <button class="bmk detailbmk${isBmk(b.slug)?' on':''}" data-bmk="${esc(b.slug)}"><i class="fa-${isBmk(b.slug)?'solid':'regular'} fa-bookmark fa-inline"></i>${isBmk(b.slug)?'Saved':'Save'}</button>
      </div>
    </div>
    ${dlActs}
    ${langSwitcher}
    ${b.desc?`<p class="desc">${esc(b.desc)}</p>`:""}
    ${dlBlock}
    ${imgs}
    ${toc}
    ${reader}
    ${content}
    ${(!dlBlock && b.files.length===0 && !imgs && !content)?`<p class="cmeta">No files mirrored yet.</p>`:""}
    ${outlinks}
    <p class="orig"><a href="${esc(b.source)}" target="_blank" rel="noopener noreferrer">View at original source (${esc(srcName)}) <i class="fa-solid fa-arrow-up-right-from-square"></i></a></p>`;
  if (htmlFile) {
    const fr = document.getElementById("htmlReader");
    fetch(htmlFile.url).then(r=>r.text()).then(html=>{
      // strip any base/target that could break framing; ensure readable width
      const wrapped = `<!doctype html><meta charset="utf-8"><base target="_blank"><style>body{max-width:820px;margin:0 auto;padding:24px 28px;font:16px/1.7 Georgia,serif;color:#1a1a1a;background:#fff}img{max-width:100%;height:auto}</style>` + html;
      fr.srcdoc = wrapped;
    }).catch(()=>{ fr.srcdoc = "<p style='font-family:sans-serif;padding:20px'>Could not load the text. Use the link below.</p>"; });
  }
  // print / download-item wiring
  const pb = document.getElementById("printBtn");
  if(pb) pb.addEventListener("click", ()=>window.print());
  const dib = document.getElementById("dlItemBtn");
  if(dib) dib.addEventListener("click", ()=>{
    hostedFiles.forEach((f,i)=>setTimeout(()=>{
      const a = document.createElement("a");
      a.href = f.url; a.download = f.name || ""; a.rel = "noopener";
      document.body.appendChild(a); a.click(); a.remove();
    }, i*350));
  });
  // translate button: replaces .content with English translation on demand
  const txb = document.getElementById("txBtn");
  if(txb && needsTranslation) {
    const langName = LANG_NAMES[b.language] || b.language.toUpperCase();
    txb.addEventListener("click", async () => {
      const contentEl = el("list").querySelector(".content");
      if(!contentEl){ txb.textContent = "No text to translate"; txb.disabled=true; return; }
      // toggle back to original
      if(txb.dataset.translated === "1") {
        contentEl.innerHTML = contentHtml;
        txb.innerHTML = `<i class="fa-solid fa-language fa-inline"></i>Translate to English`;
        txb.dataset.translated = "0";
        return;
      }
      const engine = (document.getElementById("txSrc") || {}).value || "deepl";
      // explicit Google consent gate
      if(engine === "google") {
        const ok = confirm("⚠ Google Translate will send this text to Google's servers.\n\nAre you sure you want to use Google Translate?");
        if(!ok) return;
      }
      txb.disabled = true;
      txb.innerHTML = `<i class="fa-solid fa-spinner fa-spin fa-inline"></i>Translating...`;
      try {
        const {text: translated, source} = await translateText(b.body || contentEl.innerText, b.language, engine);
        contentEl.innerHTML = mdToHtml(translated);
        const googleNote = source.includes("Google") ? " · <strong>your text was sent to Google</strong>" : "";
        const badge = `<div class="tx-badge"><i class="fa-solid fa-language fa-inline"></i>Translated to English via ${source}${googleNote} · <button id="contributeBtn" class="tx-contribute"><i class="fa-solid fa-code-pull-request fa-inline"></i>Contribute translation</button></div>`;
        contentEl.insertAdjacentHTML("afterbegin", badge);
        txb.innerHTML = `<i class="fa-solid fa-rotate-left fa-inline"></i>Show original (${langName})`;
        txb.dataset.translated = "1";
        txb.dataset.translatedText = translated;
        txb.dataset.engine = source.toLowerCase().includes("deepl") ? "deepl" : source.toLowerCase().includes("mymemory") ? "mymemory" : "google";
        // wire contribute button
        const cb = document.getElementById("contributeBtn");
        if(cb) cb.addEventListener("click", async () => {
          cb.disabled = true;
          cb.innerHTML = `<i class="fa-solid fa-spinner fa-spin fa-inline"></i>Opening PR...`;
          try {
            const resp = await fetch("/api/contribute-translation", {
              method: "POST",
              headers: {"Content-Type":"application/json"},
              body: JSON.stringify({
                originalSlug: b.slug,
                originalPath: b.path,
                originalTitle: b.title,
                translatedTitle: null,
                translatedBody: translated,
                translatedFrom: b.language,
                translatedType: txb.dataset.engine
              })
            });
            const data = await resp.json();
            if(!resp.ok) throw new Error(data.error || "Unknown error");
            cb.innerHTML = `<i class="fa-solid fa-check fa-inline"></i>PR opened!`;
            cb.onclick = () => window.open(data.prUrl, "_blank");
            cb.disabled = false;
          } catch(e) {
            cb.innerHTML = `<i class="fa-solid fa-code-pull-request fa-inline"></i>Contribute translation`;
            cb.disabled = false;
            alert("Could not open PR: " + e.message);
          }
        });
      } catch(e) {
        txb.innerHTML = `<i class="fa-solid fa-language fa-inline"></i>Translate to English`;
        alert("Translation failed: " + e.message);
      }
      txb.disabled = false;
    });
  }
  // gallery lightbox
  if(b.images.length) initLightbox(b.images, b.title);
  // reading-progress: track scroll depth through readable content, persist %.
  if(contentHtml){
    let rpTick = false;
    const trackRP = ()=>{
      rpTick = false;
      const doc = document.documentElement;
      const max = doc.scrollHeight - doc.clientHeight;
      const pct = max>0 ? Math.min(100, Math.round(doc.scrollTop / max * 100)) : 0;
      if(pct > (progress[b.slug]||0) || pct>=98) saveProgress(b.slug, pct);
    };
    window.__rpHandler && window.removeEventListener("scroll", window.__rpHandler);
    window.__rpHandler = ()=>{ if(!rpTick){ rpTick=true; requestAnimationFrame(trackRP); } };
    window.addEventListener("scroll", window.__rpHandler, {passive:true});
  } else if(window.__rpHandler){
    window.removeEventListener("scroll", window.__rpHandler); window.__rpHandler=null;
  }
  window.scrollTo(0,0);
}

// ---- gallery lightbox ----
let lbState = {imgs:[], i:0, title:""};
function initLightbox(imgs, title){
  lbState = {imgs, i:0, title:title||""};
  const gal = document.getElementById("gal");
  if(!gal) return;
  gal.querySelectorAll("a[data-lb]").forEach(a=>{
    a.addEventListener("click", e=>{ e.preventDefault(); openLightbox(+a.dataset.lb); });
  });
}
function openLightbox(i){
  lbState.i = i;
  el("lightbox").classList.add("on");
  el("lightbox").setAttribute("aria-hidden","false");
  document.body.style.overflow = "hidden";
  showLightbox();
}
function closeLightbox(){
  el("lightbox").classList.remove("on");
  el("lightbox").setAttribute("aria-hidden","true");
  document.body.style.overflow = "";
}
function stepLightbox(d){
  const n = lbState.imgs.length;
  lbState.i = (lbState.i + d + n) % n;
  showLightbox();
}
function showLightbox(){
  const n = lbState.imgs.length;
  el("lbImg").src = lbState.imgs[lbState.i];
  el("lbCount").textContent = n>1 ? `${lbState.i+1} / ${n}` : "";
  el("lbCap").textContent = lbState.title;
  const multi = n>1;
  el("lbPrev").style.display = multi?"flex":"none";
  el("lbNext").style.display = multi?"flex":"none";
}
function renderStats(){
  setSEO("Stats - The Open Stacks","A live breakdown of The Open Stacks: how many items, what kinds, which sources, and how much we actually self-host.", location.href.split("#")[0]);
  el("list").className = "detail";
  const total = books.length;
  const byType = {}, byCat = {}, bySrc = {}, byState = {full:0,partial:0,none:0};
  let hostedFiles=0, totalFiles=0, images=0, atRisk=0, hostedBytes=0;
  books.forEach(b=>{
    const t = b.pageType || "other";
    byType[t]=(byType[t]||0)+1;
    byCat[b.category]=(byCat[b.category]||0)+1;
    const s = b.sourceName || "unknown";
    bySrc[s]=(bySrc[s]||0)+1;
    if(byState[b.state]!==undefined) byState[b.state]++;
    (b.files||[]).forEach(f=>{ totalFiles++; if(f.hosted){ hostedFiles++; hostedBytes += (f.size||0); } });
    images += (b.images||[]).length;
    if(b.atRisk) atRisk++;
  });
  const typeLabel = {book:'<i class="fa-solid fa-book fa-inline"></i>books',article:'<i class="fa-solid fa-newspaper fa-inline"></i>articles',gallery:'<i class="fa-solid fa-images fa-inline"></i>galleries',stub:'<i class="fa-solid fa-bookmark fa-inline"></i>pointers',other:'<i class="fa-solid fa-file-lines fa-inline"></i>other'};
  const bar = (rows, unit) => {
    const max = Math.max(...rows.map(r=>r[1]),1);
    return rows.map(([k,v])=>`
      <div class="statrow">
        <div class="statlabel">${k}</div>
        <div class="stattrack"><div class="statfill" style="width:${(v/max*100).toFixed(1)}%"></div></div>
        <div class="statval">${v.toLocaleString()}${unit||""}</div>
      </div>`).join("");
  };
  const bigStat = (n,l) => `<div class="bigstat"><div class="bignum">${n}</div><div class="biglabel">${l}</div></div>`;
  const catRows = Object.entries(byCat).sort((a,b)=>b[1]-a[1]).map(([k,v])=>[esc(k),v]);
  const srcRows = Object.entries(bySrc).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([k,v])=>[esc(k),v]);
  const typeRows = Object.entries(byType).sort((a,b)=>b[1]-a[1]).map(([k,v])=>[typeLabel[k]||esc(k),v]);
  const hostPct = totalFiles?Math.round(hostedFiles/totalFiles*100):0;

  el("list").innerHTML = `
    <a class="back" href="#/"><i class="fa-solid fa-arrow-left fa-inline"></i>all items</a>
    <h1 class="stath1"><i class="fa-solid fa-chart-column fa-inline"></i>What's actually in here</h1>
    <p class="statlede">This isn't just books. It's a living archive of radical texts, articles, galleries, and pointers to sources at risk of being erased. Numbers below are computed live from the repo index, no rounding up.</p>

    <div class="bigstats">
      ${bigStat(total.toLocaleString(),"total items")}
      ${bigStat(catRows.length,"categories")}
      ${bigStat(hostedFiles.toLocaleString(),"self-hosted files")}
      ${bigStat(humanSize(hostedBytes)||"–","of archived files")}
      ${bigStat(images.toLocaleString(),"images archived")}
      ${bigStat(atRisk,"flagged at risk")}
      ${bigStat(Object.keys(bySrc).length,"distinct sources")}
    </div>

    <h2 class="stath2">By type</h2>
    <div class="statgroup">${bar(typeRows)}</div>

    <h2 class="stath2">How much we actually hold</h2>
    <p class="statnote">Honesty matters. "Full copy" = we archived the whole thing. "Linked only" = we point you to the real source and never pretend it's ours.</p>
    <div class="statgroup">${bar([['<i class="fa-solid fa-circle-check fa-inline" style="color:var(--grn)"></i>Full copy',byState.full],['<i class="fa-solid fa-circle-half-stroke fa-inline" style="color:var(--amb)"></i>Partial',byState.partial],['<i class="fa-regular fa-circle fa-inline" style="color:var(--mut)"></i>Linked only',byState.none]])}</div>
    <p class="statnote">${hostedFiles.toLocaleString()} of ${totalFiles.toLocaleString()} files (${hostPct}%) are physically mirrored on our servers${hostedBytes?` - <strong>${humanSize(hostedBytes)}</strong> of books, PDFs and EPUBs`:""}, safe from takedown. <a href="${ZIPBALL}">Download the whole archive as a zip <i class="fa-solid fa-file-zipper fa-inline"></i></a></p>

    <h2 class="stath2">By category</h2>
    <div class="statgroup">${bar(catRows)}</div>

    <h2 class="stath2">Top sources</h2>
    <p class="statnote">We're multi-source by design. Every item credits where it came from.</p>
    <div class="statgroup">${bar(srcRows)}</div>

    <div class="statcta">
      <p>See a gap? <a href="#/contribute">Add to the stacks <i class="fa-solid fa-arrow-right"></i></a></p>
    </div>
  `;
  window.scrollTo(0,0);
}

// ---- Contribute page: how to add to the library ----
function renderContribute(){
  setSEO("Contribute - The Open Stacks","Add a book, article, or at-risk source to The Open Stacks. Drop a Markdown file in the repo and push. The index rebuilds itself.", location.href.split("#")[0]);
  el("list").className = "detail";
  const repo = `https://github.com/${OWNER}/${REPO}`;
  el("list").innerHTML = `
    <a class="back" href="#/"><i class="fa-solid fa-arrow-left fa-inline"></i>all items</a>
    <h1 class="stath1"><i class="fa-solid fa-plus fa-inline"></i>Add to the stacks</h1>
    <p class="statlede">The library is a public Git repo. Anyone can add to it. No account on this site, no gatekeepers, no paywall. If you can write a text file, you can preserve something.</p>

    <div class="contribgrid">
      <div class="contribstep">
        <div class="stepnum">1</div>
        <h3>Fork the repo</h3>
        <p>Everything lives in <a href="${repo}" target="_blank" rel="noopener noreferrer">${OWNER}/${REPO}</a>. Fork it, or clone it if you have write access.</p>
        <a class="btn ghost" href="${repo}/fork" target="_blank" rel="noopener noreferrer"><i class="fa-brands fa-github fa-inline"></i>Fork on GitHub</a>
      </div>
      <div class="contribstep">
        <div class="stepnum">2</div>
        <h3>Drop a Markdown file</h3>
        <p>Add one <code>.md</code> file under <code>books/&lt;category&gt;/</code>. Filename becomes the slug. That's the whole schema.</p>
      </div>
      <div class="contribstep">
        <div class="stepnum">3</div>
        <h3>Commit with <code>[new]</code></h3>
        <p>Start your commit message with <code>[new]</code>. That's the trigger. A GitHub Action rebuilds the index and this site updates automatically, usually within a couple minutes.</p>
      </div>
    </div>

    <h2 class="stath2">The file format</h2>
    <p class="statnote">Front-matter (between the <code>---</code> lines) plus a body. Only <code>title</code> and <code>source</code> are truly required. Here's a full example:</p>
    <pre class="codeblock">---
title: "The Title Here"
author: "Author or Organization"
category: "surveillance"
source: "https://real-verified-url.example/"
source_name: "Where It Came From"
mirror_state: none
linked_only: true
tags:
 - "one-tag"
 - "another-tag"
files: []
---

# The Title Here

**Source:** Where It Came From

A couple of honest sentences about what this is and why it
matters. No fabricated quotes, no fake claims.

[View original source](https://real-verified-url.example/)</pre>

    <h2 class="stath2">The rules (they're short)</h2>
    <ul class="contribrules">
      <li><b>Be honest about hosting.</b> If you're just linking, set <code>mirror_state: none</code> and <code>linked_only: true</code>. Never label a pointer as a full copy.</li>
      <li><b>Verify every URL.</b> Dead or fabricated links get rejected. Check it loads before you push.</li>
      <li><b>No fabricated quotes</b> from real, named people.</li>
      <li><b>Prefer at-risk material.</b> Things being censored, defunded, or quietly deleted are exactly what belongs here. Flag them with <code>at_risk: true</code>.</li>
      <li><b>No harm content.</b> This is about exposing lies and preserving knowledge, not weapons or drug recipes.</li>
      <li><b>Credit the source.</b> Nothing here is claimed as ours.</li>
    </ul>

    <div class="statcta">
      <p>Ready? <a href="${repo}" target="_blank" rel="noopener noreferrer">Open the repo <i class="fa-solid fa-arrow-right"></i></a> · or just <a href="${repo}/new/main/books" target="_blank" rel="noopener noreferrer">create a file in the browser <i class="fa-solid fa-arrow-right"></i></a></p>
      <p class="stance" style="margin-top:14px">Read it. Share it. Fork it. <b>Organize.</b></p>
    </div>
  `;
  window.scrollTo(0,0);
}

function route(){
  // support both clean paths (/book/slug, for crawlers via vercel rewrite) and hash (#/book/slug, in-app nav)
  const path = location.pathname.replace(/\/+$/,"");
  const h = location.hash;
  const controls = el("controls");
  const hideControls = () => { controls.style.display="none"; const more=el("more"); if(more) more.style.display="none"; const rc=el("recent"); if(rc) rc.style.display="none"; };
  const mh = h.match(/#\/(?:book|gallery)\/(.+)$/);
  const mp = path.match(/^\/(?:book|gallery)\/(.+)$/);
  if(mh || mp){ hideControls(); renderBook(decodeURIComponent(mh?mh[1]:mp[1])); }
  else if(h==="#/stats" || path==="/stats"){ hideControls(); renderStats(); }
  else if(h==="#/contribute" || path==="/contribute"){ hideControls(); renderContribute(); }
  else { controls.style.display=""; clearItemJsonLd(); setSEO("The Open Stacks - a growing anti-censorship library", "A growing, multi-source library preserving radical, political, and at-risk books. Antifascist, anti-capitalist, pro free speech. Free downloads, no paywalls.", ORIGIN+"/"); renderList(); }
}

// horizontal "Recently added" strip, shown above the grid on the home view only.
// Uses the `added` timestamp baked into index.json by build_index.py (newest-first).
function renderRecent(){
  const host = el("recent");
  if(!host) return;
  const recent = [...books].sort((a,b)=>(b.added||0)-(a.added||0)).slice(0,14);
  if(!recent.length){ host.style.display="none"; return; }
  host.innerHTML = `<h3><i class="fa-solid fa-seedling fa-inline"></i>Recently added</h3>`
    + `<div class="recentrow">` + recent.map(b=>{
      const cov = b.cover
        ? `<img class="rc" src="${esc(b.cover)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`
        : `<div class="rc"></div>`;
      return `<a href="${itemHash(b)}"><span class="rnew">NEW</span>${cov}<div class="rt">${esc(b.title)}</div></a>`;
    }).join("") + `</div>`;
  host.style.display="";
}

function buildCats(){
  const counts = {};
  books.forEach(b=>counts[b.category]=(counts[b.category]||0)+1);
  el("cats").innerHTML = Object.entries(counts).sort((a,b)=>b[1]-a[1]).map(([c,n])=>
    `<button data-c="${esc(c)}">${esc(c)} <span style="opacity:.6">${n}</span></button>`).join("");
  el("cats").querySelectorAll("button").forEach(btn=>btn.addEventListener("click",()=>{
    const c = btn.dataset.c;
    if(fCat===c){fCat=null;btn.classList.remove("on");}
    else{el("cats").querySelectorAll("button").forEach(x=>x.classList.remove("on"));btn.classList.add("on");fCat=c;}
    resetAndRender();
  }));
}

// Language filter pills (orange), only shown when >1 language present.
function buildLangs(){
  const host = el("langs");
  if(!host) return;
  const counts = {};
  books.forEach(b=>{ const l=b.language||"en"; counts[l]=(counts[l]||0)+1; });
  const codes = Object.keys(counts);
  if(codes.length<2){ host.innerHTML=""; return; }
  host.innerHTML = `<span style="color:var(--mut);font-size:12px;align-self:center;margin-right:2px"><i class="fa-solid fa-language fa-inline"></i>Language:</span>`
    + codes.sort((a,b)=>counts[b]-counts[a]).map(c=>
    `<button data-l="${esc(c)}">${esc(LANG_NAMES[c]||c)} <span style="opacity:.6">${counts[c]}</span></button>`).join("");
  host.querySelectorAll("button").forEach(btn=>btn.addEventListener("click",()=>{
    const l = btn.dataset.l;
    if(fLang===l){fLang=null;btn.classList.remove("on");}
    else{host.querySelectorAll("button").forEach(x=>x.classList.remove("on"));btn.classList.add("on");fLang=l;}
    resetAndRender();
  }));
}

(async function(){
  el("dlall").href = ZIPBALL;
  const dlf = el("dlallfoot"); if(dlf) dlf.href = ZIPBALL;
  // lightbox global controls
  el("lbClose").addEventListener("click", closeLightbox);
  el("lbPrev").addEventListener("click", ()=>stepLightbox(-1));
  el("lbNext").addEventListener("click", ()=>stepLightbox(1));
  el("lightbox").addEventListener("click", e=>{ if(e.target.id==="lightbox") closeLightbox(); });
  document.addEventListener("keydown", e=>{
    if(!el("lightbox").classList.contains("on")) return;
    if(e.key==="Escape") closeLightbox();
    else if(e.key==="ArrowLeft") stepLightbox(-1);
    else if(e.key==="ArrowRight") stepLightbox(1);
  });
  try{
    const {books:bs, sha, cached} = await loadTree();
    books = bs; books.forEach(b=>bySlug[b.slug]=b); window.__IDX = books;
    const hosted = books.reduce((n,b)=>n+b.files.filter(f=>f.hosted).length,0);
    const total = books.reduce((n,b)=>n+b.files.length,0);
    el("sub").innerHTML = `${books.length} items · <span class="badge">${hosted}</span>/${total} files self-hosted · <a href="${API.replace('api.github.com/repos','github.com')}/commit/${sha}" target="_blank" rel="noopener noreferrer">@${sha.slice(0,7)}</a>`;
    buildCats();
    buildLangs();
    renderRecent();
    // typing triggers a lazy Lunr build (once); re-render when the index lands
    el("q").addEventListener("input", ()=>{
      const q = el("q").value.trim();
      if(q && !lunrIdx){ loadLunr().then(()=>{ if(el("q").value.trim()) resetAndRender(); }); }
      resetAndRender();
    });
    // bookmark toggle (delegated) - works on cards and detail pages
    document.addEventListener("click", (e)=>{
      const bt = e.target.closest && e.target.closest(".bmk[data-bmk]");
      if(!bt) return;
      e.preventDefault(); e.stopPropagation();
      const on = toggleBmk(bt.dataset.bmk);
      bt.classList.toggle("on", on);
      const ic = bt.querySelector("i");
      if(ic) ic.className = `fa-${on?"solid":"regular"} fa-bookmark`;
      if(fState==="saved") resetAndRender();
    });
    document.querySelectorAll(".filters button").forEach(btn=>btn.addEventListener("click",()=>{
      document.querySelectorAll(".filters button").forEach(x=>x.classList.remove("on"));
      btn.classList.add("on"); fState=btn.dataset.f; resetAndRender();
    }));
    el("sortSel").addEventListener("change", ()=>{ fSort=el("sortSel").value; resetAndRender(); });
    window.addEventListener("hashchange", route);
    window.addEventListener("popstate", route);
    // intercept internal nav -> clean paths via History API (no hash, no full reload)
    document.addEventListener("click", (e)=>{
      const a = e.target.closest && e.target.closest("a");
      if(!a) return;
      let href = a.getAttribute("href") || "";
      if(a.target==="_blank" || a.hasAttribute("download") || e.metaKey || e.ctrlKey || e.shiftKey || e.button!==0) return;
      // normalize legacy hash links (#/book/..., #/) to clean paths
      if(href.startsWith("#/")) href = href.slice(1);
      else if(href==="#" ) href = "/";
      else if(!href.startsWith("/")) return; // external or non-root, let browser handle
      e.preventDefault();
      if(location.pathname+location.hash !== href){
        history.pushState(null, "", href);
      }
      route();
    });
    route();
  }catch(e){
    el("list").innerHTML = `<div class="loading">Failed to load: ${esc(e.message)}</div>`;
  }
})();
