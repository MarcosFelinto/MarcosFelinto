// Teste ponta a ponta da sincronização com dois navegadores (Edge do Windows).
// Cobre: sem consulta a cada 3 s, botão "Nuvem" com SweetAlert2, fila guardada no navegador
// (sem internet → fecha → reabre → recupera), restauração de backup gravando no banco.
// Uso (com um servidor local numa pasta de banco própria):
//   node _desenvolvimento/local/servidor-local.mjs 8799 --zerar --dados=C:\temp\kp-teste
//   node _desenvolvimento/test/sincronizacao.e2e.mjs http://localhost:8799
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.argv[2] || 'http://localhost:8799';
const SENHA = 'Teste@123';
const EDGE = process.env.KP_NAVEGADOR || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
let falhas = 0;
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALHA') + ' ' + m); if (!c) falhas++; };
const espera = ms => new Promise(r => setTimeout(r, ms));

async function api(metodo, caminho, corpo, token) {
  const r = await fetch(BASE + caminho, { method: metodo, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined });
  return r.json();
}
const tokenAdmin = async () => (await api('POST', '/api/auth', { acao: 'login', email: 'admin@fabrica.com', senha: SENHA })).token;
const tabela = async (t, tk) => (await api('GET', '/api/db?acao=tabela&tabela=' + t + '&depois=0', null, tk)).registros;

async function entrar(page) {
  await page.goto(BASE + '/');
  await page.fill('#loginEmail', 'admin@fabrica.com');
  await page.fill('#loginSenha', SENHA);
  await page.click('#btnEntrar');
  await page.waitForFunction(() => typeof NUVEM !== 'undefined' && NUVEM.pronto, null, { timeout: 60000 });
}
async function abrir(browser, nome) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const erros = [];
  page.on('pageerror', e => erros.push(nome + ' [pageerror] ' + e.message.split('\n')[0]));
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.googleapis|Failed to load resource|ERR_INTERNET_DISCONNECTED/.test(m.text())) erros.push(nome + ' [console] ' + m.text().slice(0, 200)); });
  page.on('dialog', d => d.accept());
  await entrar(page);
  return { ctx, page, erros };
}
const swalTitulo = async page => { await page.waitForSelector('.swal2-popup .swal2-title', { timeout: 30000 }); return page.textContent('.swal2-popup .swal2-title'); };
const swalTexto = page => page.textContent('.swal2-popup .swal2-html-container');
async function swalEsperarTitulo(page, re) {
  await page.waitForFunction(r => { const t = document.querySelector('.swal2-popup .swal2-title'); return t && new RegExp(r).test(t.textContent); }, re.source, { timeout: 30000 });
  return page.textContent('.swal2-popup .swal2-title');
}
const swalOk = page => page.click('.swal2-popup .swal2-confirm');

