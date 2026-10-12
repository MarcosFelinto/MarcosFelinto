// ============================================================================
// Kélita Produção — camada de nuvem (cliente)
// ----------------------------------------------------------------------------
// O banco de dados (Postgres na nuvem) é a fonte dos dados; o navegador só guarda
// o que o usuário alterou e ainda não foi confirmado pelo servidor:
//   · login validado no servidor (/api/auth) — a senha nunca fica no navegador;
//   · carga inicial de todas as tabelas a partir do banco (/api/db?acao=tabela);
//   · cada alteração detectada pelo auditor do sistema (auditarAlteracoes) entra
//     numa fila e é enviada em seguida (POST /api/db) com a versão que o usuário
//     conhecia — se outra pessoa gravou antes, o servidor recusa e devolve o
//     registro atual, que substitui o local (sem sobrescrever o trabalho alheio);
//   · a fila também fica guardada no navegador (localStorage, por usuário) até o
//     servidor confirmar: fechar a aba ou cair a internet não perde alterações;
//   · depois de cada gravação o servidor publica um aviso em tempo real (Ably) e
//     os outros navegadores buscam UMA vez só o que mudou (/api/db?acao=mudancas).
//     Sem aviso em tempo real configurado, a busca é feita a cada 30 s.
// Este arquivo é carregado depois do script principal e redefine as funções de
// persistência e login; as demais telas e cálculos continuam as mesmas.
// ============================================================================

const NUVEM = {
    token: '',
    pronto: false,
    carregadoUmaVez: false,
    cursor: 0,
    versoes: new Map(),          // "TABELA:id" -> versão no servidor
    filaExtra: new Map(),        // CONFIG e LOGS (fora do auditor de tabelas)
    emEnvio: new Map(),          // CONFIG e LOGS que estão no lote em envio
    enviando: false,
    reenviar: false,
    restaurando: false,
    timerEnvio: null,
    timerPuxar: null,
    timerAviso: null,
    timerRenovar: null,
    erros: 0,
    online: true,
    ultimaSync: null,
    configJSON: '',
    ultimoErro: '',
    precisaRecarregar: false,
    pendentesProntos: false,     // só grava a fila no navegador depois de recuperar a anterior
    pendentesJSON: '',
    tempoReal: null,
    tempoRealConectado: false
};
const TABELAS_NUVEM = Object.keys(TABELAS_SYNC).concat(['CONFIG', 'LOGS']);
const NOME_TABELA = { PRODUCAO: 'Ordem de produção', INSUMOS: 'Insumo', FUNCIONARIOS: 'Funcionário', EQUIPES: 'Equipe',
    PRODUTOS: 'Produto', CATEGORIAS: 'Categoria', FICHAS: 'Ficha técnica', CUSTOS: 'Custo adicional',
    ESTOQUE: 'Movimentação de estoque', USUARIOS: 'Usuário', CONFIG: 'Configurações', LOGS: 'Log' };
const CAMPOS_DERIVADOS = ['custoAdicionalAlocado', 'custoTotal', 'custoUnitario'];
const INTERVALO_SEGURANCA = 5 * 60 * 1000;     // com tempo real: só uma conferência de segurança
const INTERVALO_SEM_TEMPO_REAL = 30 * 1000;    // sem tempo real: busca periódica
const INTERVALO_SEGUNDO_PLANO = 2 * 60 * 1000; // aba escondida e sem tempo real
const PENDENTES_PREFIXO = 'kp_pendentes:';

// Restos da versão que guardava a base inteira no navegador.
try { localStorage.removeItem('producao_state_v3'); localStorage.removeItem('sistema_id'); } catch (e) {}

