// Teste ponta a ponta do Kélita Produção: dois navegadores logados ao mesmo tempo.
// Cobre CRUD, tempo real, conflito, todas as abas, PDFs, Excel, impressão e persistência.
// Sem ABLY_API_KEY a reserva busca mudanças a cada 30 s: as esperas entre navegadores são de 45 s.
// Uso: node _desenvolvimento/test/e2e.cjs <url-base> <senha-admin> [pasta-saida]
const { chromium } = require('playwright-core');
const BASE = process.argv[2] || 'http://localhost:8790';
const SENHA = process.argv[3] || 'Teste@123';
const SAIDA = process.argv[4] || require('os').tmpdir();
let falhas = 0;
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALHA') + ' ' + m); if (!c) falhas++; };
const espera = ms => new Promise(r => setTimeout(r, ms));

async function abrir(browser, nome) {
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const erros = [];
  page.on('pageerror', e => erros.push(nome + ' [pageerror] ' + e.message.split('\n')[0]));
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.googleapis|Failed to load resource/.test(m.text())) erros.push(nome + ' [console] ' + m.text().slice(0, 200)); });
  page.on('dialog', d => d.accept());
  await page.goto(BASE + '/');
  await page.fill('#loginEmail', 'admin@fabrica.com');
  await page.fill('#loginSenha', SENHA);
  await page.click('#btnEntrar');
  await page.waitForFunction(() => typeof NUVEM !== 'undefined' && NUVEM.pronto, null, { timeout: 60000 });
  return { ctx, page, erros };
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.KP_NAVEGADOR || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  const A = await abrir(browser, 'A');
  const B = await abrir(browser, 'B');
  const n = await A.page.evaluate(() => ({ p: state.produtos.length, i: state.insumos.length, o: state.producoes.length, u: state.usuarios.length }));
  ok(n.p >= 72 && n.i >= 232 && n.o >= 19 && n.u >= 3, `dados carregados da nuvem (${JSON.stringify(n)})`);
  ok(await A.page.evaluate(() => !localStorage.getItem('producao_state_v3')), 'nada gravado no localStorage');
  await A.page.waitForFunction(() => nuvemPendentes() === 0, null, { timeout: 30000 }).then(() => ok(true, 'fila vazia depois da carga')).catch(() => ok(false, 'fila vazia depois da carga'));

  // CREATE em A -> aparece em B
  const cat = 'CAT-E2E-' + Date.now().toString(36);
  await A.page.evaluate(id => { state.categorias.push({ id, nome: 'Categoria E2E' }); salvarStorage(); }, cat);
  await A.page.waitForFunction(() => nuvemPendentes() === 0, null, { timeout: 15000 });
  await B.page.waitForFunction(id => state.categorias.some(c => c.id === id), cat, { timeout: 45000 }).then(() => ok(true, 'inclusão em A aparece em B em tempo real')).catch(() => ok(false, 'inclusão em A aparece em B'));

  // UPDATE em B -> aparece em A
  const pid = await B.page.evaluate(() => state.produtos[5].id);
  const precoOrig = await B.page.evaluate(id => state.produtos.find(x => x.id === id).precoVenda, pid);
  await B.page.evaluate(id => { const p = state.produtos.find(x => x.id === id); p.precoVenda = 99.99; salvarStorage(); }, pid);
  await A.page.waitForFunction(id => state.produtos.find(x => x.id === id).precoVenda === 99.99, pid, { timeout: 45000 }).then(() => ok(true, 'alteração em B aparece em A')).catch(() => ok(false, 'alteração em B aparece em A'));

  // DELETE pela função da tela em A -> some em B
  await A.page.evaluate(() => showTab('produtosTab'));
  await A.page.evaluate(id => excluirCategoria(id), cat);
  await B.page.waitForFunction(id => !state.categorias.some(c => c.id === id), cat, { timeout: 45000 }).then(() => ok(true, 'exclusão em A some em B')).catch(() => ok(false, 'exclusão em A some em B'));

  // CONFLITO: A e B alteram o mesmo produto quase juntos
  const pid2 = await A.page.evaluate(() => state.produtos[7].id);
  const nomeOrig = await A.page.evaluate(id => state.produtos.find(x => x.id === id).nome, pid2);
  await A.page.evaluate(() => clearTimeout(NUVEM.timerPuxar));
  await B.page.evaluate(() => clearTimeout(NUVEM.timerPuxar));
  await A.page.evaluate(id => { const p = state.produtos.find(x => x.id === id); p.nome = 'NOME DE A'; salvarStorage(); }, pid2);
  await A.page.waitForFunction(() => nuvemPendentes() === 0, null, { timeout: 15000 });
  await B.page.evaluate(id => { const p = state.produtos.find(x => x.id === id); p.nome = 'NOME DE B'; salvarStorage(); }, pid2);
  await B.page.waitForFunction(() => nuvemPendentes() === 0, null, { timeout: 15000 });
  const nomeB = await B.page.evaluate(id => state.produtos.find(x => x.id === id).nome, pid2);
  ok(nomeB === 'NOME DE A', 'conflito: B recebe a versão gravada primeiro, sem sobrescrever A (' + nomeB + ')');
  await A.page.evaluate(() => nuvemAgendarPuxar(10));
  await B.page.evaluate(() => nuvemAgendarPuxar(10));

  // Lançamento manual de produção em B pela tela -> chega em A
  const antes = await A.page.evaluate(() => state.producoes.length);
  await B.page.evaluate(() => { showTab('producoesTab'); abrirModalProducaoManual(); });
  await B.page.selectOption('#manualProduto', { label: 'CALCINHA AA COM RENDA' });
  await B.page.fill('#manualQtdProduzida', '50');
  await B.page.fill('#manualTempo', '1h30');
  await B.page.evaluate(() => { const c = document.querySelector('.manual-func-check'); c.checked = true; atualizarResponsavelManual(); });
  await B.page.evaluate(() => { document.getElementById('manualBaixaEstoque').checked = false; salvarProducaoManual(); });
  await A.page.waitForFunction(n2 => state.producoes.length === n2 + 1, antes, { timeout: 45000 }).then(() => ok(true, 'lançamento manual de produção em B chega em A')).catch(() => ok(false, 'lançamento manual chega em A'));
  const opNova = await A.page.evaluate(n2 => state.producoes[state.producoes.length - 1], antes);
  ok(opNova && opNova.custoTotal > 0 && Math.abs(opNova.horasTrabalhadas - 1.5) < 1e-6, 'ordem nova com custo calculado e 1,5 h');

  // Todas as abas e subabas sem erro
  const tabs = await A.page.$$eval('.nav-btn', els => els.map(e => (/showTab\('([^']+)'\)/.exec(e.getAttribute('onclick') || '') || [])[1]).filter(Boolean));
  for (const t of tabs) {
    await A.page.evaluate(id => showTab(id), t); await espera(120);
    const subnavs = await A.page.$$eval(`#${t} [id$="Subnav"]`, els => els.map(e => e.id));
    for (const sn of subnavs) {
      const subs = await A.page.$$eval(`#${sn} button`, els => els.map(e => (/showSubtab\('[^']+','([^']+)'\)/.exec(e.getAttribute('onclick') || '') || [])[1]).filter(Boolean));
      for (const sub of subs) { await A.page.evaluate(([n2, s2]) => showSubtab(n2, s2), [sn, sub]); await espera(80); }
    }
  }
  ok(true, 'percorreu ' + tabs.length + ' abas');

  // Relatórios: PDF de cada subaba
  await A.page.evaluate(() => showTab('relatoriosTab'));
  const subs = await A.page.$$eval('#relatoriosSubnav button', els => els.map(e => (/showSubtab\('[^']+','([^']+)'\)/.exec(e.getAttribute('onclick') || '') || [])[1]));
  let pdfs = 0; const semDados = [];
  for (const sub of subs) {
    await A.page.evaluate(s2 => showSubtab('relatoriosSubnav', s2), sub); await espera(200);
    const [dl] = await Promise.all([A.page.waitForEvent('download', { timeout: 8000 }).catch(() => null), A.page.evaluate(() => exportarRelatorioAtualPDF())]);
    if (dl) { pdfs++; if (['relSubGeral', 'relSubMargem', 'relSubTempos', 'relSubProduto'].includes(sub)) await dl.saveAs(SAIDA + '/' + sub + '.pdf'); }
    else semDados.push(sub);
  }
  ok(pdfs >= subs.length - 2, `PDF gerado em ${pdfs} de ${subs.length} relatórios` + (semDados.length ? ' (sem dados: ' + semDados.join(', ') + ')' : ''));
  const [dl2] = await Promise.all([A.page.waitForEvent('download', { timeout: 10000 }).catch(() => null), A.page.evaluate(() => exportarRelatorioPDF())]);
  ok(!!dl2, 'PDF gerencial completo');
  const [dl3] = await Promise.all([A.page.waitForEvent('download', { timeout: 10000 }).catch(() => null), A.page.evaluate(() => exportarRelatorioExcel())]);
  ok(!!dl3, 'Excel completo');

  // Impressão: só o relatório aberto
  await A.page.evaluate(() => showSubtab('relatoriosSubnav', 'relSubMargem'));
  await A.page.evaluate(() => { window.print = () => {}; imprimirRelatorioAtual(); });
  await espera(200);
  await A.page.emulateMedia({ media: 'print' });
  const vis = await A.page.evaluate(() => ({
    header: getComputedStyle(document.querySelector('header')).display,
    aside: getComputedStyle(document.querySelector('aside')).display,
    cab: getComputedStyle(document.getElementById('cabecalhoImpressao')).display,
    outras: Array.from(document.querySelectorAll('#printArea .subtab-content')).filter(e => getComputedStyle(e).display !== 'none').map(e => e.id),
    titulo: document.getElementById('impTitulo').textContent
  }));
  ok(vis.header === 'none' && vis.aside === 'none' && vis.cab === 'block' && vis.outras.join() === 'relSubMargem', 'impressão mostra só o relatório, com cabeçalho: ' + JSON.stringify(vis));
  await A.page.pdf({ path: SAIDA + '/impressao_margem.pdf', landscape: true, format: 'A4', printBackground: true });
  await A.page.emulateMedia({ media: 'screen' });
  await A.page.evaluate(() => document.body.classList.remove('imprimindo-relatorio'));

  // Recarregar a página mantém a sessão e os dados (persistência real)
  await B.page.reload();
  await B.page.waitForFunction(() => typeof NUVEM !== 'undefined' && NUVEM.pronto, null, { timeout: 60000 });
  ok(await B.page.evaluate(id => state.produtos.find(x => x.id === id).precoVenda === 99.99, pid), 'após recarregar, dados vêm do banco');

  // Desfaz as alterações de teste nos dados reais (preço, nome e a ordem criada)
  await A.page.evaluate(() => nuvemSincronizarAgora());
  await A.page.evaluate(([p1, preco, p2, nome, n2]) => {
    state.produtos.find(x => x.id === p1).precoVenda = preco;
    state.produtos.find(x => x.id === p2).nome = nome;
    const op = state.producoes[n2];
    if (op && op.quantidadeProduzida === 50) state.producoes.splice(n2, 1);
    recalcularRateioGlobal();
    salvarStorage();
  }, [pid, precoOrig, pid2, nomeOrig, antes]);
  await A.page.waitForFunction(() => nuvemPendentes() === 0, null, { timeout: 45000 }).then(() => ok(true, 'dados de teste revertidos')).catch(() => ok(false, 'dados de teste revertidos'));
  await A.page.screenshot({ path: SAIDA + '/tela_relatorio.png' });
  await A.page.evaluate(() => showTab('dashboardTab')); await espera(500);
  await A.page.screenshot({ path: SAIDA + '/tela_dashboard.png' });

  const erros = A.erros.concat(B.erros);
  ok(erros.length === 0, 'sem erros de JavaScript' + (erros.length ? ':\n  ' + erros.slice(0, 15).join('\n  ') : ''));
  await browser.close();
  console.log(falhas ? falhas + ' FALHA(S)' : 'TODOS OS TESTES PASSARAM');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
