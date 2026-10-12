/* Kélita Produção — perfil OPERADOR (Funcionária/o) e comandas por etapa.
   Cada login de funcionária é vinculado ao cadastro dela em Funcionários (usuario.funcionarioId).
   No celular ela abre a comanda (ordem de produção), escolhe a etapa que vai fazer e toca em iniciar:
   fica registrado "Etapa Costura iniciada por Edna", com hora de início. Ao concluir, informa as peças.
   Cada trecho de trabalho é uma sessão da ordem (o.sessoes) e alimenta horas, custo de mão de obra e
   produção por pessoa. Uma comanda pode ter várias pessoas, em etapas diferentes ou na mesma etapa.
   Ordens montadas pelo gestor com várias pessoas (forma padrão) continuam funcionando como antes.
   O servidor (api/db.js) confere de novo o que a funcionária pode gravar. */

function perfilOperador() { return !!(state.currentUser && state.currentUser.role === 'OPERADOR'); }
function meuUsuario() {
    const id = state.currentUser && state.currentUser.id;
    return (state.usuarios || []).find(u => u.id === id) || null;
}
function meuFuncionarioId() {
    const u = meuUsuario();
    return (u && u.funcionarioId) || (state.currentUser && state.currentUser.funcionarioId) || '';
}
function minhaFuncionaria() { const id = meuFuncionarioId(); return id ? getFuncionario(id) : null; }
function ehMinhaOrdem(o) { const id = meuFuncionarioId(); return !!(id && o && (o.funcionarioIds || []).includes(id)); }
const ORDEM_ABERTA = o => o && ['EM_ANDAMENTO', 'PAUSADA'].includes(o.status);

// ============================================================
// Sessões de trabalho por etapa
// ============================================================
function sessoesAbertas(o) { return (o.sessoes || []).filter(s => !s.fim); }
function duracaoSessaoSeg(s) { return Math.max(0, Math.floor(((s.fim || agoraMs()) - s.inicio) / 1000)); }
function sessaoAbertaDe(funcionarioId) {
    for (const o of state.producoes) {
        if (!ORDEM_ABERTA(o)) continue;
        const s = (o.sessoes || []).find(x => !x.fim && x.funcionarioId === funcionarioId);
        if (s) return { o, s };
    }
    return null;
}
function apontarEtapa(o, tipo, etapa, qtd, obs, funcionarioId) {
    if (!Array.isArray(o.apontamentos)) o.apontamentos = [];
    o.apontamentos.push({ data: new Date().toLocaleString('pt-BR'), ts: Date.now(), tipo, etapa, qtd: Number(qtd) || 0, obs,
                          usuario: state.currentUser ? state.currentUser.name : '', funcionarioId: funcionarioId || '' });
}
function pecasNaEtapa(o, etapa) { return (o.sessoes || []).filter(s => s.etapa === etapa).reduce((a, s) => a + (Number(s.qtd) || 0), 0); }

// Encerra uma sessão. modo: 'CONCLUIDA' (com peças) ou 'PAUSA'.
function encerrarSessao(o, s, qtd, modo, detalhe) {
    s.fim = agoraMs();
    s.qtd = Number(qtd) || 0;
    const tempo = fmtMinutos(duracaoSessaoSeg(s) / 60);
    if (modo === 'CONCLUIDA') {
        const total = pecasNaEtapa(o, s.etapa);
        if (o.etapa === s.etapa) o.quantidadeParcial = total;
        apontarEtapa(o, 'APONTAMENTO', s.etapa, total, `Etapa ${s.etapa} concluída por ${s.nome} — ${fmtNum(s.qtd, 0)} peça(s) em ${tempo}`, s.funcionarioId);
        registrarLog('ETAPA_CONCLUIDA', 'PRODUCAO', `Ordem ${o.id}: etapa ${s.etapa} concluída por ${s.nome} (${fmtNum(s.qtd, 0)} peças, ${tempo})`);
    } else {
        apontarEtapa(o, 'ETAPA_PAUSA', s.etapa, o.quantidadeParcial || 0, `Etapa ${s.etapa} encerrada por ${s.nome}${detalhe ? ' ' + detalhe : ''} após ${tempo}`, s.funcionarioId);
        registrarLog('ETAPA_PAUSADA', 'PRODUCAO', `Ordem ${o.id}: etapa ${s.etapa} encerrada por ${s.nome}${detalhe ? ' ' + detalhe : ''} (${tempo})`);
    }
}
function fecharSessoesAbertas(o, detalhe) { sessoesAbertas(o).forEach(s => encerrarSessao(o, s, 0, 'PAUSA', detalhe)); }