// ---------------------------------------------------------------------------
// Avisos na tela (toast) e erros inesperados
// ---------------------------------------------------------------------------
function nuvemAviso(msg, tipo, ms) {
    let box = document.getElementById('nuvemToasts');
    if (!box) {
        box = document.createElement('div');
        box.id = 'nuvemToasts';
        box.className = 'no-print fixed bottom-4 right-4 z-[70] flex flex-col gap-2 max-w-sm';
        document.body.appendChild(box);
    }
    const cores = { ok: 'bg-emerald-600', erro: 'bg-red-600', alerta: 'bg-amber-500', info: 'bg-slate-800' };
    const icones = { ok: 'fa-circle-check', erro: 'fa-circle-exclamation', alerta: 'fa-triangle-exclamation', info: 'fa-circle-info' };
    const t = document.createElement('div');
    t.className = (cores[tipo] || cores.info) + ' text-white text-xs font-semibold px-4 py-3 rounded-lg shadow-lg flex gap-2 items-start';
    t.setAttribute('role', tipo === 'erro' ? 'alert' : 'status');
    t.innerHTML = '<i class="fa-solid ' + (icones[tipo] || icones.info) + ' mt-0.5"></i><span></span>';
    t.querySelector('span').textContent = msg;
    box.appendChild(t);
    setTimeout(() => { t.style.transition = 'opacity .4s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 450); }, ms || (tipo === 'erro' ? 8000 : 4000));
}
window.addEventListener('error', e => {
    if (!e || !e.message || /ResizeObserver|Script error/.test(e.message)) return;
    console.error(e.error || e.message);
    nuvemAviso('Erro inesperado: ' + e.message + '. Se repetir, recarregue a página.', 'erro');
});
window.addEventListener('unhandledrejection', e => {
    const m = (e && e.reason && e.reason.message) || String(e && e.reason || '');
    console.error(e.reason);
    if (m) nuvemAviso('Falha: ' + m, 'erro');
});

function nuvemCarregando(texto) {
    let el = document.getElementById('nuvemCarregando');
    if (!texto) { if (el) el.remove(); return; }
    if (!el) {
        el = document.createElement('div');
        el.id = 'nuvemCarregando';
        el.className = 'no-print fixed inset-0 z-[80] bg-slate-900/80 flex items-center justify-center';
        el.innerHTML = '<div class="bg-white rounded-xl shadow-2xl px-6 py-5 flex items-center gap-3 text-sm font-semibold text-slate-700"><i class="fa-solid fa-cloud-arrow-down text-indigo-600 text-xl animate-pulse"></i><span></span></div>';
        document.body.appendChild(el);
    }
    el.querySelector('span').textContent = texto;
}

// ---------------------------------------------------------------------------
// Janelas de aviso (SweetAlert2). Sem a biblioteca, caem no alert/confirm do navegador.
// ---------------------------------------------------------------------------
const KP_SWAL = { confirmButtonColor: '#4f46e5', cancelButtonColor: '#64748b', reverseButtons: true, focusCancel: false };
const kpTemSwal = () => typeof Swal !== 'undefined';
const kpTexto = html => String(html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|li|tr|div)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

function kpCarregando(titulo, texto) {
    if (!kpTemSwal()) { nuvemCarregando(titulo); return; }
    Swal.fire(Object.assign({}, KP_SWAL, {
        title: titulo, text: texto || '', allowOutsideClick: false, allowEscapeKey: false, showConfirmButton: false,
        didOpen: () => Swal.showLoading()
    }));
}
function kpFechar() { if (kpTemSwal()) Swal.close(); nuvemCarregando(''); }
function kpSucesso(titulo, html) {
    nuvemCarregando('');
    if (!kpTemSwal()) { alert(titulo + (html ? '\n\n' + kpTexto(html) : '')); return Promise.resolve(); }
    return Swal.fire(Object.assign({}, KP_SWAL, { icon: 'success', title: titulo, html: html || '', confirmButtonText: 'OK' }));
}
function kpErro(titulo, html) { return kpMensagem('error', titulo, html); }
function kpAtencao(titulo, html) { return kpMensagem('warning', titulo, html); }
function kpMensagem(icone, titulo, html) {
    nuvemCarregando('');
    if (!kpTemSwal()) { alert(titulo + (html ? '\n\n' + kpTexto(html) : '')); return Promise.resolve(); }
    return Swal.fire(Object.assign({}, KP_SWAL, { icon: icone, title: titulo, html: html || '', confirmButtonText: 'OK' }));
}
// Resolve com { confirmado, valor } — valor é o checkbox, quando houver.
async function kpConfirmar(o) {
    if (!kpTemSwal()) return { confirmado: confirm(o.titulo + '\n\n' + kpTexto(o.html)), valor: 0 };
    const r = await Swal.fire(Object.assign({}, KP_SWAL, {
        icon: o.icone || 'question', title: o.titulo, html: o.html || '', width: o.largura,
        showCancelButton: true, confirmButtonText: o.confirmar || 'Confirmar', cancelButtonText: o.cancelar || 'Cancelar',
        confirmButtonColor: o.perigo ? '#d97706' : KP_SWAL.confirmButtonColor
    }, o.checkbox ? { input: 'checkbox', inputValue: o.checkboxMarcado ? 1 : 0, inputPlaceholder: o.checkbox } : {}));
    return { confirmado: !!r.isConfirmed, valor: r.value };
}

// ---------------------------------------------------------------------------
// Chamada à API
// ---------------------------------------------------------------------------
async function nuvemApi(metodo, caminho, corpo) {
    let r;
    try {
        r = await fetch(caminho, {
            method: metodo,
            headers: Object.assign({ 'Content-Type': 'application/json', 'X-KP-Sessao': NUVEM_SESSAO_ID },
                                   NUVEM.token ? { Authorization: 'Bearer ' + NUVEM.token } : {}),
            body: corpo ? JSON.stringify(corpo) : undefined,
            cache: 'no-store'
        });
    } catch (e) {
        throw Object.assign(new Error('Sem conexão com o servidor.'), { rede: true });
    }
    let json = {};
    try { json = await r.json(); } catch (e) { json = {}; }
    if (r.status === 401 && NUVEM.token && caminho.indexOf('/api/auth') !== 0) nuvemSessaoExpirada(json.erro);
    if (!r.ok) throw Object.assign(new Error(json.erro || ('Erro ' + r.status + ' no servidor.')), { status: r.status });
    if (json.servidor) ajustarRelogio(json.servidor);
    return json;
}

// ---------------------------------------------------------------------------
// Persistência: o que era localStorage agora é a fila de envio para a nuvem
// ---------------------------------------------------------------------------
function carregarStorage() { /* dados vêm da nuvem: ver nuvemCarregarTudo() */ }

function salvarStorage() {
    auditarAlteracoes();               // carimba metadados e enfileira o que mudou
    if (!NUVEM.pronto) return;
    const cfg = JSON.stringify(state.config);
    if (cfg !== NUVEM.configJSON) {
        NUVEM.configJSON = cfg;
        NUVEM.filaExtra.set('CONFIG:geral', { op: 'upsert', tabela: 'CONFIG', id: 'geral', dados: { id: 'geral', config: JSON.parse(cfg) } });
    }
    nuvemAgendarEnvio();
}

function registrarLog(acao, entidade, detalhes) {
    const l = {
        id: 'LOG-' + agoraMs().toString(36) + Math.random().toString(36).slice(2, 7),
        dataISO: new Date(agoraMs()).toISOString(),
        data: new Date(agoraMs()).toLocaleString('pt-BR'),
        usuario: (state.currentUser && state.currentUser.name) || 'sistema',
        perfil: (state.currentUser && state.currentUser.role) || '',
        acao: acao, entidade: entidade, detalhes: detalhes
    };
    if (!Array.isArray(state.logs)) state.logs = [];
    state.logs.push(l);
    if (state.logs.length > 3000) state.logs = state.logs.slice(-2000);
    if (NUVEM.pronto) NUVEM.filaExtra.set('LOGS:' + l.id, { op: 'upsert', tabela: 'LOGS', id: l.id, dados: l });
    salvarStorage();
}

// Identificação da sessão (antes ficava no localStorage do computador).
const NUVEM_SESSAO_ID = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : ('S-' + Date.now() + Math.random().toString(36).slice(2));
function obterIdentificacaoSistema() { return NUVEM_SESSAO_ID; }

// Senhas são conferidas no servidor; no navegador só convertemos backups antigos com senha em texto puro.
function migrarSenhas() {
    if (!Array.isArray(state.usuarios)) state.usuarios = [];
    state.usuarios.forEach(u => {
        if (u.senha) { definirSenhaUsuario(u, u.senha); u.precisaTrocarSenha = true; }
        if (u.precisaTrocarSenha === undefined) u.precisaTrocarSenha = false;
    });
}

// Integração antiga com Google Sheets: desativada (a nuvem própria faz esse papel).
function enviarParaGoogleDriveSheets() {}
function iniciarAutoSync() {}
function pararAutoSync() {}
function carregarConfigGoogleNaTela() {}
function sincronizarBidirecional() { return nuvemSincronizarAgora(); }
function atualizarPainelSync() { nuvemAtualizarPainel(false); }

// ---------------------------------------------------------------------------
// Alterações pendentes guardadas no navegador
// ---------------------------------------------------------------------------
// Só o que ainda não foi confirmado pelo servidor fica no localStorage (uma chave por
// usuário). Cada item leva a versão que o usuário conhecia, para o conflito ser detectado
// mesmo que o envio aconteça horas depois.
function nuvemChavePendentes() {
    return state.currentUser && state.currentUser.id ? PENDENTES_PREFIXO + state.currentUser.id : '';
}

function nuvemMontarPendentes() {
    const itens = [];
    (state.filaSync || []).forEach(f => {
        if (f.status !== 'PENDENTE' && f.status !== 'ENVIANDO') return;
        const base = NUVEM.versoes.get(f.tabela + ':' + f.registroId) || 0;
        if (f.operacao === 'DELETE') { itens.push({ op: 'delete', tabela: f.tabela, id: f.registroId, base }); return; }
        const reg = (state[TABELAS_SYNC[f.tabela]] || []).find(r => r.id === f.registroId);
        if (reg) itens.push({ op: 'upsert', tabela: f.tabela, id: f.registroId, base, dados: limparControleLocal(reg) });
    });
    const extras = new Map(NUVEM.emEnvio);
    NUVEM.filaExtra.forEach((o, k) => extras.set(k, o));
    extras.forEach((o, k) => itens.push(Object.assign({}, o, { base: NUVEM.versoes.get(k) || 0 })));
    return itens;
}

function nuvemSalvarPendentes() {
    if (!NUVEM.pendentesProntos) return;
    const chave = nuvemChavePendentes();
    if (!chave) return;
    const itens = nuvemMontarPendentes();
    let json = '';
    try { json = itens.length ? JSON.stringify(itens) : ''; } catch (e) { return; }
    if (json === NUVEM.pendentesJSON) return;
    NUVEM.pendentesJSON = json;
    try {
        if (json) localStorage.setItem(chave, JSON.stringify({ salvoEm: new Date().toISOString(), itens }));
        else localStorage.removeItem(chave);
    } catch (e) { console.error('Não foi possível guardar as alterações pendentes no navegador', e); }
}

function nuvemDescartarPendentes() {
    const chave = nuvemChavePendentes();
    try { if (chave) localStorage.removeItem(chave); } catch (e) {}
    NUVEM.pendentesJSON = '';
    state.filaSync = [];
    NUVEM.filaExtra.clear();
    NUVEM.emEnvio.clear();
}

// Reaplica sobre os dados recém-carregados do banco o que ficou sem confirmação na última vez.
// Chamada com o auditor travado (aplicandoRemoto) — os itens entram direto na fila.
function nuvemRecuperarPendentes() {
    const chave = nuvemChavePendentes();
    if (!chave) return 0;
    let salvo = null;
    try { salvo = JSON.parse(localStorage.getItem(chave) || 'null'); } catch (e) {}
    const itens = salvo && Array.isArray(salvo.itens) ? salvo.itens : [];
    let n = 0;
    itens.forEach(it => {
        if (!it || !it.tabela || !it.id) return;
        const chaveReg = it.tabela + ':' + it.id;
        if (it.tabela === 'CONFIG' || it.tabela === 'LOGS') {
            if (!it.dados) return;
            if (it.tabela === 'CONFIG' && it.dados.config) mergeProfundo(state.config, it.dados.config);
            if (it.tabela === 'LOGS' && !state.logs.some(l => l.id === it.id)) state.logs.push(Object.assign({}, it.dados, { id: it.id }));
            if (it.tabela === 'CONFIG') NUVEM.versoes.set(chaveReg, it.base || 0);
            NUVEM.filaExtra.set(chaveReg, { op: 'upsert', tabela: it.tabela, id: it.id, dados: it.dados });
            n++; return;
        }
        const nomeLista = TABELAS_SYNC[it.tabela];
        if (!nomeLista) return;
        const lista = state[nomeLista] || (state[nomeLista] = []);
        const i = lista.findIndex(r => r.id === it.id);
        if (it.op === 'delete') {
            if (i >= 0) lista.splice(i, 1);
        } else {
            if (!it.dados) return;
            const reg = Object.assign({}, it.dados, { id: it.id, status_sync: 'PENDENTE' });
            if (i >= 0) lista[i] = reg; else lista.push(reg);
        }
        NUVEM.versoes.set(chaveReg, it.base || 0);
        enfileirarSync(it.tabela, it.id, it.op === 'delete' ? 'DELETE' : 'UPSERT');
        n++;
    });
    return n;
}

// ---------------------------------------------------------------------------
// Carga inicial
// ---------------------------------------------------------------------------
async function nuvemLerTabelaCompleta(tabela) {
    let depois = 0, registros = [], seqMin = Infinity;
    for (let pagina = 0; pagina < 500; pagina++) {
        const r = await nuvemApi('GET', '/api/db?acao=tabela&tabela=' + encodeURIComponent(tabela) + '&depois=' + depois);
        seqMin = Math.min(seqMin, Number(r.seq) || 0);
        registros = registros.concat(r.registros || []);
        if (!r.mais) break;
        depois = r.ultimoSeq;
    }
    return { tabela, registros, seq: seqMin === Infinity ? 0 : seqMin };
}

function limparControleLocal(reg) {
    const c = Object.assign({}, reg);
    delete c.status_sync; delete c.sync_em; delete c.sistema_id;
    return c;
}

// opcoes.semTelaCarregando: quem chama já mostra a própria janela de "carregando".
async function nuvemCarregarTudo(opcoes) {
    const o = opcoes || {};
    if (!o.semTelaCarregando) nuvemCarregando('Carregando dados da nuvem…');
    let recuperados = 0;
    try {
        const lidas = await Promise.all(TABELAS_NUVEM.map(t => nuvemLerTabelaCompleta(t)));
        const porTabela = {};
        let cursor = Infinity;
        lidas.forEach(l => { porTabela[l.tabela] = l.registros; cursor = Math.min(cursor, l.seq); });

        aplicandoRemoto = true;
        try {
            NUVEM.versoes.clear();
            NUVEM.filaExtra.clear();
            NUVEM.emEnvio.clear();
            Object.keys(TABELAS_SYNC).forEach(tab => {
                state[TABELAS_SYNC[tab]] = (porTabela[tab] || []).map(r => {
                    NUVEM.versoes.set(tab + ':' + r.id, r.versao);
                    return Object.assign({}, r.dados, { id: r.id, versao: r.versao, status_sync: 'SINCRONIZADO' });
                });
            });
            const cfg = (porTabela.CONFIG || []).find(r => r.id === 'geral');
            if (cfg) { NUVEM.versoes.set('CONFIG:geral', cfg.versao); if (cfg.dados && cfg.dados.config) mergeProfundo(state.config, cfg.dados.config); }
            state.logs = (porTabela.LOGS || []).map(r => { NUVEM.versoes.set('LOGS:' + r.id, r.versao); return Object.assign({}, r.dados, { id: r.id }); })
                .sort((a, b) => String(a.dataISO || '').localeCompare(String(b.dataISO || '')));
            // Estruturas da antiga sincronização com planilha ficam vazias
            state.googleScriptUrl = '';
            state.filaSync = []; state.excluidos = []; state.changelog = []; state.conflitos = [];
            state.syncMeta = Object.assign({}, state.syncMeta || {}, { ultimoSyncOk: 'nuvem' });
            migrarDados();
            NUVEM.configJSON = JSON.stringify(state.config);
            // Custos derivados (rateio) são recalculados só na memória: quem grava é quem altera
            // uma ordem ou um custo — senão cada navegador regravaria a base inteira ao entrar.
            recalcularRateioGlobal();
            recuperados = nuvemRecuperarPendentes();
            if (recuperados) recalcularRateioGlobal();
        } finally { aplicandoRemoto = false; }

        NUVEM.cursor = cursor === Infinity ? 0 : cursor;
        snapshotSync = montarSnapshot();
        NUVEM.pronto = true;
        NUVEM.carregadoUmaVez = true;
        NUVEM.pendentesProntos = true;
        NUVEM.ultimaSync = new Date();
        salvarStorage();
        nuvemSalvarPendentes();
        if (recuperados) nuvemAviso(recuperados + ' alteração(ões) feitas antes e ainda não gravadas foram recuperadas e estão sendo enviadas.', 'info', 7000);
    } finally {
        if (!o.semTelaCarregando) nuvemCarregando('');
    }
}

// ---------------------------------------------------------------------------
// Envio das alterações
// ---------------------------------------------------------------------------
function nuvemPendentes() {
    return (state.filaSync || []).filter(f => f.status === 'PENDENTE' || f.status === 'ENVIANDO').length + NUVEM.filaExtra.size;
}

// Junta as edições feitas em sequência num único envio.
function nuvemAgendarEnvio() {
    clearTimeout(NUVEM.timerEnvio);
    NUVEM.timerEnvio = setTimeout(nuvemEnviar, 800);
    nuvemStatus();
}

// O que cada perfil pode gravar (o servidor confere de novo). Alterações fora da permissão —
// como o recálculo de custos de ordens de outras pessoas feito no celular da funcionária —
// ficam só na tela dela e não viram avisos de erro.
function nuvemPodeGravar(tabela, operacao, reg) {
    const perfil = state.currentUser && state.currentUser.role;
    if (perfil === 'ADMIN') return true;
    if (tabela === 'USUARIOS' || tabela === 'CONFIG') return false;
    if (perfil !== 'OPERADOR') return true;
    if (tabela === 'LOGS') return true;
    if (operacao === 'DELETE') return false;
    if (tabela === 'INSUMOS' || tabela === 'ESTOQUE') return true;
    if (tabela === 'PRODUCAO') {
        const meu = typeof meuFuncionarioId === 'function' ? meuFuncionarioId() : '';
        return !!(meu && reg && (reg.funcionarioIds || []).includes(meu));
    }
    return false;
}

function nuvemMontarOps() {
    const ops = [];
    (state.filaSync || []).forEach(f => {
        if (f.status !== 'PENDENTE') return;
        const chave = f.tabela + ':' + f.registroId;
        if (f.operacao === 'DELETE') {
            if (!nuvemPodeGravar(f.tabela, 'DELETE')) { f.status = 'DESCARTADO'; return; }
            ops.push({ fila: f, chave, payload: { op: 'delete', tabela: f.tabela, id: f.registroId } });
        } else {
            const lista = state[TABELAS_SYNC[f.tabela]] || [];
            const reg = lista.find(r => r.id === f.registroId);
            if (!reg) { f.status = 'DESCARTADO'; return; }
            if (!nuvemPodeGravar(f.tabela, 'UPSERT', reg)) { f.status = 'DESCARTADO'; return; }
            ops.push({ fila: f, chave, payload: { op: 'upsert', tabela: f.tabela, id: f.registroId,
                base: NUVEM.versoes.get(chave) || 0, dados: limparControleLocal(JSON.parse(JSON.stringify(reg))) } });
        }
        f.status = 'ENVIANDO';
    });
    NUVEM.filaExtra.forEach((o, chave) => {
        if (!nuvemPodeGravar(o.tabela, o.op === 'delete' ? 'DELETE' : 'UPSERT', o.dados)) return;
        NUVEM.emEnvio.set(chave, o);
        ops.push({ extra: chave, chave, payload: Object.assign({}, o, { base: o.tabela === 'LOGS' ? 0 : (NUVEM.versoes.get(chave) || 0) }) });
    });
    NUVEM.filaExtra.clear();
    state.filaSync = (state.filaSync || []).filter(f => f.status === 'PENDENTE' || f.status === 'ENVIANDO');
    return ops;
}

const nuvemResultadoVazio = () => ({ enviados: 0, gravados: 0, recusados: 0, erro: null });

// Envia tudo o que está na fila. Nunca lança erro: devolve { enviados, gravados, recusados, erro }.
async function nuvemEnviarLotes() {
    const res = nuvemResultadoVazio();
    let ops = [];
    try {
        ops = nuvemMontarOps();
        if (!ops.length) return res;
        NUVEM.enviando = true;
        nuvemStatus();
        for (let i = 0; i < ops.length; i += 400) {
            const lote = ops.slice(i, i + 400);
            let resp;
            try {
                resp = await nuvemApi('POST', '/api/db', { ops: lote.map(o => o.payload) });
            } catch (e) {
                // devolve à fila o que não foi confirmado
                ops.slice(i).forEach(o => {
                    if (o.fila) o.fila.status = 'PENDENTE';
                    else if (o.extra && !NUVEM.filaExtra.has(o.extra)) NUVEM.filaExtra.set(o.extra, { op: o.payload.op, tabela: o.payload.tabela, id: o.payload.id, dados: o.payload.dados });
                });
                // um registro com mais de uma entrada na fila: fica só a mais nova
                const vistos = new Set();
                state.filaSync = state.filaSync.slice().reverse().filter(f => { const k = f.tabela + ':' + f.registroId; if (vistos.has(k)) return false; vistos.add(k); return true; }).reverse();
                throw e;
            }
            const resultados = resp.resultados || [];
            res.enviados += lote.length;
            res.gravados += resultados.filter(r => r.ok).length;
            res.recusados += resultados.filter(r => !r.ok).length;
            nuvemProcessarResultados(lote, resultados);
        }
        NUVEM.erros = 0; NUVEM.online = true; NUVEM.ultimaSync = new Date(); NUVEM.ultimoErro = '';
    } catch (e) {
        res.erro = e;
        NUVEM.erros++; NUVEM.online = !e.rede; NUVEM.ultimoErro = e.message;
        if (e.status !== 401) setTimeout(nuvemEnviar, Math.min(30000, 2000 * Math.pow(2, NUVEM.erros)));
    } finally {
        NUVEM.enviando = false;
        NUVEM.emEnvio.clear();
        nuvemStatus();
    }
    return res;
}

// Um envio por vez. Quem chama durante um envio recebe a promessa dele (e a fila é
// reenviada logo depois, com o que entrou nesse meio tempo).
let nuvemEnvioAtual = null;
function nuvemEnviar() {
    if (!NUVEM.pronto || !NUVEM.token || NUVEM.restaurando) return Promise.resolve(nuvemResultadoVazio());
    if (nuvemEnvioAtual) { NUVEM.reenviar = true; return nuvemEnvioAtual; }
    nuvemEnvioAtual = nuvemEnviarLotes().then(r => {
        nuvemEnvioAtual = null;
        if (NUVEM.reenviar) { NUVEM.reenviar = false; if (!r.erro) nuvemAgendarEnvio(); }
        return r;
    });
    return nuvemEnvioAtual;
}

// Envia até a fila esvaziar (inclui o que estava em envio e o que entrou durante ele).
async function nuvemEnviarTudo() {
    const total = nuvemResultadoVazio();
    for (let i = 0; i < 6; i++) {
        clearTimeout(NUVEM.timerEnvio);
        const r = await nuvemEnviar();
        total.enviados += r.enviados; total.gravados += r.gravados; total.recusados += r.recusados;
        if (r.erro) { total.erro = r.erro; break; }
        if (!nuvemPendentes() && !nuvemEnvioAtual) break;
    }
    return total;
}

function nuvemDescricao(tabela, dados, id) {
    const nome = dados && (dados.nome || dados.descricao || dados.tipo || dados.email);
    return (NOME_TABELA[tabela] || tabela) + ' ' + (nome ? '"' + nome + '"' : id);
}

// Diferença só nos custos derivados (recalculados por todos): conflito silencioso.
function nuvemSoDerivados(local, remoto) {
    if (!local || !remoto) return false;
    const limpa = r => { const c = limparControleLocal(r); CAMPOS_DERIVADOS.concat(CAMPOS_META).forEach(k => delete c[k]); return impressaoRegistro(c); };
    return limpa(local) === limpa(remoto);
}

function nuvemProcessarResultados(lote, resultados) {
    const porChave = new Map();
    resultados.forEach(r => porChave.set(r.tabela + ':' + r.id, r));
    const avisos = [];
    const reenviarMesclados = [];
    let mudouLocal = false;
    aplicandoRemoto = true;
    try {
        lote.forEach(o => {
            const r = porChave.get(o.chave);
            const tabela = o.payload.tabela, id = o.payload.id;
            if (o.fila) state.filaSync = state.filaSync.filter(f => f !== o.fila);
            if (!r) return;
            if (r.ok) {
                if (r.excluido) { NUVEM.versoes.delete(o.chave); return; }
                NUVEM.versoes.set(o.chave, r.versao);
                const lista = state[TABELAS_SYNC[tabela]];
                const reg = lista && lista.find(x => x.id === id);
                if (reg) { reg.versao = r.versao; reg.status_sync = 'SINCRONIZADO'; }
                return;
            }
            // Recusado: o banco tem uma versão mais nova (outro usuário) ou o registro foi excluído.
            const outraPendente = (state.filaSync || []).some(f => f.tabela === tabela && f.registroId === id);
            state.filaSync = (state.filaSync || []).filter(f => !(f.tabela === tabela && f.registroId === id));
            if (r.motivo === 'versao' && r.atual) {
                NUVEM.versoes.set(o.chave, r.atual.versao);
                if (tabela === 'CONFIG') {
                    mergeProfundo(state.config, (r.atual.dados && r.atual.dados.config) || {});
                    NUVEM.configJSON = JSON.stringify(state.config);
                    avisos.push('As configurações foram alteradas por outro usuário; a versão mais recente foi carregada.');
                } else {
                    const lista = state[TABELAS_SYNC[tabela]] || [];
                    const i = lista.findIndex(x => x.id === id);
                    const remoto = Object.assign({}, r.atual.dados, { id, versao: r.atual.versao, status_sync: 'SINCRONIZADO' });
                    // Duas pessoas mexendo na mesma comanda ao mesmo tempo (etapas): junta as duas e reenvia
                    const mesclado = tabela === 'PRODUCAO' && typeof mesclarComanda === 'function' ? mesclarComanda(o.payload.dados, remoto) : null;
                    if (mesclado) {
                        if (i >= 0) lista[i] = mesclado; else lista.push(mesclado);
                        reenviarMesclados.push(id); mudouLocal = true; return;
                    }
                    const silencioso = i >= 0 && nuvemSoDerivados(lista[i], remoto) && !outraPendente;
                    if (i >= 0) lista[i] = remoto; else lista.push(remoto);
                    if (!silencioso) avisos.push(nuvemDescricao(tabela, remoto, id) + ' foi alterado(a) por outro usuário antes. A versão mais recente foi carregada — confira e refaça sua alteração, se necessário.');
                }
                mudouLocal = true;
            } else if (r.motivo === 'excluido') {
                NUVEM.versoes.delete(o.chave);
                const lista = state[TABELAS_SYNC[tabela]];
                if (lista) { const i = lista.findIndex(x => x.id === id); if (i >= 0) lista.splice(i, 1); }
                avisos.push(nuvemDescricao(tabela, o.payload.dados, id) + ' foi excluído(a) por outro usuário; a alteração não foi gravada.');
                mudouLocal = true;
            } else if (r.motivo === 'permissao') {
                avisos.push('Seu perfil não tem permissão para alterar ' + (NOME_TABELA[tabela] || tabela).toLowerCase() + '. A alteração foi descartada.');
                NUVEM.precisaRecarregar = true;
            } else {
                avisos.push('Não foi possível gravar ' + nuvemDescricao(tabela, o.payload.dados, id) + '.');
            }
        });
        if (mudouLocal) recalcularRateioGlobal();
    } finally { aplicandoRemoto = false; }
    if (mudouLocal) { snapshotSync = montarSnapshot(); renderizarSeSeguro({ atualizados: 1 }); }
    if (reenviarMesclados.length) { reenviarMesclados.forEach(id => enfileirarSync('PRODUCAO', id, 'UPSERT')); nuvemAgendarEnvio(); }
    avisos.slice(0, 4).forEach(a => nuvemAviso(a, 'alerta', 9000));
    if (avisos.length > 4) nuvemAviso('Mais ' + (avisos.length - 4) + ' registro(s) foram atualizados por outros usuários.', 'alerta', 9000);
    if (NUVEM.precisaRecarregar) { NUVEM.precisaRecarregar = false; nuvemRecarregarTudo(true); }
}

// ---------------------------------------------------------------------------
// Recebimento das alterações dos outros usuários
// ---------------------------------------------------------------------------
// Uma leitura por vez; devolve quantos registros mudaram na tela.
let nuvemPuxarAtual = null;
function nuvemPuxar() {
    if (nuvemPuxarAtual) return nuvemPuxarAtual;
    nuvemPuxarAtual = (async () => {
        let total = 0;
        for (let i = 0; i < 20; i++) {
            const r = await nuvemApi('GET', '/api/db?acao=mudancas&desde=' + NUVEM.cursor);
            total += nuvemAplicarMudancas(r);
            NUVEM.cursor = Number(r.seq) || NUVEM.cursor;
            if (!r.mais) break;
        }
        return total;
    })();
    return nuvemPuxarAtual.finally(() => { nuvemPuxarAtual = null; });
}

function nuvemAplicarMudancas(r) {
    // Em ordem de gravação: um registro excluído e depois recriado (ex.: restauração de backup) fica.
    const eventos = (r.alterados || []).map(x => Object.assign({ excluido: false }, x))
        .concat((r.excluidos || []).map(x => Object.assign({ excluido: true }, x)))
        .sort((a, b) => (Number(a.seq) || 0) - (Number(b.seq) || 0));
    if (!eventos.length) return 0;
    const pendentes = new Set((state.filaSync || []).map(f => f.tabela + ':' + f.registroId));
    NUVEM.filaExtra.forEach((v, k) => pendentes.add(k));
    let mudou = 0, logNovo = false, recalcular = false, configMudou = false;   // mudou = registros de dados (logs não contam)
    aplicandoRemoto = true;
    try {
        eventos.forEach(x => {
            const chave = x.tabela + ':' + x.id;
            const lista = state[TABELAS_SYNC[x.tabela]];
            if (x.excluido) {
                if (!NUVEM.versoes.has(chave) && !(lista || []).some(o => o.id === x.id)) return;
                NUVEM.versoes.delete(chave);
                state.filaSync = (state.filaSync || []).filter(f => !(f.tabela === x.tabela && f.registroId === x.id));
                if (lista) { const i = lista.findIndex(o => o.id === x.id); if (i >= 0) { lista.splice(i, 1); mudou++; } }
                if (x.tabela === 'PRODUCAO' || x.tabela === 'CUSTOS') recalcular = true;
                return;
            }
            if ((NUVEM.versoes.get(chave) || 0) >= x.versao) return;      // já conhecido (inclui as minhas gravações)
            if (pendentes.has(chave)) return;                               // há alteração local a caminho: o envio resolve
            NUVEM.versoes.set(chave, x.versao);
            if (x.tabela === 'CONFIG') {
                if (x.dados && x.dados.config) { mergeProfundo(state.config, x.dados.config); NUVEM.configJSON = JSON.stringify(state.config); configMudou = true; mudou++; }
                return;
            }
            if (x.tabela === 'LOGS') {
                if (!state.logs.some(l => l.id === x.id)) { state.logs.push(Object.assign({}, x.dados, { id: x.id })); logNovo = true; }
                return;
            }
            if (!lista) return;
            const dados = Object.assign({}, x.dados, { id: x.id, versao: x.versao, status_sync: 'SINCRONIZADO' });
            const i = lista.findIndex(o => o.id === x.id);
            if (i >= 0) lista[i] = dados; else lista.push(dados);
            mudou++;
            if (x.tabela === 'PRODUCAO' || x.tabela === 'CUSTOS') recalcular = true;
            if (x.tabela === 'USUARIOS' && state.currentUser && x.id === state.currentUser.id) nuvemConferirMeuUsuario(dados);
        });
        if (recalcular) recalcularRateioGlobal();
    } finally { aplicandoRemoto = false; }
    if (mudou || logNovo) {
        snapshotSync = montarSnapshot();
        if (configMudou && document.querySelector('#configTab.active')) carregarConfigNaTela();
        renderizarSeSeguro({ atualizados: 1 });
    }
    return mudou;
}

function nuvemConferirMeuUsuario(u) {
    if (u.status !== 'ATIVO') {
        alert('Seu usuário foi bloqueado pelo administrador. A sessão será encerrada.');
        sessionStorage.removeItem('kp_token');
        location.reload();
        return;
    }
    if (u.perfil && u.perfil !== state.currentUser.role) {
        state.currentUser.role = u.perfil;
        aplicarPermissoesMenu(u.perfil);
        nuvemAviso('Seu perfil de acesso foi alterado para ' + u.perfil + '.', 'info');
    }
}

// Redesenha só quando ninguém está digitando ou com uma janela aberta.
let renderPendentePosSync = false;
function renderizarSeSeguro(resumo) {
    const modalAberto = Array.from(document.querySelectorAll('.modal-overlay')).some(m => !m.classList.contains('hidden'));
    const ativo = document.activeElement;
    const digitando = ativo && ['INPUT', 'SELECT', 'TEXTAREA'].includes(ativo.tagName);
    if (modalAberto || digitando) { renderPendentePosSync = true; atualizarActiveCountBadge(); return; }
    renderPendentePosSync = false;
    renderizarTudo();
}
function verificarRenderPendente() {
    if (!renderPendentePosSync) return;
    const modalAberto = Array.from(document.querySelectorAll('.modal-overlay')).some(m => !m.classList.contains('hidden'));
    const ativo = document.activeElement;
    if (modalAberto || (ativo && ['INPUT', 'SELECT', 'TEXTAREA'].includes(ativo.tagName))) return;
    renderPendentePosSync = false;
    renderizarTudo();
}

// Sem tempo real a consulta é periódica; com ele, só uma conferência de segurança a cada 5 min.
function nuvemIntervaloPuxar() {
    if (NUVEM.tempoRealConectado) return INTERVALO_SEGURANCA;
    return document.hidden ? INTERVALO_SEGUNDO_PLANO : INTERVALO_SEM_TEMPO_REAL;
}
function nuvemAgendarPuxar(ms) {
    clearTimeout(NUVEM.timerPuxar);
    NUVEM.timerPuxar = setTimeout(nuvemCicloPuxar, ms);
}
async function nuvemCicloPuxar() {
    if (!NUVEM.pronto) return;
    try {
        if (nuvemPendentes() && !NUVEM.enviando) await nuvemEnviar();
        await nuvemPuxar();
        NUVEM.erros = 0; NUVEM.online = true; NUVEM.ultimaSync = new Date(); NUVEM.ultimoErro = '';
    } catch (e) {
        NUVEM.erros++; NUVEM.online = !e.rede; NUVEM.ultimoErro = e.message;
    }
    nuvemStatus();
    const base = nuvemIntervaloPuxar();
    nuvemAgendarPuxar(NUVEM.erros ? Math.min(base, 5000 * Math.pow(2, Math.min(NUVEM.erros, 4))) : base);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && NUVEM.pronto) nuvemAgendarPuxar(150); });
