#!/usr/bin/env bash
# Diretório do servidor passado como primeiro argumento
SERVER_DIR="$1"

# Verifica se o diretório do servidor foi fornecido
if [ -z "$SERVER_DIR" ]; then
  echo "Erro: O diretório do servidor não foi fornecido."
  exit 1
fi

PLUGINS_DIR="$SERVER_DIR/plugins"

# Lista de IDs de plugins do SpigotMC (Spiget)
RESOURCES=("28140" "34315") # Ex: LuckPerms, Vault

echo "Garantindo que o diretório de plugins exista em: $PLUGINS_DIR"
mkdir -p "$PLUGINS_DIR"

for ID in "${RESOURCES[@]}"; do
  echo "Baixando plugin com ID $ID para $PLUGINS_DIR..."
  # Baixa o .jar mais recente do recurso, com tratamento de erro
  if curl -fL "https://api.spiget.org/v2/resources/$ID/download" -o "$PLUGINS_DIR/$ID.jar"; then
    echo "Plugin ID $ID baixado com sucesso."
  else
    echo "Erro ao baixar o plugin com ID $ID. Verifique o ID e a sua conexão."
  fi
done

echo "Processo de download de plugins concluído para o servidor em $SERVER_DIR!"
