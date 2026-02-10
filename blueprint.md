# Painel de Controle do Servidor Minecraft

## Visão Geral

Este projeto é um painel de controle baseado na web para criar e gerenciar servidores Minecraft. A interface permite que os usuários selecionem um tipo de servidor (Vanilla, Paper ou Spigot), uma versão do Minecraft, criem um servidor com um nome personalizado e, em seguida, iniciem, parem, e interajam com o console do servidor em tempo real.

## Recursos Implementados

*   **Design e Interface:**
    *   **Tema Escuro Moderno:** Interface com um tema escuro, limpo e responsivo.
    *   **Layout Intuitivo:** Controles agrupados logicamente para uma experiência de usuário unificada.
    *   **Ícones e Efeitos Visuais:** Uso de ícones, gradientes e efeitos para uma aparência polida.

*   **Criação de Servidor Dinâmica:**
    *   **Seleção de Tipo de Servidor:** Menu suspenso para escolher entre "Vanilla", "Paper" e "Spigot".
    *   **Busca de Versões Dinâmica:**
        *   Para **Vanilla**, busca todas as versões da API da Mojang.
        *   Para **Paper**, busca as versões compatíveis da API do PaperMC.
        *   Para **Spigot**, extrai as versões disponíveis de um repositório conhecido.
    *   **Nome Personalizado:** Permite que o usuário nomeie seu servidor.
    *   **Automação:** Baixa o `.jar` correto para o tipo e versão selecionados, aceita o EULA e prepara o diretório do servidor.
    *   **Scripts de Inicialização Dinâmicos:** O script `start.sh` é gerado dinamicamente para usar o nome do JAR correto (ex: `spigot-1.19.4.jar`).

*   **Gerenciamento de Servidor:**
    *   **Listagem:** Lista todos os servidores existentes.
    *   **Controles:** Botões para "Iniciar", "Parar" e "Reiniciar".
    *   **Deleção:** Permite a exclusão de servidores parados.
    *   **Status:** Desabilita/habilita os controles com base no estado do servidor.

*   **Console Interativo e IP:**
    *   **Terminal em Tempo Real:** Exibe a saída do console do servidor.
    *   **Envio de Comandos:** Permite o envio de comandos para o servidor.
    *   **Exibição de IP:** Mostra o IP público do servidor e um botão para copiá-lo.

*   **Backend e Arquitetura:**
    *   **Node.js com Express:** Para o servidor web e a API.
    *   **Socket.IO:** Para comunicação em tempo real.
    *   **Estrutura Modular:** Código organizado para separar responsabilidades.

## Plano de Melhoria (Sessão Atual)

**Objetivo:** Corrigir o erro no download de servidores Spigot.

**Passos:**

1.  **[CONCLUÍDO] Identificar o Erro:** O erro `getaddrinfo ENOTFOUND download.getbukkit.org` indicou que a URL de download do Spigot estava offline.
2.  **[CONCLUÍDO] Corrigir a URL de Download:** Atualizar a variável `spigotDownloadUrl` no `server.js` para um espelho funcional (`https://cdn.getbukkit.org/spigot/spigot-[version].jar`).
3.  **[CONCLUÍDO] Atualizar `blueprint.md`:** Documentar a correção do bug.
