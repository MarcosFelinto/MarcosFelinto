// Utilitários HTTP das funções serverless.
import { lerToken } from './seguranca.js';
import { buscarUsuarioPorId } from './db.js';

export function responder(res, status, corpo) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(corpo));
}

export async function lerCorpo(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body || '{}'); } catch (e) { return {}; } }
  const partes = [];
  for await (const p of req) partes.push(p);
  const txt = Buffer.concat(partes).toString('utf8');
  try { return JSON.parse(txt || '{}'); } catch (e) { return {}; }
}

export function tokenDaRequisicao(req) {
  const h = req.headers['authorization'] || req.headers['Authorization'] || '';
  return h.startsWith('Bearer ') ? h.slice(7) : '';
}

// Valida a sessão e confere no banco se o usuário continua ativo (bloqueio vale na hora).
export async function exigirSessao(req) {
  const sessao = lerToken(tokenDaRequisicao(req));
  if (!sessao) throw Object.assign(new Error('Sessão expirada. Entre novamente.'), { status: 401 });
  const u = await buscarUsuarioPorId(sessao.uid);
  if (!u || u.dados.status !== 'ATIVO') throw Object.assign(new Error('Usuário bloqueado ou removido.'), { status: 401 });
  return { ...sessao, perfil: u.dados.perfil || sessao.perfil, nome: u.dados.nome || sessao.nome, email: u.dados.email || sessao.email,
           funcionarioId: u.dados.funcionarioId || '' };
}

export function tratarErro(res, e) {
  const status = e.status || 500;
  if (status >= 500) console.error('[kelita]', e);
  responder(res, status, { erro: e.message || 'Erro interno' });
}
