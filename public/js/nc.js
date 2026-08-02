/* Общие помощники: запросы, хранение токена, мелкий DOM */
const NC = {
  cur: '₾',
  token: () => localStorage.getItem('nc_token') || '',
  setToken: (t) => localStorage.setItem('nc_token', t),
  clientId: () => localStorage.getItem('nc_client') || '',
  setClient: (id) => localStorage.setItem('nc_client', id),
  async api(path, opts = {}) {
    const res = await fetch(path, {
      method: opts.method || 'GET',
      headers: Object.assign({ 'Content-Type': 'application/json', 'X-NC-Token': NC.token() }, opts.headers || {}),
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || ('Ошибка ' + res.status));
    return data;
  },
  money: (n) => (Math.round(n * 100) / 100).toLocaleString('ru-RU') + ' ' + NC.cur,
  macros: (d) => d ? `${d.kcal} ккал · Б${d.p} Ж${d.f} У${d.c}` : '',
  esc: (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
  tile(dish, cls) {
    const img = dish && dish.img ? `background-image:url('/img/${dish.img}')` : '';
    return `<div class="tile ${cls || ''}" style="${img}"></div>`;
  },
  toast(msg) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2600);
  },
  plural: (n, one, few, many) => {
    const a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
  },
  /* набор чипов-переключателей: NC.chips('goals', OPTS.goals, выбранные) */
  chips(field, options, chosen, limit) {
    const on = chosen || [];
    return `<div class="chips" data-chips="${field}"${limit ? ` data-limit="${limit}"` : ''}>` +
      options.map(o => `<button type="button" class="chip ${on.includes(o) ? 'on' : ''}" data-val="${NC.esc(o)}">${NC.esc(o)}</button>`).join('') +
      `</div>`;
  },
  /* один выбор из списка */
  radios(field, options, value) {
    return `<div class="chips" data-radio="${field}">` +
      options.map(o => `<button type="button" class="chip ${String(o) === String(value) ? 'on' : ''}" data-val="${NC.esc(o)}">${NC.esc(o)}</button>`).join('') +
      `</div>`;
  },
  /* список типов питания: иконка, название, пояснение */
  diets(options, value) {
    return `<div class="diets" data-diet>` + options.map(d => `
      <button type="button" class="diet ${d.id === value ? 'on' : ''}" data-val="${d.id}">
        <span class="ic">${d.icon}</span>
        <span class="tx"><b>${NC.esc(d.name)}</b><i>${NC.esc(d.desc)}</i></span>
        <span class="dot"></span>
      </button>`).join('') + `</div>`;
  },
  stars(value, dishId, date) {
    return `<div class="stars" data-stars="${dishId}" data-date="${date || ''}">` +
      [1, 2, 3, 4, 5].map(n => `<button type="button" class="${n <= value ? 'on' : ''}" data-n="${n}" aria-label="${n} из 5">★</button>`).join('') +
      `</div>`;
  },
  /* навешивает поведение на чипы/радио/звёзды внутри host */
  bindPickers(host, model, onChange) {
    host.querySelectorAll('[data-chips]').forEach(box => {
      const field = box.dataset.chips, limit = +box.dataset.limit || 0;
      box.querySelectorAll('.chip').forEach(b => b.onclick = () => {
        const v = b.dataset.val;
        const list = model[field] || (model[field] = []);
        const i = list.indexOf(v);
        if (i >= 0) list.splice(i, 1);
        else {
          if (limit && list.length >= limit) return NC.toast('Можно выбрать не больше ' + limit);
          list.push(v);
        }
        b.classList.toggle('on');
        if (onChange) onChange(field, list);
      });
    });
    host.querySelectorAll('[data-radio]').forEach(box => {
      const field = box.dataset.radio;
      box.querySelectorAll('.chip').forEach(b => b.onclick = () => {
        box.querySelectorAll('.chip').forEach(x => x.classList.remove('on'));
        b.classList.add('on');
        model[field] = isNaN(b.dataset.val) ? b.dataset.val : +b.dataset.val;
        if (onChange) onChange(field, model[field]);
      });
    });
  },
  dateRu(iso, opts) {
    return new Date(iso).toLocaleDateString('ru-RU', opts || { day: 'numeric', month: 'long' });
  },
  /* размер задаётся переменной --logo-size, чтобы им управляли медиазапросы */
  logo(size) {
    return `<span class="logo"${size ? ` style="--logo-size:${size}px"` : ''}>
      <span class="mark"><span class="stack"><b>NC</b><s>meals</s></span></span></span>`;
  }
};