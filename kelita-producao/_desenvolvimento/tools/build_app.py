"""Gera app/public/index.html (Kélita Produção) a partir do SISTEMA_PRODUÇÃO_EVOLUIDO_V15.html.

Cada ajuste é uma substituição explícita e conferida (o script para se a âncora não existir),
para que a refatoração seja reprodutível e auditável.
"""
import re, sys, pathlib

SRC = pathlib.Path('/home/claude/kp/src/original.html')
DST = pathlib.Path('/home/claude/kp/app/public/index.html')
s = SRC.read_text(encoding='utf-8')
log = []


def sub(old, new, count=1, nome=''):
    global s
    n = s.count(old)
    if n != count:
        sys.exit(f'ERRO [{nome or old[:60]!r}]: esperado {count} ocorrência(s), achou {n}')
    s = s.replace(old, new)
    log.append(nome or old[:60])


def sub_re(padrao, novo, nome, minimo=1, flags=0):
    global s
    s2, n = re.subn(padrao, novo, s, flags=flags)
    if n < minimo:
        sys.exit(f'ERRO [{nome}]: padrão não encontrado')
    s = s2
    log.append(f'{nome} ({n}x)')


def cortar(inicio, fim, novo='', nome=''):
    """Remove o trecho de `inicio` (inclusive) até `fim` (exclusive) e põe `novo` no lugar."""
    global s
    i = s.index(inicio)
    j = s.index(fim, i)
    s = s[:i] + novo + s[j:]
    log.append(nome or ('corte ' + inicio[:40]))


# ---------------------------------------------------------------------------
# 1. CABEÇALHO HTML: nome do sistema, bibliotecas locais (sem CDN), CSS compilado
# ---------------------------------------------------------------------------
sub('<title>Plataforma Inteligente de Produção, Custos e Eficiência</title>',
    '<title>Kélita Produção</title>\n    <meta name="description" content="Kélita Produção — produção, custos, estoque e eficiência na nuvem">\n'
    '    <link rel="icon" href="assets/icone.svg" type="image/svg+xml">', nome='titulo')
sub('    <script src="https://cdn.tailwindcss.com"></script>\n', '', nome='remove tailwind cdn')
sub('<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">',
    '<link rel="stylesheet" href="assets/fontawesome/css/all.min.css">\n    <link rel="stylesheet" href="assets/app.css">', nome='fontawesome local')
for cdn, local in [
    ('https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js', 'assets/lib/chart.umd.js'),
    ('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js', 'assets/lib/xlsx.full.min.js'),
    ('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js', 'assets/lib/jspdf.umd.min.js'),
    ('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js', 'assets/lib/jspdf.plugin.autotable.min.js'),
]:
    sub(cdn, local, nome='lib local ' + local)

# Impressão antiga (visibility hack) dá lugar ao CSS de impressão em assets/app.css
sub("""        @media print {
            body * { visibility: hidden; }
            #printArea, #printArea * { visibility: visible; }
            #printArea { position: absolute; top: 0; left: 0; width: 100%; }
        }
""", '', nome='remove print antigo')

# ---------------------------------------------------------------------------
# 2. MARCA E TELAS
# ---------------------------------------------------------------------------
sub('<h1 class="text-2xl font-bold text-slate-900">Gestão Inteligente da Produção</h1>',
    '<h1 class="text-2xl font-bold text-slate-900">Kélita Produção</h1>', nome='login titulo')
sub('<p class="text-sm text-slate-500 mt-1">Produção · Custos · Estoque · Eficiência — v6.0</p>',
    '<p class="text-sm text-slate-500 mt-1">Produção · Custos · Estoque · Eficiência</p>\n'
    '                <p id="loginNuvemInfo" class="text-[11px] text-emerald-600 font-semibold mt-2"><i class="fa-solid fa-cloud"></i> Dados salvos na nuvem, em tempo real</p>',
    nome='login subtitulo')
sub('<button type="submit" class="w-full bg-indigo-600',
    '<button type="submit" id="btnEntrar" class="w-full bg-indigo-600', nome='id botão entrar')
sub('<h1 class="font-bold text-lg leading-tight">PLATAFORMA DE PRODUÇÃO</h1>',
    '<h1 class="font-bold text-lg leading-tight">KÉLITA PRODUÇÃO</h1>', nome='header titulo')
cortar('<button onclick="sincronizarBidirecional()" id="btnHeaderSync"', '<button onclick="showTab(\'alertasTab\')"',
       '''<button onclick="nuvemSincronizarAgora()" id="nuvemStatus" class="no-print flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white px-3 py-2 rounded-lg text-xs font-semibold transition-all" title="Situação da gravação na nuvem — clique para sincronizar agora">
                    <span id="nuvemStatusPonto" class="w-2.5 h-2.5 rounded-full bg-slate-400"></span><span id="nuvemStatusTexto">Conectando…</span>
                </button>
                ''', nome='header status nuvem')

