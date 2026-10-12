"""Auditoria estática: handlers inline sem função, IDs usados no JS e ausentes no HTML, IDs duplicados.
Uso: python3 audit_static.py pagina.html script1.js [script2.js ...]"""
import re, sys
from collections import Counter

html_path, js_paths = sys.argv[1], sys.argv[2:]
s = open(html_path, encoding='utf-8').read()
js = '\n'.join(open(p, encoding='utf-8').read() for p in js_paths)

defined = set(re.findall(r'function\s+([A-Za-z_$][\w$]*)\s*\(', js))
defined |= set(re.findall(r'(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=', js))
defined |= set(re.findall(r'window\.([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function', js))

calls = set()
for m in re.finditer(r'on(?:click|change|input|submit|keyup|blur)="([^"]*)"', s + js):
    calls.update(re.findall(r'([A-Za-z_$][\w$]*)\s*\(', m.group(1)))

ignore = {'event', 'alert', 'confirm', 'prompt', 'if', 'return', 'parseFloat', 'Number', 'String',
          'preventDefault', 'getElementById', 'click', 'stopPropagation', 'setTimeout', 'print',
          'remove', 'toggle', 'add', 'contains', 'querySelector', 'closest', 'select', 'focus'}
print('Handlers sem função definida:', sorted(c for c in calls if c not in defined and c not in ignore))

corte = s.index('id="appsScriptCode"') if 'id="appsScriptCode"' in s else s.index('<script>', s.index('</main>'))
markup = s[:corte]
ids_def = set(re.findall(r'id="([^"]+)"', s))
ids_def |= set(re.findall(r'id="([^"$]+)"', js))
ids_criados_js = set(re.findall(r"\.id\s*=\s*'([^']+)'", js))
ids_js = set(re.findall(r"getElementById\('([^']+)'\)", js))
print('IDs usados no JS sem elemento no HTML:', sorted(i for i in ids_js if i not in ids_def and i not in ids_criados_js and '$' not in i))
dup = [k for k, v in Counter(re.findall(r'id="([^"$]+)"', markup)).items() if v > 1]
print('IDs duplicados:', dup)
