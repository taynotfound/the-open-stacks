const input = document.getElementById('search-input');
if (input) {
  let timer;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const q = input.value.trim();
      const url = new URL(location.href);
      q ? url.searchParams.set('q', q) : url.searchParams.delete('q');
      url.searchParams.delete('page');
      location.href = url.toString();
    }, 400);
  });
}
