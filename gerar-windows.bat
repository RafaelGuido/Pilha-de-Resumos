@echo off
cd /d "%~dp0"
echo Instalando dependencias...
call npm install
echo Gerando o app...
call npm run build:win
echo.
echo Pronto! O app esta em: dist\Pilha de Resumos-win32-x64
echo Para distribuir, zipe essa pasta inteira.
pause