// Mão de obra por pessoa: horas das próprias sessões; quem não registrou etapa fica com o tempo total da ordem.
function detalheMaoObraPorSessoes(o, horasOrdem) {
    const porPessoa = new Map();
    (o.sessoes || []).forEach(s => {
        const p = porPessoa.get(s.funcionarioId) || { id: s.funcionarioId, nome: s.nome, custoHora: Number(s.custoHora) || 0, seg: 0, etapas: new Set() };
        p.seg += duracaoSessaoSeg(s); p.etapas.add(s.etapa);
        porPessoa.set(s.funcionarioId, p);
    });
    const snap = id => (o.funcionariosSnapshot || []).find(x => x.id === id) || { id, nome: (getFuncionario(id) || {}).nome || '', custoHora: custoHoraFuncionario(getFuncionario(id)) };
    return (o.funcionarioIds || []).map(id => {
        const p = porPessoa.get(id);
        if (p) { const h = p.seg / 3600; return { id, nome: p.nome, custoHora: p.custoHora, horas: h, custo: h * p.custoHora, etapas: [...p.etapas] }; }
        const f = snap(id), ch = Number(f.custoHora) || 0;
        return { id, nome: f.nome, custoHora: ch, horas: horasOrdem, custo: horasOrdem * ch };
    });
}

// Duas pessoas iniciando/concluindo etapas na mesma comanda ao mesmo tempo: em vez de perder a
// alteração de uma delas, junta as etapas, apontamentos e pessoas das duas versões e grava de novo.
// Só vale para comanda ainda aberta no banco; o resto da ordem segue a versão do banco.
function mesclarComanda(local, remoto) {
    if (!local || !remoto || !ORDEM_ABERTA(remoto)) return null;
    const sl = local.sessoes || [], sr = remoto.sessoes || [];
    const idsR = new Map(sr.map(s => [s.id, s]));
    const temNovidade = sl.some(s => { const r = idsR.get(s.id); return !r || (s.fim && !r.fim) || (Number(s.qtd) || 0) !== (Number(r.qtd) || 0); });
    if (!temNovidade) return null;
    const sessoes = sr.map(r => { const l = sl.find(s => s.id === r.id); return l && l.fim && !r.fim ? l : (l && l.fim && r.fim && (Number(l.qtd) || 0) !== (Number(r.qtd) || 0) ? l : r); })
        .concat(sl.filter(s => !idsR.has(s.id)));
    const chave = a => (a.ts || '') + '|' + (a.obs || '') + '|' + (a.funcionarioId || '');
    const vistos = new Set((remoto.apontamentos || []).map(chave));
    const apontamentos = (remoto.apontamentos || []).concat((local.apontamentos || []).filter(a => !vistos.has(chave(a)))).sort((a, b) => (a.ts || 0) - (b.ts || 0));
    const funcionarioIds = [...new Set([...(remoto.funcionarioIds || []), ...(local.funcionarioIds || [])])];
    const snaps = new Map((remoto.funcionariosSnapshot || []).map(f => [f.id, f]));
    (local.funcionariosSnapshot || []).forEach(f => { if (!snaps.has(f.id)) snaps.set(f.id, f); });
    const ultimaEtapa = [...apontamentos].reverse().find(a => a.tipo === 'ETAPA');
    const mesclado = Object.assign({}, remoto, {
        sessoes, apontamentos, funcionarioIds, funcionariosSnapshot: [...snaps.values()],
        etapa: ultimaEtapa ? ultimaEtapa.etapa : remoto.etapa,
        quantidadeParcial: Math.max(Number(remoto.quantidadeParcial) || 0, Number(local.quantidadeParcial) || 0),
        status_sync: 'PENDENTE'
    });
    if (remoto.status === 'PAUSADA' && local.status === 'EM_ANDAMENTO') {
        Object.assign(mesclado, { status: 'EM_ANDAMENTO', timerStart: local.timerStart, pausedSeconds: local.pausedSeconds, pausadoDesde: null });
    }
    return mesclado;
}

