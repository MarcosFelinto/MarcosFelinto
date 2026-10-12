// GET  /api/db?acao=tabela&tabela=PRODUTOS&depois=0   -> carga paginada de uma tabela
// GET  /api/db?acao=mudancas&desde=<seq>               -> tudo que mudou depois do cursor
// GET  /api/db?acao=status                              -> saúde do banco e contagens
// GET  /api/db?acao=tempoReal                           -> token para escutar os avisos de mudança (Ably)
// POST /api/db  { ops: [{ op, tabela, id, base, dados }] } -> grava inclusões, alterações e exclusões
// POST /api/db  { acao: 'restaurar', registros, config }   -> restaura um backup (só ADMIN, atômico)
// Toda gravação confirmada publica { seq, origem } no canal de tempo real.
import { garantirEsquema, TABELAS, lerTabela, mudancasDesde, aplicarOperacoes, seqAtual, estatisticas, bancoConfigurado, lerRegistros, restaurarBackup } from './_lib/db.js';
import { responder, lerCorpo, exigirSessao, tratarErro } from './_lib/http.js';
import { tempoRealAtivo, canalTempoReal, criarTokenTempoReal, publicarMudanca } from './_lib/tempoReal.js';

const origemDa = req => String(req.headers['x-kp-sessao'] || '').slice(0, 80);

const SO_ADMIN = new Set(['USUARIOS', 'CONFIG']);
const CAMPOS_LOCAIS = ['status_sync', 'sync_em', 'sistema_id'];

// Perfil OPERADOR (funcionária no celular): só lança e acompanha a PRÓPRIA produção.
// Grava ordens em que ela está entre os funcionários, a baixa de insumos da ficha e as
// movimentações de estoque geradas por essa baixa. Não exclui nada.
const OPERADOR_ESCRITA = new Set(['PRODUCAO', 'INSUMOS', 'ESTOQUE', 'LOGS']);
// Valores de salário/custo dos colegas não vão para o celular da funcionária.
const CAMPOS_PAGAMENTO = ['salarioBase', 'encargosPercent', 'beneficios', 'outrosCustos', 'custoHora'];

function filtrarLeitura(sessao, tabela, dados, id) {
  if (sessao.perfil !== 'OPERADOR' || !dados) return dados;
  if (tabela === 'USUARIOS') return id === sessao.uid ? dados : null;
  if (tabela === 'FUNCIONARIOS' && id !== sessao.funcionarioId) {
    const copia = { ...dados };
    CAMPOS_PAGAMENTO.forEach(k => delete copia[k]);
    return copia;
  }
  return dados;
}
const ehDela = (sessao, dados) => !!(sessao.funcionarioId && dados && Array.isArray(dados.funcionarioIds) && dados.funcionarioIds.includes(sessao.funcionarioId));