window.addEventListener('online', () => { if (NUVEM.pronto) { nuvemAgendarPuxar(100); nuvemEnviar(); } });
window.addEventListener('beforeunload', e => {
    nuvemSalvarPendentes();
    if (NUVEM.pronto && nuvemPendentes()) { e.preventDefault(); e.returnValue = 'Há alterações ainda não gravadas na nuvem.'; return e.returnValue; }
});

// ---------------------------------------------------------------------------
// Aviso em tempo real (Ably): o servidor avisa que algo mudou e o navegador busca uma vez
// ---------------------------------------------------------------------------
async function nuvemConectarTempoReal() {
    nuvemDesconectarTempoReal();
    if (typeof Ably === 'undefined' || !NUVEM.token) return;
    let cfg;
    try { cfg = await nuvemApi('GET', '/api/db?acao=tempoReal'); } catch (e) { return; }
    if (!cfg || !cfg.ativo || !NUVEM.pronto) return;
    let primeiroToken = cfg.tokenRequest;
    let rt;
    try {
        rt = new Ably.Realtime({
            closeOnUnload: true,
            authCallback: (params, cb) => {
                if (primeiroToken) { const t = primeiroToken; primeiroToken = null; cb(null, t); return; }
                nuvemApi('GET', '/api/db?acao=tempoReal')
                    .then(r => r && r.ativo ? cb(null, r.tokenRequest) : cb('Aviso em tempo real desligado no servidor.', null))
                    .catch(e => cb(e.message, null));
            }
        });
    } catch (e) { console.error('Tempo real indisponível', e); return; }
    NUVEM.tempoReal = rt;
    rt.connection.on(mudanca => {
        if (NUVEM.tempoReal !== rt) return;
        const antes = NUVEM.tempoRealConectado;
        NUVEM.tempoRealConectado = mudanca.current === 'connected';
        // Ao (re)conectar, busca o que pode ter passado enquanto a conexão estava fora.
        if (NUVEM.tempoRealConectado && !antes) nuvemAgendarPuxar(100);
        else if (!NUVEM.tempoRealConectado && antes) nuvemAgendarPuxar(nuvemIntervaloPuxar());
        nuvemStatus();
    });
    rt.channels.get(cfg.canal).subscribe('mudanca', msg => {
        const d = (msg && msg.data) || {};
        if (d.origem && d.origem === NUVEM_SESSAO_ID) return;          // gravação desta própria aba
        if (Number(d.seq) && Number(d.seq) <= NUVEM.cursor) return;     // já recebido
        clearTimeout(NUVEM.timerAviso);                                 // vários avisos seguidos = uma busca
        NUVEM.timerAviso = setTimeout(() => { if (NUVEM.pronto) nuvemCicloPuxar(); }, 300);
    });
}