// Iniciar uma etapa numa comanda, pela funcionária logada
function iniciarEtapa(ordemId, etapa) {
    const f = minhaFuncionaria();
    if (!f) { alert('Seu login não está vinculado a um cadastro de funcionária.'); return; }
    const o = state.producoes.find(x => x.id === ordemId);
    if (!ORDEM_ABERTA(o)) { alert('Esta comanda não está mais aberta.'); mpRedesenhar(); return; }
    const atual = sessaoAbertaDe(f.id);
    if (atual) {
        if (atual.o.id === o.id && atual.s.etapa === etapa) return;
        if (!confirm(`Você está em ${atual.s.etapa} na comanda ${atual.o.id}.\nEncerrar e começar ${etapa} na ${o.id}?`)) return;
        encerrarSessao(atual.o, atual.s, 0, 'PAUSA', 'para trocar de etapa');
    }
    if (!(o.funcionarioIds || []).includes(f.id)) {
        o.funcionarioIds = [...(o.funcionarioIds || []), f.id];
        o.funcionariosSnapshot = [...(o.funcionariosSnapshot || []), { id: f.id, nome: f.nome, custoHora: custoHoraFuncionario(f) }];
    }
    if (o.status === 'PAUSADA') {
        if (o.pausadoDesde) o.pausedSeconds = (o.pausedSeconds || 0) + Math.floor((agoraMs() - o.pausadoDesde) / 1000);
        o.pausadoDesde = null; o.status = 'EM_ANDAMENTO'; o.timerStart = agoraMs();
    }
    if (!Array.isArray(o.sessoes)) o.sessoes = [];
    o.sessoes.push({ id: 'S' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), funcionarioId: f.id, nome: f.nome,
                     etapa, inicio: agoraMs(), fim: null, qtd: 0, custoHora: custoHoraFuncionario(f) });
    o.etapa = etapa;
    apontarEtapa(o, 'ETAPA', etapa, o.quantidadeParcial || 0, `Etapa ${etapa} iniciada por ${f.nome}`, f.id);
    registrarLog('ETAPA_INICIADA', 'PRODUCAO', `Ordem ${o.id}: etapa ${etapa} iniciada por ${f.nome}`);
    mpComandaAberta = '';
    salvarStorage();
    mpRedesenhar();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function iniciarEtapaN(ordemId, i) { const e = mpEtapas()[i]; if (e) iniciarEtapa(ordemId, e); }
// Redesenha depois de uma ação: tira o foco do campo (no iPhone o toque no botão não tira) para a tela atualizar
function mpRedesenhar() { const a = document.activeElement; if (a && a.blur) a.blur(); renderizarMinhaProducao(); }

function mpConcluirEtapa() {
    const a = sessaoAbertaDe(meuFuncionarioId());
    if (!a) return;
    const qtd = parseFloat((document.getElementById('mpQtdEtapa') || {}).value);
    if (isNaN(qtd) || qtd < 0) { alert('Informe quantas peças você fez nesta etapa (pode ser 0).'); return; }
    if (qtd > (Number(a.o.quantidadePlanejada) || 0) * 1.5 && !confirm('A quantidade passa bastante da meta da comanda. Confirmar?')) return;
    encerrarSessao(a.o, a.s, qtd, 'CONCLUIDA');
    salvarStorage(); mpRedesenhar();
}
function mpPausarEtapa() {
    const a = sessaoAbertaDe(meuFuncionarioId());
    if (!a) return;
    encerrarSessao(a.o, a.s, 0, 'PAUSA', '(pausa)');
    salvarStorage(); mpRedesenhar();
}

// ============================================================
// Integração com o restante do sistema
// ============================================================
(function () {
    const aplicar = window.aplicarPermissoesMenu;
    window.aplicarPermissoesMenu = function (perfil) {
        document.body.classList.toggle('perfil-operador', perfil === 'OPERADOR');
        aplicar.apply(this, arguments);
        if (perfil === 'OPERADOR') showTab('minhaProducaoTab');
    };
    const trocar = window.showTab;
    window.showTab = function (tabId) {
        if (perfilOperador() && tabId !== 'minhaProducaoTab') tabId = 'minhaProducaoTab';
        return trocar.call(this, tabId);
    };
    RENDER_POR_ABA.minhaProducaoTab = () => renderizarMinhaProducao();

    // Custo de mão de obra em tempo real considera as etapas de cada pessoa
    const moAcumulado = window.custoMaoObraAcumulado;
    window.custoMaoObraAcumulado = function (o) {
        if (!(o.sessoes || []).length) return moAcumulado(o);
        return detalheMaoObraPorSessoes(o, tempoDecorrido(o) / 3600).reduce((a, d) => a + d.custo, 0);
    };
    // Cancelar ou finalizar pela tela do gestor encerra quem ainda estava trabalhando na comanda
    const cancelar = window.cancelarProducao;
    window.cancelarProducao = function (id) {
        const o = state.producoes.find(x => x.id === id);
        const r = cancelar.apply(this, arguments);
        if (o && o.status === 'CANCELADA' && sessoesAbertas(o).length) { fecharSessoesAbertas(o, 'no cancelamento'); salvarStorage(); }
        return r;
    };
    // Cartão da ordem no quadro do gestor mostra quem está em cada etapa agora
    const cartao = window.cardOrdemProducao;
    window.cardOrdemProducao = function (o) {
        const html = cartao.apply(this, arguments);
        const abertas = sessoesAbertas(o);
        if (!abertas.length) return html;
        const linha = `<div class="px-3 pb-3 -mt-1 space-y-1">${abertas.map(s => `
            <div class="flex items-center gap-2 text-[11px] bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg px-2 py-1">
              <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span class="truncate">Etapa <strong>${esc(s.etapa)}</strong> iniciada por <strong>${esc(s.nome)}</strong></span>
              <span class="ml-auto font-mono" data-timer-sessao="${esc(o.id)}|${esc(s.id)}">${formatTempo(duracaoSessaoSeg(s))}</span>
            </div>`).join('')}</div>`;
        const i = html.lastIndexOf('</div>');
        return i < 0 ? html + linha : html.slice(0, i) + linha + html.slice(i);
    };
    // Cronômetro das etapas
    setInterval(() => {
        document.querySelectorAll('[data-timer-sessao]').forEach(el => {
            const [oid, sid] = el.getAttribute('data-timer-sessao').split('|');
            const o = state.producoes.find(x => x.id === oid);
            const s = o && (o.sessoes || []).find(x => x.id === sid);
            if (s) el.textContent = formatTempo(duracaoSessaoSeg(s));
        });
    }, 1000);
})();

