// ============================================================
// Ajuste de Pulmão/Apanha — app.js (MODO LOCAL, sem Firebase)
// Dados guardados no localStorage. Quando plugarmos o Firebase,
// só trocamos as funções DB.* por chamadas ao Firestore — o
// resto do app não muda.
// ============================================================

// ---------------- "Banco de dados" local ----------------
const DB = {
  getEnderecos() {
    return JSON.parse(localStorage.getItem('enderecos') || '{}');
  },
  setEnderecos(obj) {
    localStorage.setItem('enderecos', JSON.stringify(obj));
  },
  getOperadores() {
    return JSON.parse(localStorage.getItem('operadores') || '[]');
  },
  setOperadores(arr) {
    localStorage.setItem('operadores', JSON.stringify(arr));
  },
  getAjustes() {
    return JSON.parse(localStorage.getItem('ajustes') || '[]');
  },
  addAjuste(ajuste) {
    const arr = DB.getAjustes();
    arr.unshift(ajuste); // mais recente primeiro
    localStorage.setItem('ajustes', JSON.stringify(arr));
  }
};

function seedDadosExemplo() {
  DB.setEnderecos({
    '60.121.2.1': { codigo: '48213', descricao: 'Refrigerante Cola 2L' },
    '72.124.31': { codigo: '51890', descricao: 'Sabão em Pó 1kg' }
  });
  DB.setOperadores([
    { matricula: '225946', nome: 'Operador Teste' }
  ]);
  localStorage.setItem('ajustes', '[]');
}

// Primeira vez que o app abre neste navegador: já popula com exemplo
if (localStorage.getItem('enderecos') === null) {
  seedDadosExemplo();
}

// ---------------- Navegação entre telas ----------------
const screens = {
  role: document.getElementById('screen-role'),
  login: document.getElementById('screen-login'),
  mesa: document.getElementById('screen-mesa'),
  menu: document.getElementById('screen-menu'),
  form: document.getElementById('screen-form'),
  success: document.getElementById('screen-success'),
};
function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
}

let papelSelecionado = null; // 'mesa' | 'operador'
let operador = null;         // { matricula, nome }
let tipoAtual = null;        // 'apanha' | 'pulmao'
let itemEncontrado = null;   // { codigo, descricao } | null

// ---------------- Tela 1: escolher papel ----------------
document.querySelectorAll('#screen-role .choice-card').forEach(card => {
  card.addEventListener('click', () => {
    papelSelecionado = card.dataset.role;
    abrirLogin();
  });
});

function abrirLogin() {
  document.getElementById('in-matricula').value = '';
  document.getElementById('in-senha').value = '';
  document.getElementById('login-error').textContent = '';

  if (papelSelecionado === 'mesa') {
    document.getElementById('login-eyebrow').textContent = 'CD-107 · Mesa';
    document.getElementById('login-title').textContent = 'Login da Mesa';
  } else {
    document.getElementById('login-eyebrow').textContent = 'CD-107 · Operador';
    document.getElementById('login-title').textContent = 'Login do Operador';
  }
  showScreen('login');
  setTimeout(() => document.getElementById('in-matricula').focus(), 150);
}

document.getElementById('btn-voltar-role').addEventListener('click', () => showScreen('role'));

// ---------------- Tela 2: login (livre, por enquanto) ----------------
document.getElementById('btn-login').addEventListener('click', fazerLogin);
document.getElementById('in-senha').addEventListener('keydown', e => {
  if (e.key === 'Enter') fazerLogin();
});

function fazerLogin() {
  const matricula = document.getElementById('in-matricula').value.trim();
  const senha = document.getElementById('in-senha').value.trim();
  const errBox = document.getElementById('login-error');
  errBox.textContent = '';

  if (!matricula || !senha) {
    errBox.textContent = 'Preencha matrícula e senha.';
    return;
  }

  // MODO LOCAL: qualquer matrícula/senha entra.
  // (aqui depois entra a checagem real contra o Firestore)
  const cadastrados = DB.getOperadores();
  const cadastrado = cadastrados.find(o => o.matricula === matricula);
  const nome = cadastrado ? cadastrado.nome : ('Matrícula ' + matricula);

  operador = { matricula, nome };

  if (papelSelecionado === 'mesa') {
    entrarNaMesa();
  } else {
    entrarNoMenu();
  }
}

// ---------------- Tela Mesa ----------------
function entrarNaMesa() {
  document.getElementById('mesa-matricula').textContent = '· ' + operador.matricula;
  renderOperadoresMesa();
  renderAjustesMesa();
  atualizarContadorEnderecos();
  showScreen('mesa');
}

document.getElementById('btn-logout-mesa').addEventListener('click', () => {
  operador = null;
  showScreen('role');
});

