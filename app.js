// ============================================================
// Ajuste de Pulmão/Apanha — app.js (Firebase Firestore)
// A base de endereços é salva em poucos "blocos" (documentos)
// em vez de 1 documento por endereço — isso evita estourar a
// cota gratuita de gravações do Firestore num único upload.
// Operadores e ajustes usam onSnapshot: qualquer mudança feita
// num aparelho aparece em tempo real nos outros.
// ============================================================

const CHUNK_SIZE = 4000; // endereços por bloco (~4000 fica bem abaixo do limite de 1MB/doc)

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
let enderecoSelecionado = null;

// ---------------- Cache local da base de endereços ----------------
// Carregada 1x por sessão (login) a partir dos blocos no Firestore,
// depois toda busca por código é feita na memória (rápido, sem custo).
let ENDERECOS_CACHE = null;

function getEnderecosCache() { return ENDERECOS_CACHE || {}; }

async function carregarBaseEnderecos() {
  const metaSnap = await db.collection('meta').doc('enderecos').get();
  if (!metaSnap.exists) { ENDERECOS_CACHE = {}; return; }
  const total = metaSnap.data().totalChunks || 0;
  const promises = [];
  for (let i = 0; i < total; i++) {
    promises.push(db.collection('enderecosChunks').doc('chunk_' + i).get());
  }
  const snaps = await Promise.all(promises);
  const merged = {};
  snaps.forEach(s => {
    if (s.exists) Object.assign(merged, JSON.parse(s.data().json));
  });
  ENDERECOS_CACHE = merged;
}

// Publica a base inteira em blocos no Firestore (usado pelo upload da Mesa)
async function publicarBaseEnderecos(base, indexados) {
  const chaves = Object.keys(base);
  const chunks = [];
  for (let i = 0; i < chaves.length; i += CHUNK_SIZE) {
    const slice = {};
    chaves.slice(i, i + CHUNK_SIZE).forEach(k => { slice[k] = base[k]; });
    chunks.push(slice);
  }

  let chunksAntigos = 0;
  const metaSnap = await db.collection('meta').doc('enderecos').get();
  if (metaSnap.exists) chunksAntigos = metaSnap.data().totalChunks || 0;

  for (let i = 0; i < chunks.length; i++) {
    await db.collection('enderecosChunks').doc('chunk_' + i).set({ json: JSON.stringify(chunks[i]) });
  }
  for (let i = chunks.length; i < chunksAntigos; i++) {
    await db.collection('enderecosChunks').doc('chunk_' + i).delete();
  }

  await db.collection('meta').doc('enderecos').set({
    totalChunks: chunks.length,
    totalCount: indexados,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  });

  ENDERECOS_CACHE = base;
}

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

