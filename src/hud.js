(function (G) {
  'use strict';

  // Indicador de combate (abajo a la derecha, se puede mover con el editor de botones):
  // icono blanco del arma, balas "cargador | reserva" y la vida como un arco alrededor.
  //   toque corto     cambio rápido al arma anterior
  //   mantener        se despliega el selector: deslizas sin soltar hasta un arma (o una venda)
  //                   y al soltar la eliges (o te vendas)
  // En PC: Q igual (tocar = cambio rápido, mantener = selector, se elige moviendo el ratón).

  const HOLD_MS = 260;
  let root = null, sel = null, player = null;
  let ring = null, icon = null, mag = null, res = null, pips = null, name = null, med = null;
  let open = false, hl = null, timer = null, pid = null, cards = [];
  let kbd = null;                 // selección con el ratón (PC): { x, y }
  let key = '';
  const onMsg = (m, k) => { if (HUD.onMessage) HUD.onMessage(m, k); };
  const el = (id) => document.getElementById(id);
  const W = () => G.Weapons;

  // ---------- Arco de vida ----------
  // de abajo (110°) a arriba (-110°) por la derecha, con pathLength 100
  function arcPath(cx, cy, r) {
    const a0 = 110 * Math.PI / 180, a1 = -110 * Math.PI / 180;
    const p = (a) => (cx + r * Math.cos(a)).toFixed(1) + ' ' + (cy + r * Math.sin(a)).toFixed(1);
    return 'M ' + p(a0) + ' A ' + r + ' ' + r + ' 0 1 0 ' + p(a1);
  }

  function init() {
    root = el('wpn'); sel = el('wsel');
    if (!root) return;
    const d = arcPath(60, 60, 52);
    root.querySelector('.wpn-ring').innerHTML =
      '<path class="ring-bg" pathLength="100" d="' + d + '"/><path class="ring-hp" pathLength="100" d="' + d + '"/>';
    ring = root.querySelector('.ring-hp');
    icon = root.querySelector('.wpn-ic'); mag = root.querySelector('.wpn-mag'); res = root.querySelector('.wpn-res');
    pips = root.querySelector('.wpn-pips'); name = root.querySelector('.wpn-name'); med = root.querySelector('.wpn-med');

    root.addEventListener('pointerdown', (e) => {
      if (G.Input.editing || !G.Input.enabled) return;
      e.preventDefault(); e.stopPropagation();
      pid = e.pointerId;
      try { root.setPointerCapture(pid); } catch (er) { /* nada */ }
      clearTimeout(timer);
      timer = setTimeout(() => { timer = null; openSel(); highlight(e.clientX, e.clientY); }, HOLD_MS);
    });
    root.addEventListener('pointermove', (e) => { if (open && e.pointerId === pid) highlight(e.clientX, e.clientY); });
    const up = (e) => {
      if (e.pointerId !== pid) return;
      pid = null;
      if (timer) { clearTimeout(timer); timer = null; quick(); return; }
      if (open) { pick(); closeSel(); }
    };
    root.addEventListener('pointerup', up);
    root.addEventListener('pointercancel', (e) => { if (e.pointerId === pid) { pid = null; clearTimeout(timer); timer = null; closeSel(); } });

    // PC: Q
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'KeyQ' || e.repeat || !G.Input.enabled || G.Input.editing) return;
      e.preventDefault();
      clearTimeout(timer);
      timer = setTimeout(() => { timer = null; openSel(); kbd = { x: 0, y: 0 }; kbdHighlight(); }, HOLD_MS);
    });
    window.addEventListener('keyup', (e) => {
      if (e.code !== 'KeyQ') return;
      if (timer) { clearTimeout(timer); timer = null; if (G.Input.enabled) quick(); return; }
      if (open) { pick(); closeSel(); }
    });
    window.addEventListener('mousemove', (e) => {
      if (!open || !kbd) return;
      kbd.x += e.movementX || 0; kbd.y += e.movementY || 0;
      kbdHighlight();
    });
  }

  function quick() {
    if (!player || player.dead) return;
    const m = player.quickSwap();
    if (m) onMsg(m);
  }

  // ---------- Selector ----------
  const SLOT_NAMES = ['Cuerpo a cuerpo', 'Pistola', 'Arma larga 1', 'Arma larga 2'];
  function cardHtml(c) {
    const u = c.id ? G.Icons.white(c.id) : null;
    return '<div class="ws-card' + (c.empty ? ' empty' : '') + (c.on ? ' on' : '') + (c.broken ? ' broken' : '') + '" data-k="' + c.k + '">' +
      '<span class="ws-ic">' + (u ? '<img alt="" src="' + u + '">' : (c.glyph || '')) + '</span>' +
      '<span class="ws-tx"><span class="ws-nm">' + c.name + '</span><span class="ws-ct">' + (c.txt || '') + '</span></span></div>';
  }
  function weaponText(s) {
    const w = W().get(s.id);
    if (W().isGun(w)) return s.broken ? 'ROTA' : (w.gun === 'bow' ? (s.mag ? '1' : '0') + ' | ' + player.ammo.flecha : s.mag + ' | ' + player.ammo[w.ammo]);
    return Math.max(0, Math.round(s.cond * w.cond)) + ' golpes';
  }
  function buildCards() {
    const p = player;
    const weapons = [0, 1, 2, 3].map((i) => {
      const s = p.hands[i];
      return s ? { k: 'w' + i, id: s.id, name: W().get(s.id).name, txt: weaponText(s), on: p.cur === i, broken: !!s.broken }
        : { k: 'w' + i, name: SLOT_NAMES[i], txt: 'vacío', empty: true };
    });
    weapons.push({ k: 'w-1', name: 'Manos libres', txt: '', on: p.cur === -1, glyph: '<b>✋</b>' });
    const items = [
      { k: 'i:venda', id: 'venda', name: 'Venda', txt: 'x' + p.items.venda, empty: !p.items.venda },
      { k: 'i:venda_d', id: 'venda_d', name: 'Venda desinfectada', txt: 'x' + p.items.venda_d, empty: !p.items.venda_d }
    ];
    return { weapons, items };
  }
  function openSel() {
    if (!player || player.dead || !sel) return;
    open = true; hl = null;
    G.Input.blockLook = true;
    const { weapons, items } = buildCards();
    sel.innerHTML = '<div class="ws-col ws-items">' + items.map(cardHtml).join('') + '</div>' +
      '<div class="ws-col ws-weapons">' + weapons.map(cardHtml).join('') + '</div>';
    sel.classList.remove('hidden');
    // se abre hacia el centro de la pantalla, junto al indicador
    const r = root.getBoundingClientRect(), Wd = window.innerWidth, H = window.innerHeight;
    const sw = sel.offsetWidth, sh = sel.offsetHeight;
    let x = r.left + r.width / 2 > Wd / 2 ? r.left - sw - 8 : r.right + 8;
    let y = r.top + r.height / 2 > H / 2 ? r.bottom - sh : r.top;
    x = Math.max(6, Math.min(Wd - sw - 6, x)); y = Math.max(6, Math.min(H - sh - 6, y));
    sel.style.left = x + 'px'; sel.style.top = y + 'px';
    cards = Array.from(sel.querySelectorAll('.ws-card'));
  }
  function closeSel() {
    open = false; kbd = null; hl = null;
    G.Input.blockLook = false;
    if (sel) sel.classList.add('hidden');
  }
  function setHl(c) {
    if (hl === c) return;
    if (hl) hl.classList.remove('hl');
    hl = c;
    if (hl) hl.classList.add('hl');
  }
  function highlight(x, y) {
    let best = null;
    for (const c of cards) {
      const r = c.getBoundingClientRect();
      if (x >= r.left - 6 && x <= r.right + 6 && y >= r.top - 3 && y <= r.bottom + 3) best = c;
    }
    setHl(best);
  }
  // PC: el ratón mueve la selección (filas de 46 px; a la izquierda, la columna de vendas)
  function kbdHighlight() {
    const col = kbd.x < -70 ? sel.querySelectorAll('.ws-items .ws-card') : sel.querySelectorAll('.ws-weapons .ws-card');
    const list = Array.from(col);
    const cur = list.findIndex((c) => c.classList.contains('on'));
    let i = (cur >= 0 ? cur : 0) + Math.round(kbd.y / 46);
    i = Math.max(0, Math.min(list.length - 1, i));
    setHl(list[i]);
  }
  function pick() {
    if (!hl || !player) return;
    const k = hl.dataset.k;
    if (k.charAt(0) === 'w') {
      const i = parseInt(k.slice(1), 10);
      if (i >= 0 && !player.hands[i]) return;
      if (player.busy()) { onMsg('Ahora no puedes cambiar de arma'); return; }
      if (i !== player.cur) { player.equip(i); onMsg(i >= 0 ? 'En las manos: ' + player.weapon.name : 'Manos libres'); }
    } else {
      const m = player.startBandage(k.slice(2));
      if (m) onMsg(m, 'warn');
    }
  }

  // ---------- Cada fotograma ----------
  function update(p, state) {
    player = p;
    if (!root) return;
    const s = p.slot, w = p.weapon, gun = W().isGun(w) && !!s;
    const hp = Math.max(0, Math.round(p.health));
    const k2 = [hp, p.bleeding, p.infected, p.cur, s ? s.id + (s.broken ? 'R' : '') : '', s ? s.mag : '', s ? Math.round((s.cond || 0) * 100) : '',
      gun ? p.ammo[w.ammo] : '', p.items.venda + p.items.venda_d * 10, p.backpack].join('|');
    if (k2 === key) return;
    key = k2;
    ring.style.strokeDasharray = hp + ' 100';
    root.classList.toggle('bleed', p.bleeding);
    root.classList.toggle('sick', !!p.infected);
    root.classList.toggle('low', hp < 30);
    const u = s ? G.Icons.white(s.id) : null;
    if (u) { icon.src = u; icon.classList.remove('hidden'); } else icon.classList.add('hidden');
    name.textContent = s ? '' : 'Manos libres';
    root.classList.toggle('gun', gun);
    root.classList.toggle('broken', !!(s && s.broken));
    if (gun) {
      const bow = w.gun === 'bow';
      mag.textContent = s.broken ? '—' : (bow ? (s.mag ? 1 : 0) : s.mag);
      const r = p.ammo[w.ammo];
      res.textContent = r;
      res.classList.toggle('full', r >= p.ammoCap(w.ammo));
      // munición del cargador como rayitas (como en el juego de referencia)
      const n = bow ? 1 : w.mag;
      let h = '';
      for (let i = 0; i < n; i++) h += '<i' + (i < s.mag ? ' class="on"' : '') + '></i>';
      pips.innerHTML = h;
    } else if (s) {
      // cuerpo a cuerpo: golpes que le quedan
      const n = w.cond, left = Math.max(0, Math.round(s.cond * n));
      mag.textContent = ''; res.textContent = '';
      let h = '';
      for (let i = 0; i < n; i++) h += '<i' + (i < left ? ' class="on"' : '') + '></i>';
      pips.innerHTML = h;
    } else { mag.textContent = ''; res.textContent = ''; pips.innerHTML = ''; }
    const nv = p.items.venda + p.items.venda_d;
    med.classList.toggle('hidden', !nv);
    if (nv) med.innerHTML = '<img alt="" src="' + (G.Icons.white(p.items.venda_d ? 'venda_d' : 'venda') || '') + '"><span>' + nv + '</span>';
  }

  const HUD = { init, update, get selecting() { return open; }, onMessage: null };
  G.HUD = HUD;
})(window.Game = window.Game || {});
