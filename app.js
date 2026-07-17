/* Open Stacks - repo-watching client.
 * Lazy skeleton loading, honest file labels, per-page SEO,
 * inline HTML/image rendering, big galleries, target=_blank everywhere.
 */
const OWNER = "taynotfound", REPO = "open-stacks-library", BRANCH = "main";
const API = `https://api.github.com/repos/${OWNER}/${REPO}`;
const RAW = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}`;
const ZIPBALL = `https://github.com/${OWNER}/${REPO}/archive/refs/heads/${BRANCH}.zip`;

const el = id => document.getElementById(id);
let books = [], fState = "all", fCat = null, bySlug = {};
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

function cardHTML(b){
  return `<a class="card" href="#/book/${encodeURIComponent(b.slug)}">
      ${coverEl(b)}
      ${b.atRisk?`<span class="risk"><i class="fa-solid fa-triangle-exclamation fa-inline"></i>at risk</span>`:""}
      ${b.pageType==="gallery"?`<span class="gtag"><i class="fa-solid fa-images fa-inline"></i>gallery</span>`:""}
      <div class="cardbody">
        <div class="ctitle"><span class="dot ${b.state}"></span>${esc(b.title)}</div>
        <div class="cmeta">${b.author?esc(b.author)+" · ":""}${b.files.length} file(s)</div>
      </div>
    </a>`;
}
function skeletonHTML(){
  return `<div class="card skel"><div class="cover sk"></div><div class="cardbody"><div class="sk line"></div><div class="sk line short"></div></div></div>`;
}