async function fazerLogin() {
  const matricula = document.getElementById('in-matricula').value.trim();
  const senha = document.getElementById('in-senha').value.trim();
  const errBox = document.getElementById('login-error');
  const btn = document.getElementById('btn-login');
  errBox.textContent = '';

  if (!matricula || !senha) {
    errBox.textContent = 'Preencha matrícula e senha.';
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Entrando…';

  try {
    // MODO LIVRE: qualquer matrícula/senha entra.
    // Só busca o nome cadastrado no Firestore, se existir.
    let nome = 'Matrícula ' + matricula;
    try {
      const doc = await db.collection('operadores').doc(matricula).get();
      if (doc.exists && doc.data().nome) nome = doc.data().nome;
    } catch (e) { /* segue sem nome cadastrado */ }

    operador = { matricula, nome };

    if (papelSelecionado === 'mesa') {
      await entrarNaMesa();
    } else {
      await entrarNoMenu();
    }
  } catch (e) {
    console.error(e);
    errBox.textContent = 'Erro ao conectar no Firebase. Confira o firebase-config.js e as regras do Firestore.';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Entrar';
  }
}

// ============================================================
// TELA MESA
// ============================================================
async function entrarNaMesa() {
  document.getElementById('mesa-matricula').textContent = '· ' + operador.matricula;
  showScreen('mesa');
  document.getElementById('qtd-enderecos').textContent = 'carregando…';

  await carregarBaseEnderecos();
  atualizarContadorEnderecos();
  attachMesaListeners();
}

document.getElementById('btn-logout-mesa').addEventListener('click', () => {
  operador = null;
  showScreen('role');
});

function atualizarContadorEnderecos() {
  document.getElementById('qtd-enderecos').textContent = Object.keys(getEnderecosCache()).length;
}

// -- listeners em tempo real: operadores e ajustes --
let unsubOperadores = null;
let unsubAjustes = null;

function attachMesaListeners() {
  if (unsubOperadores) return; // já ativos, não duplica

  unsubOperadores = db.collection('operadores').orderBy('nome').onSnapshot(
    snap => {
      const lista = [];
      snap.forEach(doc => lista.push({ matricula: doc.id, nome: doc.data().nome || '' }));
      renderOperadoresMesa(lista);
    },
    err => console.error('Erro ao ouvir operadores:', err)
  );

  unsubAjustes = db.collection('ajustes').orderBy('timestamp', 'desc').limit(30).onSnapshot(
    snap => {
      const lista = [];
      snap.forEach(doc => lista.push(doc.data()));
      renderAjustesMesa(lista);
    },
    err => console.error('Erro ao ouvir ajustes:', err)
  );
}

// -- upload de planilha/arquivo de endereços --
let arquivoSelecionado = null;

document.getElementById('in-file').addEventListener('change', (e) => {
  arquivoSelecionado = e.target.files[0] || null;
  document.getElementById('btn-upload').disabled = !arquivoSelecionado;
  document.getElementById('upload-status').textContent = '';
  const nameEl = document.getElementById('file-name-display');
  if (arquivoSelecionado) {
    nameEl.textContent = arquivoSelecionado.name;
    nameEl.classList.add('has-file');
  } else {
    nameEl.textContent = 'Nenhum arquivo selecionado';
    nameEl.classList.remove('has-file');
  }
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

// -- remove zeros à esquerda de um segmento de endereço (001 -> 1), mantendo "0" --
function stripZeros(s) {
  const t = String(s || '').trim().replace(/^0+/, '');
  return t === '' ? '0' : t;
}

// -- leitura de texto delimitado (.txt / .csv), decodificando windows-1252 --
function lerTextoDelimitado(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const decoder = new TextDecoder('windows-1252');
        let texto = decoder.decode(e.target.result);
        texto = texto.replace(/^\uFEFF/, ''); // remove BOM se existir
        const linhas = texto.split(/\r\n|\n|\r/).filter(l => l.length > 0);
        if (linhas.length === 0) { resolve([]); return; }
        const candidatos = [';', ',', '\t'];
        const header = linhas[0];
        let delim = ';';
        let max = -1;
        candidatos.forEach(c => {
          const n = header.split(c).length;
          if (n > max) { max = n; delim = c; }
        });
        const rows = linhas.map(l => l.split(delim).map(c => c.trim()));
        console.log('[lerTextoDelimitado] delimitador detectado:', JSON.stringify(delim), '| colunas no cabeçalho:', rows[0].length);
        resolve(rows);
      } catch (err) { reject(err); }
    };
    reader.onerror = () => reject(new Error('Falha ao ler o arquivo.'));
    reader.readAsArrayBuffer(file);
  });
}

// -- parser específico do arquivo "Posição de Endereços" --
function ehPosicaoDeEnderecos(headerRow) {
  const normalized = headerRow.map(normalizarHeader);
  return normalized.includes('codrua') && normalized.includes('nropredio') && normalized.includes('especie_end');
}

