// POST /api/auth  { acao: 'login', email, senha }
//                 { acao: 'trocarSenha', email, senhaAtual, novaSenha }
// GET  /api/auth  -> dados da sessão atual (renova o token)
import { garantirEsquema, buscarUsuarioPorEmail, atualizarUsuarioServidor, semSensiveis, bancoConfigurado } from './_lib/db.js';
import { conferirSenha, emitirToken, hashSenha, gerarSalt } from './_lib/seguranca.js';
import { responder, lerCorpo, exigirSessao, tratarErro } from './_lib/http.js';

const tentativas = new Map();   // limita força bruta por e-mail (por instância)
function bloqueado(email) {
  const t = tentativas.get(email);
  return t && t.n >= 8 && Date.now() - t.ultima < 10 * 60 * 1000;
}
function falhou(email) {
  const t = tentativas.get(email) || { n: 0, ultima: 0 };
  t.n = Date.now() - t.ultima > 10 * 60 * 1000 ? 1 : t.n + 1; t.ultima = Date.now();
  tentativas.set(email, t);
}

export default async function handler(req, res) {
  try {
    if (!bancoConfigurado()) return responder(res, 503, { erro: 'Banco de dados não configurado.' });
    await garantirEsquema();

    if (req.method === 'GET') {
      const sessao = await exigirSessao(req);
      return responder(res, 200, { token: emitirToken({ id: sessao.uid, email: sessao.email, nome: sessao.nome, perfil: sessao.perfil }),
                                   usuario: { id: sessao.uid, email: sessao.email, nome: sessao.nome, perfil: sessao.perfil, funcionarioId: sessao.funcionarioId || '' } });
    }
    if (req.method !== 'POST') return responder(res, 405, { erro: 'Método não permitido' });

    const corpo = await lerCorpo(req);
    const email = String(corpo.email || '').trim().toLowerCase();
    if (!email) return responder(res, 400, { erro: 'Informe o e-mail.' });
    if (bloqueado(email)) return responder(res, 429, { erro: 'Muitas tentativas. Aguarde 10 minutos.' });

    const reg = await buscarUsuarioPorEmail(email);
    const senha = corpo.acao === 'trocarSenha' ? corpo.senhaAtual : corpo.senha;
    if (!reg || !conferirSenha(reg.dados, senha)) { falhou(email); return responder(res, 401, { erro: 'E-mail ou senha incorretos.' }); }
    if (reg.dados.status !== 'ATIVO') return responder(res, 403, { erro: 'Usuário bloqueado. Fale com o administrador.' });
    tentativas.delete(email);

    if (corpo.acao === 'trocarSenha') {
      const nova = String(corpo.novaSenha || '');
      if (nova.length < 6) return responder(res, 400, { erro: 'A nova senha precisa ter pelo menos 6 caracteres.' });
      const salt = gerarSalt();
      await atualizarUsuarioServidor(reg.id, { senhaSalt: salt, senhaHash: hashSenha(nova, salt), precisaTrocarSenha: false,
                                               senhaAtualizadaEm: new Date().toISOString() }, email);
      reg.dados.precisaTrocarSenha = false;
    }

    if (reg.dados.precisaTrocarSenha) {
      return responder(res, 200, { precisaTrocarSenha: true, usuario: semSensiveis('USUARIOS', reg.dados) });
    }

    await atualizarUsuarioServidor(reg.id, { ultimoAcesso: new Date().toLocaleString('pt-BR', { timeZone: 'America/Fortaleza' }) }, email);
    const u = { id: reg.id, email: reg.dados.email, nome: reg.dados.nome, perfil: reg.dados.perfil };
    return responder(res, 200, { token: emitirToken(u), usuario: { ...u, funcionarioId: reg.dados.funcionarioId || '' } });
  } catch (e) { tratarErro(res, e); }
}
