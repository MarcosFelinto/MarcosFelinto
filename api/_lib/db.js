// ============================================================================
// Kélita Produção — camada de banco de dados (Postgres / Neon)
// ----------------------------------------------------------------------------
// Modelo documental: cada registro do sistema é uma linha de kp_registros
// (tabela + id + dados JSONB). Toda gravação recebe um número de sequência
// global (kp_seq), que é o cursor usado pelos navegadores para buscar só o que
// mudou desde a última leitura — é isso que mantém todos os usuários em tempo real.
//
// Concorrência otimista: o navegador envia a versão do registro que ele conhecia
// ("base"). Se outra pessoa gravou antes, a versão do banco é maior, a gravação é
// recusada e o navegador recebe o registro atual (sem perda silenciosa de dados).
//
// Exclusão é permanente: a linha é apagada de kp_registros; em kp_exclusoes fica
// apenas a marca (tabela, id, seq) para avisar os outros navegadores.
// ============================================================================
import { neon } from '@neondatabase/serverless';
import SEED from './seed.js';
import { hashSenha, gerarSalt } from './seguranca.js';

export const TABELAS = ['PRODUCAO', 'INSUMOS', 'FUNCIONARIOS', 'EQUIPES', 'PRODUTOS', 'CATEGORIAS',
  'FICHAS', 'CUSTOS', 'ESTOQUE', 'USUARIOS', 'CONFIG', 'LOGS'];
export const CAMPOS_SENSIVEIS = ['senhaHash', 'senhaSalt', 'senha'];

