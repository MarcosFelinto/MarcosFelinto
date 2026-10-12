// Servidor local para testes: serve public/ e as funções /api com um Postgres embutido (PGlite).
// Não usa o banco da produção. Os dados ficam em _desenvolvimento/local/.dados (sobrevivem ao reinício).
// Uso:  npm run local            -> http://localhost:8787
//       npm run local -- --zerar -> apaga o banco local e recarrega o backup
//       npm run local -- 8799 --dados=C:\temp\kp -> outra porta e outra pasta de banco (testes)
// Cada pasta de banco só pode ser aberta por UM servidor por vez.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..', '..');
const PUBLICO = path.join(RAIZ, 'public');
const SENHA_TESTE = 'Teste@123';

const args = process.argv.slice(2);
const argDados = args.find(a => a.startsWith('--dados='));
const DADOS = argDados ? path.resolve(argDados.slice(8)) : path.join(AQUI, '.dados');
if (args.includes('--zerar')) fs.rmSync(DADOS, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
const porta = Number(args.find(a => /^\d+$/.test(a))) || 8787;

process.env.SESSION_SECRET = 'kelita-local';
const importar = rel => import(pathToFileURL(path.join(RAIZ, rel)).href);

const db = await PGlite.create(DADOS);
const dbmod = await importar('api/_lib/db.js');
dbmod.usarExecutor(async (texto, params) => (await db.query(texto, params)).rows);
const seg = await importar('api/_lib/seguranca.js');
await dbmod.garantirEsquema();

// Senha conhecida para todos os usuários do banco local (sem troca obrigatória).
const usuarios = (await db.query(`select id, dados->>'email' as email, dados->>'perfil' as perfil
                                  from kp_registros where tabela = 'USUARIOS' order by id`)).rows;
for (const u of usuarios) {
  const salt = seg.gerarSalt();
  await db.query(`update kp_registros set dados = dados || $1::jsonb where tabela = 'USUARIOS' and id = $2`,
    [JSON.stringify({ senhaSalt: salt, senhaHash: seg.hashSenha(SENHA_TESTE, salt), precisaTrocarSenha: false, status: 'ATIVO' }), u.id]);
}

const auth = (await importar('api/auth.js')).default;
const api = (await importar('api/db.js')).default;

const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const inicio = Date.now();
  if (url.pathname === '/api/auth' || url.pathname === '/api/db') {
    req.query = Object.fromEntries(url.searchParams);
    res.on('finish', () => console.log(`${req.method} ${url.pathname}${url.search} -> ${res.statusCode} (${Date.now() - inicio} ms)`));
    try { return await (url.pathname === '/api/auth' ? auth : api)(req, res); }
    catch (e) { console.error(e); res.statusCode = 500; return res.end(String(e)); }
  }
  let p = path.normalize(path.join(PUBLICO, decodeURIComponent(url.pathname)));
  if (!p.startsWith(PUBLICO)) { res.writeHead(403); return res.end('403'); }
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  if (!fs.existsSync(p)) { res.writeHead(404); return res.end('404'); }
  res.writeHead(200, { 'Content-Type': TIPOS[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(p).pipe(res);
});

server.listen(porta, () => {
  console.log(`\nKélita Produção (local) em http://localhost:${porta}`);
  console.log(`Banco local: ${DADOS}`);
  console.log(`Senha de todos os usuários: ${SENHA_TESTE}`);
  for (const u of usuarios) console.log(`  ${u.email}  (${u.perfil})`);
  console.log('');
});
