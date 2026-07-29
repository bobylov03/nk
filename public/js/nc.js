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
  dateRu(iso, opts) {
    return new Date(iso).toLocaleDateString('ru-RU', opts || { day: 'numeric', month: 'long' });
  },
  logo(size) {
    const s = size || 58;
    return `<span class="logo"><span class="mark" style="width:${s}px;height:${s}px">
      <span style="display:flex;flex-direction:column;align-items:center;gap:1px">
        <b style="font-size:${Math.round(s * 0.41)}px">NC</b>
        <s style="font-size:${Math.round(s * 0.135)}px">meals</s>
      </span></span></span>`;
  }
};