function nuvemDesconectarTempoReal() {
    const rt = NUVEM.tempoReal;
    NUVEM.tempoReal = null;
    NUVEM.tempoRealConectado = false;
    clearTimeout(NUVEM.timerAviso);
    if (rt) { try { rt.close(); } catch (e) {} }
}

// ---------------------------------------------------------------------------
// Indicador de situação (cabeçalho) e painel em Configurações
// ---------------------------------------------------------------------------
function nuvemStatus() {
    nuvemSalvarPendentes();
    const ponto = document.getElementById('nuvemStatusPonto'), texto = document.getElementById('nuvemStatusTexto');
    if (!ponto || !texto) return;
    const pend = nuvemPendentes();
    let cor = 'bg-emerald-400', msg = 'Nuvem · sincronizado';
    if (!NUVEM.pronto) { cor = 'bg-slate-400'; msg = 'Conectando…'; }
    else if (!NUVEM.online || NUVEM.erros) { cor = 'bg-red-500'; msg = 'Sem conexão' + (pend ? ' · ' + pend + ' pendente(s)' : ''); }
    else if (NUVEM.enviando || pend) { cor = 'bg-amber-400 animate-pulse'; msg = 'Salvando…'; }
    else if (NUVEM.ultimaSync) msg = 'Nuvem · ' + NUVEM.ultimaSync.toLocaleTimeString('pt-BR');
    ponto.className = 'w-2.5 h-2.5 rounded-full ' + cor;
    texto.textContent = msg;
    const modo = NUVEM.tempoRealConectado ? 'Atualização em tempo real ativa' : 'Atualização automática a cada 30 s';
    document.getElementById('nuvemStatus').title = (NUVEM.ultimoErro ? 'Último erro: ' + NUVEM.ultimoErro + '\n' : '') + modo + '\nClique para sincronizar agora';
}

