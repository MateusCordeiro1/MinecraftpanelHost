#!/bin/bash

# Garante que o playit tenha permissão de execução
chmod +x ./playit-linux-amd64

echo "Iniciando o túnel com playit.gg em segundo plano..."
./playit-linux-amd64 > /dev/null 2>&1 &
PLAYIT_PID=$!

# Adiciona um manipulador de saída para matar o processo do túnel quando este script sair
trap 'echo "Parando o túnel playit.gg..."; kill $PLAYIT_PID' EXIT

echo "Aguardando o túnel iniciar..."
sleep 5

echo "Iniciando o servidor Minecraft..."
echo "A saída do console será exibida abaixo."
echo "Para parar o servidor, use o comando 'stop' ou o botão no painel."

# Executa o servidor no PRIMEIRO PLANO. O script vai esperar aqui até que o processo do java termine.
# A saída (stdout/stderr) será capturada pelo painel.
nix-shell -p pkgs.jdk21 --run "java -Xmx5G -Xms1G -jar server.jar nogui"

# Quando o comando acima terminar, o script continuará.
echo "O processo do servidor Minecraft foi finalizado."

# A trap de EXIT será acionada automaticamente aqui, derrubando o túnel.