# Card do Google Sheets (Configurações) -> painel do banco na nuvem
cortar('<div class="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">\n                    <h3 class="font-bold text-slate-800 flex items-center gap-2"><i class="fa-brands fa-google-drive',
       '<div class="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-3">\n                    <h3 class="font-bold text-slate-800 flex items-center gap-2"><i class="fa-solid fa-database"></i> Dados do Sistema</h3>',
       '''<div class="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4" id="painelNuvem">
                    <h3 class="font-bold text-slate-800 flex items-center gap-2"><i class="fa-solid fa-cloud text-emerald-600"></i> Banco de dados na nuvem</h3>
                    <p class="text-xs text-slate-500">Todos os cadastros, produções, movimentações e configurações ficam gravados no banco de dados Postgres da Vercel (Neon). Cada alteração é enviada na hora e aparece para os outros usuários em poucos segundos — não é preciso salvar nem sincronizar manualmente.</p>
                    <div id="painelNuvemResumo" class="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs"></div>
                    <div class="flex flex-wrap gap-2">
                        <button onclick="nuvemSincronizarAgora()" class="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-4 py-2 rounded-lg text-xs flex items-center gap-2"><i class="fa-solid fa-arrows-rotate"></i> Sincronizar agora</button>
                        <button onclick="nuvemRecarregarTudo()" class="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold px-4 py-2 rounded-lg text-xs flex items-center gap-2"><i class="fa-solid fa-cloud-arrow-down"></i> Recarregar dados da nuvem</button>
                        <button onclick="nuvemAtualizarPainel(true)" class="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold px-4 py-2 rounded-lg text-xs flex items-center gap-2"><i class="fa-solid fa-chart-simple"></i> Ver contagem por tabela</button>
                    </div>
                    <div id="painelNuvemTabelas"></div>
                </div>

                ''', nome='painel nuvem')
sub('''<button onclick="document.getElementById('inputRestaurarBackup').click()" class="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold px-4 py-2 rounded-lg text-xs">Restaurar backup</button>''',
    '''<button onclick="document.getElementById('inputRestaurarBackup').click()" class="bg-amber-500 hover:bg-amber-600 text-white font-bold px-4 py-2 rounded-lg text-xs">Restaurar backup na nuvem</button>''',
    nome='botão restaurar')
sub('<div class="flex gap-2">\n                        <button onclick="exportarBackupJSON()"',
    '<p class="text-xs text-slate-500">O backup em JSON é uma cópia de segurança completa. Restaurar um backup <strong>substitui os dados da nuvem para todos os usuários</strong>.</p>\n                    <div class="flex gap-2 flex-wrap">\n                        <button onclick="exportarBackupJSON()"',
    nome='texto backup')

# Script com o código do Apps Script (Google) não é mais usado
cortar('<script type="text/plain" id="appsScriptCode">', '    <script>\n', '', nome='remove apps script')

# ---------------------------------------------------------------------------
# 3. RELATÓRIOS: botões de impressão e PDF do relatório aberto, cabeçalho de impressão
# ---------------------------------------------------------------------------
sub('''<button onclick="exportarRelatorioPDF()" class="bg-red-600 hover:bg-red-700 text-white font-bold px-3 py-2 rounded-lg text-xs flex items-center gap-2"><i class="fa-solid fa-file-pdf"></i> PDF</button>''',
    '''<button onclick="imprimirRelatorioAtual()" class="bg-slate-800 hover:bg-slate-900 text-white font-bold px-3 py-2 rounded-lg text-xs flex items-center gap-2"><i class="fa-solid fa-print"></i> Imprimir este relatório</button>
                        <button onclick="exportarRelatorioAtualPDF()" class="bg-red-600 hover:bg-red-700 text-white font-bold px-3 py-2 rounded-lg text-xs flex items-center gap-2"><i class="fa-solid fa-file-pdf"></i> PDF deste relatório</button>
                        <button onclick="exportarRelatorioPDF()" class="bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 font-bold px-3 py-2 rounded-lg text-xs flex items-center gap-2"><i class="fa-solid fa-file-pdf"></i> PDF gerencial completo</button>''',
    nome='botões relatório')
sub('<div class="flex gap-2">\n                        <button onclick="imprimirRelatorioAtual()"',
    '<div class="flex gap-2 flex-wrap no-print">\n                        <button onclick="imprimirRelatorioAtual()"', nome='no-print botões')
sub('<div id="printArea">', '''<div id="printArea">
                <div id="cabecalhoImpressao" class="so-impressao">
                    <div class="flex justify-between items-end border-b-2 border-slate-800 pb-2 mb-3">
                        <div><p class="text-[10px] uppercase tracking-wider text-slate-500">Kélita Produção</p><h2 id="impTitulo" class="text-lg font-bold">Relatório</h2></div>
                        <div class="text-right text-[10px] text-slate-600"><p id="impFiltros"></p><p id="impEmissao"></p></div>
                    </div>
                </div>''', nome='cabeçalho impressão')

# Rótulo do tempo no lançamento manual deixa claro que é o tempo total da ordem
sub('<label class="block text-xs font-semibold text-slate-600 mb-1">Tempo total da produção *</label>',
    '<label class="block text-xs font-semibold text-slate-600 mb-1">Tempo total da produção * <span class="font-normal text-slate-400">(soma de todas as peças, não o tempo de uma peça)</span></label>',
    nome='rótulo tempo manual')

# ---------------------------------------------------------------------------
# 4. JAVASCRIPT — CORREÇÕES
# ---------------------------------------------------------------------------
# 4.1 Data local (antes usava UTC e virava o dia depois das 21h no Brasil)
sub('        let idSeq = 1000;',
    '''        // Data de hoje no fuso do usuário (toISOString usa UTC e vira o dia às 21h no Brasil).
        function hojeISO() { const d = new Date(agoraMs()); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
        // Relógio corrigido pelo horário do servidor (cronômetros iguais em todos os computadores).
        function agoraMs() { return Date.now() + (Number(window.__offsetRelogio) || 0); }

        let idSeq = 1000;''', nome='hojeISO/agoraMs')