async function nuvemAtualizarPainel(detalhe) {
    const box = document.getElementById('painelNuvemResumo');
    if (!box) return;
    const card = (t, v, cls) => '<div class="p-3 rounded-lg border bg-slate-50"><p class="text-[10px] uppercase font-bold text-slate-400">' + t + '</p><p class="font-bold ' + (cls || 'text-slate-700') + '">' + v + '</p></div>';
    box.innerHTML = card('Banco de dados', 'Postgres (Neon) · Vercel')
        + card('Situação', NUVEM.online && !NUVEM.erros ? 'Conectado' : 'Sem conexão', NUVEM.online && !NUVEM.erros ? 'text-emerald-600' : 'text-red-600')
        + card('Atualização', NUVEM.tempoRealConectado ? 'Tempo real' : 'A cada 30 s', NUVEM.tempoRealConectado ? 'text-emerald-600' : 'text-amber-600')
        + card('Última sincronização', NUVEM.ultimaSync ? NUVEM.ultimaSync.toLocaleString('pt-BR') : '—')
        + card('Alterações a enviar', String(nuvemPendentes()));
    if (!detalhe) return;
    const alvo = document.getElementById('painelNuvemTabelas');
    alvo.innerHTML = '<p class="text-xs text-slate-400">Consultando o banco…</p>';
    try {
        const r = await nuvemApi('GET', '/api/db?acao=status');
        alvo.innerHTML = '<div class="overflow-x-auto"><table class="w-full text-left text-xs text-slate-600 mt-2"><thead class="bg-slate-50 uppercase text-slate-400 border-b"><tr><th class="p-2">Tabela</th><th class="p-2">Registros</th><th class="p-2">Última alteração</th></tr></thead><tbody>'
            + r.porTabela.map(t => '<tr class="border-b"><td class="p-2 font-bold">' + esc(NOME_TABELA[t.tabela] || t.tabela) + '</td><td class="p-2">' + fmtNum(t.total, 0) + '</td><td class="p-2">' + (t.ultima ? new Date(t.ultima).toLocaleString('pt-BR') : '—') + '</td></tr>').join('')
            + '</tbody></table></div><p class="text-[11px] text-slate-400 mt-2">Espaço ocupado: ' + fmtNum(r.bytes / 1048576, 2) + ' MB · cursor ' + r.seq + '</p>';
    } catch (e) { alvo.innerHTML = '<p class="text-xs text-red-600">' + esc(e.message) + '</p>'; }
}

