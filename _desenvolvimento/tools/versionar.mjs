// Atualiza o "?v=<hash>" dos arquivos próprios no index.html.
// O navegador guarda /assets/* por até 1 hora (vercel.json); com o hash novo ele baixa a versão
// alterada na hora, sem misturar HTML novo com JS/CSS antigos.
// Uso: npm run versionar   (rode sempre depois de editar algo em public/assets)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const PUBLICO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');
const ARQUIVOS = ['assets/app.css', 'assets/lib/sweetalert2.all.min.js', 'assets/lib/ably.min.js',
  'assets/nuvem.js', 'assets/impressao.js', 'assets/responsivo.js', 'assets/operador.js'];

const indice = path.join(PUBLICO, 'index.html');
let html = fs.readFileSync(indice, 'utf8');
for (const f of ARQUIVOS) {
  const v = crypto.createHash('md5').update(fs.readFileSync(path.join(PUBLICO, f))).digest('hex').slice(0, 8);
  const re = new RegExp(f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\?v=[0-9a-f]+)?"', 'g');
  const n = (html.match(re) || []).length;
  if (n !== 1) throw new Error(`${f}: esperado 1 uso no index.html, achei ${n}`);
  html = html.replace(re, `${f}?v=${v}"`);
  console.log(`${f}?v=${v}`);
}
fs.writeFileSync(indice, html);
console.log('index.html atualizado');