// ============================================================
// Tela "Minha Produção"
// ============================================================
let mpMostrarNova = false, mpComandaAberta = '', mpBusca = '';
function mpPrimeiroNome(nome) { return String(nome || '').trim().split(/\s+/)[0] || ''; }
function mpProdutosComFicha() {
    return state.produtos.filter(p => p.status !== 'INATIVO' && getFichaAtiva(p.id))
        .sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
}
function mpEtapas() { return (state.config.etapas || []).length ? state.config.etapas : ['Produção']; }
const mpDia = ms => new Date(ms - 3 * 3600000).toISOString().slice(0, 10);   // dia em Fortaleza (UTC-3)

function mpFiltrarComandas(texto) {
    mpBusca = (texto || '').trim().toLowerCase();
    document.querySelectorAll('[data-comanda-busca]').forEach(el => {
        el.style.display = !mpBusca || el.getAttribute('data-comanda-busca').includes(mpBusca) ? '' : 'none';
    });
}
function mpAbrirComanda(id) { mpComandaAberta = mpComandaAberta === id ? '' : id; mpRedesenhar(); }
function mpAlternarNova() { mpMostrarNova = !mpMostrarNova; mpRedesenhar(); }

function renderizarMinhaProducao() {
    const alvo = document.getElementById('mpConteudo');
    if (!alvo) return;
    const f = minhaFuncionaria();
    if (!f) {
        alvo.innerHTML = `
          <div class="bg-white rounded-2xl border border-amber-200 p-5 shadow-sm">
            <h2 class="text-lg font-bold text-slate-800"><i class="fa-solid fa-link-slash text-amber-500"></i> Login sem vínculo</h2>
            <p class="text-sm text-slate-600 mt-2">Seu login ainda não está ligado ao seu cadastro de funcionária. Peça ao administrador para vincular em <strong>Usuários &amp; Acessos</strong>.</p>
          </div>`;
        return;
    }
    // Se ela estava digitando a quantidade, não redesenha por baixo dela
    const ativo = document.activeElement;
    if (ativo && ativo.closest && ativo.closest('#mpConteudo') && ['INPUT', 'SELECT'].includes(ativo.tagName)) { renderPendentePosSync = true; return; }

    const hoje = hojeISO();
    const d7 = new Date(new Date(hoje + 'T12:00:00').getTime() - 6 * 86400000).toISOString().slice(0, 10);
    const minhasSessoes = [];
    state.producoes.forEach(o => (o.sessoes || []).forEach(s => { if (s.funcionarioId === f.id) minhasSessoes.push({ o, s }); }));
    const manuais = state.producoes.filter(o => o.status === 'FINALIZADA' && o.lancamentoManual && ehMinhaOrdem(o));
    const doDia = (lista, diaFn) => lista.filter(x => diaFn(x) === hoje);
    const naSemana = (lista, diaFn) => lista.filter(x => diaFn(x) >= d7);
    const diaSessao = x => mpDia(x.s.inicio), diaManual = o => String(o.data).slice(0, 10);
    const segHoje = doDia(minhasSessoes, diaSessao).reduce((a, x) => a + duracaoSessaoSeg(x.s), 0) + doDia(manuais, diaManual).reduce((a, o) => a + tempoProducaoMinutos(o) * 60, 0);
    const pecasHoje = doDia(minhasSessoes, diaSessao).reduce((a, x) => a + (Number(x.s.qtd) || 0), 0) + doDia(manuais, diaManual).reduce((a, o) => a + (Number(o.quantidadeProduzida) || 0), 0);
    const semSess = naSemana(minhasSessoes, diaSessao), semMan = naSemana(manuais, diaManual);
    const segSemanaComPecas = semSess.filter(x => x.s.qtd > 0).reduce((a, x) => a + duracaoSessaoSeg(x.s), 0) + semMan.reduce((a, o) => a + tempoProducaoMinutos(o) * 60, 0);
    const pecasSemana = semSess.reduce((a, x) => a + (Number(x.s.qtd) || 0), 0) + semMan.reduce((a, o) => a + (Number(o.quantidadeProduzida) || 0), 0);

    const agora = sessaoAbertaDe(f.id);
    const abertas = state.producoes.filter(ORDEM_ABERTA)
        .sort((a, b) => (ehMinhaOrdem(b) - ehMinhaOrdem(a)) || String(b.id).localeCompare(String(a.id)));
    const produtos = mpProdutosComFicha();
    const etapas = mpEtapas();

    const cartaoAgora = () => {
        if (!agora) return '';
        const p = getProduto(agora.o.produtoId);
        const feitas = pecasNaEtapa(agora.o, agora.s.etapa);
        return `
          <div class="bg-white rounded-2xl border-2 border-emerald-400 p-4 shadow-sm">
            <p class="text-[11px] font-bold uppercase tracking-wide text-emerald-600"><span class="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span> Você está trabalhando agora</p>
            <div class="flex items-start justify-between gap-3 mt-1">
              <div class="min-w-0">
                <p class="text-xl font-bold text-slate-800 leading-tight">${esc(agora.s.etapa)}</p>
                <p class="text-sm text-slate-600 truncate">${esc(p ? p.nome : '')}</p>
                <p class="text-xs text-slate-400">Comanda ${esc(agora.o.id)} · meta ${fmtNum(agora.o.quantidadePlanejada, 0)} peças${feitas ? ' · ' + fmtNum(feitas, 0) + ' já feitas nesta etapa' : ''}</p>
              </div>
              <p class="font-mono text-2xl font-bold text-emerald-700" data-timer-sessao="${esc(agora.o.id)}|${esc(agora.s.id)}">${formatTempo(duracaoSessaoSeg(agora.s))}</p>
            </div>
            <label class="block text-xs font-semibold text-slate-600 mt-3 mb-1">Peças que você fez nesta etapa</label>
            <input id="mpQtdEtapa" type="number" inputmode="numeric" min="0" step="1" class="w-full p-3 border rounded-xl bg-slate-50" placeholder="Ex.: 20">
            <div class="grid grid-cols-2 gap-2 mt-3">
              <button onclick="mpPausarEtapa()" class="py-3 rounded-xl bg-amber-100 text-amber-800 font-bold text-sm"><i class="fa-solid fa-pause"></i> Pausar</button>
              <button onclick="mpConcluirEtapa()" class="py-3 rounded-xl bg-emerald-600 text-white font-bold text-sm"><i class="fa-solid fa-check"></i> Concluir etapa</button>
            </div>
          </div>`;
    };

    const cartaoComanda = o => {
        const p = getProduto(o.produtoId);
        const aberto = mpComandaAberta === o.id;
        const pessoas = sessoesAbertas(o);
        const minha = ehMinhaOrdem(o);
        const busca = (o.id + ' ' + (p ? p.nome + ' ' + (p.codigo || '') : '')).toLowerCase();
        return `
          <div data-comanda-busca="${esc(busca)}" class="bg-white rounded-2xl border ${aberto ? 'border-indigo-400' : 'border-slate-200'} shadow-sm overflow-hidden">
            <button onclick="mpAbrirComanda('${esc(o.id)}')" class="w-full text-left p-4 flex items-start justify-between gap-3">
              <div class="min-w-0">
                <p class="font-mono text-xs font-bold text-indigo-600">${esc(o.id)}${minha ? ' <span class="ml-1 text-[10px] font-sans bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded">você participa</span>' : ''}</p>
                <p class="font-bold text-slate-800 leading-tight mt-0.5">${esc(p ? p.nome : o.produtoId)}</p>
                <p class="text-xs text-slate-500 mt-0.5">${fmtNum(o.quantidadePlanejada, 0)} peças · etapa atual: ${esc(o.etapa || '—')}${o.status === 'PAUSADA' ? ' · <span class="text-amber-600 font-semibold">pausada</span>' : ''}</p>
                ${pessoas.length ? `<p class="text-[11px] text-emerald-700 mt-1"><i class="fa-solid fa-user-clock"></i> ${pessoas.map(s => esc(mpPrimeiroNome(s.nome)) + ' em ' + esc(s.etapa)).join(' · ')}</p>` : ''}
              </div>
              <i class="fa-solid ${aberto ? 'fa-chevron-up' : 'fa-chevron-down'} text-slate-400 mt-1"></i>
            </button>
            ${aberto ? `
            <div class="px-4 pb-4 border-t border-slate-100 pt-3">
              <p class="text-xs font-semibold text-slate-600 mb-2">Qual etapa você vai fazer?</p>
              <div class="grid grid-cols-2 gap-2">
                ${etapas.map((e, i) => `<button onclick="iniciarEtapaN('${esc(o.id)}', ${i})" class="py-3 px-2 rounded-xl ${o.etapa === e ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-800'} font-bold text-sm"><i class="fa-solid fa-play text-xs"></i> ${esc(e)}</button>`).join('')}
              </div>
              ${minha ? `<button onclick="mpFinalizar('${esc(o.id)}')" class="w-full mt-3 py-2.5 rounded-xl border border-indigo-200 text-indigo-700 font-bold text-sm"><i class="fa-solid fa-flag-checkered"></i> Finalizar comanda (última etapa)</button>` : ''}
            </div>` : ''}
          </div>`;
    };

    const linhaHistorico = item => {
        if (item.s) {
            const p = getProduto(item.o.produtoId);
            const [, m, d] = mpDia(item.s.inicio).split('-');
            const hora = new Date(item.s.inicio).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
            return `<div class="flex items-center justify-between gap-3 py-2.5 border-b border-slate-100 last:border-0">
                <div class="min-w-0"><p class="font-semibold text-slate-800 text-sm truncate">${esc(item.s.etapa)} · ${esc(p ? p.nome : '')}</p>
                  <p class="text-[11px] text-slate-500">${d}/${m} ${hora} · ${esc(item.o.id)} · ${item.s.fim ? fmtMinutos(duracaoSessaoSeg(item.s) / 60) : 'em andamento'}</p></div>
                <p class="font-bold text-slate-800 flex-shrink-0">${item.s.qtd ? fmtNum(item.s.qtd, 0) + ' <span class="text-xs font-normal text-slate-500">peças</span>' : '<span class="text-xs font-normal text-slate-400">—</span>'}</p>
              </div>`;
        }
        const o = item.m, p = getProduto(o.produtoId);
        const [, m, d] = String(o.data).slice(0, 10).split('-');
        return `<div class="flex items-center justify-between gap-3 py-2.5 border-b border-slate-100 last:border-0">
            <div class="min-w-0"><p class="font-semibold text-slate-800 text-sm truncate">${esc(o.processo || 'Produção')} · ${esc(p ? p.nome : '')}</p>
              <p class="text-[11px] text-slate-500">${d}/${m} · lançada · ${fmtMinutos(tempoProducaoMinutos(o))}</p></div>
            <p class="font-bold text-slate-800 flex-shrink-0">${fmtNum(o.quantidadeProduzida, 0)} <span class="text-xs font-normal text-slate-500">peças</span></p>
          </div>`;
    };
    const historico = semSess.map(x => ({ ...x, quando: x.s.inicio })).concat(semMan.map(o => ({ m: o, quando: Date.parse(String(o.data).slice(0, 10) + 'T23:00:00') })))
        .sort((a, b) => b.quando - a.quando);

    alvo.innerHTML = `
      <div class="rounded-2xl p-5 text-white shadow-md" style="background:linear-gradient(135deg,#4f46e5,#7c3aed)">
        <p class="text-sm text-indigo-100">Olá,</p>
        <h2 class="text-2xl font-bold leading-tight">${esc(mpPrimeiroNome(f.nome))}</h2>
        <div class="grid grid-cols-3 gap-2 mt-4 text-center">
          <div class="bg-white/15 rounded-xl py-2"><p class="text-xl font-bold">${fmtNum(pecasHoje, 0)}</p><p class="text-[11px] text-indigo-100">peças hoje</p></div>
          <div class="bg-white/15 rounded-xl py-2"><p class="text-xl font-bold">${segHoje >= 60 ? fmtMinutos(segHoje / 60) : '—'}</p><p class="text-[11px] text-indigo-100">trabalhado hoje</p></div>
          <div class="bg-white/15 rounded-xl py-2"><p class="text-xl font-bold">${pecasSemana > 0 && segSemanaComPecas > 0 ? fmtMinutos(segSemanaComPecas / 60 / pecasSemana) : '—'}</p><p class="text-[11px] text-indigo-100">por peça (7 dias)</p></div>
        </div>
      </div>

      ${cartaoAgora()}

      <div>
        <div class="flex items-center justify-between mb-2">
          <h3 class="text-sm font-bold text-slate-700">Comandas abertas <span class="text-slate-400 font-normal">(${abertas.length})</span></h3>
          <button onclick="mpAlternarNova()" class="text-xs font-bold text-indigo-600"><i class="fa-solid fa-plus"></i> Nova comanda</button>
        </div>
        <div id="mpNova" class="${mpMostrarNova ? '' : 'hidden'} bg-white rounded-2xl border border-indigo-200 p-4 shadow-sm space-y-3 mb-3">
          <p class="font-bold text-slate-800">Abrir nova comanda</p>
          ${produtos.length ? `
          <div><label class="block text-xs font-semibold text-slate-600 mb-1">Produto</label>
            <select id="mpProduto" class="w-full p-3 border rounded-xl bg-slate-50"><option value="">Escolha o produto…</option>${produtos.map(p => `<option value="${esc(p.id)}">${esc(p.nome)}${p.codigo ? ' · ' + esc(p.codigo) : ''}</option>`).join('')}</select></div>
          <div class="grid grid-cols-2 gap-2">
            <div><label class="block text-xs font-semibold text-slate-600 mb-1">Peças (meta)</label>
              <input id="mpQtd" type="number" inputmode="numeric" min="1" step="1" class="w-full p-3 border rounded-xl bg-slate-50" placeholder="Ex.: 50"></div>
            <div><label class="block text-xs font-semibold text-slate-600 mb-1">Sua etapa</label>
              <select id="mpEtapaNova" class="w-full p-3 border rounded-xl bg-slate-50">${etapas.map(e => `<option value="${esc(e)}">${esc(e)}</option>`).join('')}</select></div>
          </div>
          <div class="grid grid-cols-2 gap-2">
            <button onclick="mpAlternarNova()" class="py-3 rounded-xl bg-slate-100 text-slate-700 font-bold text-sm">Voltar</button>
            <button onclick="mpNovaComanda()" class="py-3 rounded-xl bg-indigo-600 text-white font-bold text-sm"><i class="fa-solid fa-play"></i> Abrir e começar</button>
          </div>` : '<p class="text-sm text-slate-500">Nenhum produto com ficha técnica ativa. Avise o administrador.</p>'}
        </div>
        ${abertas.length > 3 ? `<input type="search" oninput="mpFiltrarComandas(this.value)" value="${esc(mpBusca)}" class="w-full p-3 border rounded-xl bg-white mb-3" placeholder="Buscar pelo número da comanda ou produto">` : ''}
        <div class="space-y-3">${abertas.map(cartaoComanda).join('') || '<p class="text-sm text-slate-400 bg-white rounded-2xl border border-dashed border-slate-300 p-4 text-center">Nenhuma comanda aberta. Use "Nova comanda".</p>'}</div>
      </div>

      <button onclick="mpLancarFeita()" class="w-full bg-white hover:bg-slate-50 border border-slate-200 text-slate-800 rounded-2xl p-4 text-left shadow-sm flex items-center gap-3">
        <i class="fa-solid fa-clipboard-check text-2xl text-indigo-600"></i>
        <span><span class="block font-bold">Lançar produção já feita</span><span class="text-[11px] text-slate-500">sem cronômetro: produto, quantidade e tempo</span></span>
      </button>

      <div class="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
        <h3 class="text-sm font-bold text-slate-700">Meu trabalho — últimos 7 dias</h3>
        <p class="text-[11px] text-slate-500 mb-2">${fmtNum(pecasSemana, 0)} peças · ${fmtMinutos((semSess.reduce((a, x) => a + duracaoSessaoSeg(x.s), 0) + semMan.reduce((a, o) => a + tempoProducaoMinutos(o) * 60, 0)) / 60)} trabalhados</p>
        ${historico.slice(0, 40).map(linhaHistorico).join('') || '<p class="text-sm text-slate-400 py-2">Nada registrado nos últimos 7 dias.</p>'}
      </div>`;
    if (mpBusca) mpFiltrarComandas(mpBusca);
}

