#!/usr/bin/env bash
# Kélita Produção — publica o sistema na Vercel (projeto kelita-producao).
# Requisito: Node.js. Na primeira vez a Vercel pede login pelo navegador.
set -e
cd "$(dirname "$0")"
npx --yes vercel@latest link --yes --scope felintobr-7281s-projects --project kelita-producao
npx --yes vercel@latest deploy --prod --yes --scope felintobr-7281s-projects
echo "Pronto! Acesse: https://kelita-producao.vercel.app"