// Botão "Nuvem · hh:mm:ss" e "Sincronizar agora": envia, busca e mostra o que realmente aconteceu.
let nuvemSincronizandoManual = false;
async function nuvemSincronizarAgora() {
    if (nuvemSincronizandoManual) return;
    if (!NUVEM.pronto) { kpErro('Sem conexão com a nuvem', 'Entre novamente no sistema para sincronizar.'); return; }
    nuvemSincronizandoManual = true;
    kpCarregando('Sincronizando…', 'Gravando suas alterações no banco e buscando as dos outros usuários.');
    let erro = null, envio = nuvemResultadoVazio(), recebidas = 0;
    try {
        envio = await nuvemEnviarTudo();
        if (envio.erro) throw envio.erro;
        recebidas = await nuvemPuxar();
        NUVEM.erros = 0; NUVEM.online = true; NUVEM.ultimaSync = new Date(); NUVEM.ultimoErro = '';
    } catch (e) {
        erro = e;
        NUVEM.erros = Math.max(1, NUVEM.erros); NUVEM.online = !e.rede; NUVEM.ultimoErro = e.message;
    } finally {
        nuvemSincronizandoManual = false;
        nuvemStatus();
        nuvemAtualizarPainel(false);
    }
    if (erro) {
        const pend = nuvemPendentes();
        const html = esc(erro.message || 'Falha desconhecida.')
            + (pend ? '<br><br><b>' + pend + ' alteração(ões)</b> continuam guardadas neste navegador e serão enviadas quando a conexão voltar.' : '');
        if (!kpTemSwal()) { kpErro('Não foi possível sincronizar', html); return; }
        const r = await Swal.fire(Object.assign({}, KP_SWAL, { icon: 'error', title: 'Não foi possível sincronizar', html,
            showCancelButton: true, confirmButtonText: 'Tentar de novo', cancelButtonText: 'Fechar' }));
        if (r.isConfirmed) nuvemSincronizarAgora();
        return;
    }
    const hora = NUVEM.ultimaSync.toLocaleTimeString('pt-BR');
    if (!envio.enviados && !recebidas) {
        kpSucesso('Tudo sincronizado', 'Nenhuma alteração pendente — os dados desta tela já são os mesmos do banco.<br><small class="text-slate-500">Conferido às ' + hora + '</small>');
        return;
    }
    const linhas = [];
    if (envio.gravados) linhas.push('<b>' + envio.gravados + '</b> alteração(ões) gravada(s) no banco');
    if (envio.recusados) linhas.push('<b>' + envio.recusados + '</b> alteração(ões) recusada(s) — veja os avisos no canto da tela');
    if (recebidas) linhas.push('<b>' + recebidas + '</b> atualização(ões) recebida(s) de outros usuários');
    const pend = nuvemPendentes();
    if (pend) linhas.push('<b>' + pend + '</b> ainda na fila (reenvio automático)');
    (envio.recusados || pend ? kpAtencao : kpSucesso)(envio.recusados || pend ? 'Sincronização parcial' : 'Sincronizado com a nuvem',
        linhas.join('<br>') + '<br><small class="text-slate-500">Concluído às ' + hora + '</small>');
}