// ---------- Nova comanda aberta pela própria funcionária ----------
function mpNovaComanda() {
    const f = minhaFuncionaria();
    if (!f) return;
    const produtoId = (document.getElementById('mpProduto') || {}).value || '';
    const qtd = parseFloat((document.getElementById('mpQtd') || {}).value) || 0;
    const etapa = (document.getElementById('mpEtapaNova') || {}).value || mpEtapas()[0];
    const produto = getProduto(produtoId);
    const ficha = produtoId ? getFichaAtiva(produtoId) : null;
    if (!produto) { alert('Escolha o produto.'); return; }
    if (!ficha) { alert('Este produto está sem ficha técnica ativa. Avise o administrador.'); return; }
    if (qtd <= 0) { alert('Informe quantas peças a comanda terá.'); return; }
    const ordem = {
        id: gerarNumeroOrdem(),
        data: hojeISO(),
        produtoId, fichaTecnicaId: ficha.id,
        fichaSnapshot: { versao: ficha.versao, quantidadePadrao: ficha.quantidadePadrao, tempoPadraoMin: ficha.tempoPadraoMin || 0, itens: ficha.itens.map(it => ({ ...it })) },
        funcionariosSnapshot: [{ id: f.id, nome: f.nome, custoHora: custoHoraFuncionario(f) }],
        equipeId: f.equipeId || '',
        funcionarioIds: [f.id],
        responsavelId: f.id,
        prioridade: 'NORMAL', prazo: '',
        etapa,
        quantidadePlanejada: qtd,
        quantidadeParcial: 0,
        apontamentos: [],
        sessoes: [],
        quantidadeProduzida: 0, quantidadeAprovada: 0, quantidadePerdida: 0, motivoPerda: '', observacoes: '',
        status: 'EM_ANDAMENTO',
        horaInicio: new Date().toISOString(),
        horaFim: null,
        timerStart: agoraMs(), elapsedSeconds: 0, pausedSeconds: 0, pausadoDesde: null,
        materialCost: 0, laborCost: 0, custoAdicionalAlocado: 0, custoTotal: 0, custoUnitario: 0,
        consumoReal: [],
        origem: 'CELULAR'
    };
    state.producoes.push(ordem);
    registrarLog('INICIAR_PRODUCAO', 'PRODUCAO', 'Comanda ' + ordem.id + ' aberta por ' + f.nome + ' (celular) — ' + produto.nome + ', ' + qtd + ' un.');
    mpMostrarNova = false;
    iniciarEtapa(ordem.id, etapa);
}

