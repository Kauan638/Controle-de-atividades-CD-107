// ============================================================
// Ajuste de Pulmão/Apanha — app.js
// ============================================================

const screens = {
  login: document.getElementById('screen-login'),
  menu: document.getElementById('screen-menu'),
  form: document.getElementById('screen-form'),
  success: document.getElementById('screen-success'),
};

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
}

let operador = null;       // { matricula, nome }
let tipoAtual = null;      // 'apanha' | 'pulmao'
let itemEncontrado = null; // { codigo, descricao } | null
let lookupTimer = null;

// ---------------- Sessão ----------------
function carregarSessao() {
  const raw = sessionStorage.getItem('operador');
  if (raw) {
    operador = JSON.parse(raw);
    entrarNoMenu();
  }
}

function salvarSessao() {
  sessionStorage.setItem('operador', JSON.stringify(operador));
}

function limparSessao() {
  sessionStorage.removeItem('operador');
  operador = null;
  document.getElementById('in-matricula').value = '';
  document.getElementById('in-senha').value = '';
  showScreen('login');
}

// ---------------- Login ----------------
document.getElementById('btn-login').addEventListener('click', fazerLogin);
document.getElementById('in-senha').addEventListener('keydown', e => {
  if (e.key === 'Enter') fazerLogin();
});

async function fazerLogin() {
  const matricula = document.getElementById('in-matricula').value.trim();
  const senha = document.getElementById('in-senha').value.trim();
  const errBox = document.getElementById('login-error');
  errBox.textContent = '';

  if (!matricula || !senha) {
    errBox.textContent = 'Preencha matrícula e senha.';
    return;
  }

  const btn = document.getElementById('btn-login');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Entrando…';

  try {
    const doc = await db.collection('operadores').doc(matricula).get();
    if (!doc.exists) {
      errBox.textContent = 'Matrícula não encontrada.';
      return;
    }
    const data = doc.data();
    if (data.ativo === false) {
      errBox.textContent = 'Matrícula inativa. Fale com a mesa.';
      return;
    }
    if (String(data.senha) !== senha) {
      errBox.textContent = 'Senha incorreta.';
      return;
    }
    operador = { matricula, nome: data.nome || matricula };
    salvarSessao();
    entrarNoMenu();
  } catch (e) {
    console.error(e);
    errBox.textContent = 'Erro ao conectar. Verifique a internet.';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Entrar';
  }
}

function entrarNoMenu() {
  document.getElementById('menu-nome').textContent = operador.nome;
  document.getElementById('menu-matricula').textContent = ' · ' + operador.matricula;
  showScreen('menu');
}

document.getElementById('btn-logout').addEventListener('click', limparSessao);

// ---------------- Escolha Apanha / Pulmão ----------------
document.querySelectorAll('.choice-card').forEach(card => {
  card.addEventListener('click', () => abrirForm(card.dataset.tipo));
});

function abrirForm(tipo) {
  tipoAtual = tipo;
  itemEncontrado = null;
  document.getElementById('in-endereco').value = '';
  document.getElementById('in-qtd').value = '';
  document.getElementById('form-error').textContent = '';
  resetLookupBox();

  const badge = document.getElementById('form-badge');
  badge.textContent = tipo.toUpperCase();
  badge.className = 'badge ' + tipo;
  document.getElementById('form-nome').textContent = operador.nome;

  atualizarBotaoConfirmar();
  showScreen('form');
  setTimeout(() => document.getElementById('in-endereco').focus(), 150);
}

document.getElementById('btn-voltar-menu').addEventListener('click', () => showScreen('menu'));

// ---------------- Lookup de endereço ----------------
function resetLookupBox() {
  const box = document.getElementById('lookup-box');
  box.className = 'lookup-box';
  box.innerHTML = '<span class="placeholder">Digite o endereço para buscar o item…</span>';
}