function urlDoBanco() {
  const env = process.env;
  const direto = env.DATABASE_URL || env.POSTGRES_URL || env.STORAGE_URL;
  if (direto) return direto;
  const achado = Object.keys(env).find(k => /URL$/.test(k) && /^postgres(ql)?:\/\//.test(env[k] || ''));
  return achado ? env[achado] : '';
}

let executorInjetado = null;              // usado nos testes locais (PGlite)
export function usarExecutor(fn) { executorInjetado = fn; esquemaPronto = null; }

let sqlCliente = null;
export function bancoConfigurado() { return !!(executorInjetado || urlDoBanco()); }

export async function q(texto, params = []) {
  if (executorInjetado) return executorInjetado(texto, params);
  if (!sqlCliente) {
    const url = urlDoBanco();
    if (!url) throw Object.assign(new Error('Banco de dados não configurado (DATABASE_URL ausente).'), { status: 503 });
    sqlCliente = neon(url);
  }
  return sqlCliente.query(texto, params);
}

let esquemaPronto = null;
export function garantirEsquema() {
  if (!esquemaPronto) esquemaPronto = criarEsquema().catch(e => { esquemaPronto = null; throw e; });
  return esquemaPronto;
}

async function criarEsquema() {
  await q(`create sequence if not exists kp_seq`);
  await q(`create table if not exists kp_registros (
      tabela text not null,
      id text not null,
      dados jsonb not null,
      versao integer not null default 1,
      seq bigint not null,
      criado_em timestamptz not null default now(),
      atualizado_em timestamptz not null default now(),
      atualizado_por text,
      primary key (tabela, id))`);
  await q(`create index if not exists kp_registros_seq on kp_registros (seq)`);
  await q(`create index if not exists kp_registros_tabela_seq on kp_registros (tabela, seq)`);
  await q(`create table if not exists kp_exclusoes (
      tabela text not null,
      id text not null,
      seq bigint not null,
      excluido_em timestamptz not null default now(),
      excluido_por text,
      primary key (tabela, id))`);
  await q(`create index if not exists kp_exclusoes_seq on kp_exclusoes (seq)`);
  await semear();
}

// Primeira execução: carrega a base inicial (backup do sistema) para o banco vazio.
async function semear() {
  const [{ total }] = await q(`select count(*)::int as total from kp_registros`);
  if (total > 0) return;
  const linhas = [];
  for (const tabela of Object.keys(SEED.registros || {})) {
    for (const reg of SEED.registros[tabela]) {
      if (reg && reg.id) linhas.push({ tabela, id: String(reg.id), dados: reg });
    }
  }
  if (!linhas.some(l => l.tabela === 'USUARIOS')) {
    linhas.push({ tabela: 'USUARIOS', id: 'USR-001', dados: usuarioAdminPadrao() });
  }
  for (let i = 0; i < linhas.length; i += 400) {
    const lote = linhas.slice(i, i + 400);
    await q(`insert into kp_registros (tabela, id, dados, versao, seq, atualizado_por)
             select t.tabela, t.id, t.dados, 1, nextval('kp_seq'), 'carga-inicial'
             from jsonb_to_recordset($1::jsonb) as t(tabela text, id text, dados jsonb)
             on conflict (tabela, id) do nothing`, [JSON.stringify(lote)]);
  }
}

// Administrador padrão para bancos sem nenhum usuário (senha inicial 123456, troca obrigatória).
function usuarioAdminPadrao() {
  const salt = gerarSalt();
  return { id: 'USR-001', nome: 'Administrador', email: 'admin@fabrica.com', perfil: 'ADMIN', status: 'ATIVO',
           senhaSalt: salt, senhaHash: hashSenha('123456', salt), precisaTrocarSenha: true,
           criadoEm: new Date().toISOString().slice(0, 10) };
}

export function semSensiveis(tabela, dados) {
  if (tabela !== 'USUARIOS' || !dados) return dados;
  const copia = { ...dados };
  CAMPOS_SENSIVEIS.forEach(k => delete copia[k]);
  return copia;
}

export async function seqAtual() {
  const [r] = await q(`select coalesce(greatest((select max(seq) from kp_registros), (select max(seq) from kp_exclusoes)), 0)::bigint as seq`);
  return Number(r.seq) || 0;
}

// Leitura paginada de uma tabela (carga inicial do navegador).
export async function lerTabela(tabela, depoisDe = 0, limite = 2000) {
  const ordemLogs = tabela === 'LOGS';
  const linhas = ordemLogs
    ? await q(`select id, dados, versao, seq from kp_registros where tabela = 'LOGS' order by seq desc limit $1`, [limite])
    : await q(`select id, dados, versao, seq from kp_registros where tabela = $1 and seq > $2 order by seq limit $3`, [tabela, depoisDe, limite]);
  return {
    registros: linhas.map(l => ({ id: l.id, versao: l.versao, seq: Number(l.seq), dados: semSensiveis(tabela, l.dados) })),
    mais: !ordemLogs && linhas.length === limite,
    ultimoSeq: linhas.length ? Number(linhas[linhas.length - 1].seq) : depoisDe
  };
}

// Tudo o que mudou depois do cursor (inclusões, alterações e exclusões).
export async function mudancasDesde(seq, limite = 3000) {
  const alterados = await q(`select tabela, id, dados, versao, seq from kp_registros where seq > $1 order by seq limit $2`, [seq, limite]);
  const excluidos = await q(`select tabela, id, seq from kp_exclusoes where seq > $1 order by seq limit $2`, [seq, limite]);
  const mais = alterados.length === limite || excluidos.length === limite;
  let ultimo = seq;
  alterados.forEach(r => { ultimo = Math.max(ultimo, Number(r.seq)); });
  excluidos.forEach(r => { ultimo = Math.max(ultimo, Number(r.seq)); });
  if (mais) {
    // Com a página cheia, só é seguro avançar o cursor até o menor dos dois limites.
    const limA = alterados.length === limite ? Number(alterados[alterados.length - 1].seq) : Infinity;
    const limE = excluidos.length === limite ? Number(excluidos[excluidos.length - 1].seq) : Infinity;
    ultimo = Math.min(limA, limE);
  }
  return {
    alterados: alterados.filter(r => Number(r.seq) <= ultimo)
      .map(r => ({ tabela: r.tabela, id: r.id, versao: r.versao, seq: Number(r.seq), dados: semSensiveis(r.tabela, r.dados) })),
    excluidos: excluidos.filter(r => Number(r.seq) <= ultimo).map(r => ({ tabela: r.tabela, id: r.id, seq: Number(r.seq) })),
    seq: ultimo,
    mais
  };
}

// Registros atuais de uma tabela (usado para conferir a quem pertence uma ordem antes de alterá-la).
export async function lerRegistros(tabela, ids) {
  if (!ids.length) return [];
  return q(`select id, dados from kp_registros where tabela = $1 and id = any($2::text[])`, [tabela, ids]);
}

export async function buscarUsuarioPorEmail(email) {
  const [r] = await q(`select id, dados, versao from kp_registros where tabela = 'USUARIOS' and lower(dados->>'email') = lower($1) limit 1`, [email]);
  return r || null;
}
export async function buscarUsuarioPorId(id) {
  const [r] = await q(`select id, dados, versao from kp_registros where tabela = 'USUARIOS' and id = $1`, [id]);
  return r || null;
}
// Atualização feita pelo próprio servidor (último acesso, troca de senha): sempre vence.
export async function atualizarUsuarioServidor(id, campos, autor) {
  const [r] = await q(`update kp_registros set dados = dados || $2::jsonb, versao = versao + 1, seq = nextval('kp_seq'),
                       atualizado_em = now(), atualizado_por = $3
                       where tabela = 'USUARIOS' and id = $1 returning versao, seq`, [id, JSON.stringify(campos), autor]);
  return r || null;
}

// Aplica um lote de operações vindas de um navegador.
// ops: [{ op: 'upsert'|'delete', tabela, id, base, dados }]
export async function aplicarOperacoes(ops, usuario) {
  const autor = usuario.email;
  const upserts = ops.filter(o => o.op === 'upsert');
  const deletes = ops.filter(o => o.op === 'delete');
  const resultados = [];

  for (let i = 0; i < upserts.length; i += 300) {
    const lote = upserts.slice(i, i + 300).map(o => ({ tabela: o.tabela, id: String(o.id), dados: o.dados, base: Number(o.base) || 0 }));
    const gravados = await q(`
      with entrada as (
        select * from jsonb_to_recordset($1::jsonb) as t(tabela text, id text, dados jsonb, base integer)
      ), alvo as (
        select e.tabela, e.id, e.dados, e.base, r.versao as atual, r.dados as dados_atuais
        from entrada e left join kp_registros r on r.tabela = e.tabela and r.id = e.id
      ), aceitos as (
        select tabela, id, base,
               case when tabela = 'USUARIOS' and dados_atuais is not null and not jsonb_exists(dados, 'senhaHash')
                    then dados || jsonb_build_object('senhaHash', dados_atuais->'senhaHash', 'senhaSalt', dados_atuais->'senhaSalt')
                    else dados end as dados
        from alvo
        where (atual is null and base = 0) or atual = base or tabela = 'LOGS'
      )
      insert into kp_registros as r (tabela, id, dados, versao, seq, atualizado_em, atualizado_por)
      select tabela, id, dados, base + 1, nextval('kp_seq'), now(), $2 from aceitos
      on conflict (tabela, id) do update
        set dados = excluded.dados, versao = r.versao + 1, seq = excluded.seq,
            atualizado_em = now(), atualizado_por = excluded.atualizado_por
        where r.versao = excluded.versao - 1 or r.tabela = 'LOGS'
      returning tabela, id, versao, seq`, [JSON.stringify(lote), autor]);
    const ok = new Map(gravados.map(g => [g.tabela + '\u0001' + g.id, g]));
    const recusados = lote.filter(o => !ok.has(o.tabela + '\u0001' + o.id));
    let atuais = new Map();
    if (recusados.length) {
      const linhas = await q(`select r.tabela, r.id, r.dados, r.versao, r.seq
                              from kp_registros r join jsonb_to_recordset($1::jsonb) as t(tabela text, id text)
                              on r.tabela = t.tabela and r.id = t.id`,
                             [JSON.stringify(recusados.map(o => ({ tabela: o.tabela, id: o.id })))]);
      atuais = new Map(linhas.map(l => [l.tabela + '\u0001' + l.id, l]));
    }
    lote.forEach(o => {
      const chave = o.tabela + '\u0001' + o.id;
      const g = ok.get(chave);
      if (g) { resultados.push({ tabela: o.tabela, id: o.id, ok: true, versao: g.versao, seq: Number(g.seq) }); return; }
      const atual = atuais.get(chave);
      resultados.push(atual
        ? { tabela: o.tabela, id: o.id, ok: false, motivo: 'versao', atual: { versao: atual.versao, seq: Number(atual.seq), dados: semSensiveis(o.tabela, atual.dados) } }
        : { tabela: o.tabela, id: o.id, ok: false, motivo: 'excluido' });
    });
  }

  if (deletes.length) {
    const alvo = JSON.stringify(deletes.map(o => ({ tabela: o.tabela, id: String(o.id) })));
    await q(`delete from kp_registros r using jsonb_to_recordset($1::jsonb) as t(tabela text, id text)
             where r.tabela = t.tabela and r.id = t.id`, [alvo]);
    const marcas = await q(`insert into kp_exclusoes as x (tabela, id, seq, excluido_em, excluido_por)
             select t.tabela, t.id, nextval('kp_seq'), now(), $2 from jsonb_to_recordset($1::jsonb) as t(tabela text, id text)
             on conflict (tabela, id) do update set seq = excluded.seq, excluido_em = now(), excluido_por = excluded.excluido_por
             returning tabela, id, seq`, [alvo, autor]);
    marcas.forEach(m => resultados.push({ tabela: m.tabela, id: m.id, ok: true, excluido: true, seq: Number(m.seq) }));
  }
  return resultados;
}

// Restauração de backup: substitui as tabelas do arquivo num único comando SQL (atômico —
// ou entra tudo, ou nada). Registros que não estão no arquivo são excluídos e marcados em
// kp_exclusoes para os outros navegadores; o usuário que restaura nunca é removido e mantém
// a própria senha; senhas ausentes no arquivo (backups exportados da nuvem) são preservadas.
// LOGS e CONFIG são acrescentados/atualizados, nunca apagados.
export async function restaurarBackup(registros, config, usuario) {
  const entrada = [];
  const tabelas = [];
  for (const tabela of Object.keys(registros || {})) {
    if (!TABELAS.includes(tabela) || tabela === 'CONFIG') continue;
    const lista = Array.isArray(registros[tabela]) ? registros[tabela] : [];
    if (tabela !== 'LOGS') tabelas.push(tabela);
    const vistos = new Set();
    for (const reg of lista) {
      if (!reg || typeof reg !== 'object' || reg.id === undefined || reg.id === null || reg.id === '') continue;
      const id = String(reg.id);
      if (vistos.has(id)) continue;
      vistos.add(id);
      const dados = { ...reg, id };
      ['status_sync', 'sync_em', 'sistema_id'].forEach(k => delete dados[k]);
      entrada.push({ tabela, id, dados });
    }
  }
  if (config && typeof config === 'object') entrada.push({ tabela: 'CONFIG', id: 'geral', dados: { id: 'geral', config } });
  if (entrada.length > 60000) throw Object.assign(new Error('Backup grande demais (máximo 60.000 registros).'), { status: 413 });

  const linhas = await q(`
    with entrada as (
      select * from jsonb_to_recordset($1::jsonb) as t(tabela text, id text, dados jsonb)
    ), removidos as (
      delete from kp_registros r
      where r.tabela = any($2::text[])
        and not (r.tabela = 'USUARIOS' and r.id = $3)
        and not exists (select 1 from entrada e where e.tabela = r.tabela and e.id = r.id)
      returning r.tabela, r.id
    ), marcas as (
      insert into kp_exclusoes as x (tabela, id, seq, excluido_em, excluido_por)
      select tabela, id, nextval('kp_seq'), now(), $4 from removidos
      on conflict (tabela, id) do update set seq = excluded.seq, excluido_em = now(), excluido_por = excluded.excluido_por
      returning 1
    ), gravados as (
      insert into kp_registros as r (tabela, id, dados, versao, seq, atualizado_em, atualizado_por)
      select e.tabela, e.id,
             case when e.tabela <> 'USUARIOS' then e.dados
                  when e.id = $3 then e.dados || jsonb_strip_nulls(jsonb_build_object(
                         'senhaHash', a.dados->'senhaHash', 'senhaSalt', a.dados->'senhaSalt',
                         'status', a.dados->'status', 'perfil', a.dados->'perfil', 'precisaTrocarSenha', a.dados->'precisaTrocarSenha'))
                  when not jsonb_exists(e.dados, 'senhaHash') then e.dados || jsonb_strip_nulls(jsonb_build_object(
                         'senhaHash', a.dados->'senhaHash', 'senhaSalt', a.dados->'senhaSalt'))
                  else e.dados end,
             1, nextval('kp_seq'), now(), $4
      from entrada e left join kp_registros a on a.tabela = e.tabela and a.id = e.id
      on conflict (tabela, id) do update
        set dados = excluded.dados, versao = r.versao + 1, seq = excluded.seq,
            atualizado_em = now(), atualizado_por = excluded.atualizado_por
      returning r.tabela, (xmax = 0) as novo
    ), sem_marca as (
      -- registro que volta pelo backup deixa de constar como excluído
      delete from kp_exclusoes x using entrada e where x.tabela = e.tabela and x.id = e.id
      returning 1
    )
    select tabela, 'gravado' as tipo, novo from gravados
    union all
    select tabela, 'excluido' as tipo, null from removidos`,
    [JSON.stringify(entrada), tabelas, String(usuario.uid || ''), usuario.email || 'restauracao']);

  const resumo = {};
  const linha = t => resumo[t] || (resumo[t] = { incluidos: 0, alterados: 0, excluidos: 0 });
  linhas.forEach(l => {
    if (l.tipo === 'excluido') linha(l.tabela).excluidos++;
    else if (l.novo) linha(l.tabela).incluidos++;
    else linha(l.tabela).alterados++;
  });
  return { resumo, seq: await seqAtual() };
}

export async function estatisticas() {
  const porTabela = await q(`select tabela, count(*)::int as total, max(atualizado_em) as ultima from kp_registros group by tabela order by tabela`);
  const [tam] = await q(`select pg_total_relation_size('kp_registros')::bigint as bytes`);
  return { porTabela, bytes: Number(tam.bytes) || 0, seq: await seqAtual() };
}