function processarPosicaoDeEnderecos(rows) {
  const header = rows[0].map(normalizarHeader);
  const idx = {
    deposito: header.indexOf('deposito'),
    codrua: header.indexOf('codrua'),
    nropredio: header.indexOf('nropredio'),
    nroapartamento: header.indexOf('nroapartamento'),
    nrosala: header.indexOf('nrosala'),
    especie: header.indexOf('especie_end'),
    codigo: header.indexOf('codigo'),
    descricao: header.indexOf('descricao'),
    status: header.indexOf('status_endereco'),
  };

  const base = {};
  let indexados = 0;
  const total = rows.length - 1;

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const status = (r[idx.status] || '').trim();
    const codigo = (r[idx.codigo] || '').trim();
    if (status !== 'Ocupado' || !codigo) continue;

    const dep = (r[idx.deposito] || '01').trim();
    const key = [
      dep,
      stripZeros(r[idx.codrua]),
      stripZeros(r[idx.nropredio]),
      stripZeros(r[idx.nroapartamento]),
      stripZeros(r[idx.nrosala]),
    ].join('.');

    const especie = (r[idx.especie] || '').trim();
    base[key] = {
      codigo,
      descricao: (r[idx.descricao] || '').trim(),
      tipo: especie === 'Apanha' ? 'apanha' : 'pulmao'
    };
    indexados++;
  }
  return { base, indexados, total };
}

document.getElementById('btn-upload').addEventListener('click', async () => {
  if (!arquivoSelecionado) return;
  const statusEl = document.getElementById('upload-status');
  const btn = document.getElementById('btn-upload');
  const progWrap = document.getElementById('progress-wrap');
  const progBar = document.getElementById('progress-bar');

  btn.disabled = true;
  statusEl.style.color = 'var(--text-dim)';
  statusEl.textContent = 'Lendo arquivo…';
  progWrap.style.display = 'block';
  progBar.style.width = '10%';

  try {
    const nomeArquivo = arquivoSelecionado.name.toLowerCase();
    const ehXlsx = nomeArquivo.endsWith('.xlsx') || nomeArquivo.endsWith('.xls');

    const rows = ehXlsx ? await lerPlanilha(arquivoSelecionado) : await lerTextoDelimitado(arquivoSelecionado);
    if (rows.length < 2) throw new Error('Arquivo vazio ou sem linhas de dados.');

    let base, indexados, total;

    if (ehPosicaoDeEnderecos(rows[0])) {
      statusEl.textContent = 'Processando Posição de Endereços…';
      progBar.style.width = '30%';
      const resultado = processarPosicaoDeEnderecos(rows);
      base = resultado.base; indexados = resultado.indexados; total = resultado.total;
    } else {
      const cols = identificarColunas(rows[0]);
      if (cols.endereco === -1 || cols.codigo === -1 || cols.descricao === -1) {
        throw new Error('Não reconheci esse formato — nem é "Posição de Endereços" nem tem colunas de Endereço/Código/Descrição.');
      }
      base = {};
      indexados = 0;
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        const endereco = r[cols.endereco] != null ? String(r[cols.endereco]).trim() : '';
        if (!endereco) continue;
        base[endereco] = {
          codigo: r[cols.codigo] != null ? String(r[cols.codigo]).trim() : '',
          descricao: r[cols.descricao] != null ? String(r[cols.descricao]).trim() : '',
          tipo: null
        };
        indexados++;
      }
      total = rows.length - 1;
    }

    if (indexados === 0) throw new Error('Nenhum endereço ocupado/válido encontrado no arquivo.');

    statusEl.textContent = `Enviando ${indexados} endereços pro Firebase (em blocos)…`;
    progBar.style.width = '60%';

    await publicarBaseEnderecos(base, indexados);

    progBar.style.width = '100%';
    statusEl.style.color = 'var(--green)';
    statusEl.textContent = `✓ Base atualizada: ${indexados} endereços salvos no Firebase (de ${total} linhas lidas). Já vale pra todos os aparelhos.`;
    atualizarContadorEnderecos();
  } catch (e) {
    console.error(e);
    statusEl.style.color = 'var(--red)';
    statusEl.textContent = 'Erro: ' + e.message;
  } finally {
    btn.disabled = false;
  }
});

