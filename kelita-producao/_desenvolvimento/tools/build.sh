#!/usr/bin/env bash
# Monta app/public a partir do sistema original: HTML refatorado, bibliotecas locais, ícones e CSS compilado.
set -euo pipefail
KP=/home/claude/kp
NM=$KP/build/node_modules
python3 $KP/tools/build_app.py
mkdir -p $KP/app/public/assets/lib $KP/app/public/assets/fontawesome/css $KP/app/public/assets/fontawesome/webfonts
cp $NM/chart.js/dist/chart.umd.js $NM/xlsx/dist/xlsx.full.min.js $NM/jspdf/dist/jspdf.umd.min.js \
   $NM/jspdf-autotable/dist/jspdf.plugin.autotable.min.js $KP/app/public/assets/lib/
cp $NM/@fortawesome/fontawesome-free/css/all.min.css $KP/app/public/assets/fontawesome/css/
cp $NM/@fortawesome/fontawesome-free/webfonts/*.woff2 $KP/app/public/assets/fontawesome/webfonts/
cd $KP/build && npx tailwindcss -c $KP/app/estilo/tailwind.config.cjs -i $KP/app/estilo/entrada.css \
   -o $KP/app/public/assets/app.css --minify 2>&1 | tail -1
# versão nos arquivos próprios (?v=hash): o navegador nunca mistura HTML novo com CSS/JS antigos do cache
python3 - <<PY
import hashlib, re
pub = '$KP/app/public/'
p = pub + 'index.html'; s = open(p, encoding='utf-8').read()
for f in ['assets/app.css', 'assets/nuvem.js', 'assets/impressao.js', 'assets/responsivo.js', 'assets/operador.js']:
    v = hashlib.md5(open(pub + f, 'rb').read()).hexdigest()[:8]
    s, n = re.subn(re.escape(f) + r'(\\?v=[0-9a-f]+)?"', f + '?v=' + v + '"', s)
    assert n == 1, (f, n)
open(p, 'w', encoding='utf-8').write(s)
print('versões aplicadas')
PY
# sintaxe e auditoria estática
SCR=$(mktemp -d)
python3 -c "
s=open('$KP/app/public/index.html',encoding='utf-8').read()
i=s.index('<script>',s.rindex('assets/lib/jspdf.plugin.autotable.min.js'))
j=s.index('</script>',i)
open('$SCR/principal.js','w',encoding='utf-8').write(s[i+8:j])"
node --check $SCR/principal.js && node --check $KP/app/public/assets/nuvem.js && node --check $KP/app/public/assets/impressao.js && node --check $KP/app/public/assets/responsivo.js && node --check $KP/app/public/assets/operador.js && echo "sintaxe OK"
python3 $KP/tools/audit_static.py $KP/app/public/index.html $SCR/principal.js $KP/app/public/assets/nuvem.js $KP/app/public/assets/impressao.js $KP/app/public/assets/responsivo.js $KP/app/public/assets/operador.js
du -sh $KP/app/public
