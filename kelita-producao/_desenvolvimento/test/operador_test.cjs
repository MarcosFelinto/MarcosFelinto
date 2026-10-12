// Teste das comandas por etapa (perfil Funcionária) — duas funcionárias no celular e o gestor no computador.
// Sem ABLY_API_KEY a reserva busca mudanças a cada 30 s: as esperas entre aparelhos são de 45 s.
// Uso: node _desenvolvimento/test/operador_test.cjs [url-base]
const { chromium, devices } = require('playwright-core');
const BASE = process.argv[2] || 'http://localhost:8800';
let falhas = 0;
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALHA') + ' ' + m); if (!c) falhas++; };
const api = async (metodo, caminho, corpo, token) => {
  const r = await fetch(BASE + caminho, { method: metodo, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: corpo ? JSON.stringify(corpo) : undefined });
  return { status: r.status, corpo: await r.json().catch(() => ({})) };
};
const esperar = (page, fn, arg, t = 45000) => page.waitForFunction(fn, arg, { timeout: t });
const SUF = Date.now().toString(36);

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.KP_NAVEGADOR || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  const erros = [];
  const admin = await (await browser.newContext({ viewport: { width: 1360, height: 820 } })).newPage();
  admin.on('pageerror', e => erros.push('admin: ' + e.message));
  admin.on('dialog', d => d.accept());
  await admin.goto(BASE + '/');
  await admin.fill('#loginEmail', 'admin@fabrica.com'); await admin.fill('#loginSenha', 'Teste@123'); await admin.click('#btnEntrar');
  await esperar(admin, () => typeof NUVEM !== 'undefined' && NUVEM.pronto);

  // ---------- Gestor cria dois acessos de funcionária ----------
  const pessoas = await admin.evaluate(() => state.funcionarios.filter(x => x.status === 'ATIVO' && !state.usuarios.some(u => u.funcionarioId === x.id)).slice(0, 4).map(f => ({ id: f.id, nome: f.nome })));
  const [fa, fb, fc, fd] = pessoas;
  const logins = [];
  for (const f of [fa, fb]) {
    await admin.evaluate(id => criarAcessoFuncionaria(id), f.id);
    const sug = await admin.evaluate(() => ({ perfil: document.getElementById('usrPerfil').value, vinculo: document.getElementById('usrFuncionario').value }));
    const login = 'op' + logins.length + SUF;
    await admin.fill('#usrEmail', login); await admin.fill('#usrSenha', 'Inicial1');
    await admin.evaluate(() => salvarUsuario());
    logins.push(login);
    ok(sug.perfil === 'OPERADOR' && sug.vinculo === f.id, 'gestor: acesso de ' + f.nome + ' já vem com perfil e vínculo');
  }
  await esperar(admin, () => !nuvemPendentes());

  // ---------- Gestor abre uma comanda do jeito padrão, com duas pessoas ----------
  const pid = await admin.evaluate(() => state.produtos.find(p => p.status !== 'INATIVO' && getFichaAtiva(p.id)).id);
  await admin.evaluate(({ pid, ids }) => {
    abrirModalIniciarProducao(pid);
    document.getElementById('modalProdQtdPlanejada').value = 30;
    document.querySelectorAll('.modal-prod-func-check').forEach(c => { c.checked = ids.includes(c.value); });
    confirmarInicioProducao();
  }, { pid, ids: [fc.id, fd.id] });
  const comanda = await admin.evaluate(() => state.producoes[state.producoes.length - 1].id);
  await esperar(admin, () => !nuvemPendentes());
  ok(!!comanda, 'gestor: comanda ' + comanda + ' aberta com ' + fc.nome + ' e ' + fd.nome + ' (forma padrão)');

  // ---------- Duas funcionárias no celular ----------
  const abrirCelular = async (login) => {
    const ctx = await browser.newContext({ ...devices['iPhone 13'] });
    const p = await ctx.newPage();
    p.on('pageerror', e => erros.push(login + ': ' + e.message));
    const resp = ['Nova1234', 'Nova1234'];
    p.on('dialog', d => d.type() === 'prompt' ? d.accept(resp.shift() || '') : d.accept());
    await p.goto(BASE + '/');
    await p.fill('#loginEmail', login); await p.fill('#loginSenha', 'Inicial1'); await p.click('#btnEntrar');
    await esperar(p, () => typeof NUVEM !== 'undefined' && NUVEM.pronto);
    await p.waitForTimeout(600);
    return p;
  };
  const A = await abrirCelular(logins[0]);
  const B = await abrirCelular(logins[1]);
  ok(await A.evaluate(() => document.querySelector('.tab-content.active').id) === 'minhaProducaoTab', 'celular: entra direto em Minha Produção');
  await esperar(A, id => !!document.querySelector('[data-comanda-busca*="' + id.toLowerCase() + '"]'), comanda);
  ok(true, 'celular: comanda aberta pelo gestor aparece na lista');

  // As duas tocam na mesma comanda, cada uma na sua etapa, quase ao mesmo tempo
  const etapas = await A.evaluate(() => mpEtapas());
  await A.evaluate(id => mpAbrirComanda(id), comanda);
  await B.evaluate(id => mpAbrirComanda(id), comanda);
  await Promise.all([A.evaluate(id => iniciarEtapaN(id, 0), comanda), B.evaluate(id => iniciarEtapaN(id, 1), comanda)]);
  await A.screenshot({ path: require('path').join(require('os').tmpdir(), 'comanda_1.png') });
  await esperar(admin, id => { const o = state.producoes.find(x => x.id === id); return o && sessoesAbertas(o).length === 2; }, comanda, 45000).catch(() => {});
  const vistoGestor = await admin.evaluate(id => { const o = state.producoes.find(x => x.id === id); return { abertas: sessoesAbertas(o).map(s => s.nome + '|' + s.etapa), ids: o.funcionarioIds, aps: o.apontamentos.map(a => a.obs) }; }, comanda);
  ok(vistoGestor.abertas.length === 2, 'tempo real: gestor vê as duas etapas abertas na comanda (' + vistoGestor.abertas.join(', ') + ')');
  ok(vistoGestor.aps.some(t => t === 'Etapa ' + etapas[0] + ' iniciada por ' + fa.nome) && vistoGestor.aps.some(t => t === 'Etapa ' + etapas[1] + ' iniciada por ' + fb.nome), 'histórico: "Etapa X iniciada por Fulana" para as duas');
  ok([fa.id, fb.id, fc.id, fd.id].every(id => vistoGestor.ids.includes(id)), 'comanda tem as 4 pessoas: as 2 do gestor + as 2 que entraram pela etapa');
  await admin.evaluate(() => { showTab('producoesTab'); showSubtab('producoesSubnav', 'prodSubAndamento'); });
  await admin.waitForTimeout(500);
  ok((await admin.textContent('#producoesTab')).includes('iniciada por'), 'gestor: cartão da comanda mostra quem está em cada etapa');

  // Conclusões
  await A.waitForTimeout(2200);
  await A.fill('#mpQtdEtapa', '30'); await A.click('text=Concluir etapa');
  await B.waitForTimeout(500);
  await B.click('text=Pausar');
  await B.waitForTimeout(300);
  await B.evaluate(id => mpAbrirComanda(id), comanda);
  await B.evaluate(id => iniciarEtapaN(id, 1), comanda);
  await B.waitForTimeout(1500);
  await B.fill('#mpQtdEtapa', '28'); await B.click('text=Concluir etapa');
  await esperar(A, () => !nuvemPendentes()); await esperar(B, () => !nuvemPendentes());
  await esperar(A, id => { const o = state.producoes.find(x => x.id === id); return o && (o.sessoes || []).length === 3 && !sessoesAbertas(o).length; }, comanda, 45000).catch(() => {});
  const sess = await A.evaluate(id => state.producoes.find(x => x.id === id).sessoes.map(s => ({ n: s.nome, e: s.etapa, q: s.qtd, seg: duracaoSessaoSeg(s), fim: !!s.fim })), comanda);
  ok(sess.length === 3 && sess.every(s => s.fim), 'etapas registradas: ' + sess.map(s => s.n.split(' ')[0] + ' ' + s.e + ' ' + s.q + 'pç ' + s.seg + 's').join(' · '));
  await B.screenshot({ path: require('path').join(require('os').tmpdir(), 'comanda_2.png') });

  // A finaliza a comanda (última etapa)
  await A.evaluate(id => mpAbrirComanda(id), comanda);
  await A.evaluate(id => mpFinalizar(id), comanda);
  await A.fill('#modalFinQtdProduzida', '28'); await A.fill('#modalFinQtdAprovada', '27');
  await A.evaluate(() => atualizarPerdaCalculada());
  await A.fill('#modalFinMotivoPerda', 'Defeito de costura');
  await A.evaluate(() => confirmarFinalizacaoProducao());
  await esperar(A, () => !nuvemPendentes());
  await esperar(admin, id => { const o = state.producoes.find(x => x.id === id); return o && o.status === 'FINALIZADA'; }, comanda, 45000).catch(() => {});
  const fin = await admin.evaluate(id => { const o = state.producoes.find(x => x.id === id); return { st: o.status, det: o.detalheMaoObra, horasOrdem: o.horasTrabalhadas }; }, comanda);
  const det = id => fin.det.find(d => d.id === id) || {};
  ok(fin.st === 'FINALIZADA', 'comanda finalizada pela funcionária e recebida pelo gestor');
  ok(det(fa.id).horas > 0 && det(fa.id).horas < fin.horasOrdem && det(fb.id).horas > 0 && det(fb.id).horas < fin.horasOrdem,
     'horas por pessoa: cada funcionária recebe só o tempo das próprias etapas');
  ok(Math.abs(det(fc.id).horas - fin.horasOrdem) < 1e-9 && Math.abs(det(fd.id).horas - fin.horasOrdem) < 1e-9, 'forma padrão mantida: quem o gestor pôs na comanda recebe o tempo total');
  const horasRel = await admin.evaluate(({ id, fid }) => { const o = state.producoes.find(x => x.id === id); return horasDaPessoaNaOrdem(o, fid); }, { id: comanda, fid: fa.id });
  ok(Math.abs(horasRel - det(fa.id).horas) < 1e-9, 'relatórios usam as horas da própria pessoa');

  // Nova comanda aberta pela funcionária
  await A.evaluate(() => mpAlternarNova());
  await A.selectOption('#mpProduto', pid); await A.fill('#mpQtd', '12');
  await A.click('text=Abrir e começar'); await A.waitForTimeout(600);
  const nova = await A.evaluate(() => { const a = sessaoAbertaDe(meuFuncionarioId()); return a && { id: a.o.id, etapa: a.s.etapa, ids: a.o.funcionarioIds }; });
  ok(nova && nova.ids.length === 1, 'celular: nova comanda aberta por ela já começa a etapa (' + (nova && nova.id + ' · ' + nova.etapa) + ')');
  await A.click('text=Pausar'); await A.waitForTimeout(300);
  await A.evaluate(id => cancelarProducao(id), nova.id).catch(() => {});

  // ---------- Travas do servidor ----------
  const TA = (await api('POST', '/api/auth', { acao: 'login', email: logins[0], senha: 'Nova1234' })).corpo.token;
  const outra = await admin.evaluate(id => state.producoes.find(o => o.status === 'FINALIZADA' && !(o.funcionarioIds || []).includes(id)), fa.id);
  const t = await api('POST', '/api/db', { ops: [
    { op: 'upsert', tabela: 'PRODUTOS', id: 'X-' + SUF, base: 0, dados: { nome: 'x' } },
    { op: 'upsert', tabela: 'PRODUCAO', id: outra.id, base: outra.versao || 1, dados: { ...outra, funcionarioIds: [fa.id] } },
    { op: 'delete', tabela: 'PRODUCAO', id: comanda }
  ] }, TA);
  ok(t.corpo.resultados.every(r => r.ok === false && r.motivo === 'permissao'), 'API: recusa produto, ordem finalizada de outra pessoa e exclusão');
  ok((await api('GET', '/api/db?acao=tabela&tabela=USUARIOS', null, TA)).corpo.registros.length === 1, 'API: funcionária lê só o próprio usuário');

  // ---------- Limpeza ----------
  const ids = [comanda, nova.id];
  await esperar(A, () => !nuvemPendentes());
  await esperar(admin, id => { const o = state.producoes.find(x => x.id === id); return o && o.status === 'CANCELADA'; }, nova.id, 45000).catch(() => {});
  await admin.evaluate(ids => {
    state.movimentacoesEstoque.filter(m => ids.includes(m.producaoId)).forEach(m => { const ins = getInsumo(m.insumoId); if (ins) ins.estoqueAtual += Number(m.quantidade) || 0; });
    state.movimentacoesEstoque = state.movimentacoesEstoque.filter(m => !ids.includes(m.producaoId));
    state.producoes = state.producoes.filter(o => !ids.includes(o.id));
    salvarStorage();
  }, ids);
  await admin.evaluate(ls => { state.usuarios = state.usuarios.filter(u => !ls.includes(u.email)); salvarStorage(); }, logins);
  await esperar(admin, () => !nuvemPendentes());
  const ADM = (await api('POST', '/api/auth', { acao: 'login', email: 'admin@fabrica.com', senha: 'Teste@123' })).corpo.token;
  const resto = (await api('GET', '/api/db?acao=mudancas&desde=0', null, ADM)).corpo.alterados.filter(r => ids.includes(r.id) || logins.includes((r.dados || {}).email));
  ok(resto.length === 0, 'dados de teste removidos' + (resto.length ? ': ' + JSON.stringify(resto.map(r => [r.tabela, r.id, (r.dados||{}).status, (r.dados||{}).atualizado_por])) : ''));
  const avisos = await A.evaluate(() => (document.getElementById('nuvemToasts') || {}).textContent || '');
  ok(!/permissão|Não foi possível gravar|refaça/.test(avisos), 'celular: sem avisos de conflito ou permissão');
  ok(erros.length === 0, 'sem erros de JavaScript' + (erros.length ? ': ' + erros.join(' | ') : ''));
  await browser.close();
  console.log(falhas ? falhas + ' FALHA(S)' : 'TODOS OS TESTES PASSARAM');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
