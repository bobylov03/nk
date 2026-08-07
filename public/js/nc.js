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
  /* дни недели: пн–вс переключателями */
  days(options, chosen) {
    const on = chosen || [];
    return `<div class="days" data-days>` + options.map(d =>
      `<button type="button" class="${on.includes(d.n) ? 'on' : ''}" data-n="${d.n}">${d.short}</button>`).join('') + `</div>`;
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
  /* иконки соцсетей в подвале — рисуются только для заполненных ссылок */
  socials(host, c) {
    if (!host) return;
    const I = {
      social_tg: ['Telegram', 'M21.9 4.3 2.9 11.6c-1 .4-1 1.7 0 2l4.8 1.5 1.8 5.6c.3.8 1.3 1 1.9.4l2.7-2.6 4.8 3.5c.7.5 1.7.1 1.9-.7l3.1-15c.2-1-.7-1.9-1.7-1.5zM8.9 14.4 18 8.2l-7.4 7.1-.3 3.3-1.4-4.2z'],
      social_ig: ['Instagram', 'M12 2.2c3.2 0 3.6 0 4.9.1 3.3.1 4.8 1.7 4.9 4.9.1 1.3.1 1.6.1 4.8s0 3.6-.1 4.9c-.1 3.2-1.7 4.8-4.9 4.9-1.3.1-1.6.1-4.9.1s-3.6 0-4.9-.1c-3.2-.1-4.8-1.7-4.9-4.9C2.1 15.6 2.1 15.2 2.1 12s0-3.6.1-4.9c.1-3.2 1.7-4.8 4.9-4.9C8.4 2.2 8.8 2.2 12 2.2zm0 3.2a6.6 6.6 0 1 0 0 13.2 6.6 6.6 0 0 0 0-13.2zm0 10.9a4.3 4.3 0 1 1 0-8.6 4.3 4.3 0 0 1 0 8.6zm6.9-11.1a1.5 1.5 0 1 0 0 3.1 1.5 1.5 0 0 0 0-3.1z'],
      social_wa: ['WhatsApp', 'M12 2a10 10 0 0 0-8.6 15L2 22l5.2-1.4A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3.1.8.8-3-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.6-6.1c-.3-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.1-.2 0-.4.1-.5l.4-.5c.1-.2.2-.3.3-.5v-.5l-.8-1.9c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.5.1-.7.3-.9.9-1.1 2.1-.5 3.4a11 11 0 0 0 4.6 4.6c1.6.7 2.7.7 3.6.4.5-.2 1.2-.8 1.4-1.4.1-.4.1-.8.1-.9-.1-.1-.2-.2-.5-.2z'],
      social_tt: ['TikTok', 'M16.6 2h-3.1v13.4a2.6 2.6 0 1 1-2.2-2.6V9.6a5.8 5.8 0 1 0 5.3 5.8V8.9c1.1.8 2.5 1.3 4 1.3V7.1c-2.3 0-4-1.9-4-5.1z']
    };
    host.innerHTML = Object.keys(I).filter(k => c[k]).map(k =>
      `<a href="${NC.esc(c[k])}" target="_blank" rel="noopener" aria-label="${I[k][0]}" title="${I[k][0]}" style="border:0">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="${I[k][1]}"/></svg></a>`).join('');
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