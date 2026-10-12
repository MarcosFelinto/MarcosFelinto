@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Kelita Producao - publicando na Vercel
echo.
echo === Kelita Producao: publicando na Vercel ===
echo.
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js nao encontrado. Instale em https://nodejs.org e rode de novo.
  echo ERRO: Node.js ausente> publicar.log
  pause
  exit /b 1
)
echo [1/3] Conferindo login na Vercel...
call npx --yes vercel@latest whoami > publicar.log 2>&1
if errorlevel 1 (
  echo.
  echo  ============================================================
  echo   ACAO NECESSARIA - login na Vercel ^(so na primeira vez^)
  echo   1. Aperte ENTER para abrir o navegador
  echo   2. Entre na sua conta Vercel
  echo   3. Clique em ALLOW / AUTORIZAR
  echo  ============================================================
  echo.
  call npx --yes vercel@latest login
  call npx --yes vercel@latest whoami >> publicar.log 2>&1
  if errorlevel 1 goto erro
)
echo [2/3] Vinculando ao projeto kelita-producao...
call npx --yes vercel@latest link --yes --scope felintobr-7281s-projects --project kelita-producao >> publicar.log 2>&1
if errorlevel 1 goto erro
echo [3/3] Publicando (leva 1 a 2 minutos)...
call npx --yes vercel@latest deploy --prod --yes --scope felintobr-7281s-projects >> publicar.log 2>&1
if errorlevel 1 goto erro
type publicar.log
echo RESULTADO: OK>> publicar.log
echo.
echo Pronto! Acesse: https://kelita-producao.vercel.app
pause
exit /b 0
:erro
type publicar.log
echo RESULTADO: FALHA>> publicar.log
echo.
echo Algo deu errado. A mensagem acima esta em publicar.log.
pause
exit /b 1
