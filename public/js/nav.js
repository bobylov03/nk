/* Шапка: бургер-меню и высота для scroll-margin якорей.
   Подключается на всех страницах с навигацией. */
(function () {
  const nav = document.getElementById('nav');
  if (!nav) return;
  const burger = document.getElementById('burger');
  const menu = document.getElementById('nav-menu');

  const setH = () => document.documentElement.style.setProperty('--nav-h', (nav.offsetHeight + 14) + 'px');
  setH();
  addEventListener('resize', setH);
  if (window.ResizeObserver) new ResizeObserver(setH).observe(nav);

  if (!burger || !menu) return;
  const close = () => { nav.classList.remove('open'); burger.setAttribute('aria-expanded', 'false'); };
  burger.onclick = () => {
    const open = !nav.classList.contains('open');
    nav.classList.toggle('open', open);
    burger.setAttribute('aria-expanded', String(open));
  };
  menu.querySelectorAll('a').forEach(a => a.addEventListener('click', close));
  addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  document.addEventListener('click', (e) => { if (!nav.contains(e.target)) close(); });
})();