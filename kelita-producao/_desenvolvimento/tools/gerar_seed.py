"""Gera app/api/_lib/seed.js (carga inicial do banco) a partir do backup do sistema de produção."""
import json, sys

ORIGEM = sys.argv[1] if len(sys.argv) > 1 else '/home/claude/data/backup_producao_2026-09-29.json'
DESTINO = '/home/claude/kp/app/api/_lib/seed.js'

d = json.load(open(ORIGEM, encoding='utf-8'))
MAPA = {'PRODUCAO': 'producoes', 'INSUMOS': 'insumos', 'FUNCIONARIOS': 'funcionarios', 'EQUIPES': 'equipes',
        'PRODUTOS': 'produtos', 'CATEGORIAS': 'categorias', 'FICHAS': 'fichasTecnicas', 'CUSTOS': 'custosAdicionais',
        'ESTOQUE': 'movimentacoesEstoque', 'USUARIOS': 'usuarios'}
registros = {}
for tabela, chave in MAPA.items():
    lista = []
    for r in d.get(chave, []):
        r = dict(r)
        for c in ('status_sync', 'sync_em', 'sistema_id'):
            r.pop(c, None)
        lista.append(r)
    registros[tabela] = lista
registros['CONFIG'] = [{'id': 'geral', 'config': d['config']}]
registros['LOGS'] = [dict(l, id='LOG-%05d' % (i + 1)) for i, l in enumerate(d.get('logs', []))]

texto = json.dumps({'origem': ORIGEM.split('/')[-1], 'registros': registros}, ensure_ascii=False)
with open(DESTINO, 'w', encoding='utf-8') as f:
    f.write('// Base inicial: backup do sistema de 29/09/2026 (carregado só quando o banco está vazio).\n')
    f.write('export default ' + texto + ';\n')
print(len(texto), {t: len(v) for t, v in registros.items()})
