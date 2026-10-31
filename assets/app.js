// Carrinho e envio do pedido pelo WhatsApp. Os itens vêm de window.CARDAPIO (gerado por build/site.js).
(() => {
  const { loja: LOJA, whatsapp: WA, itens: ITENS } = window.CARDAPIO;
  const byId = Object.fromEntries(ITENS.map((i) => [i.id, i]));
  const KEY = 'lanio-pedido-v1';
  const $ = (s) => document.querySelector(s);
  const brl = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // ---------- estado (salvo no aparelho do cliente, para não perder o pedido ao recarregar) ----------
  let state = { cart: {}, form: { tipo: 'entrega' } };
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && s.cart) state = { cart: s.cart, form: { tipo: 'entrega', ...s.form } };
  } catch (e) { /* armazenamento indisponível: segue sem salvar */ }
  for (const id of Object.keys(state.cart)) if (!byId[id]) delete state.cart[id]; // item saiu do cardápio
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignora */ } };

  const qtyOf = (id) => (state.cart[id] ? state.cart[id].qty : 0);
  const linhas = () => ITENS.filter((i) => qtyOf(i.id)).map((i) => ({ ...i, qty: qtyOf(i.id), note: state.cart[i.id].note || '' }));
  const total = () => linhas().reduce((a, l) => a + l.qty * l.valor, 0);
  const contagem = () => linhas().reduce((a, l) => a + l.qty, 0);

  function setQty(id, q) {
    q = Math.max(0, Math.min(99, q));
    if (q === 0) delete state.cart[id];
    else state.cart[id] = { qty: q, note: state.cart[id] ? state.cart[id].note : '' };
    save();
    update();
  }

  // ---------- tela ----------
  const sheet = $('#sheet'), form = $('#order'), lista = $('#cart-list');

  function update() {
    document.querySelectorAll('.menu .item').forEach((li) => {
      const id = li.dataset.id, q = qtyOf(id);
      li.classList.toggle('on', q > 0);
      li.querySelector('.qty').textContent = q;
      const n = li.querySelector('[data-note]');
      if (document.activeElement !== n) n.value = state.cart[id] ? state.cart[id].note : '';
    });
    const c = contagem();
    $('#cartbar').hidden = c === 0;
    $('#cb-count').textContent = c === 1 ? '1 item' : `${c} itens`;
    $('#cb-total').textContent = brl(total());
    renderCarrinho();
  }

  function renderCarrinho() {
    const ls = linhas();
    lista.innerHTML = ls.length
      ? ls.map((l) => `<li class="item on" data-id="${l.id}">
          <div class="info"><span class="name">${esc(l.nome)}</span><span class="price">${brl(l.qty * l.valor)}</span><span class="unit">${l.qty} × ${esc(l.preco)}</span></div>
          <div class="ctl"><div class="stepper"><button type="button" data-act="dec" aria-label="Tirar um ${esc(l.nome)}">−</button><output class="qty">${l.qty}</output><button type="button" data-act="inc" aria-label="Mais um ${esc(l.nome)}">+</button></div></div>
          <input class="note" data-note type="text" maxlength="120" placeholder="Observação (opcional): ex. bem passado" aria-label="Observação para ${esc(l.nome)}" value="${esc(l.note)}">
        </li>`).join('')
      : '<li class="empty">Seu pedido está vazio. Adicione itens no cardápio.</li>';
    $('#cart-total').textContent = brl(total());
    $('#send').disabled = !ls.length;
  }

  // ---------- formulário ----------
  function lerForm() {
    const fd = new FormData(form), f = {};
    for (const k of ['nome', 'tipo', 'endereco', 'referencia', 'pagamento', 'troco', 'obs']) f[k] = (fd.get(k) || '').toString();
    return f;
  }
  function aplicarCondicionais() {
    form.querySelector('[data-show="entrega"]').hidden = state.form.tipo === 'retirada';
    form.querySelector('[data-show="dinheiro"]').hidden = state.form.pagamento !== 'dinheiro';
  }
  function restaurarForm() {
    for (const [k, v] of Object.entries(state.form)) {
      const els = form.querySelectorAll(`[name="${k}"]`);
      els.forEach((el) => { if (el.type === 'radio') el.checked = el.value === v; else el.value = v; });
    }
    aplicarCondicionais();
  }
  form.addEventListener('input', (e) => {
    if (e.target.matches('[data-note]')) return;
    state.form = lerForm();
    e.target.removeAttribute('aria-invalid');
    const fs = e.target.closest('fieldset'); if (fs) fs.removeAttribute('aria-invalid');
    save();
    aplicarCondicionais();
    // depois de uma tentativa de envio, o aviso acompanha o que ainda falta
    if ($('#err').textContent) {
      const faltando = validar(state.form);
      $('#err').textContent = faltando.length ? 'Falta preencher: ' + faltando.join(', ') + '.' : '';
    }
  });

  function validar(f) {
    const faltando = [];
    const marca = (sel, ok) => { const el = form.querySelector(sel); if (ok) el.removeAttribute('aria-invalid'); else el.setAttribute('aria-invalid', 'true'); return ok; };
    if (!marca('#f-nome', f.nome.trim())) faltando.push('seu nome');
    if (!marca('fieldset:has([name="tipo"])', f.tipo)) faltando.push('entrega ou retirada');
    if (f.tipo === 'entrega' && !marca('#f-end', f.endereco.trim())) faltando.push('o endereço de entrega');
    if (!marca('fieldset:has([name="pagamento"])', f.pagamento)) faltando.push('a forma de pagamento');
    return faltando;
  }

  function mensagem(f) {
    const pag = { pix: 'Pix', cartao: 'Cartão', dinheiro: 'Dinheiro' }[f.pagamento];
    const troco = f.troco.trim() ? ` (troco para ${/^r\$/i.test(f.troco.trim()) ? f.troco.trim() : 'R$ ' + f.troco.trim()})` : '';
    const ls = linhas();
    return [
      `*Novo pedido | ${LOJA}*`,
      '',
      ...ls.flatMap((l) => [`${l.qty}x ${l.nome} | ${brl(l.qty * l.valor)}`, ...(l.note.trim() ? [`   Obs.: ${l.note.trim()}`] : [])]),
      '',
      `*Total: ${brl(total())}*`,
      '',
      `*Nome:* ${f.nome.trim()}`,
      f.tipo === 'retirada' ? '*Retirada no local*' : `*Entrega:* ${f.endereco.trim()}`,
      ...(f.tipo !== 'retirada' && f.referencia.trim() ? [`*Referência:* ${f.referencia.trim()}`] : []),
      `*Pagamento:* ${pag}${f.pagamento === 'dinheiro' ? troco : ''}`,
      ...(f.obs.trim() ? [`*Observações:* ${f.obs.trim()}`] : []),
    ].join('\n');
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!linhas().length) return;
    const f = lerForm();
    const faltando = validar(f);
    if (faltando.length) {
      $('#err').textContent = 'Falta preencher: ' + faltando.join(', ') + '.';
      const primeiro = form.querySelector('[aria-invalid="true"]');
      if (primeiro) primeiro.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    $('#err').textContent = '';
    window.location.href = `https://wa.me/${WA}?text=${encodeURIComponent(mensagem(f))}`;
  });

  // ---------- ações (botões +, −, abrir, fechar, limpar) ----------
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    const li = b.closest('[data-id]'), id = li && li.dataset.id;
    if (act === 'add' || act === 'inc') setQty(id, qtyOf(id) + 1);
    else if (act === 'dec') setQty(id, qtyOf(id) - 1);
    else if (act === 'open') { renderCarrinho(); sheet.showModal(); }
    else if (act === 'close') sheet.close();
    else if (act === 'clear' && confirm('Tirar todos os itens do pedido?')) { state.cart = {}; save(); update(); sheet.close(); }
  });
  sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.close(); }); // toque fora fecha

  // observação por item: vale tanto no cardápio quanto na folha do pedido
  document.addEventListener('input', (e) => {
    if (!e.target.matches('[data-note]')) return;
    const id = e.target.closest('[data-id]').dataset.id;
    if (!state.cart[id]) return;
    state.cart[id].note = e.target.value;
    save();
    document.querySelectorAll(`[data-id="${id}"] [data-note]`).forEach((n) => { if (n !== e.target) n.value = e.target.value; });
  });

  // ---------- categoria ativa no menu do topo ----------
  const chips = [...document.querySelectorAll('.cats a')];
  const marcar = (id) => chips.forEach((a) => {
    const on = a.getAttribute('href') === '#' + id;
    a.classList.toggle('on', on);
    if (on) a.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  });
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((ents) => {
      ents.filter((en) => en.isIntersecting).forEach((en) => marcar(en.target.id));
    }, { rootMargin: '-80px 0px -70% 0px' });
    document.querySelectorAll('.cat').forEach((s) => io.observe(s));
  }

  restaurarForm();
  update();
})();