// -- cadastro de operadores (Firestore, tempo real) --
function renderOperadoresMesa(lista) {
  const tbody = document.getElementById('op-tbody');
  if (lista.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" style="color:var(--text-faint);">Nenhum operador cadastrado ainda.</td></tr>';
    return;
  }
  tbody.innerHTML = '';
  lista.forEach(op => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="mono">${escapeHtml(op.matricula)}</td>
      <td>${escapeHtml(op.nome)}</td>
      <td><button class="link-btn" data-matricula="${op.matricula}">Remover</button></td>
    `;
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll('button[data-matricula]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await db.collection('operadores').doc(btn.dataset.matricula).delete();
    });
  });
}

document.getElementById('btn-add-op').addEventListener('click', async () => {
  const matricula = document.getElementById('op-matricula').value.trim();
  const nome = document.getElementById('op-nome').value.trim();
  if (!matricula || !nome) return;
  await db.collection('operadores').doc(matricula).set({ nome }, { merge: true });
  document.getElementById('op-matricula').value = '';
  document.getElementById('op-nome').value = '';
});

// -- log de ajustes na tela da mesa (Firestore, tempo real) --
function renderAjustesMesa(lista) {
  const tbody = document.getElementById('ajustes-tbody');
  if (lista.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="color:var(--text-faint);">Nenhum ajuste registrado ainda.</td></tr>';
    return;
  }
  tbody.innerHTML = '';
  lista.forEach(a => {
    const tr = document.createElement('tr');
    const ts = (a.timestamp && a.timestamp.toDate) ? a.timestamp.toDate() : new Date();
    const hora = ts.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    tr.innerHTML = `
      <td class="mono">${hora}</td>
      <td>${escapeHtml(a.matricula || '')}</td>
      <td><span class="badge ${a.tipo}" style="margin:0;">${(a.tipo || '').toUpperCase()}</span></td>
      <td class="mono">${escapeHtml(a.endereco || '')}</td>
      <td>${escapeHtml(a.descricao || '')}</td>
      <td class="mono">${a.qtd}cx</td>
    `;
    tbody.appendChild(tr);
  });
}

// ============================================================
// FLUXO DO OPERADOR
// ============================================================
async function entrarNoMenu() {
  document.getElementById('menu-nome').textContent = operador.nome;
  showScreen('menu');
  setMenuCarregando(true);
  try {
    await carregarBaseEnderecos();
  } catch (e) {
    console.error(e);
  }
  setMenuCarregando(false);
}

function setMenuCarregando(carregando) {
  const grid = document.querySelector('#screen-menu .choice-grid');
  const aviso = document.getElementById('menu-carregando');
  if (carregando) {
    grid.style.opacity = '0.4';
    grid.style.pointerEvents = 'none';
    aviso.style.display = 'block';
  } else {
    grid.style.opacity = '1';
    grid.style.pointerEvents = 'auto';
    aviso.style.display = 'none';
  }
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
  enderecoSelecionado = null;
  document.getElementById('in-codigo').value = '';
  document.getElementById('in-qtd').value = '';
  document.getElementById('form-error').textContent = '';
  document.getElementById('lista-enderecos').innerHTML = '';
  resetLookupBox();

  const badge = document.getElementById('form-badge');
  badge.textContent = tipo.toUpperCase();
  badge.className = 'badge ' + tipo;
  document.getElementById('form-nome').textContent = operador.nome;

  atualizarBotaoConfirmar();
  showScreen('form');
  setTimeout(() => document.getElementById('in-codigo').focus(), 150);
}
document.getElementById('btn-voltar-menu').addEventListener('click', () => showScreen('menu'));

function resetLookupBox() {
  const box = document.getElementById('lookup-box');
  box.className = 'lookup-box';
  box.innerHTML = '<span class="placeholder">Digite o código para ver os endereços…</span>';
}

document.getElementById('in-codigo').addEventListener('input', () => {
  const codigo = document.getElementById('in-codigo').value.trim();
  itemEncontrado = null;
  enderecoSelecionado = null;
  resetLookupBox();
  atualizarBotaoConfirmar();

  const listaEl = document.getElementById('lista-enderecos');
  if (!codigo) { listaEl.innerHTML = ''; return; }

  const resultados = buscarPorCodigo(codigo, tipoAtual);

  if (resultados.length === 0) {
    listaEl.innerHTML = '';
    const box = document.getElementById('lookup-box');
    box.className = 'lookup-box notfound';
    box.innerHTML = '<span class="status-icon">✕</span><div class="info"><div class="desc">Nenhum endereço encontrado</div><div class="cod">Confira o código ou o tipo (Apanha/Pulmão) selecionado</div></div>';
    return;
  }

  if (resultados.length === 1) {
    listaEl.innerHTML = '';
    selecionarEndereco(resultados[0]);
    return;
  }

  renderListaEnderecos(resultados);
});

function buscarPorCodigo(codigo, tipo) {
  const base = getEnderecosCache();
  const resultados = [];
  for (const key in base) {
    const item = base[key];
    if (item.codigo === codigo && (!item.tipo || item.tipo === tipo)) {
      resultados.push({
        key,
        endereco: keyParaEnderecoAmigavel(key),
        descricao: item.descricao,
        codigo: item.codigo
      });
    }
  }
  resultados.sort((a, b) => compararEnderecos(a.key, b.key));
  return resultados;
}

function keyParaEnderecoAmigavel(key) {
  const partes = key.split('.');
  return partes.length > 1 ? partes.slice(1).join('.') : key;
}

function compararEnderecos(keyA, keyB) {
  const a = keyA.split('.').map(Number);
  const b = keyB.split('.').map(Number);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const diff = (a[i] || 0) - (b[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function renderListaEnderecos(resultados) {
  const container = document.getElementById('lista-enderecos');
  container.innerHTML = '';
  const list = document.createElement('div');
  list.className = 'addr-list';
  resultados.forEach(r => {
    const div = document.createElement('div');
    div.className = 'addr-item';
    div.innerHTML = `<span class="end">${escapeHtml(r.endereco)}</span><span class="desc">${escapeHtml(r.descricao)}</span>`;
    div.addEventListener('click', () => {
      container.querySelectorAll('.addr-item').forEach(el => el.classList.remove('sel'));
      div.classList.add('sel');
      selecionarEndereco(r);
    });
    list.appendChild(div);
  });
  container.appendChild(list);

  const box = document.getElementById('lookup-box');
  box.className = 'lookup-box';
  box.innerHTML = `<span class="placeholder">${resultados.length} endereços encontrados — escolha um acima ↑</span>`;
}

function selecionarEndereco(r) {
  itemEncontrado = { codigo: r.codigo, descricao: r.descricao };
  enderecoSelecionado = r.endereco;

  const box = document.getElementById('lookup-box');
  box.className = 'lookup-box found';
  box.innerHTML = `<span class="status-icon">✓</span><div class="info"><div class="desc">${escapeHtml(r.descricao)}</div><div class="cod">Endereço ${escapeHtml(r.endereco)} · Cód. ${escapeHtml(r.codigo)}</div></div>`;

  atualizarBotaoConfirmar();
  document.getElementById('in-qtd').focus();
}

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
  document.getElementById('modal-end').textContent = enderecoSelecionado;
  modal.classList.add('active');
});
document.getElementById('modal-nao').addEventListener('click', () => modal.classList.remove('active'));

document.getElementById('modal-sim').addEventListener('click', async () => {
  const btnSim = document.getElementById('modal-sim');
  btnSim.disabled = true;
  btnSim.innerHTML = '<span class="spinner"></span>Salvando…';

  const endereco = enderecoSelecionado;
  const qtd = parseInt(document.getElementById('in-qtd').value, 10);

  try {
    await db.collection('ajustes').add({
      matricula: operador.matricula,
      nome: operador.nome,
      tipo: tipoAtual,
      endereco,
      codigo: itemEncontrado.codigo,
      descricao: itemEncontrado.descricao,
      qtd,
      timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });

    modal.classList.remove('active');
    document.getElementById('success-desc').textContent = `${itemEncontrado.descricao} · ${qtd}cx · ${endereco}`;
    showScreen('success');
    setTimeout(() => showScreen('menu'), 2200);
  } catch (e) {
    console.error(e);
    document.getElementById('form-error').textContent = 'Erro ao salvar. Confira a internet e tente de novo.';
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