sub_re(r'new Date\(\)\.toISOString\(\)\.slice\(0, ?10\)', 'hojeISO()', 'datas locais', minimo=17)
# o ajuste de relógio passa a publicar o desvio para agoraMs()
sub("""            if (Math.abs(novo - offsetRelogio) > 1500) {
                offsetRelogio = novo;""", """            if (Math.abs(novo - offsetRelogio) > 1500) {
                offsetRelogio = novo;
                window.__offsetRelogio = novo;""", nome='offset público')

# 4.2 IDs com parte aleatória (vários usuários criando registros ao mesmo tempo)
sub("function gerarId(prefixo) { idSeq++; return prefixo + '-' + Date.now().toString().slice(-6) + idSeq; }",
    "function gerarId(prefixo) { idSeq++; return prefixo + '-' + Date.now().toString().slice(-6) + idSeq + Math.random().toString(36).slice(2, 5).toUpperCase(); }",
    nome='gerarId aleatório')

# 4.3 Cronômetros pelo relógio do servidor
sub('timerStart: Date.now(), elapsedSeconds: 0,', 'timerStart: agoraMs(), elapsedSeconds: 0,', nome='timer início')
sub("o.status = 'PAUSADA'; o.timerStart = null; o.pausadoDesde = Date.now();", "o.status = 'PAUSADA'; o.timerStart = null; o.pausadoDesde = agoraMs();", nome='timer pausa')
sub("if (o.pausadoDesde) o.pausedSeconds = (o.pausedSeconds || 0) + Math.floor((Date.now() - o.pausadoDesde) / 1000);",
    "if (o.pausadoDesde) o.pausedSeconds = (o.pausedSeconds || 0) + Math.floor((agoraMs() - o.pausadoDesde) / 1000);", nome='timer retomada 1')
sub("o.status = 'EM_ANDAMENTO'; o.timerStart = Date.now();", "o.status = 'EM_ANDAMENTO'; o.timerStart = agoraMs();", nome='timer retomada 2')
sub("if (o.status === 'EM_ANDAMENTO' && o.timerStart) total += Math.floor((Date.now() - o.timerStart) / 1000);",
    "if (o.status === 'EM_ANDAMENTO' && o.timerStart) total += Math.floor((agoraMs() - o.timerStart) / 1000);", nome='tempoDecorrido')

# 4.4 Mão de obra padrão: média só de quem tem custo/hora (funcionário sem salário puxava a média para baixo)
sub("""            const ativos = state.funcionarios.filter(f => f.status === 'ATIVO');
            if (!ativos.length) return 0;
            const custoHoraMedio = ativos.reduce((a,f)=>a + custoHoraFuncionario(f), 0) / ativos.length;""",
    """            const ativos = state.funcionarios.filter(f => f.status === 'ATIVO' && custoHoraFuncionario(f) > 0);
            if (!ativos.length) return 0;
            const custoHoraMedio = ativos.reduce((a,f)=>a + custoHoraFuncionario(f), 0) / ativos.length;""", nome='MO padrão')

# 4.5 Indireto padrão por produto: custo direto de um produto não entra no custo dos outros
sub("""        function custoIndiretoPadraoUnitario() {
            const totalAdicionais = state.custosAdicionais.reduce((a,c)=>a + (Number(c.valor)||0), 0);
            const unidades = state.producoes.filter(o=>o.status==='FINALIZADA').reduce((a,o)=>a + (Number(o.quantidadeAprovada)||0), 0);
            return unidades > 0 ? totalAdicionais / unidades : 0;
        }""",
    """        // Custo indireto padrão por unidade do produto:
        //  · custos gerais (por período ou por equipe) ÷ unidades aprovadas de todas as ordens;
        //  · custos lançados direto para o produto ÷ unidades aprovadas daquele produto.
        function custoIndiretoPadraoUnitario(produtoId) {
            const finalizadas = state.producoes.filter(o => o.status === 'FINALIZADA');
            const unidades = finalizadas.reduce((a,o)=>a + (Number(o.quantidadeAprovada)||0), 0);
            const gerais = state.custosAdicionais.filter(c => c.rateio !== 'DIRETO_PRODUTO').reduce((a,c)=>a + (Number(c.valor)||0), 0);
            let unit = unidades > 0 ? gerais / unidades : 0;
            if (produtoId) {
                const diretos = state.custosAdicionais.filter(c => c.rateio === 'DIRETO_PRODUTO' && c.produtoId === produtoId).reduce((a,c)=>a + (Number(c.valor)||0), 0);
                const unidProduto = finalizadas.filter(o => o.produtoId === produtoId).reduce((a,o)=>a + (Number(o.quantidadeAprovada)||0), 0);
                if (diretos > 0 && unidProduto > 0) unit += diretos / unidProduto;
            }
            return unit;
        }
        // Custo padrão completo (material + mão de obra padrão + indiretos), conforme as configurações.
        function custoPadraoCompleto(produtoId) { return composicaoCustoProduto(produtoId, 'PADRAO').total; }
        // Custo real médio ponderado pelas unidades (não pela média simples das ordens).
        function custoRealPonderado(lista) {
            const base = o => state.config.baseCalculoCusto === 'produzida' ? (Number(o.quantidadeProduzida)||0) : (Number(o.quantidadeAprovada)||0);
            const qtd = lista.reduce((a,o)=>a + base(o), 0);
            return qtd > 0 ? lista.reduce((a,o)=>a + (Number(o.custoTotal)||0), 0) / qtd : 0;
        }""", nome='indireto por produto')