function atualizarContadorEnderecos() {
  const qtd = Object.keys(DB.getEnderecos()).length;
  document.getElementById('qtd-enderecos').textContent = qtd;
}

// -- upload de planilha de endereços --
let arquivoSelecionado = null;

document.getElementById('in-file').addEventListener('change', (e) => {
  arquivoSelecionado = e.target.files[0] || null;
  document.getElementById('btn-upload').disabled = !arquivoSelecionado;
  document.getElementById('upload-status').textContent = '';
});

function normalizarHeader(str) {
  return String(str).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}
const HEADER_MAP = {
  endereco: ['endereco', 'end', 'enderec'],
  codigo: ['codigo', 'cod', 'codprod', 'produto'],
  descricao: ['descricao', 'desc', 'descrprod', 'nome']
};
function identificarColunas(headerRow) {
  const normalized = headerRow.map(normalizarHeader);
  const result = {};
  for (const [key, variants] of Object.entries(HEADER_MAP)) {
    let idx = -1;
    for (const v of variants) {
      idx = normalized.findIndex(h => h === v || h.startsWith(v));
      if (idx !== -1) break;
    }
    result[key] = idx;
  }
  return result;
}
function lerPlanilha(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
        resolve(rows);
      } catch (err) { reject(err); }
    };
    reader.onerror = () => reject(new Error('Falha ao ler o arquivo.'));
    reader.readAsArrayBuffer(file);
  });
}

document.getElementById('btn-upload').addEventListener('click', async () => {
  if (!arquivoSelecionado) return;
  const statusEl = document.getElementById('upload-status');
  const btn = document.getElementById('btn-upload');
  const progWrap = document.getElementById('progress-wrap');
  const progBar = document.getElementById('progress-bar');

  btn.disabled = true;
  statusEl.style.color = 'var(--text-dim)';
  statusEl.textContent = 'Lendo planilha…';
  progWrap.style.display = 'none';

  try {
    const rows = await lerPlanilha(arquivoSelecionado);
    if (rows.length < 2) throw new Error('Planilha vazia ou sem linhas de dados.');

    const cols = identificarColunas(rows[0]);
    if (cols.endereco === -1 || cols.codigo === -1 || cols.descricao === -1) {
      throw new Error('Não encontrei as colunas de Endereço/Código/Descrição no cabeçalho.');
    }

    const base = DB.getEnderecos();
    let count = 0;
    progWrap.style.display = 'block';

    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const endereco = r[cols.endereco] != null ? String(r[cols.endereco]).trim() : '';
      if (!endereco) continue;
      base[endereco] = {
        codigo: r[cols.codigo] != null ? String(r[cols.codigo]).trim() : '',
        descricao: r[cols.descricao] != null ? String(r[cols.descricao]).trim() : ''
      };
      count++;
      if (count % 200 === 0) {
        const pct = Math.round((i / rows.length) * 100);
        progBar.style.width = pct + '%';
        statusEl.textContent = `Processando ${count}…`;
        await new Promise(r => setTimeout(r, 0)); // não travar a UI
      }
    }

    DB.setEnderecos(base);
    progBar.style.width = '100%';
    statusEl.style.color = 'var(--green)';
    statusEl.textContent = `✓ Base atualizada: ${count} endereços salvos neste navegador.`;
    atualizarContadorEnderecos();
  } catch (e) {
    console.error(e);
    statusEl.style.color = 'var(--red)';
    statusEl.textContent = 'Erro: ' + e.message;
  } finally {
    btn.disabled = false;
  }
});