// ---------- Finalizar a comanda (última etapa) ----------
function mpFinalizar(id) {
    const o = state.producoes.find(x => x.id === id);
    if (!ORDEM_ABERTA(o) || !ehMinhaOrdem(o)) return;
    const outras = sessoesAbertas(o).filter(s => s.funcionarioId !== meuFuncionarioId());
    if (outras.length && !confirm('Ainda há gente trabalhando nesta comanda (' + outras.map(s => s.nome + ' em ' + s.etapa).join(', ') + '). Finalizar mesmo assim?')) return;
    abrirModalFinalizar(id);
    // Na tela da funcionária: sem valores em R$ e sem o ajuste de consumo de insumos (vale o previsto da ficha)
    const p = getProduto(o.produtoId);
    const resumo = document.getElementById('modalFinResumoOrdem');
    if (resumo) resumo.innerHTML = `<strong>${esc(p ? p.nome : '')}</strong> · comanda ${esc(o.id)}<br>Meta ${fmtNum(o.quantidadePlanejada, 0)} peças · aberta há ${formatTempo(tempoDecorrido(o))}`;
    const consumo = document.getElementById('modalFinConsumoReal');
    if (consumo && consumo.parentElement) consumo.parentElement.style.display = 'none';
}

// ---------- Produção já feita (sem cronômetro) ----------
function mpLancarFeita() {
    const f = minhaFuncionaria();
    if (!f) { alert('Seu login não está vinculado a um cadastro de funcionária.'); return; }
    abrirModalProducaoManual();
    const lista = document.getElementById('manualFuncionarios');
    lista.innerHTML = `<label class="hidden"><input type="checkbox" class="manual-func-check" value="${esc(f.id)}" checked> ${esc(f.nome)}</label>`;
    lista.parentElement.style.display = 'none';
    const eq = document.getElementById('manualEquipe');
    if (f.equipeId && [...eq.options].some(op => op.value === f.equipeId)) eq.value = f.equipeId;
    eq.parentElement.style.display = 'none';
    atualizarResponsavelManual();
    const resp = document.getElementById('manualResponsavel');
    resp.value = f.id; resp.parentElement.style.display = 'none';
    document.getElementById('manualBaixaEstoqueWrap').style.display = 'none';
    const ids = new Set(mpProdutosComFicha().map(p => p.id));
    const sel = document.getElementById('manualProduto');
    [...sel.options].forEach(op => { if (op.value && !ids.has(op.value)) op.remove(); });
    document.getElementById('manualTituloModal').innerHTML = '<i class="fa-solid fa-clipboard-check text-indigo-600"></i> Lançar produção feita';
}