sub("const indiretos = state.config.usarCustosAdicionais ? custoIndiretoPadraoUnitario() : 0;",
    "const indiretos = state.config.usarCustosAdicionais ? custoIndiretoPadraoUnitario(produtoId) : 0;", nome='indireto chamada 1')
sub("const ind = custoIndiretoPadraoUnitario();", "const ind = state.config.usarCustosAdicionais ? custoIndiretoPadraoUnitario(produtoId) : 0;", nome='indireto chamada 2')

# 4.6 Custo real do produto respeita a base de cálculo configurada (aprovada x produzida)
sub("""                const qtd = finalizadas.reduce((a,o)=>a + (Number(o.quantidadeAprovada)||0), 0);
                const mat = finalizadas.reduce((a,o)=>a + (Number(o.materialCost)||0), 0);""",
    """                const qtd = finalizadas.reduce((a,o)=>a + (Number(state.config.baseCalculoCusto === 'produzida' ? o.quantidadeProduzida : o.quantidadeAprovada)||0), 0);
                const mat = finalizadas.reduce((a,o)=>a + (Number(o.materialCost)||0), 0);""", nome='composição real base')

# 4.7 Padrão x real comparava só material (padrão) com custo completo (real) e usava média simples
sub("""                const padrao = custoPadraoProduto(p.id);
                const producoesProduto = state.producoes.filter(o => o.produtoId === p.id && o.status === 'FINALIZADA');
                if (producoesProduto.length === 0) return;
                const real = producoesProduto.reduce((acc,o)=>acc+o.custoUnitario,0) / producoesProduto.length;""",
    """                const padrao = custoPadraoCompleto(p.id);
                const producoesProduto = state.producoes.filter(o => o.produtoId === p.id && o.status === 'FINALIZADA');
                if (producoesProduto.length === 0) return;
                const real = custoRealPonderado(producoesProduto);""", nome='padrão x real tabela')
sub("""                const padrao = custoPadraoProduto(p.id);
                const lista = finalizadas.filter(o => o.produtoId === p.id);
                if (lista.length === 0 || padrao === 0) return;
                const real = lista.reduce((a,o)=>a+o.custoUnitario,0) / lista.length;""",
    """                const padrao = custoPadraoCompleto(p.id);
                const lista = finalizadas.filter(o => o.produtoId === p.id);
                if (lista.length === 0 || padrao === 0) return;
                const real = custoRealPonderado(lista);""", nome='padrão x real alertas')

# 4.8 Rateio por competência: custo "por período" ou "por equipe" vai para a produção do mesmo mês
sub("""                } else if (c.rateio === 'EQUIPE' && c.equipeId && c.equipeId === ordem.equipeId) {
                    total = somaGrupo(p => p.equipeId === c.equipeId);
                } else if (c.rateio === 'PERIODO') {
                    total = somaGrupo(() => true);
                } else return;""",
    """                } else if (c.rateio === 'EQUIPE' && c.equipeId && c.equipeId === ordem.equipeId) {
                    if (mesCusto(c) && mesCusto(c) !== mesOrdem(ordem)) return;
                    total = somaGrupo(p => p.equipeId === c.equipeId && (!mesCusto(c) || mesOrdem(p) === mesCusto(c)));
                } else if (c.rateio === 'PERIODO') {
                    if (mesCusto(c) && mesCusto(c) !== mesOrdem(ordem)) return;
                    total = somaGrupo(p => !mesCusto(c) || mesOrdem(p) === mesCusto(c));
                } else return;""", nome='rateio por competência')
sub("""        function calcularCustoAdicionalAlocado(ordem) {""",
    """        // Competência (AAAA-MM) do custo adicional e da ordem de produção.
        const mesCusto = c => String(c.data || '').slice(0, 7);
        const mesOrdem = o => String(o.data || '').slice(0, 7);
        function calcularCustoAdicionalAlocado(ordem) {""", nome='helpers competência')

# 4.9 Filtro de período: datas com hora ("2026-09-30T03:00") ficavam fora no último dia
sub("""                if (dataIni && o.data < dataIni) return false;
                if (dataFim && o.data > dataFim) return false;""",
    """                const dOrdem = String(o.data || '').slice(0, 10);
                if (dataIni && dOrdem < dataIni) return false;
                if (dataFim && dOrdem > dataFim) return false;""", nome='filtro de datas')

# 4.10 Movimentações antigas sem data ISO escapavam dos filtros de período
sub("""            if (!Array.isArray(state.config.etapas) || !state.config.etapas.length)""",
    """            (state.movimentacoesEstoque || []).forEach(m => {
                if (!m.dataISO) {
                    const txt = String(m.data || '');
                    const br = /^(\\d{2})\\/(\\d{2})\\/(\\d{4})/.exec(txt);
                    m.dataISO = br ? (br[3] + '-' + br[2] + '-' + br[1]) : (/^\\d{4}-\\d{2}-\\d{2}/.test(txt) ? txt.slice(0, 10) : '');
                }
                if (!Number(m.timestamp) && m.dataISO) m.timestamp = Date.parse(m.dataISO + 'T12:00:00');
            });
            // Ordens e custos antigos guardavam a data com hora UTC ("2026-09-05T03:00:00.000Z"):
            // vira só o dia, senão gráficos e tabelas mostram o mesmo dia repetido.
            [state.producoes, state.custosAdicionais].forEach(lista => (lista || []).forEach(r => {
                if (typeof r.data === 'string' && /^\\d{4}-\\d{2}-\\d{2}T/.test(r.data)) r.data = r.data.slice(0, 10);
            }));
            if (!Array.isArray(state.config.etapas) || !state.config.etapas.length)""", nome='normaliza datas de movimentação')

