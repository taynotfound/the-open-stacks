/* Open Stacks — repo-watching client.
 * Lazy skeleton loading, honest file labels, per-page SEO,
 * inline HTML/image rendering, big galleries, target=_blank everywhere.
 */
const OWNER = "taynotfound", REPO = "libcom-mirror", BRANCH = "main";
const API = `https://api.github.com/repos/${OWNER}/${REPO}`;
const RAW = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}`;
const ZIPBALL = `https://github.com/${OWNER}/${REPO}/archive/refs/heads/${BRANCH}.zip`;

const el = id => document.getElementById(id);
let books = [], fState = "all", fCat = null, bySlug = {};

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
  const cacheKey = "libcom_books_"+sha;
  const cached = localStorage.getItem(cacheKey);
  if(cached){ return {books: JSON.parse(cached), sha, cached:true}; }
  const tree = await fetch(`${API}/git/trees/${sha}?recursive=1`).then(r=>r.json());
  const mdPaths = (tree.tree||[]).filter(t=>t.type==="blob" && t.path.startsWith("books/") && t.path.endsWith(".md")).map(t=>t.path);
  const out = [];
  const B = 40;
  for(let i=0;i<mdPaths.length;i+=B){
    const batch = mdPaths.slice(i, i+B);
    const res = await Promise.all(batch.map(p =>
      fetch(`${RAW}/${p.split("/").map(encodeURIComponent).join("/")}`).then(r=>r.ok?r.text():"").catch(()=> "")));
    res.forEach((txt,j)=>{
      if(!txt) return;
      const {meta, body} = parseFront(txt);
      const title = meta.title||batch[j].split("/").pop();
      out.push({
        title, author: meta.author||"",
        category: meta.category|| batch[j].split("/")[1] || "general",
        state: meta.mirror_state||"none",
        tags: meta.tags||[], files: meta.files||[],
        images: meta.images||[], links: meta.links||[],
        pageType: meta.page_type||"",
        source: meta.source||"", cover: meta.cover||"",
        sourceName: meta.source_name||"", atRisk: /true/i.test(meta.at_risk||""),
        desc: meta.description||firstPara(body), body, slug: slugify(title), path: batch[j],
      });
    });
    el("sub").textContent = `loaded ${out.length}/${mdPaths.length} books…`;
  }
  Object.keys(localStorage).filter(k=>k.startsWith("libcom_books_")).forEach(k=>localStorage.removeItem(k));
  try{ localStorage.setItem(cacheKey, JSON.stringify(out)); }catch(e){}
  return {books: out, sha, cached:false};
}

function coverEl(b, big){
  if(b.cover) return `<img class="cover${big?' big':''}" src="${esc(b.cover)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'cover ph${big?' big':''}',textContent:'📕'}))">`;
  return `<div class="cover ph${big?' big':''}">📕</div>`;
}