// ============================================================
// Administrador: criar o acesso de uma funcionária
// ============================================================
function prepararVinculoUsuario(funcionarioId) {
    const sel = document.getElementById('usrFuncionario');
    if (!sel) return;
    const lista = state.funcionarios.filter(f => f.status === 'ATIVO' || f.id === funcionarioId)
        .sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
    sel.innerHTML = '<option value="">— Nenhum —</option>' + lista.map(f => `<option value="${esc(f.id)}">${esc(f.nome)}${f.cargo ? ' · ' + esc(f.cargo) : ''}</option>`).join('');
    sel.value = funcionarioId || '';
    const perfil = document.getElementById('usrPerfil');
    const marcar = () => { const ob = document.getElementById('usrFuncionarioObrig'); if (ob) ob.style.display = perfil.value === 'OPERADOR' ? '' : 'none'; };
    perfil.onchange = marcar; marcar();
}

function criarAcessoFuncionaria(funcionarioId) {
    const f = getFuncionario(funcionarioId);
    if (!f) return;
    const existente = state.usuarios.find(u => u.funcionarioId === funcionarioId);
    if (existente) {
        alert(f.nome + ' já tem acesso: login "' + existente.email + '". Abrindo o cadastro para conferir ou trocar a senha.');
        abrirModalUsuario(existente.id);
        return;
    }
    abrirModalUsuario();
    const sugestao = String(mpPrimeiroNome(f.nome)).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
    let login = sugestao || 'funcionaria', n = 2;
    while (state.usuarios.some(u => (u.email || '').toLowerCase() === login)) login = sugestao + n++;
    document.getElementById('usrNome').value = f.nome;
    document.getElementById('usrEmail').value = login;
    document.getElementById('usrPerfil').value = 'OPERADOR';
    prepararVinculoUsuario(funcionarioId);
    document.getElementById('usrSenha').focus();
}
