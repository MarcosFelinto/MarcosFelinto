// ============================================================================
// Kélita Produção — impressão e PDF de cada relatório
// ----------------------------------------------------------------------------
// · "Imprimir este relatório": usa a impressão do navegador com folha de estilo
//   própria (@media print em app.css) — só o relatório aberto, com cabeçalho,
//   filtros aplicados e data de emissão; menus, botões e filtros ficam de fora.
// · "PDF deste relatório": monta o PDF a partir do que está na tela — títulos,
//   cartões de indicadores, tabelas (jsPDF-AutoTable) e gráficos (imagem).
// ============================================================================

function relatorioAtivo() {
    return document.querySelector('#printArea .subtab-content.active');
}
function tituloRelatorioAtual() {
    const btn = Array.from(document.querySelectorAll('#relatoriosSubnav button')).find(b => b.classList.contains('text-indigo-600'));
    return btn ? btn.innerText.trim() : 'Relatório';
}
function textoDoSelect(id) {
    const el = document.getElementById(id);
    if (!el || !el.value) return '';
    const op = el.options[el.selectedIndex];
    return op ? op.text : el.value;
}
function descricaoFiltrosRelatorio() {
    const fmt = d => d ? d.split('-').reverse().join('/') : '';
    const ini = (document.getElementById('filtroDataIni') || {}).value || '';
    const fim = (document.getElementById('filtroDataFim') || {}).value || '';
    const partes = [];
    partes.push('Período: ' + (ini || fim ? (fmt(ini) || 'início') + ' a ' + (fmt(fim) || 'hoje') : 'todo o histórico'));
    [['filtroProduto', 'Produto'], ['filtroCategoria', 'Categoria'], ['filtroFuncionario', 'Funcionário'], ['filtroEquipe', 'Equipe'], ['filtroSetor', 'Setor']]
        .forEach(([id, rot]) => { const t = textoDoSelect(id); if (t) partes.push(rot + ': ' + t); });
    return partes.join(' · ');
}
function linhaEmissao() {
    const u = (state.currentUser && state.currentUser.name) || '';
    return 'Emitido em ' + new Date().toLocaleString('pt-BR') + (u ? ' por ' + u : '');
}

function imprimirRelatorioAtual() {
    if (!relatorioAtivo()) { alert('Abra um relatório para imprimir.'); return; }
    document.getElementById('impTitulo').textContent = tituloRelatorioAtual();
    document.getElementById('impFiltros').textContent = descricaoFiltrosRelatorio();
    document.getElementById('impEmissao').textContent = linhaEmissao();
    document.body.classList.add('imprimindo-relatorio');
    registrarLog('IMPRIMIR', 'RELATORIO', 'Relatório "' + tituloRelatorioAtual() + '" enviado para impressão');
    setTimeout(() => window.print(), 50);
}
window.addEventListener('afterprint', () => document.body.classList.remove('imprimindo-relatorio'));

