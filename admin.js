// ============================================================
// Admin — admin.js
// ============================================================

// Troque essa senha antes de publicar. É só uma trava simples
// pra essa página não ficar aberta pra qualquer um — não é a
// senha de nenhum operador.
const SENHA_MESA = 'mesa107';

const screens = {
  gate: document.getElementById('screen-gate'),
  admin: document.getElementById('screen-admin'),
};
function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
}

document.getElementById('btn-gate').addEventListener('click', () => {
  const val = document.getElementById('gate-senha').value;
  if (val === SENHA_MESA) {
    showScreen('admin');
    carregarOperadores();
  } else {
    document.getElementById('gate-error').textContent = 'Senha incorreta.';
  }
});
document.getElementById('gate-senha').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('btn-gate').click();
});

// ============================================================
// UPLOAD DE PLANILHA DE ENDEREÇOS
// ============================================================
let arquivoSelecionado = null;

document.getElementById('in-file').addEventListener('change', (e) => {
  arquivoSelecionado = e.target.files[0] || null;
  document.getElementById('btn-upload').disabled = !arquivoSelecionado;
  document.getElementById('upload-status').textContent = '';
});

function normalizarHeader(str) {
  return String(str)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().trim();
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

document.getElementById('btn-upload').addEventListener('click', async () => {
  if (!arquivoSelecionado) return;
  const statusEl = document.getElementById('upload-status');
  const btn = document.getElementById('btn-upload');
  const progWrap = document.getElementById('progress-wrap');
  const progBar = document.getElementById('progress-bar');

  btn.disabled = true;
  statusEl.style.color = 'var(--text-dim)';
  statusEl.textContent = 'Lendo planilha…';

  try {
    const rows = await lerPlanilha(arquivoSelecionado);
    if (rows.length < 2) throw new Error('Planilha vazia ou sem linhas de dados.');

    const cols = identificarColunas(rows[0]);
    if (cols.endereco === -1 || cols.codigo === -1 || cols.descricao === -1) {
      throw new Error('Não encontrei as colunas de Endereço/Código/Descrição no cabeçalho.');
    }

    const dados = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const endereco = r[cols.endereco] != null ? String(r[cols.endereco]).trim() : '';
      if (!endereco) continue;
      dados.push({
        endereco,
        codigo: r[cols.codigo] != null ? String(r[cols.codigo]).trim() : '',
        descricao: r[cols.descricao] != null ? String(r[cols.descricao]).trim() : ''
      });
    }

    if (dados.length === 0) throw new Error('Nenhuma linha válida encontrada.');

    progWrap.style.display = 'block';
    statusEl.style.color = 'var(--text-dim)';

    const TAMANHO_LOTE = 450;
    let enviados = 0;
    for (let i = 0; i < dados.length; i += TAMANHO_LOTE) {
      const lote = dados.slice(i, i + TAMANHO_LOTE);
      const batch = db.batch();
      lote.forEach(item => {
        const ref = db.collection('enderecos').doc(item.endereco);
        batch.set(ref, { codigo: item.codigo, descricao: item.descricao });
      });
      await batch.commit();
      enviados += lote.length;
      const pct = Math.round((enviados / dados.length) * 100);
      progBar.style.width = pct + '%';
      statusEl.textContent = `Enviando ${enviados} de ${dados.length}…`;
    }

    statusEl.style.color = 'var(--green)';
    statusEl.textContent = `✓ Base atualizada: ${dados.length} endereços.`;
  } catch (e) {
    console.error(e);
    statusEl.style.color = 'var(--red)';
    statusEl.textContent = 'Erro: ' + e.message;
  } finally {
    btn.disabled = false;
  }
});

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

// ============================================================
// CRUD DE OPERADORES
// ============================================================
function carregarOperadores() {
  db.collection('operadores').orderBy('nome').onSnapshot(snap => {
    const tbody = document.getElementById('op-tbody');
    if (snap.empty) {
      tbody.innerHTML = '<tr><td colspan="5" style="color:var(--text-faint);">Nenhum operador cadastrado ainda.</td></tr>';
      return;
    }
    tbody.innerHTML = '';
    snap.forEach(doc => {
      const d = doc.data();
      const ativo = d.ativo !== false;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="mono">${escapeHtml(doc.id)}</td>
        <td>${escapeHtml(d.nome || '')}</td>
        <td class="mono">${escapeHtml(String(d.senha || ''))}</td>
        <td><span class="pill ${ativo ? 'ativo' : 'inativo'}">${ativo ? 'ATIVO' : 'INATIVO'}</span></td>
        <td><button class="link-btn toggle-op" data-id="${doc.id}" data-ativo="${ativo}">${ativo ? 'Desativar' : 'Ativar'}</button></td>
      `;
      tbody.appendChild(tr);
    });

    document.querySelectorAll('.toggle-op').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const ativoAtual = btn.dataset.ativo === 'true';
        await db.collection('operadores').doc(id).update({ ativo: !ativoAtual });
      });
    });
  });
}

document.getElementById('btn-add-op').addEventListener('click', async () => {
  const matricula = document.getElementById('op-matricula').value.trim();
  const nome = document.getElementById('op-nome').value.trim();
  const senha = document.getElementById('op-senha').value.trim();
  const errEl = document.getElementById('op-error');
  errEl.textContent = '';

  if (!matricula || !nome || !senha) {
    errEl.textContent = 'Preencha matrícula, nome e senha.';
    return;
  }

  try {
    await db.collection('operadores').doc(matricula).set({ nome, senha, ativo: true });
    document.getElementById('op-matricula').value = '';
    document.getElementById('op-nome').value = '';
    document.getElementById('op-senha').value = '';
  } catch (e) {
    console.error(e);
    errEl.textContent = 'Erro ao salvar operador.';
  }
});

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
