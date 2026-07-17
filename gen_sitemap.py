#!/usr/bin/env python3
"""Regenerate sitemap.xml from the live index.json. Run before committing site changes,
or wire into CI. Lists home + stats + contribute + every /book/<slug> item."""
import json, html, urllib.request
from urllib.parse import quote

BASE = "https://theopenstacks.apolochees.me"
IDX = "https://raw.githubusercontent.com/taynotfound/open-stacks-library/main/index.json"

d = json.load(urllib.request.urlopen(IDX, timeout=60))
items = d if isinstance(d, list) else d.get("items", d)

urls = []
def u(loc, pri, cf="weekly"):
    urls.append(f"  <url><loc>{html.escape(loc)}</loc><changefreq>{cf}</changefreq><priority>{pri}</priority></url>")

u(f"{BASE}/", "1.0", "daily")
u(f"{BASE}/stats", "0.6")
u(f"{BASE}/contribute", "0.5")
for it in items:
    slug = it.get("slug")
    if slug:
        u(f"{BASE}/book/{quote(slug, safe='')}", "0.7")

xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + "\n".join(urls) + "\n</urlset>\n"
open("sitemap.xml", "w").write(xml)
print(f"wrote sitemap.xml with {len(urls)} urls")