document.getElementById('in-endereco').addEventListener('input', () => {
  itemEncontrado = null;
  atualizarBotaoConfirmar();
  clearTimeout(lookupTimer);
  const endereco = document.getElementById('in-endereco').value.trim();
  if (!endereco) { resetLookupBox(); return; }

  const box = document.getElementById('lookup-box');
  box.className = 'lookup-box';
  box.innerHTML = '<span class="placeholder"><span class="spinner" style="border-top-color:var(--amber)"></span>Buscando…</span>';

  lookupTimer = setTimeout(() => buscarEndereco(endereco), 450);
});

document.getElementById('in-qtd').addEventListener('input', atualizarBotaoConfirmar);

async function buscarEndereco(endereco) {
  const box = document.getElementById('lookup-box');
  try {
    const doc = await db.collection('enderecos').doc(endereco).get();
    // se o usuário já digitou outro endereço enquanto isso, ignora resultado velho
    if (document.getElementById('in-endereco').value.trim() !== endereco) return;

    if (!doc.exists) {
      itemEncontrado = null;
      box.className = 'lookup-box notfound';
      box.innerHTML = '<span class="status-icon">✕</span><div class="info"><div class="desc">Endereço não encontrado</div><div class="cod">Confira o endereço digitado</div></div>';
    } else {
      const data = doc.data();
      itemEncontrado = { codigo: data.codigo, descricao: data.descricao };
      box.className = 'lookup-box found';
      box.innerHTML = `<span class="status-icon">✓</span><div class="info"><div class="desc">${escapeHtml(data.descricao)}</div><div class="cod">Cód. ${escapeHtml(String(data.codigo))}</div></div>`;
    }
  } catch (e) {
    console.error(e);
    itemEncontrado = null;
    box.className = 'lookup-box notfound';
    box.innerHTML = '<span class="status-icon">⚠</span><div class="info"><div class="desc">Erro ao buscar</div><div class="cod">Tente novamente</div></div>';
  }
  atualizarBotaoConfirmar();
}

function atualizarBotaoConfirmar() {
  const qtd = parseInt(document.getElementById('in-qtd').value, 10);
  const ok = itemEncontrado && qtd > 0;
  document.getElementById('btn-confirmar').disabled = !ok;
}

// ---------------- Modal de confirmação ----------------
const modal = document.getElementById('modal-confirm');

document.getElementById('btn-confirmar').addEventListener('click', () => {
  if (!itemEncontrado) return;
  document.getElementById('modal-desc').textContent = itemEncontrado.descricao;
  document.getElementById('modal-cod').textContent = itemEncontrado.codigo;
  modal.classList.add('active');
});

document.getElementById('modal-nao').addEventListener('click', () => modal.classList.remove('active'));

document.getElementById('modal-sim').addEventListener('click', async () => {
  const btnSim = document.getElementById('modal-sim');
  btnSim.disabled = true;
  btnSim.innerHTML = '<span class="spinner"></span>Salvando…';

  const endereco = document.getElementById('in-endereco').value.trim();
  const qtd = parseInt(document.getElementById('in-qtd').value, 10);

  try {
    await db.collection('ajustes').add({
      matricula: operador.matricula,
      nome: operador.nome,
      tipo: tipoAtual,
      endereco: endereco,
      codigo: itemEncontrado.codigo,
      descricao: itemEncontrado.descricao,
      qtd: qtd,
      timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });

    modal.classList.remove('active');
    document.getElementById('success-desc').textContent =
      `${itemEncontrado.descricao} · ${qtd}cx · ${endereco}`;
    showScreen('success');

    setTimeout(() => showScreen('menu'), 2200);
  } catch (e) {
    console.error(e);
    document.getElementById('form-error').textContent = 'Erro ao salvar. Tente novamente.';
    modal.classList.remove('active');
  } finally {
    btnSim.disabled = false;
    btnSim.textContent = 'Sim';
  }
});

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---------------- Boot ----------------
carregarSessao();