// Fontes padrão do PDF só têm o alfabeto latino: troca símbolos e remove emojis.
function textoPDF(t) {
    return String(t == null ? '' : t)
        .replace(/[–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
        .replace(/…/g, '...').replace(/•/g, '·').replace(/×/g, 'x').replace(/→/g, '->')
        .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '').replace(/[ \t]+/g, ' ').trim();
}

function visivel(el) {
    if (!el || el.classList.contains('hidden')) return false;
    const st = getComputedStyle(el);
    return st.display !== 'none' && st.visibility !== 'hidden';
}

// Percorre o relatório na ordem da tela e devolve blocos imprimíveis.
function coletarBlocosRelatorio(raiz) {
    const blocos = [];
    const andar = el => {
        Array.from(el.children).forEach(c => {
            if (!visivel(c)) return;
            const tag = c.tagName;
            if (['SELECT', 'INPUT', 'BUTTON', 'LABEL', 'SCRIPT', 'STYLE'].includes(tag)) return;
            if (tag === 'TABLE') { blocos.push({ tipo: 'tabela', el: c }); return; }
            if (tag === 'CANVAS') { blocos.push({ tipo: 'grafico', el: c }); return; }
            if (/^H[1-6]$/.test(tag)) { const t = textoPDF(c.innerText); if (t) blocos.push({ tipo: 'titulo', texto: t }); return; }
            if (tag === 'P' || tag === 'SPAN') { const t = textoPDF(c.innerText); if (t) blocos.push({ tipo: 'texto', texto: t }); return; }
            if (tag === 'UL' || tag === 'OL') {
                Array.from(c.querySelectorAll('li')).forEach((li, i) => {
                    const t = textoPDF(li.innerText);
                    if (t) blocos.push({ tipo: 'texto', texto: (tag === 'OL' ? (i + 1) + '. ' : '- ') + t, item: true });
                });
                return;
            }
            const ehGradeDeCartoes = c.classList.contains('grid') && !c.querySelector('table, canvas, select, input');
            if (ehGradeDeCartoes && c.children.length) {
                const cartoes = Array.from(c.children).filter(visivel).map(k => textoPDF(k.innerText.replace(/\n+/g, '\n')));
                if (cartoes.length) blocos.push({ tipo: 'cartoes', itens: cartoes });
                return;
            }
            if (!c.children.length) { const t = textoPDF(c.innerText); if (t) blocos.push({ tipo: 'texto', texto: t }); return; }
            andar(c);
        });
    };
    andar(raiz);
    return blocos;
}

function exportarRelatorioAtualPDF() {
    const raiz = relatorioAtivo();
    if (!raiz) { alert('Abra um relatório para exportar.'); return; }
    if (!window.jspdf) { alert('Biblioteca de PDF não carregada. Recarregue a página.'); return; }
    const titulo = tituloRelatorioAtual();
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 12;
    doc.setFontSize(8); doc.setTextColor(100); doc.text(textoPDF('KÉLITA PRODUÇÃO'), M, 11);
    doc.setFontSize(15); doc.setTextColor(20); doc.text(textoPDF(titulo), M, 18);
    doc.setFontSize(8); doc.setTextColor(90);
    doc.text(doc.splitTextToSize(textoPDF(descricaoFiltrosRelatorio()), W - 2 * M), M, 23);
    doc.text(textoPDF(linhaEmissao()), M, 27);
    doc.setDrawColor(40); doc.setLineWidth(0.4); doc.line(M, 29, W - M, 29);
    let y = 34;
    const garantir = alt => { if (y + alt > H - 12) { doc.addPage(); y = 14; } };
    const estiloTabela = { fontSize: 7.5, cellPadding: 1.4, overflow: 'linebreak', textColor: 30 };
    const blocos = coletarBlocosRelatorio(raiz);
    if (!blocos.some(b => b.tipo === 'tabela' || b.tipo === 'cartoes' || b.tipo === 'grafico' || (b.tipo === 'texto' && b.texto.length > 3))) {
        alert('Este relatório ainda não tem dados para exportar com os filtros atuais.');
        return;
    }
    blocos.forEach(b => {
        if (b.tipo === 'titulo') {
            garantir(10); doc.setFontSize(10.5); doc.setTextColor(30); doc.text(b.texto, M, y); y += 5;
        } else if (b.tipo === 'texto') {
            doc.setFontSize(9); doc.setTextColor(50);
            const recuo = b.item ? 4 : 0;
            const linhas = doc.splitTextToSize(b.texto, W - 2 * M - recuo);
            garantir(linhas.length * 4 + 1); doc.text(linhas, M + recuo, y); y += linhas.length * 4 + 1.8;
        } else if (b.tipo === 'cartoes') {
            const porLinha = Math.min(5, b.itens.length);
            const linhas = [];
            for (let i = 0; i < b.itens.length; i += porLinha) {
                const l = b.itens.slice(i, i + porLinha);
                while (l.length < porLinha) l.push('');
                linhas.push(l);
            }
            doc.autoTable({ startY: y, body: linhas, theme: 'grid', margin: { left: M, right: M },
                styles: Object.assign({}, estiloTabela, { fontSize: 8, cellPadding: 2, fillColor: [248, 250, 252] }) });
            y = doc.lastAutoTable.finalY + 4;
        } else if (b.tipo === 'tabela') {
            garantir(14);
            doc.autoTable({ html: b.el, startY: y, theme: 'striped', margin: { left: M, right: M }, useCss: false,
                styles: estiloTabela, headStyles: { fillColor: [49, 46, 129], textColor: 255, fontSize: 7.5 },
                didParseCell: d => { d.cell.text = (d.cell.text || []).map(textoPDF); } });
            y = doc.lastAutoTable.finalY + 5;
        } else if (b.tipo === 'grafico') {
            const c = b.el;
            if (!c.width || !c.height) return;
            let w = Math.min(W - 2 * M, 200), h = w * c.height / c.width;
            if (h > 95) { h = 95; w = h * c.width / c.height; }
            garantir(h + 3);
            try { doc.addImage(c.toDataURL('image/png', 1), 'PNG', M, y, w, h); y += h + 5; } catch (e) { console.warn('gráfico não exportado', e); }
        }
    });
    const n = doc.internal.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
        doc.setPage(i); doc.setFontSize(7); doc.setTextColor(120);
        doc.text(textoPDF('Kélita Produção · ' + titulo + ' · página ' + i + ' de ' + n), M, H - 6);
    }
    const nomeArq = titulo.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '_').toLowerCase();
    doc.save('relatorio_' + nomeArq + '_' + hojeISO() + '.pdf');
    registrarLog('EXPORTAR', 'RELATORIO', 'PDF do relatório "' + titulo + '"');
}