// Botão "Recarregar dados da nuvem" (silencioso: chamado internamente, sem janelas).
async function nuvemRecarregarTudo(silencioso) {
    if (!NUVEM.pronto) return;
    if (!silencioso) kpCarregando('Recarregando dados…', 'Buscando todas as tabelas no banco de dados.');
    try {
        await nuvemEnviarTudo();
        await nuvemCarregarTudo({ semTelaCarregando: !silencioso || undefined });
        carregarConfigNaTela();
        renderizarTudo();
        if (!silencioso) kpSucesso('Dados recarregados', 'Todas as telas mostram agora o que está gravado no banco.');
    } catch (e) {
        if (silencioso) nuvemAviso('Falha ao recarregar: ' + e.message, 'erro');
        else kpErro('Não foi possível recarregar', esc(e.message));
    }
}

// ---------------------------------------------------------------------------
// Login, sessão e saída
// ---------------------------------------------------------------------------
function pedirNovaSenha(email) {
    for (let i = 0; i < 3; i++) {
        const nova = prompt('Primeiro acesso de ' + email + '.\nDefina uma nova senha (mínimo 6 caracteres):');
        if (nova === null) return '';
        if ((nova || '').length < 6) { alert('A senha precisa ter pelo menos 6 caracteres.'); continue; }
        const conf = prompt('Confirme a nova senha:');
        if (conf !== nova) { alert('As senhas não conferem.'); continue; }
        return nova;
    }
    return '';
}

let registrarLogDepois = null;
async function realizarLogin() {
    const email = (document.getElementById('loginEmail').value || '').trim().toLowerCase();
    const senha = document.getElementById('loginSenha').value;
    const erroEl = document.getElementById('loginErro');
    const btn = document.getElementById('btnEntrar');
    erroEl.classList.add('hidden');
    if (btn) { btn.disabled = true; btn.classList.add('opacity-60'); }
    try {
        let r = await nuvemApi('POST', '/api/auth', { acao: 'login', email, senha });
        if (r.precisaTrocarSenha) {
            const nova = pedirNovaSenha(email);
            if (!nova) throw new Error('É obrigatório definir uma nova senha no primeiro acesso.');
            r = await nuvemApi('POST', '/api/auth', { acao: 'trocarSenha', email, senhaAtual: senha, novaSenha: nova });
            registrarLogDepois = ['SENHA', 'USUARIO', 'Senha definida no primeiro acesso (' + email + ')'];
        }
        document.getElementById('loginSenha').value = '';
        await nuvemIniciarSessao(r.token, r.usuario);
    } catch (e) {
        erroEl.innerText = e.message || 'Não foi possível entrar.';
        erroEl.classList.remove('hidden');
    } finally {
        if (btn) { btn.disabled = false; btn.classList.remove('opacity-60'); }
    }
}

async function nuvemIniciarSessao(token, usuario) {
    const reentrada = NUVEM.carregadoUmaVez;
    NUVEM.token = token;
    sessionStorage.setItem('kp_token', token);
    const mesmoUsuario = !!(state.currentUser && state.currentUser.id === usuario.id);
    // Outro usuário entrando na mesma aba: a fila do anterior já ficou guardada na chave dele.
    if (!mesmoUsuario) NUVEM.pendentesJSON = '';
    state.currentUser = { id: usuario.id, name: usuario.nome, role: usuario.perfil, email: usuario.email, funcionarioId: usuario.funcionarioId || '' };
    // Sessão expirada e renovada pela mesma pessoa: envia o que ficou na fila (e atualiza a cópia guardada).
    if (reentrada && mesmoUsuario && nuvemPendentes()) { NUVEM.pronto = true; await nuvemEnviarTudo(); }
    NUVEM.pendentesProntos = false;
    await nuvemCarregarTudo();
    const PERFIL_NOME = { ADMIN: 'Administrador', PRODUCAO: 'Operador de Produção', ESTOQUE: 'Operador de Estoque', OPERADOR: 'Funcionária(o)' };
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('userDisplayName').innerText = usuario.nome;
    document.getElementById('userRoleBadge').innerText = PERFIL_NOME[usuario.perfil] || usuario.perfil;
    aplicarPermissoesMenu(usuario.perfil);
    carregarConfigNaTela();
    if (!reentrada) registrarLog('LOGIN', 'SISTEMA', 'Acesso realizado como ' + usuario.perfil + ' (' + usuario.email + ')');
    if (registrarLogDepois) { registrarLog.apply(null, registrarLogDepois); registrarLogDepois = null; }
    renderizarTudo();
    nuvemStatus();
    nuvemAgendarPuxar(nuvemIntervaloPuxar());
    nuvemConectarTempoReal();
    clearInterval(NUVEM.timerRenovar);
    NUVEM.timerRenovar = setInterval(async () => {
        try { const r = await nuvemApi('GET', '/api/auth'); NUVEM.token = r.token; sessionStorage.setItem('kp_token', r.token); } catch (e) {}
    }, 4 * 3600 * 1000);
}

