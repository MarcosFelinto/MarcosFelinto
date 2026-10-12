// Servidor local de testes: serve app/public e as funções /api com Postgres em memória (PGlite).
// Uso: node devserver.mjs [porta]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '/home/claude/kp/build/node_modules/@electric-sql/pglite/dist/index.js';

process.env.SESSION_SECRET = 'teste-local';
const APP = '/home/claude/kp/app';
const db = await PGlite.create();
const dbmod = await import(APP + '/api/_lib/db.js');
dbmod.usarExecutor(async (texto, params) => (await db.query(texto, params)).rows);
const seg = await import(APP + '/api/_lib/seguranca.js');
await dbmod.garantirEsquema();
// senha conhecida para o admin nos testes
await db.query(`update kp_registros set dados = dados || $1::jsonb where tabela='USUARIOS' and id='USR-001'`,
  [JSON.stringify({ senhaSalt: 'tst', senhaHash: seg.hashSenha('Teste@123', 'tst'), precisaTrocarSenha: false })]);
const auth = (await import(APP + '/api/auth.js')).default;
const api = (await import(APP + '/api/db.js')).default;

const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css',
  '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/auth' || url.pathname === '/api/db') {
    req.query = Object.fromEntries(url.searchParams);
    const fn = url.pathname === '/api/auth' ? auth : api;
    return fn(req, res);
  }
  let p = path.join(APP, 'public', decodeURIComponent(url.pathname));
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  if (!fs.existsSync(p)) { res.writeHead(404); return res.end('404'); }
  res.writeHead(200, { 'Content-Type': TIPOS[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
const porta = Number(process.argv[2]) || 8787;
server.listen(porta, () => console.log('ok http://localhost:' + porta));
