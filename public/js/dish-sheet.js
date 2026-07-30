const ALLERGENS = ['глютен','орех','миндал','молок','сыр','яйц','рыб','кунжут','соя','мед'];
function dishSheet(d) {
  if (!d) return '';
  const found = ALLERGENS.filter(a => String(d.ing || '').toLowerCase().includes(a));
  const rows = [['Вес порции', d.weight + ' г'], ['Состав', d.ing || '—'], ['Аллергены', found.join(', ') || 'не обнаружены'], ['Особенности', (d.tags || []).join(' · ') || '—']];
  const macros = [[d.kcal, 'ккал'], [d.p + ' г', 'белки'], [d.f + ' г', 'жиры'], [d.c + ' г', 'углеводы']];
  return '<div class="sheet" id="sheet"><div class="inner" onclick="event.stopPropagation()">' +
    '<div class="row" style="justify-content:space-between"><span class="mono">' + (d.catLabel || '') + '</span>' +
      '<button class="btn ghost sm" id="sheet-close" style="width:34px;height:34px;padding:0;border-radius:50%">×</button></div>' +
    '<div class="photo" style="' + (d.img ? "background-image:url('/img/" + d.img + "')" : '') + '"></div>' +
    '<div class="col" style="gap:8px"><span class="serif" style="font-size:28px;line-height:1.12">' + NC.esc(d.name) + '</span>' +
      '<span class="muted" style="font-size:14px;line-height:1.6">' + NC.esc(d.desc || 'Описание появится, когда блюдо войдёт в цикл.') + '</span></div>' +
    '<div class="macro4">' + macros.map(function (m) { return '<div><span class="serif" style="font-size:22px;line-height:1">' + m[0] + '</span><span class="mono" style="font-size:8px">' + m[1] + '</span></div>'; }).join('') + '</div>' +
    '<div class="card col" style="gap:14px">' + rows.map(function (r) { return '<div class="col" style="gap:5px"><span class="mono">' + r[0] + '</span><span style="font-size:13.5px;line-height:1.55">' + NC.esc(r[1]) + '</span></div>'; }).join('') + '</div>' +
    '<div class="col" style="gap:10px;padding:20px;border-radius:var(--r);background:var(--plum)">' +
      '<span class="mono" style="color:rgba(220,192,166,.6)">Почему это блюдо сегодня</span>' +
      '<span class="serif" style="font-size:19px;line-height:1.4;color:var(--champagne)">' + NC.esc(d.why || 'Блюдо собрано под норму дня по калориям и белку.') + '</span></div>' +
  '</div></div>';
}
function bindSheet(host, dishes) {
  host.querySelectorAll('[data-dish]').forEach(function (el) {
    el.onclick = function (e) {
      if (e.target.closest('[data-swap]')) return;
      const d = dishes.find(function (x) { return x.id === el.dataset.dish; });
      if (!d) return;
      const wrap = document.createElement('div');
      wrap.innerHTML = dishSheet(d);
      const node = wrap.firstElementChild;
      document.body.appendChild(node);
      const close = function () { node.remove(); };
      node.onclick = close;
      node.querySelector('#sheet-close').onclick = close;
    };
  });
}