function nuvemSessaoExpirada(msg) {
    if (!NUVEM.pronto) return;
    nuvemSalvarPendentes();
    NUVEM.pronto = false;
    clearTimeout(NUVEM.timerPuxar);
    nuvemDesconectarTempoReal();
    sessionStorage.removeItem('kp_token');
    kpFechar();
    const erroEl = document.getElementById('loginErro');
    erroEl.innerText = (msg || 'Sua sessão expirou.') + ' Entre novamente — suas alterações pendentes serão enviadas.';
    erroEl.classList.remove('hidden');
    document.getElementById('loginEmail').value = (state.currentUser && state.currentUser.email) || '';
    document.getElementById('loginScreen').classList.remove('hidden');
    nuvemStatus();
}

async function logout() {
    try {
        registrarLog('LOGOUT', 'SISTEMA', 'Sessão encerrada');
        clearTimeout(NUVEM.timerEnvio);
        await nuvemEnviarTudo();
    } catch (e) {}
    nuvemSalvarPendentes();              // o que não subiu fica guardado para o próximo acesso
    nuvemDesconectarTempoReal();
    NUVEM.pronto = false;
    sessionStorage.removeItem('kp_token');
    location.reload();
}

// ---------------------------------------------------------------------------
// Backup: restaurar grava o conteúdo do arquivo direto no banco (no servidor, de uma vez)
// ---------------------------------------------------------------------------
function nuvemLerArquivo(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result);
        reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
        reader.readAsText(file);
    });
}

async function restaurarBackupJSON(ev) {
    const file = ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    if (!NUVEM.pronto) { kpErro('Sem conexão com a nuvem', 'Entre novamente no sistema antes de restaurar um backup.'); return; }
    if (!state.currentUser || state.currentUser.role !== 'ADMIN') { kpErro('Sem permissão', 'Apenas administradores podem restaurar backups.'); return; }

    let parsed;
    try { parsed = JSON.parse(await nuvemLerArquivo(file)); }
    catch (e) { kpErro('Arquivo inválido', 'O arquivo <b>' + esc(file.name) + '</b> não é um JSON válido.'); return; }
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.produtos)) {
        kpErro('Arquivo não reconhecido', 'O arquivo <b>' + esc(file.name) + '</b> não parece ser um backup deste sistema.');
        return;
    }

    // Monta o que vai para o servidor e o resumo para a confirmação.
    const registros = {};
    const linhas = [];
    Object.keys(TABELAS_SYNC).forEach(t => {
        const k = TABELAS_SYNC[t];
        if (!Array.isArray(parsed[k])) return;
        registros[t] = parsed[k].filter(r => r && r.id).map(limparControleLocal);
        linhas.push('<tr class="border-b"><td class="p-1 text-left">' + esc(NOME_TABELA[t] || t) + '</td><td class="p-1 text-right">'
            + fmtNum((state[k] || []).length, 0) + '</td><td class="p-1 text-right font-bold">' + fmtNum(registros[t].length, 0) + '</td></tr>');
    });
    if (Array.isArray(parsed.logs)) {
        registros.LOGS = parsed.logs.filter(l => l && typeof l === 'object')
            .map((l, i) => Object.assign({}, l, { id: l.id || ('LOG-REST-' + i + '-' + Math.random().toString(36).slice(2, 6)) }));
    }
    const config = parsed.config ? mergeProfundo(JSON.parse(JSON.stringify(state.config)), parsed.config) : null;

    const conf = await kpConfirmar({
        titulo: 'Restaurar backup na nuvem?',
        icone: 'warning', perigo: true, largura: 560,
        html: '<p class="text-sm mb-2">Arquivo: <b>' + esc(file.name) + '</b></p>'
            + '<table class="w-full text-xs mb-3"><thead><tr class="border-b text-slate-500"><th class="p-1 text-left">Tabela</th><th class="p-1 text-right">Hoje</th><th class="p-1 text-right">No arquivo</th></tr></thead><tbody>'
            + linhas.join('') + '</tbody></table>'
            + '<p class="text-xs text-red-600 font-semibold">Os dados atuais serão SUBSTITUÍDOS para todos os usuários: registros que não estão no arquivo serão excluídos. Alterações ainda não enviadas deste navegador serão descartadas.</p>',
        confirmar: 'Restaurar', cancelar: 'Cancelar',
        checkbox: 'Baixar um backup dos dados atuais antes de restaurar', checkboxMarcado: true
    });
    if (!conf.confirmado) return;
    if (conf.valor) exportarBackupJSON();

    kpCarregando('Enviando backup para o banco…', 'Não feche esta página. Isso pode levar alguns segundos.');
    NUVEM.restaurando = true;
    clearTimeout(NUVEM.timerEnvio);
    let r;
    try {
        if (nuvemEnvioAtual) await nuvemEnvioAtual;
        r = await nuvemApi('POST', '/api/db', { acao: 'restaurar', registros, config });
    } catch (e) {
        NUVEM.restaurando = false;
        nuvemAgendarEnvio();
        kpErro('Backup não restaurado', esc(e.message) + '<br><br>Nenhum dado foi alterado no banco.');
        return;
    }
    // Gravado no banco: a tela passa a mostrar exatamente o que está lá.
    try {
        nuvemDescartarPendentes();
        NUVEM.restaurando = false;
        kpCarregando('Backup gravado. Recarregando…', 'Buscando os dados restaurados no banco.');
        await nuvemCarregarTudo({ semTelaCarregando: true });
        carregarConfigNaTela();
        registrarLog('RESTORE', 'SISTEMA', 'Backup restaurado de arquivo (' + file.name + ')');
        renderizarTudo();
    } catch (e) {
        NUVEM.restaurando = false;
        kpErro('Backup gravado, mas a tela não foi atualizada', 'O banco já tem os dados do backup. Recarregue a página (F5) para vê-los.<br><br>' + esc(e.message));
        return;
    }
    const resumo = r.resumo || {};
    const tabelas = Object.keys(resumo).filter(t => t !== 'LOGS' && t !== 'CONFIG');
    kpSucesso('Backup restaurado',
        '<table class="w-full text-xs"><thead><tr class="border-b text-slate-500"><th class="p-1 text-left">Tabela</th><th class="p-1 text-right">Incluídos</th><th class="p-1 text-right">Alterados</th><th class="p-1 text-right">Excluídos</th></tr></thead><tbody>'
        + tabelas.map(t => '<tr class="border-b"><td class="p-1 text-left">' + esc(NOME_TABELA[t] || t) + '</td><td class="p-1 text-right">' + resumo[t].incluidos
            + '</td><td class="p-1 text-right">' + resumo[t].alterados + '</td><td class="p-1 text-right">' + resumo[t].excluidos + '</td></tr>').join('')
        + '</tbody></table><p class="text-xs text-slate-500 mt-2">Os outros usuários recebem os dados restaurados automaticamente.</p>');
}

// ---------------------------------------------------------------------------
// Inicialização
// ---------------------------------------------------------------------------
window.onload = async function () {
    try {
        // Nada de dados de exemplo na tela: tudo vem do banco depois do login.
        Object.keys(TABELAS_SYNC).forEach(t => { state[TABELAS_SYNC[t]] = []; });
        state.logs = [];
        state.googleScriptUrl = '';
        state.syncMeta = Object.assign({}, state.syncMeta || {}, { ultimoSyncOk: 'nuvem' });
        migrarDados();
        carregarConfigNaTela();
        definirVisaoProducao('kanban');
        iniciarLoopCronometros();
    } catch (e) { console.error('Falha na preparação da tela', e); }
    nuvemStatus();
    const token = sessionStorage.getItem('kp_token');
    if (token) {
        NUVEM.token = token;
        try {
            const r = await nuvemApi('GET', '/api/auth');
            await nuvemIniciarSessao(r.token, r.usuario);
            return;
        } catch (e) {
            sessionStorage.removeItem('kp_token');
            NUVEM.token = '';
            NUVEM.pronto = false;
        }
    }
    document.getElementById('loginScreen').classList.remove('hidden');
    const email = document.getElementById('loginEmail');
    if (email) email.focus();
};