(async () => {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const A = await abrir(browser, 'A');
  const B = await abrir(browser, 'B');
  const TK = await tokenAdmin();

  // 1) bibliotecas e modo de atualização
  ok(await A.page.evaluate(() => typeof Swal !== 'undefined' && typeof Ably !== 'undefined'), 'SweetAlert2 e Ably carregados');
  ok(await A.page.evaluate(() => NUVEM.tempoRealConectado === false), 'sem ABLY_API_KEY: tempo real desligado (consulta a cada 30 s)');
  ok(await A.page.evaluate(() => localStorage.getItem('producao_state_v3') === null), 'base inteira não fica mais no localStorage');

  // 2) nada de consulta a cada 3 s
  let consultas = 0;
  const contar = req => { if (req.url().includes('acao=mudancas')) consultas++; };
  A.page.on('request', contar);
  await espera(12000);
  A.page.off('request', contar);
  ok(consultas === 0, 'em 12 s parado, nenhuma consulta de mudanças (antes eram ~4): ' + consultas);

  // 3) A cria uma categoria; B recebe pelo botão "Nuvem"
  await A.page.evaluate(() => { state.categorias.push({ id: 'CAT-E2E-1', nome: 'Categoria E2E' }); salvarStorage(); });
  await A.page.waitForFunction(() => !nuvemPendentes() && !NUVEM.enviando, null, { timeout: 15000 });
  ok((await tabela('CATEGORIAS', TK)).some(r => r.id === 'CAT-E2E-1'), 'alteração de A gravada no banco');
  await B.page.click('#nuvemStatus');
  ok(/Sincronizado/.test(await swalEsperarTitulo(B.page, /Sincronizado|Tudo/)), 'B: botão mostra "Sincronizado com a nuvem"');
  ok(/[1-9]d* atualiza/.test(await swalTexto(B.page)), 'B: mensagem informa as atualizações recebidas (categoria + último acesso do login feito pelo teste): ' + (await swalTexto(B.page)).trim().slice(0, 90));
  await swalOk(B.page);
  ok(await B.page.evaluate(() => state.categorias.some(c => c.id === 'CAT-E2E-1')), 'B: categoria aparece na memória');
  ok(/Nuvem · \d/.test(await B.page.textContent('#nuvemStatusTexto')), 'B: cabeçalho mostra "Nuvem · hh:mm:ss"');

  // 4) sem nada pendente
  await B.page.click('#nuvemStatus');
  ok(/Tudo sincronizado/.test(await swalEsperarTitulo(B.page, /Sincronizado|Tudo/)), 'B: sem mudanças mostra "Tudo sincronizado"');
  await swalOk(B.page);

  // 5) sem internet: o botão avisa a falha e a alteração fica guardada no navegador
  await A.ctx.setOffline(true);
  await A.page.evaluate(() => { const c = state.categorias.find(x => x.id === 'CAT-E2E-1'); c.nome = 'Alterada offline'; salvarStorage(); });
  await A.page.click('#nuvemStatus');
  ok(/Não foi possível sincronizar/.test(await swalEsperarTitulo(A.page, /possível|Sincronizado/)), 'A offline: botão mostra erro');
  ok(/1 alteração/.test(await swalTexto(A.page)), 'A offline: erro informa 1 alteração guardada');
  await A.page.click('.swal2-popup .swal2-cancel');
  const guardado = await A.page.evaluate(() => JSON.parse(localStorage.getItem('kp_pendentes:USR-001') || 'null'));
  ok(guardado && guardado.itens.some(i => i.id === 'CAT-E2E-1' && i.dados.nome === 'Alterada offline'), 'A offline: alteração guardada no localStorage');
  ok((await tabela('CATEGORIAS', TK)).find(r => r.id === 'CAT-E2E-1').dados.nome === 'Categoria E2E', 'banco ainda sem a alteração offline');

  // fecha a aba (como se o navegador fosse fechado) e abre de novo com internet
  await A.page.close({ runBeforeUnload: false });
  await A.ctx.setOffline(false);
  A.page = await A.ctx.newPage();
  A.page.on('pageerror', e => A.erros.push('A2 [pageerror] ' + e.message.split('\n')[0]));
  A.page.on('dialog', d => d.accept());
  await entrar(A.page);
  await A.page.waitForFunction(() => !nuvemPendentes() && !NUVEM.enviando, null, { timeout: 15000 });
  ok((await tabela('CATEGORIAS', TK)).find(r => r.id === 'CAT-E2E-1').dados.nome === 'Alterada offline', 'reaberto: alteração recuperada e gravada no banco');
  ok(await A.page.evaluate(() => localStorage.getItem('kp_pendentes:USR-001') === null), 'reaberto: fila do navegador esvaziada após confirmação');

  // 6) restaurar backup: grava no banco, atualiza Configurações e chega no outro navegador
  const atuais = {};
  for (const [t, k] of [['PRODUTOS', 'produtos'], ['CATEGORIAS', 'categorias'], ['INSUMOS', 'insumos']]) atuais[k] = (await tabela(t, TK)).map(r => r.dados);
  const backup = {
    produtos: atuais.produtos.slice(0, 5),
    categorias: atuais.categorias.filter(c => c.id !== 'CAT-E2E-1').concat([{ id: 'CAT-BKP', nome: 'Do backup' }]),
    insumos: atuais.insumos,
    config: { limitePerdaPercent: 9.5 }
  };
  const arq = path.join(os.tmpdir(), 'kp-backup-e2e.json');
  fs.writeFileSync(arq, JSON.stringify(backup));
  await A.page.evaluate(() => showTab('configTab'));
  await A.page.setInputFiles('#inputRestaurarBackup', arq);
  ok(/Restaurar backup/.test(await swalTitulo(A.page)), 'restaurar: confirmação com SweetAlert2');
  ok(/No arquivo/.test(await swalTexto(A.page)), 'restaurar: confirmação mostra resumo por tabela');
  await A.page.uncheck('.swal2-popup .swal2-checkbox input');
  await swalOk(A.page);
  ok(/Backup restaurado/.test(await swalEsperarTitulo(A.page, /Backup restaurado|não restaurado|tela não foi atualizada/)), 'restaurar: mensagem de sucesso');
  ok(/Incluídos/.test(await swalTexto(A.page)), 'restaurar: sucesso mostra incluídos/alterados/excluídos');
  await swalOk(A.page);
  const prodDb = await tabela('PRODUTOS', TK), catDb = await tabela('CATEGORIAS', TK);
  ok(prodDb.length === 5, 'restaurar: banco ficou com 5 produtos (era ' + atuais.produtos.length + ')');
  ok(catDb.some(c => c.id === 'CAT-BKP') && !catDb.some(c => c.id === 'CAT-E2E-1'), 'restaurar: categorias substituídas no banco');
  ok(await A.page.inputValue('#cfgLimitePerda') === '9.5', 'restaurar: formulário de Configurações atualizado');
  ok(await A.page.evaluate(() => state.produtos.length === 5), 'restaurar: tela de A mostra os dados do banco');
  await B.page.click('#nuvemStatus');
  await swalEsperarTitulo(B.page, /Sincronizado|Tudo|possível/);
  await swalOk(B.page);
  ok(await B.page.evaluate(() => state.produtos.length === 5 && state.categorias.some(c => c.id === 'CAT-BKP') && !state.categorias.some(c => c.id === 'CAT-E2E-1')), 'restaurar: B recebeu inclusões e exclusões');
  ok(await B.page.evaluate(() => state.config.limitePerdaPercent === 9.5), 'restaurar: B recebeu a configuração');

  // 7) restaurar com falha no servidor: avisa e nada muda
  await A.page.route('**/api/db', r => r.request().method() === 'POST' && /restaurar/.test(r.request().postData() || '')
    ? r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ erro: 'Falha simulada' }) }) : r.continue());
  await A.page.setInputFiles('#inputRestaurarBackup', arq);
  await swalTitulo(A.page);
  await A.page.uncheck('.swal2-popup .swal2-checkbox input');
  await swalOk(A.page);
  ok(/não restaurado/.test(await swalEsperarTitulo(A.page, /restaurado|tela não foi atualizada/)), 'restaurar com falha: mensagem de erro');
  ok(/Nenhum dado foi alterado/.test(await swalTexto(A.page)), 'restaurar com falha: informa que nada mudou');
  await swalOk(A.page);
  await A.page.unroute('**/api/db');

  // 8) "Recarregar dados da nuvem"
  await A.page.evaluate(() => nuvemRecarregarTudo());
  ok(/Dados recarregados/.test(await swalEsperarTitulo(A.page, /recarregados|recarregar/)), 'recarregar: mensagem de sucesso');
  await swalOk(A.page);

  const erros = A.erros.concat(B.erros);
  ok(erros.length === 0, 'sem erros no console' + (erros.length ? ':\n  ' + erros.join('\n  ') : ''));
  await browser.close();
  console.log(falhas ? '\n' + falhas + ' FALHA(S)' : '\nTUDO OK');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
