// Senhas e sessão — mesmo algoritmo de hash usado pelo sistema desde a versão 7
// (SHA-256 com salt por usuário + 500 iterações), para que as senhas atuais continuem válidas.
import crypto from 'node:crypto';

const sha = m => crypto.createHash('sha256').update(m, 'utf8').digest('hex');

export function hashSenha(senha, salt) {
  let h = sha(salt + '|' + senha + '|PRODUCAO-V7');
  for (let i = 0; i < 500; i++) h = sha(h + salt);
  return h;
}
export function gerarSalt() { return crypto.randomBytes(12).toString('hex'); }
export function conferirSenha(dados, senha) {
  if (!dados || !dados.senhaHash) return false;
  const calc = Buffer.from(hashSenha(String(senha || ''), dados.senhaSalt || ''));
  const salvo = Buffer.from(String(dados.senhaHash));
  return calc.length === salvo.length && crypto.timingSafeEqual(calc, salvo);
}

function segredo() {
  const env = process.env;
  if (env.SESSION_SECRET) return env.SESSION_SECRET;
  const base = env.DATABASE_URL || env.POSTGRES_URL || env.STORAGE_URL || 'kelita-producao-local';
  return sha('kelita-producao|sessao|' + base);
}
const b64 = s => Buffer.from(s).toString('base64url');

export function emitirToken(usuario, horas = 12) {
  const corpo = { uid: usuario.id, email: usuario.email, nome: usuario.nome, perfil: usuario.perfil,
                  exp: Date.now() + horas * 3600 * 1000 };
  const p = b64(JSON.stringify(corpo));
  const assinatura = crypto.createHmac('sha256', segredo()).update(p).digest('base64url');
  return p + '.' + assinatura;
}

export function lerToken(token) {
  if (!token || typeof token !== 'string' || token.indexOf('.') < 0) return null;
  const [p, assinatura] = token.split('.');
  const esperado = crypto.createHmac('sha256', segredo()).update(p).digest('base64url');
  const a = Buffer.from(assinatura || ''), b = Buffer.from(esperado);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const corpo = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
    if (!corpo.exp || corpo.exp < Date.now()) return null;
    return corpo;
  } catch (e) { return null; }
}
