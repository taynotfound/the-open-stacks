# The Open Stacks

A browsable, repo-watching frontend for [`taynotfound/libcom-mirror`](https://github.com/taynotfound/libcom-mirror) — a growing anti-censorship library.

Static site (no build step). It reads the mirror repo **live** from GitHub, so new books "just work" the moment their Markdown lands in the mirror — no rebuild, no redeploy.

## What it does

- **Repo-watching** — reads `books/<category>/*.md` from the mirror via the GitHub API, caches by commit SHA.
- **Lazy loading + skeletons** — cards stream in on scroll (IntersectionObserver), never blocks on all ~800 books.
- **Per-page views** — covers, tags, source attribution, and archived body text scraped from the original source.
- **Inline reading** — self-hosted public-domain / at-risk HTML books (1984, Animal Farm...) render inline in a sandboxed iframe via `srcdoc`.
- **Image galleries** — graffiti / poster pages show big images.
- **Honest file labels** — a file is labelled by its real extension. HTML is HTML, never a fake PDF.
- **Every external link** opens in a new tab (`target="_blank"`).
- **Search + status filters** — at-risk / self-hosted / partial / linked-only.
- **SEO** — per-book title/description, `robots.txt`, `sitemap.xml`.

## Run it

```sh
python3 -m http.server 3232
# open http://localhost:3232
```

Any static host works (it's just `index.html` + `app.js`).

## Stance

We stand for free speech and free access — and against the far right, state control, capitalism, and censorship.

Texts remain © their authors / under each source's terms. Take what you need, give what you can.