// -- cadastro de operadores (informativo, local) --
function renderOperadoresMesa() {
  const lista = DB.getOperadores();
  const tbody = document.getElementById('op-tbody');
  if (lista.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" style="color:var(--text-faint);">Nenhum operador cadastrado ainda.</td></tr>';
    return;
  }
  tbody.innerHTML = '';
  lista.forEach((op, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="mono">${escapeHtml(op.matricula)}</td>
      <td>${escapeHtml(op.nome)}</td>
      <td><button class="link-btn" data-idx="${idx}">Remover</button></td>
    `;
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll('button[data-idx]').forEach(btn => {
    btn.addEventListener('click', () => {
      const arr = DB.getOperadores();
      arr.splice(Number(btn.dataset.idx), 1);
      DB.setOperadores(arr);
      renderOperadoresMesa();
    });
  });
}

document.getElementById('btn-add-op').addEventListener('click', () => {
  const matricula = document.getElementById('op-matricula').value.trim();
  const nome = document.getElementById('op-nome').value.trim();
  if (!matricula || !nome) return;
  const arr = DB.getOperadores();
  if (arr.some(o => o.matricula === matricula)) {
    arr.forEach(o => { if (o.matricula === matricula) o.nome = nome; });
  } else {
    arr.push({ matricula, nome });
  }
  DB.setOperadores(arr);
  document.getElementById('op-matricula').value = '';
  document.getElementById('op-nome').value = '';
  renderOperadoresMesa();
});

// -- log de ajustes na tela da mesa --
function renderAjustesMesa() {
  const lista = DB.getAjustes();
  const tbody = document.getElementById('ajustes-tbody');
  if (lista.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="color:var(--text-faint);">Nenhum ajuste registrado ainda.</td></tr>';
    return;
  }
  tbody.innerHTML = '';
  lista.slice(0, 30).forEach(a => {
    const tr = document.createElement('tr');
    const hora = new Date(a.timestamp).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    tr.innerHTML = `
      <td class="mono">${hora}</td>
      <td>${escapeHtml(a.matricula)}</td>
      <td><span class="badge ${a.tipo}" style="margin:0;">${a.tipo.toUpperCase()}</span></td>
      <td class="mono">${escapeHtml(a.endereco)}</td>
      <td>${escapeHtml(a.descricao)}</td>
      <td class="mono">${a.qtd}cx</td>
    `;
    tbody.appendChild(tr);
  });
}

document.getElementById('btn-reset-dados').addEventListener('click', () => {
  if (confirm('Isso apaga os dados locais (endereços, operadores, ajustes) e recarrega os dados de exemplo. Continuar?')) {
    seedDadosExemplo();
    renderOperadoresMesa();
    renderAjustesMesa();
    atualizarContadorEnderecos();
  }
});

// ============================================================
// FLUXO DO OPERADOR
// ============================================================
function entrarNoMenu() {
  document.getElementById('menu-nome').textContent = operador.nome;
  showScreen('menu');
}
document.getElementById('btn-logout-op').addEventListener('click', () => {
  operador = null;
  showScreen('role');
});

document.querySelectorAll('#screen-menu .choice-card').forEach(card => {
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

function resetLookupBox() {
  const box = document.getElementById('lookup-box');
  box.className = 'lookup-box';
  box.innerHTML = '<span class="placeholder">Digite o endereço para buscar o item…</span>';
}

document.getElementById('in-endereco').addEventListener('input', () => {
  const endereco = document.getElementById('in-endereco').value.trim();
  const box = document.getElementById('lookup-box');

  if (!endereco) { itemEncontrado = null; resetLookupBox(); atualizarBotaoConfirmar(); return; }

  const base = DB.getEnderecos();
  const item = base[endereco];

  if (!item) {
    itemEncontrado = null;
    box.className = 'lookup-box notfound';
    box.innerHTML = '<span class="status-icon">✕</span><div class="info"><div class="desc">Endereço não encontrado</div><div class="cod">Confira o endereço digitado</div></div>';
  } else {
    itemEncontrado = { codigo: item.codigo, descricao: item.descricao };
    box.className = 'lookup-box found';
    box.innerHTML = `<span class="status-icon">✓</span><div class="info"><div class="desc">${escapeHtml(item.descricao)}</div><div class="cod">Cód. ${escapeHtml(String(item.codigo))}</div></div>`;
  }
  atualizarBotaoConfirmar();
});

document.getElementById('in-qtd').addEventListener('input', atualizarBotaoConfirmar);

function atualizarBotaoConfirmar() {
  const qtd = parseInt(document.getElementById('in-qtd').value, 10);
  document.getElementById('btn-confirmar').disabled = !(itemEncontrado && qtd > 0);
}

// -- modal de confirmação --
const modal = document.getElementById('modal-confirm');
document.getElementById('btn-confirmar').addEventListener('click', () => {
  if (!itemEncontrado) return;
  document.getElementById('modal-desc').textContent = itemEncontrado.descricao;
  document.getElementById('modal-cod').textContent = itemEncontrado.codigo;
  modal.classList.add('active');
});
document.getElementById('modal-nao').addEventListener('click', () => modal.classList.remove('active'));

document.getElementById('modal-sim').addEventListener('click', () => {
  const endereco = document.getElementById('in-endereco').value.trim();
  const qtd = parseInt(document.getElementById('in-qtd').value, 10);

  DB.addAjuste({
    matricula: operador.matricula,
    nome: operador.nome,
    tipo: tipoAtual,
    endereco,
    codigo: itemEncontrado.codigo,
    descricao: itemEncontrado.descricao,
    qtd,
    timestamp: Date.now()
  });

  modal.classList.remove('active');
  document.getElementById('success-desc').textContent = `${itemEncontrado.descricao} · ${qtd}cx · ${endereco}`;
  showScreen('success');
  setTimeout(() => showScreen('menu'), 2200);
});

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