# 4.11 Lançamento manual: tempo absurdo (ex.: 9 min para 119 peças) pede confirmação
sub("""            if (!isFinite(minutos) || minutos <= 0) { alert('Informe o tempo de produção. Exemplos: 15, 45min, 1h30, 2h 20min.'); return; }

            const ficha = getFichaAtiva(produtoId);""",
    """            if (!isFinite(minutos) || minutos <= 0) { alert('Informe o tempo de produção. Exemplos: 15, 45min, 1h30, 2h 20min.'); return; }
            const segPorPeca = minutos * 60 / qtdProduzida;
            if (segPorPeca < 15 && !confirm('Tempo muito baixo: ' + fmtMinutos(minutos) + ' para ' + fmtNum(qtdProduzida, 0) + ' peças dá ' + fmtNum(segPorPeca, 1) + ' segundos por peça.\\n\\nO campo é o TEMPO TOTAL da ordem (todas as peças). Se você digitou o tempo de UMA peça, cancele e informe o total.\\n\\nGravar assim mesmo?')) return;

            const ficha = getFichaAtiva(produtoId);""", nome='validação tempo manual')

# 4.12 Entrada de estoque com valor fora do comum pede confirmação (unidade errada: metros como rolos)
sub("""                const custoUnit = (!isNaN(custoInformado) && custoInformado > 0) ? custoInformado : ins.custoMedio;
                const saldoAnterior = ins.estoqueAtual;""",
    """                const custoUnit = (!isNaN(custoInformado) && custoInformado > 0) ? custoInformado : ins.custoMedio;
                const valorEntrada = qtd * custoUnit;
                if ((valorEntrada > 20000 || (ins.estoqueAtual > 0 && qtd > ins.estoqueAtual * 50)) &&
                    !confirm('Confira a unidade: ' + ins.nome + ' é controlado em "' + ins.unidade + '".\\n\\nEntrada de ' + fmtNum(qtd, 3) + ' ' + ins.unidade + ' × ' + fmtR$(custoUnit) + ' = ' + fmtR$(valorEntrada) + '.\\n\\nSe a quantidade foi digitada em outra unidade (metros, gramas), cancele e corrija. Confirmar a entrada?')) return;
                const saldoAnterior = ins.estoqueAtual;""", nome='validação entrada estoque')

# 4.13 Alertas novos: custo adicional sem produção no mês e funcionário CLT sem encargos
sub("""            state.insumos.forEach(i => { if (i.estoqueAtual < i.estoqueMinimo)""",
    """            state.custosAdicionais.forEach(c => {
                if (c.rateio === 'DIRETO_PRODUTO' || !mesCusto(c)) return;
                const temProducao = finalizadas.some(o => mesOrdem(o) === mesCusto(c) && (c.rateio !== 'EQUIPE' || o.equipeId === c.equipeId));
                if (!temProducao) alertas.push({ tipo: 'amarelo', icone: 'fa-calculator', msg: `Custo adicional "${esc(c.tipo || '')}" de ${fmtR$(c.valor)} (${esc(mesCusto(c))}) sem produção finalizada no mês — ainda não entrou no custo dos produtos.` });
            });
            state.funcionarios.filter(f => f.status === 'ATIVO' && !f.custoManual && (Number(f.salarioBase) || 0) > 0 && !(Number(f.encargosPercent) > 0) && f.vinculo === 'CLT').forEach(f => {
                alertas.push({ tipo: 'amarelo', icone: 'fa-user-tie', msg: `Funcionário "${esc(f.nome)}" (CLT) está sem encargos no cadastro — o custo/hora fica subestimado.` });
            });
            state.insumos.forEach(i => { if (i.estoqueAtual < i.estoqueMinimo)""", nome='alertas novos')

# 4.14 Escapar textos digitados pelos usuários (com vários usuários, evita injeção de HTML)
for campo in ['l.usuario', 'l.perfil', 'l.acao', 'l.detalhes', 'l.data', 'c.nome', 'm.usuario', 'nomes', 'p.nome', 'f.nome',
              'eq.nome', 'i.nome', 'ins.nome', 'd.f.nome', 'd.eq.nome', "p?p.nome:''", "ins?ins.nome:''"]:
    s = s.replace('${' + campo + '}', '${esc(' + campo + ')}')
log.append('escape de textos em HTML')
# as mensagens de falta de saldo vão para alert() (texto puro): desfaz o escape ali
s = s.replace("faltas.push(`${esc(ins.nome)} (saldo", "faltas.push(`${ins.nome} (saldo")

# 4.15 Motor de sincronização com Google Sheets substituído pela nuvem (assets/nuvem.js)
cortar('        // ============================================================\n        // BANCO CENTRAL — SINCRONIZAÇÃO INCREMENTAL',
       '        const RENDER_POR_ABA = {',
       '        // Sincronização com o banco de dados na nuvem: ver assets/nuvem.js\n\n', nome='remove motor Google Sheets')