export default async function handler(req, res) {
  try {
    if (!bancoConfigurado()) return responder(res, 503, { erro: 'Banco de dados não configurado.' });
    await garantirEsquema();
    const sessao = await exigirSessao(req);
    const agora = new Date().toISOString();

    if (req.method === 'GET') {
      const acao = req.query.acao || 'mudancas';
      if (acao === 'tabela') {
        const tabela = String(req.query.tabela || '');
        if (!TABELAS.includes(tabela)) return responder(res, 400, { erro: 'Tabela inválida.' });
        const r = await lerTabela(tabela, Number(req.query.depois) || 0);
        r.registros = r.registros.map(x => ({ ...x, dados: filtrarLeitura(sessao, tabela, x.dados, x.id) })).filter(x => x.dados);
        return responder(res, 200, { ...r, seq: await seqAtual(), servidor: agora });
      }
      if (acao === 'tempoReal') {
        if (!tempoRealAtivo()) return responder(res, 200, { ativo: false, servidor: agora });
        const tokenRequest = await criarTokenTempoReal(sessao.uid + ':' + origemDa(req));
        return responder(res, 200, { ativo: true, canal: canalTempoReal(), tokenRequest, servidor: agora });
      }
      if (acao === 'status') {
        if (sessao.perfil !== 'ADMIN') return responder(res, 403, { erro: 'Apenas administradores.' });
        return responder(res, 200, { ...(await estatisticas()), servidor: agora, banco: 'Postgres (Neon)' });
      }
      const r = await mudancasDesde(Number(req.query.desde) || 0);
      r.alterados = r.alterados.map(x => ({ ...x, dados: filtrarLeitura(sessao, x.tabela, x.dados, x.id) })).filter(x => x.dados);
      return responder(res, 200, { ...r, servidor: agora });
    }

    if (req.method !== 'POST') return responder(res, 405, { erro: 'Método não permitido' });
    const corpo = await lerCorpo(req);
    if (corpo.acao === 'restaurar') {
      if (sessao.perfil !== 'ADMIN') return responder(res, 403, { erro: 'Apenas administradores podem restaurar backups.' });
      if (!corpo.registros || typeof corpo.registros !== 'object') return responder(res, 400, { erro: 'Backup sem registros.' });
      const r = await restaurarBackup(corpo.registros, corpo.config, sessao);
      await publicarMudanca(r.seq, origemDa(req));
      return responder(res, 200, { ...r, servidor: agora });
    }
    const ops = Array.isArray(corpo.ops) ? corpo.ops : [];
    if (!ops.length) return responder(res, 200, { resultados: [], servidor: agora });
    if (ops.length > 5000) return responder(res, 413, { erro: 'Lote muito grande (máximo 5.000 operações).' });

    const operador = sessao.perfil === 'OPERADOR';
    // Ordens que a funcionária altera: novas, já dela, ou comandas abertas em que ela está entrando numa etapa.
    const atuaisDela = new Map();
    if (operador) {
      const ids = ops.filter(o => o && o.tabela === 'PRODUCAO' && o.op === 'upsert').map(o => String(o.id || '')).filter(Boolean);
      // Comanda aberta (em andamento ou pausada) aceita a entrada dela numa etapa; finalizada de outra pessoa, não.
      (await lerRegistros('PRODUCAO', [...new Set(ids)])).forEach(r => atuaisDela.set(r.id,
        ehDela(sessao, r.dados) || ['EM_ANDAMENTO', 'PAUSADA'].includes(r.dados && r.dados.status)));
    }

    const validas = [], recusadas = [];
    ops.forEach(o => {
      const tabela = String(o.tabela || ''), id = String(o.id || '');
      if (!TABELAS.includes(tabela) || !id || !['upsert', 'delete'].includes(o.op)) {
        recusadas.push({ tabela, id, ok: false, motivo: 'invalida' }); return;
      }
      if (SO_ADMIN.has(tabela) && sessao.perfil !== 'ADMIN') {
        recusadas.push({ tabela, id, ok: false, motivo: 'permissao' }); return;
      }
      if (operador) {
        const negar = () => recusadas.push({ tabela, id, ok: false, motivo: 'permissao' });
        if (o.op !== 'upsert' || !OPERADOR_ESCRITA.has(tabela)) return negar();
        if (tabela === 'PRODUCAO' && (!ehDela(sessao, o.dados) || atuaisDela.get(id) === false)) return negar();
        if (tabela === 'ESTOQUE' && Number(o.base) > 0) return negar();   // só inclui movimentações novas
      }
      if (o.op === 'upsert') {
        if (!o.dados || typeof o.dados !== 'object') { recusadas.push({ tabela, id, ok: false, motivo: 'invalida' }); return; }
        const dados = { ...o.dados, id };
        CAMPOS_LOCAIS.forEach(k => delete dados[k]);
        validas.push({ op: 'upsert', tabela, id, base: Number(o.base) || 0, dados });
      } else {
        if (tabela === 'USUARIOS' && id === sessao.uid) { recusadas.push({ tabela, id, ok: false, motivo: 'permissao' }); return; }
        validas.push({ op: 'delete', tabela, id });
      }
    });
    const resultados = validas.length ? await aplicarOperacoes(validas, sessao) : [];
    const maiorSeq = resultados.reduce((m, r) => (r.ok && r.seq > m ? r.seq : m), 0);
    if (maiorSeq) await publicarMudanca(maiorSeq, origemDa(req));
    return responder(res, 200, { resultados: resultados.concat(recusadas), servidor: agora });
  } catch (e) { tratarErro(res, e); }
}