function cardHTML(b){
  return `<a class="card" href="#/book/${encodeURIComponent(b.slug)}">
      ${coverEl(b)}
      ${b.atRisk?`<span class="risk">⚠ at risk</span>`:""}
      ${b.pageType==="gallery"?`<span class="gtag">🖼 gallery</span>`:""}
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
  setSEO("The Open Stacks — an anti-censorship library","Host what they'd erase. A growing, multi-source archive of books and articles at risk of being taken down.", location.href.split("#")[0]);
  const q = el("q").value.toLowerCase();
  const view = books.filter(b=>{
    if(fState==="risk"){ if(!b.atRisk) return false; }
    else if(fState!=="all" && b.state!==fState) return false;
    if(fCat && b.category!==fCat) return false;
    if(q){ if(!(b.title+" "+b.author+" "+b.tags.join(" ")).toLowerCase().includes(q)) return false; }
    return true;
  }).sort((a,b)=>a.title.toLowerCase()<b.title.toLowerCase()?-1:1);
  el("count").textContent = `${view.length} book${view.length===1?"":"s"}`;
  el("list").className = "grid";
  // lazy skeleton render: place skeletons, swap in real cards as they scroll near viewport
  if(io) io.disconnect();
  el("list").innerHTML = view.map((b,i)=>`<div class="slot card skel" data-i="${i}"><div class="cover sk"></div><div class="cardbody"><div class="sk line"></div><div class="sk line short"></div></div></div>`).join("") || `<div class="loading">No books match.</div>`;
  const slots = [...el("list").querySelectorAll(".slot")];
  io = new IntersectionObserver((entries,obs)=>{
    entries.forEach(en=>{
      if(en.isIntersecting){
        const i = +en.target.dataset.i;
        en.target.outerHTML = cardHTML(view[i]);
        obs.unobserve(en.target);
      }
    });
  }, {rootMargin:"600px"});
  slots.forEach(s=>io.observe(s));
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

function renderBook(slug){
  const b = bySlug[slug];
  if(!b){ el("list").className=""; el("list").innerHTML = `<div class="loading">Not found. <a href="#/">← back</a></div>`; return; }
  const canon = location.href;
  setSEO(`${b.title} — The Open Stacks`, b.desc || `${b.title}${b.author?" by "+b.author:""}, archived on The Open Stacks.`, canon);
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
  const outlinks = b.links.length ? `<h3 class="dh">Links from this page</h3><ul class="outlinks">${b.links.map(l=>`<li><a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.text||l.url)} ↗</a></li>`).join("")}</ul>` : "";
  const content = b.body && b.body.length>40 ? `<div class="content">${mdToHtml(b.body)}</div>` : "";
  // self-hosted HTML files -> read inline. raw/jsDelivr force text/plain, so we fetch and inject via srcdoc (renders as HTML).
  const htmlFile = b.files.find(f=>f.hosted && /\.html?($|\?|#)/i.test((f.url||"")+ " " + (f.name||"")) || (f.hosted && /html/i.test(f.type||"")));
  const reader = htmlFile ? `<h3 class="dh">Read here</h3><div class="reader"><iframe id="htmlReader" loading="lazy" title="${esc(b.title)}" sandbox="allow-popups allow-popups-to-escape-sandbox"></iframe></div><p class="cmeta"><a href="${esc(htmlFile.url)}" target="_blank" rel="noopener noreferrer">Open raw file in new tab ↗</a></p>` : "";

  el("list").innerHTML = `
    <a class="back" href="#/">← all books</a>
    ${b.atRisk?`<div class="riskbar">⚠ <strong>Mirrored because it's at risk.</strong> This work faces takedown, banning, or restricted access somewhere. We keep a readable copy.</div>`:""}
    <div class="bookhead">
      ${gallery?"":coverEl(b, true)}
      <div class="bookinfo">
        <h2><span class="dot ${b.state}"></span>${esc(b.title)}</h2>
        ${b.author?`<div class="cmeta">by ${esc(b.author)}</div>`:""}
        <div class="cmeta">in <a href="#/">${esc(b.category)}</a>${gallery?' · 🖼 image page':""}</div>
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
    <p class="orig"><a href="${esc(b.source)}" target="_blank" rel="noopener noreferrer">View at original source (${esc(srcName)}) ↗</a></p>`;
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

function route(){
  const h = location.hash;
  const controls = el("controls");
  const m = h.match(/#\/book\/(.+)$/);
  if(m){ controls.style.display="none"; renderBook(decodeURIComponent(m[1])); }
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
    renderList();
  }));
}

(async function(){
  el("dlall").href = ZIPBALL;
  try{
    const {books:bs, sha, cached} = await loadTree();
    books = bs; books.forEach(b=>bySlug[b.slug]=b);
    const hosted = books.reduce((n,b)=>n+b.files.filter(f=>f.hosted).length,0);
    const total = books.reduce((n,b)=>n+b.files.length,0);
    el("sub").innerHTML = `${books.length} books · <span class="badge">${hosted}</span>/${total} files self-hosted · <a href="${API.replace('api.github.com/repos','github.com')}/commit/${sha}" target="_blank" rel="noopener noreferrer">@${sha.slice(0,7)}</a>`;
    buildCats();
    el("q").addEventListener("input", renderList);
    document.querySelectorAll(".filters button").forEach(btn=>btn.addEventListener("click",()=>{
      document.querySelectorAll(".filters button").forEach(x=>x.classList.remove("on"));
      btn.classList.add("on"); fState=btn.dataset.f; renderList();
    }));
    window.addEventListener("hashchange", route);
    route();
  }catch(e){
    el("list").innerHTML = `<div class="loading">Failed to load: ${esc(e.message)}</div>`;
  }
})();
