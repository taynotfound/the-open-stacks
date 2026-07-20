// ── Search: navigate on Enter or suggestion click only ──
const input = document.getElementById('search-input');
const dropdown = document.getElementById('search-suggest');

if (input) {
  let fetchTimer, navTimer, lastQ = '';

  function navigate(q) {
    const url = new URL(location.href);
    q ? url.searchParams.set('q', q) : url.searchParams.delete('q');
    url.searchParams.delete('page');
    location.href = url.toString();
  }

  function closeDropdown() {
    if (dropdown) dropdown.innerHTML = '';
  }

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(fetchTimer);
      closeDropdown();
      navigate(input.value.trim());
    }
    if (e.key === 'Escape') closeDropdown();
  });

  input.addEventListener('input', () => {
    const q = input.value.trim();
    clearTimeout(fetchTimer);
    clearTimeout(navTimer);
    if (!dropdown) return;
    if (q.length < 2) { closeDropdown(); return; }
    if (q === lastQ) return;

    // fetch suggestions after 350ms idle — NOT a page nav
    fetchTimer = setTimeout(async () => {
      lastQ = q;
      try {
        const r = await fetch(`/api/suggest?q=${encodeURIComponent(q)}`);
        const items = await r.json();
        if (!items.length) { closeDropdown(); return; }
        dropdown.innerHTML = items.map(b =>
          `<a href="/book/${b.slug}" class="suggest-item">
            <span class="suggest-title">${b.title}</span>
            ${b.author ? `<span class="suggest-author">${b.author}</span>` : ''}
          </a>`
        ).join('');
      } catch { closeDropdown(); }
    }, 350);
  });

  document.addEventListener('click', e => {
    if (!input.contains(e.target) && dropdown && !dropdown.contains(e.target)) closeDropdown();
  });
}


// ── Reading list save button ──
(function() {
  const btn = document.getElementById('saveBtn');
  if (!btn) return;
  const slug = btn.dataset.slug;
  const title = btn.dataset.title;
  const RL_KEY = 'os_reading_list';

  function getList() { try { return JSON.parse(localStorage.getItem(RL_KEY) || '[]'); } catch { return []; } }
  function isSaved() { return getList().some(i => i.slug === slug); }

  function update() {
    btn.textContent = isSaved() ? '★ Saved' : '☆ Save';
    btn.classList.toggle('saved', isSaved());
  }

  btn.addEventListener('click', () => {
    let list = getList();
    if (isSaved()) {
      list = list.filter(i => i.slug !== slug);
    } else {
      list.unshift({ slug, title });
      if (list.length > 200) list = list.slice(0, 200);
    }
    localStorage.setItem(RL_KEY, JSON.stringify(list));
    update();
  });

  update();
})();