let io = null;
function renderList(){
  setSEO("The Open Stacks - an anti-censorship library","Host what they'd erase. A growing, multi-source archive of books and articles at risk of being taken down.", location.href.split("#")[0]);
  const q = el("q").value.toLowerCase();
  const view = books.filter(b=>{
    if(fState==="risk"){ if(!b.atRisk) return false; }
    else if(fState!=="all" && b.state!==fState) return false;
    if(fCat && b.category!==fCat) return false;
    if(q){ if(!(b.title+" "+b.author+" "+b.tags.join(" ")).toLowerCase().includes(q)) return false; }
    return true;
  }).sort((a,b)=>a.title.toLowerCase()<b.title.toLowerCase()?-1:1);
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

// crude, safe markdown->html for scraped body (paragraphs, links, images, headings)
function mdToHtml(md){
  if(!md) return "";
  return md.split(/\n{2,}/).map(block=>{
    let t = block.trim();
    if(!t) return "";
    const h = t.match(/^(#{1,4})\s+(.*)/);
    if(h) return `<h${h[1].length+1}>${esc(h[2])}</h${h[1].length+1}>`;
    // image ![alt](url)
    t = t.replace(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g,(m,u)=>`<img class="inl" loading="lazy" src="${esc(u)}" alt="">`);
    // links [text](url)
    t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,(m,tx,u)=>`<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(tx)}</a>`);
    if(/^<img/.test(t)) return `<p class="imgwrap">${t}</p>`;
    return `<p>${t.replace(/\n/g,"<br>")}</p>`;
  }).join("");
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

async function renderBook(slug){
  const b = bySlug[slug];
  if(!b){ el("list").className=""; el("list").innerHTML = `<div class="loading">Not found. <a href="#/"><i class="fa-solid fa-arrow-left fa-inline"></i>back</a></div>`; return; }
  await ensureBody(b);
  const canon = location.href;
  setSEO(`${b.title} - The Open Stacks`, b.desc || `${b.title}${b.author?" by "+b.author:""}, archived on The Open Stacks.`, canon);
  el("list").className = "detail";
  const gallery = b.pageType==="gallery" || (b.images.length && !b.files.length);
  const srcName = b.sourceName || (b.source.includes("libcom.org") ? "libcom.org" : (b.source.match(/\/\/([^\/]+)/)||[])[1] || "source");

  const files = b.files.map(f=>{
    const cls = f.hosted?' class="host"':'';
    const tag = f.hosted?" · self-hosted":"";
    return `<a${cls} href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">${esc(fileLabel(f))}<span class="fn">${esc(f.name)}${tag}</span></a>`;
  }).join("");
  const tags = b.tags.map(t=>`<span class="tag">${esc(t)}</span>`).join("");
  const imgs = b.images.length ? `<div class="gallery${gallery?' big':''}">${b.images.map(u=>`<a href="${esc(u)}" target="_blank" rel="noopener noreferrer"><img loading="lazy" src="${esc(u)}" alt=""></a>`).join("")}</div>` : "";
  const outlinks = b.links.length ? `<h3 class="dh">Links from this page</h3><ul class="outlinks">${b.links.map(l=>`<li><a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.text||l.url)} <i class="fa-solid fa-arrow-up-right-from-square"></i></a></li>`).join("")}</ul>` : "";
  const content = b.body && b.body.length>40 ? `<div class="content">${mdToHtml(b.body)}</div>` : "";
  // self-hosted HTML files -> read inline. raw/jsDelivr force text/plain, so we fetch and inject via srcdoc (renders as HTML).
  const htmlFile = b.files.find(f=>f.hosted && /\.html?($|\?|#)/i.test((f.url||"")+ " " + (f.name||"")) || (f.hosted && /html/i.test(f.type||"")));
  const reader = htmlFile ? `<h3 class="dh">Read here</h3><div class="reader"><iframe id="htmlReader" loading="lazy" title="${esc(b.title)}" sandbox="allow-popups allow-popups-to-escape-sandbox"></iframe></div><p class="cmeta"><a href="${esc(htmlFile.url)}" target="_blank" rel="noopener noreferrer">Open raw file in new tab <i class="fa-solid fa-arrow-up-right-from-square"></i></a></p>` : "";

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
      </div>
    </div>
    ${b.desc?`<p class="desc">${esc(b.desc)}</p>`:""}
    ${imgs}
    ${reader}
    ${content}
    ${files?`<h3 class="dh">Downloads</h3><div class="dlfiles">${files}</div>`:(b.files.length===0&&!imgs&&!content?`<p class="cmeta">No files mirrored yet.</p>`:"")}
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
  window.scrollTo(0,0);
}

// ---- Stats page: honest breakdown of what the library actually holds ----
function renderStats(){
  setSEO("Stats - The Open Stacks","A live breakdown of The Open Stacks: how many items, what kinds, which sources, and how much we actually self-host.", location.href.split("#")[0]);
  el("list").className = "detail";
  const total = books.length;
  const byType = {}, byCat = {}, bySrc = {}, byState = {full:0,partial:0,none:0};
  let hostedFiles=0, totalFiles=0, images=0, atRisk=0;
  books.forEach(b=>{
    const t = b.pageType || "other";
    byType[t]=(byType[t]||0)+1;
    byCat[b.category]=(byCat[b.category]||0)+1;
    const s = b.sourceName || "unknown";
    bySrc[s]=(bySrc[s]||0)+1;
    if(byState[b.state]!==undefined) byState[b.state]++;
    (b.files||[]).forEach(f=>{ totalFiles++; if(f.hosted) hostedFiles++; });
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
      ${bigStat(images.toLocaleString(),"images archived")}
      ${bigStat(atRisk,"flagged at risk")}
      ${bigStat(Object.keys(bySrc).length,"distinct sources")}
    </div>

    <h2 class="stath2">By type</h2>
    <div class="statgroup">${bar(typeRows)}</div>

    <h2 class="stath2">How much we actually hold</h2>
    <p class="statnote">Honesty matters. "Full copy" = we archived the whole thing. "Linked only" = we point you to the real source and never pretend it's ours.</p>
    <div class="statgroup">${bar([['<i class="fa-solid fa-circle-check fa-inline" style="color:var(--grn)"></i>Full copy',byState.full],['<i class="fa-solid fa-circle-half-stroke fa-inline" style="color:var(--amb)"></i>Partial',byState.partial],['<i class="fa-regular fa-circle fa-inline" style="color:var(--mut)"></i>Linked only',byState.none]])}</div>
    <p class="statnote">${hostedFiles.toLocaleString()} of ${totalFiles.toLocaleString()} files (${hostPct}%) are physically mirrored on our servers, safe from takedown.</p>

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
  const h = location.hash;
  const controls = el("controls");
  const hideControls = () => { controls.style.display="none"; const more=el("more"); if(more) more.style.display="none"; };
  const m = h.match(/#\/book\/(.+)$/);
  if(m){ hideControls(); renderBook(decodeURIComponent(m[1])); }
  else if(h==="#/stats"){ hideControls(); renderStats(); }
  else if(h==="#/contribute"){ hideControls(); renderContribute(); }
  else { controls.style.display=""; renderList(); }
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

(async function(){
  el("dlall").href = ZIPBALL;
  try{
    const {books:bs, sha, cached} = await loadTree();
    books = bs; books.forEach(b=>bySlug[b.slug]=b);
    const hosted = books.reduce((n,b)=>n+b.files.filter(f=>f.hosted).length,0);
    const total = books.reduce((n,b)=>n+b.files.length,0);
    el("sub").innerHTML = `${books.length} items · <span class="badge">${hosted}</span>/${total} files self-hosted · <a href="${API.replace('api.github.com/repos','github.com')}/commit/${sha}" target="_blank" rel="noopener noreferrer">@${sha.slice(0,7)}</a>`;
    buildCats();
    el("q").addEventListener("input", resetAndRender);
    document.querySelectorAll(".filters button").forEach(btn=>btn.addEventListener("click",()=>{
      document.querySelectorAll(".filters button").forEach(x=>x.classList.remove("on"));
      btn.classList.add("on"); fState=btn.dataset.f; resetAndRender();
    }));
    window.addEventListener("hashchange", route);
    route();
  }catch(e){
    el("list").innerHTML = `<div class="loading">Failed to load: ${esc(e.message)}</div>`;
  }
})();