sub("""            const syncBtn = document.getElementById('btnHeaderSync');
            if (syncBtn) syncBtn.classList.toggle('hidden', !state.googleScriptUrl);
""", '', nome='renderizarTudo sem botão google')
sub("""            carregarConfigGoogleNaTela();
            carregarParametrosPrecoNaTela();""", """            carregarParametrosPrecoNaTela();
            if (typeof nuvemAtualizarPainel === 'function') nuvemAtualizarPainel(false);""", nome='config sem google')
sub_re(r"googleScriptUrl: 'https://script\.google\.com/[^']*'", "googleScriptUrl: ''", 'remove url google')

# 4.16 "Evolução mensal" do relatório Por Produto plotava uma ordem por ponto (datas repetidas) e ignorava o período.
#      Agora agrupa por mês, respeita os filtros e o custo unitário é ponderado pelas peças aprovadas.
sub("""            const lista = state.producoes.filter(o => o.produtoId === produtoId && o.status === 'FINALIZADA').sort((a,b)=>a.data.localeCompare(b.data));
            criarChart('chartRelatorioProduto', { type:'line', data:{ labels: lista.map(o=>o.data), datasets:[{ label:'Quantidade Produzida', data: lista.map(o=>o.quantidadeProduzida), borderColor:'#4f46e5', yAxisID:'y' },{ label:'Custo Unitário (R$)', data: lista.map(o=>Math.round(o.custoUnitario*100)/100),""",
"""            const meses = {};
            producoesFiltradas().filter(o => o.produtoId === produtoId && o.status === 'FINALIZADA').forEach(o => {
                const m = String(o.data || '').slice(0, 7); if (!m) return;
                const g = meses[m] || (meses[m] = { qtd: 0, custo: 0, base: 0 });
                const q = Number(o.quantidadeProduzida) || 0, b = Number(o.quantidadeAprovada) || q;
                g.qtd += q; g.custo += (Number(o.custoUnitario) || 0) * b; g.base += b;
            });
            const chaves = Object.keys(meses).sort();
            criarChart('chartRelatorioProduto', { type:'bar', data:{ labels: chaves.map(m => m.slice(5, 7) + '/' + m.slice(0, 4)), datasets:[{ label:'Quantidade Produzida', data: chaves.map(m => meses[m].qtd), backgroundColor:'rgba(79,70,229,0.75)', borderColor:'#4f46e5', yAxisID:'y', maxBarThickness:60 },{ type:'line', label:'Custo Unitário (R$)', data: chaves.map(m => meses[m].base ? Math.round(meses[m].custo / meses[m].base * 100) / 100 : 0),""",
    nome='evolução mensal agrupada por mês')
sub("""borderColor:'#d97706', yAxisID:'y1' }] }, options:{ responsive:true, scales:{ y:{type:'linear',position:'left'}, y1:{type:'linear',position:'right', grid:{drawOnChartArea:false}} } } });""",
    """borderColor:'#d97706', backgroundColor:'#d97706', pointRadius:5, yAxisID:'y1' }] }, options:{ responsive:true, scales:{ y:{type:'linear',position:'left', beginAtZero:true, title:{display:true, text:'Peças'}}, y1:{type:'linear',position:'right', beginAtZero:true, title:{display:true, text:'R$ por peça'}, grid:{drawOnChartArea:false}} } } });""",
    nome='evolução mensal: barras + linha')

# Inicialização passa a ser da camada de nuvem (login -> carga do banco -> tela)
cortar('        window.onload = function () {', '        // Fecha modais com ESC', '', nome='remove onload local')

# 5. Celular: menu lateral vira gaveta com botão ☰, cabeçalho compacto, layout sem largura mínima
sub('''            <div class="flex items-center space-x-3">
                <i class="fa-solid fa-industry text-indigo-400 text-2xl"></i>
                <div>
                    <h1 class="font-bold text-lg leading-tight">KÉLITA PRODUÇÃO</h1>
                    <p class="text-xs text-slate-400">Gestão, Custos, Estoque & Eficiência</p>''',
'''            <div class="flex items-center space-x-3 min-w-0">
                <button id="btnMenu" type="button" onclick="menuAlternar()" class="no-print lg:hidden bg-slate-800 hover:bg-slate-700 text-white w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" aria-label="Abrir menu" aria-controls="menuLateral" aria-expanded="false"><i class="fa-solid fa-bars"></i></button>
                <i class="fa-solid fa-industry text-indigo-400 text-2xl hidden sm:inline-block"></i>
                <div class="min-w-0">
                    <h1 class="font-bold text-base sm:text-lg leading-tight truncate">KÉLITA PRODUÇÃO</h1>
                    <p class="text-xs text-slate-400 hidden sm:block">Gestão, Custos, Estoque & Eficiência</p>''', nome='celular: botão de menu no cabeçalho')
sub('<div class="max-w-[1600px] mx-auto px-4 py-3 flex flex-wrap justify-between items-center gap-4">',
    '<div class="max-w-[1600px] mx-auto px-3 sm:px-4 py-2 sm:py-3 flex justify-between items-center gap-2 sm:gap-4">', nome='celular: cabeçalho compacto')
