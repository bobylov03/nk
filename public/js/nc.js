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
  /* Расчёт нормы КБЖУ. Формула Миффлина–Сан Жеора — то, чем пользуются
     диетологи по умолчанию. Все результаты — ориентир, не назначение врача. */
  ACTIVITY: [
    { id: 'low', k: 1.2, label: 'Сидячий образ жизни', note: 'офис, мало ходьбы' },
    { id: 'light', k: 1.375, label: 'Лёгкая активность', note: 'тренировки 1–3 раза в неделю' },
    { id: 'mid', k: 1.55, label: 'Средняя активность', note: 'тренировки 3–5 раз в неделю' },
    { id: 'high', k: 1.725, label: 'Высокая активность', note: 'тренировки 6–7 раз в неделю' }
  ],
  GOALS: [
    { id: 'lose', label: 'Снизить вес', sign: -1 },
    { id: 'keep', label: 'Удержать вес', sign: 0 },
    { id: 'gain', label: 'Набрать массу', sign: 1 }
  ],
  kbjuCalc(d) {
    const sex = d.sex === 'm' ? 'm' : 'f';
    const w = +d.weight || 0, h = +d.height || 0, age = +d.age || 0;
    if (!w || !h || !age) return null;

    const act = (NC.ACTIVITY.find(a => a.id === d.activity) || NC.ACTIVITY[1]).k;
    let goal = NC.GOALS.find(g => g.id === d.goal) || NC.GOALS[1];
    const bmiNow = w / Math.pow(h / 100, 2);

    // если вес уже ниже нормы, дефицит не считаем — показываем поддержание
    let warn = '';
    if (bmiNow < 18.5 && goal.id === 'lose') {
      goal = NC.GOALS.find(g => g.id === 'keep');
      warn = 'Ваш вес уже ниже нормы для этого роста, поэтому мы рассчитали норму поддержания. Снижение веса в такой ситуации стоит обсуждать с врачом, а не с калькулятором.';
    } else if (bmiNow < 18.5) {
      warn = 'Вес ниже нормы для этого роста — стоит показать расчёт врачу или нутрициологу.';
    } else if (bmiNow >= 30) {
      warn = 'При таком индексе массы тела план питания лучше согласовать с врачом — возможно, потребуются анализы.';
    }

    const bmr = Math.round(10 * w + 6.25 * h - 5 * age + (sex === 'm' ? 5 : -161));
    const tdee = Math.round(bmr * act);

    // умеренный шаг: 15% дефицит, 12% профицит — быстрее небезопасно и хуже удерживается
    let kcal = Math.round(tdee + tdee * goal.sign * (goal.sign < 0 ? 0.15 : 0.12));

    // нижние границы: не опускаемся ниже основного обмена и ниже общепринятого минимума
    const floor = Math.max(bmr, sex === 'm' ? 1500 : 1200);
    const capped = kcal < floor;
    if (capped) kcal = floor;
    kcal = Math.round(kcal / 10) * 10;

    // белок и жиры от массы тела, углеводы — остаток
    const pPerKg = goal.id === 'lose' ? 1.9 : goal.id === 'gain' ? 1.8 : 1.6;
    const p = Math.round(w * pPerKg);
    const f = Math.round(w * (goal.id === 'lose' ? 0.9 : 1.0));
    const c = Math.max(0, Math.round((kcal - p * 4 - f * 9) / 4));

    // 7700 ккал ≈ 1 кг жировой ткани
    const perWeek = +(((kcal - tdee) * 7) / 7700).toFixed(2);
    const bmi = +(w / Math.pow(h / 100, 2)).toFixed(1);

    if (capped && goal.id === 'lose') {
      warn = warn || 'Мы не опускаем норму ниже безопасного минимума, поэтому снижение будет медленнее — так вес уходит устойчивее.';
    }
    return { bmr, tdee, kcal, p, f, c, perWeek, bmi, capped, floor, warn, goal: goal.id, adjusted: goal.id !== d.goal };
  },
  /* Форма калькулятора + результат. m — объект kbju из профиля. */
  kbjuForm(m) {
    const r = NC.kbjuCalc(m.calc || {});
    const c = m.calc || {};
    const sexBtn = (id, label) => `<button type="button" class="chip ${c.sex === id ? 'on' : ''}" data-calc-sex="${id}">${label}</button>`;
    return `<div class="calc">
      <div class="chips">${sexBtn('f', 'Женщина')}${sexBtn('m', 'Мужчина')}</div>
      <div class="calc-grid">
        <label><span class="mono">Возраст</span><input data-calc="age" value="${NC.esc(c.age || '')}" inputmode="numeric" placeholder="30"></label>
        <label><span class="mono">Рост, см</span><input data-calc="height" value="${NC.esc(c.height || '')}" inputmode="numeric" placeholder="165"></label>
        <label><span class="mono">Вес, кг</span><input data-calc="weight" value="${NC.esc(c.weight || '')}" inputmode="decimal" placeholder="62"></label>
      </div>
      <span class="mono">Активность</span>
      <div class="chips">${NC.ACTIVITY.map(a =>
        `<button type="button" class="chip ${c.activity === a.id ? 'on' : ''}" data-calc-act="${a.id}" title="${a.note}">${a.label}</button>`).join('')}</div>
      <span class="mono">Цель</span>
      <div class="chips">${NC.GOALS.map(g =>
        `<button type="button" class="chip ${c.goal === g.id ? 'on' : ''}" data-calc-goal="${g.id}">${g.label}</button>`).join('')}</div>
      ${r ? `
        <div class="calc-out">
          <div class="calc-main"><b>${r.kcal}</b><s>ккал в день</s></div>
          <div class="calc-macros">
            <span><b>${r.p}</b><s>белки, г</s></span>
            <span><b>${r.f}</b><s>жиры, г</s></span>
            <span><b>${r.c}</b><s>углеводы, г</s></span>
          </div>
          <div class="calc-note">
            ${r.perWeek ? `<span>При такой норме вес будет меняться примерно на <b>${Math.abs(r.perWeek)} кг в неделю</b> — это около ${Math.abs(+(r.perWeek * 4.3).toFixed(1))} кг в месяц.</span>`
              : '<span>Эта норма рассчитана на удержание текущего веса.</span>'}
            <span class="muted">Основной обмен ${r.bmr} ккал, расход с активностью ${r.tdee} ккал. Индекс массы тела ${r.bmi}.</span>
          </div>
          ${r.warn ? `<div class="calc-warn">${NC.esc(r.warn)}</div>` : ''}
          <button type="button" class="btn sm" data-calc-apply style="align-self:flex-start">Использовать эти цифры</button>
        </div>`
        : '<span class="q-note">Заполните возраст, рост и вес — расчёт появится здесь.</span>'}
      <span class="q-note">Расчёт ориентировочный: формула Миффлина–Сан Жеора не учитывает состав тела и состояние здоровья. Если есть хронические заболевания, беременность или наблюдение у специалиста — опирайтесь на его рекомендации.</span>
    </div>`;
  },
  /* обработчики калькулятора; onChange вызывается после каждого изменения */
  bindCalc(host, m, onChange) {
    const calc = m.calc || (m.calc = {});
    const upd = () => onChange && onChange();
    host.querySelectorAll('[data-calc]').forEach(el => el.oninput = () => { calc[el.dataset.calc] = el.value; upd(); });
    host.querySelectorAll('[data-calc-sex]').forEach(b => b.onclick = () => { calc.sex = b.dataset.calcSex; upd(); });
    host.querySelectorAll('[data-calc-act]').forEach(b => b.onclick = () => { calc.activity = b.dataset.calcAct; upd(); });
    host.querySelectorAll('[data-calc-goal]').forEach(b => b.onclick = () => { calc.goal = b.dataset.calcGoal; upd(); });
    const ap = host.querySelector('[data-calc-apply]');
    if (ap) ap.onclick = () => {
      const r = NC.kbjuCalc(calc);
      if (!r) return NC.toast('Заполните возраст, рост и вес');
      m.on = true; m.kcal = r.kcal; m.p = r.p; m.f = r.f; m.c = r.c; m.mode = 'manual';
      NC.toast('Норма подставлена');
      upd();
    };
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