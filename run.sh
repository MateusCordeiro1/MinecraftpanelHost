#!/bin/bash

# Script para iniciar o painel de controle do servidor Minecraft

# Mensagem de início
echo "Iniciando o Minecraft Server Manager..."

# Passo 1: Instalar/atualizar as dependências do Node.js
# Isso garante que pacotes como express, cors, etc., estejam instalados.
echo "[1/2] Verificando e instalando dependências..."
npm install

# Verificar se a instalação de dependências foi bem-sucedida
if [ $? -ne 0 ]; then
    echo "Erro: Falha ao instalar as dependências com o npm. Verifique seu ambiente Node.js."
    exit 1
fi

echo "Dependências verificadas."

# Passo 2: Iniciar o servidor do painel
# O server.js é o coração do backend do nosso painel.
echo "[2/2] Iniciando o servidor do painel em http://localhost:3000"
node server.js