sub('<div class="flex items-center gap-3">\n                <button onclick="nuvemSincronizarAgora()"',
    '<div class="flex items-center gap-1.5 sm:gap-3 flex-shrink-0">\n                <button onclick="nuvemSincronizarAgora()"', nome='celular: botões do cabeçalho')
sub('<div class="flex-1 flex max-w-[1600px] w-full mx-auto px-4 py-6 gap-6">',
    '<div id="layoutPrincipal" class="flex-1 flex max-w-[1600px] w-full mx-auto px-2 sm:px-4 py-3 sm:py-6 gap-0 lg:gap-6">\n        <div id="menuFundo" class="no-print" onclick="menuFechar()"></div>', nome='celular: layout principal')
sub('<aside class="w-64 flex-shrink-0 bg-white rounded-xl shadow-sm border border-slate-200 p-3 h-fit sticky top-20 max-h-[85vh] overflow-y-auto">',
    '<aside id="menuLateral" class="w-64 flex-shrink-0 bg-white rounded-xl shadow-sm border border-slate-200 p-3 h-fit sticky top-20 max-h-[85vh] overflow-y-auto">', nome='celular: menu lateral')

# 6. Perfil OPERADOR (funcionária): login vinculado ao cadastro do funcionário, só a própria produção
sub_re(r'(<a href="#" onclick="showTab\(\'dashboardTab\'\)")',
       '<a href="#" onclick="showTab(\'minhaProducaoTab\')" class="nav-btn flex items-center px-3 py-2.5 rounded-lg hover:bg-slate-50 transition-all" data-role="OPERADOR"><i class="fa-solid fa-shirt w-6"></i> Minha Produção</a>\n                \\1',
       'menu: Minha Produção')
sub('            <section id="alertasTab"',
'''            <!-- ============ MINHA PRODUÇÃO (perfil Funcionária) — conteúdo em assets/operador.js ============ -->
            <section id="minhaProducaoTab" class="tab-content space-y-4">
                <div id="mpConteudo" class="space-y-4"></div>
            </section>

            <section id="alertasTab"''', nome='aba Minha Produção')
sub("""                        <option value="ESTOQUE">Estoque (insumos & materiais)</option>
                    </select>
                </div>""",
"""                        <option value="ESTOQUE">Estoque (insumos & materiais)</option>
                        <option value="OPERADOR">Funcionária(o) — só lança a própria produção (celular)</option>
                    </select>
                </div>
                <div id="usrFuncionarioWrap"><label class="block text-xs font-semibold text-slate-600 mb-1">Funcionária(o) vinculada(o) <span id="usrFuncionarioObrig" class="text-red-500">*</span></label>
                    <select id="usrFuncionario" class="w-full p-2 border rounded-lg bg-slate-50"></select>
                    <p class="text-[11px] text-slate-400 mt-1">A produção lançada com este login fica no nome desta pessoa.</p>
                </div>""", nome='usuário: perfil Funcionária e vínculo')
sub('<label class="block text-xs font-semibold text-slate-600 mb-1">E-mail de acesso *</label><input type="email" id="usrEmail"',
    '<label class="block text-xs font-semibold text-slate-600 mb-1">Login de acesso * <span class="font-normal text-slate-400">(e-mail ou um usuário simples, ex.: maria)</span></label><input type="text" autocapitalize="none" autocomplete="off" id="usrEmail"', nome='usuário: login livre')
sub('<input type="email" id="loginEmail" placeholder="seu@email.com"',
    '<input type="text" inputmode="email" autocapitalize="none" autocomplete="username" id="loginEmail" placeholder="seu e-mail ou usuário"', nome='login: e-mail ou usuário')
sub("set('usrSenha', ''); set('usrPerfil', u.perfil); set('usrStatus', u.status);",
    "set('usrSenha', ''); set('usrPerfil', u.perfil); set('usrStatus', u.status);\n                if (typeof prepararVinculoUsuario === 'function') prepararVinculoUsuario(u.funcionarioId || '');", nome='usuário: carrega vínculo')
sub("set('usrSenha',''); set('usrPerfil','PRODUCAO'); set('usrStatus','ATIVO');",
    "set('usrSenha',''); set('usrPerfil','PRODUCAO'); set('usrStatus','ATIVO');\n                if (typeof prepararVinculoUsuario === 'function') prepararVinculoUsuario('');", nome='usuário: vínculo vazio')
sub("""            if (!nome || !email) { alert('Preencha nome e e-mail.'); return; }""",
"""            if (!nome || !email) { alert('Preencha nome e login de acesso.'); return; }
            const funcionarioId = (document.getElementById('usrFuncionario') || {}).value || '';
            if (perfil === 'OPERADOR' && !funcionarioId) { alert('Escolha a funcionária ou funcionário vinculado a este login.'); return; }
            const dupVinculo = funcionarioId && state.usuarios.find(u => u.funcionarioId === funcionarioId && u.id !== id);
            if (dupVinculo && !confirm('O login "' + dupVinculo.email + '" já está vinculado a esta pessoa. Vincular este também?')) return;""", nome='usuário: valida vínculo')
sub("u.nome = nome; u.email = email; u.perfil = perfil; u.status = status;",
    "u.nome = nome; u.email = email; u.perfil = perfil; u.status = status; u.funcionarioId = funcionarioId;", nome='usuário: grava vínculo')
sub("const novo = { id: gerarId('USR'), nome, email, perfil, status, criadoEm: hojeISO(), precisaTrocarSenha: true };",
    "const novo = { id: gerarId('USR'), nome, email, perfil, status, funcionarioId, criadoEm: hojeISO(), precisaTrocarSenha: true };", nome='usuário novo com vínculo')
sub("const PERFIL_LABEL = { ADMIN: 'Administrador', PRODUCAO: 'Produção', ESTOQUE: 'Estoque' };",
    "const PERFIL_LABEL = { ADMIN: 'Administrador', PRODUCAO: 'Produção', ESTOQUE: 'Estoque', OPERADOR: 'Funcionária(o)' };", nome='rótulo perfil')
sub("""u.perfil==='PRODUCAO'?'bg-emerald-100 text-emerald-700':'bg-amber-100 text-amber-700'}">${PERFIL_LABEL[u.perfil]||u.perfil}</span></td>""",
    """u.perfil==='PRODUCAO'?'bg-emerald-100 text-emerald-700':u.perfil==='OPERADOR'?'bg-sky-100 text-sky-700':'bg-amber-100 text-amber-700'}">${PERFIL_LABEL[u.perfil]||u.perfil}</span>${u.funcionarioId && getFuncionario(u.funcionarioId) ? `<div class="text-[10px] text-slate-400 mt-0.5"><i class="fa-solid fa-link"></i> ${esc(getFuncionario(u.funcionarioId).nome)}</div>` : ''}</td>""", nome='usuários: mostra vínculo')
sub("const PERFIL_NOME = { ADMIN: 'Administrador', PRODUCAO: 'Operador de Produção', ESTOQUE: 'Operador de Estoque' };",
    "const PERFIL_NOME = { ADMIN: 'Administrador', PRODUCAO: 'Operador de Produção', ESTOQUE: 'Operador de Estoque', OPERADOR: 'Funcionária(o)' };", nome='nome perfil (legado)')
sub("""                        <button onclick="excluirFuncionario('${f.id}')" class="text-red-500" title="Excluir"><i class="fa-solid fa-trash"></i></button>""",
    """                        <button onclick="criarAcessoFuncionaria('${f.id}')" class="text-sky-600" title="Acesso pelo celular (lançar a própria produção)"><i class="fa-solid fa-mobile-screen-button"></i></button>
                        <button onclick="excluirFuncionario('${f.id}')" class="text-red-500" title="Excluir"><i class="fa-solid fa-trash"></i></button>""", nome='funcionários: botão de acesso')

# 7. Comandas por etapa: cada pessoa, pelo próprio login, inicia e conclui a etapa que está fazendo.
#    As horas de cada uma saem das próprias etapas (o.sessoes); quem não registrou etapa segue a regra
#    padrão (tempo total da ordem), então ordens com várias pessoas montadas pelo gestor continuam iguais.
sub("        function membrosDaEquipe(equipeId) {",
"""        // Horas de uma pessoa numa ordem: as da própria etapa, quando houver; senão o tempo total da ordem.
        function horasDaPessoaNaOrdem(o, funcionarioId) {
            const d = (o.detalheMaoObra || []).find(x => x.id === funcionarioId);
            return d && d.horas != null ? Number(d.horas) || 0 : (Number(o.horasTrabalhadas) || 0);
        }
        function membrosDaEquipe(equipeId) {""", nome='horas por pessoa')
sub("lista.reduce((a,o)=>a+(o.horasTrabalhadas||0),0)", "lista.reduce((a,o)=>a+horasDaPessoaNaOrdem(o, f.id),0)", count=4, nome='relatórios: horas da própria pessoa')
sub("""            const laborCost = listaMO.reduce((a,f)=>a + horas * (Number(f.custoHora)||0), 0);
            o.laborCost = state.config.usarMaoDeObra ? laborCost : 0;
            o.horasTrabalhadas = horas;
            o.detalheMaoObra = listaMO.map(f => ({ id: f.id, nome: f.nome, custoHora: Number(f.custoHora)||0, horas, custo: horas * (Number(f.custoHora)||0) }));""",
"""            let detalheMO = listaMO.map(f => ({ id: f.id, nome: f.nome, custoHora: Number(f.custoHora)||0, horas, custo: horas * (Number(f.custoHora)||0) }));
            // Comanda com etapas registradas por pessoa: cada uma recebe as horas que ela mesma apontou
            if ((o.sessoes || []).length && typeof detalheMaoObraPorSessoes === 'function') { fecharSessoesAbertas(o, 'na finalização'); detalheMO = detalheMaoObraPorSessoes(o, horas); }
            const laborCost = detalheMO.reduce((a, d) => a + (Number(d.custo) || 0), 0);
            o.laborCost = state.config.usarMaoDeObra ? laborCost : 0;
            o.horasTrabalhadas = horas;
            o.detalheMaoObra = detalheMO;""", nome='finalização: horas por etapa de cada pessoa')

# Scripts novos depois do script principal
sub('    </script>\n</body>', '    </script>\n    <script src="assets/nuvem.js"></script>\n    <script src="assets/impressao.js"></script>\n    <script src="assets/responsivo.js"></script>\n    <script src="assets/operador.js"></script>\n</body>', nome='scripts nuvem/impressão/celular')

DST.parent.mkdir(parents=True, exist_ok=True)
DST.write_text(s, encoding='utf-8')
print('\n'.join('  · ' + x for x in log))
print('gerado', DST, len(s.splitlines()), 'linhas')
