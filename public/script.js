document.addEventListener('DOMContentLoaded', () => {
    const socket = io({ reconnectionAttempts: 10, reconnectionDelay: 1000 });

    // --- Element Selectors ---
    const startButton = document.getElementById('startButton');
    const stopButton = document.getElementById('stopButton');
    const restartButton = document.getElementById('restartButton');
    const deleteServerBtn = document.getElementById('deleteServerBtn');
    const terminal = document.getElementById('terminal');
    const serverSelector = document.getElementById('serverSelector');
    const serverTypeSelector = document.getElementById('serverTypeSelector');
    const versionSelector = document.getElementById('versionSelector');
    const serverNameInput = document.getElementById('serverNameInput');
    const createServerForm = document.getElementById('createServerForm');
    const creationStatus = document.getElementById('creationStatus');
    const serverIpElement = document.getElementById('serverIp');
    const copyIpButton = document.getElementById('copyIpButton');
    const commandInput = document.getElementById('commandInput');
    const sendCommandBtn = document.getElementById('sendCommandBtn');

    // --- State Variables ---
    let serverRunning = false;
    let activeServerName = null;

    // --- Core Functions ---
    const updateButtonStates = (isRunning, serverName) => {
        serverRunning = isRunning;
        activeServerName = isRunning ? serverName : null;

        startButton.disabled = isRunning;
        stopButton.disabled = !isRunning;
        restartButton.disabled = !isRunning;
        deleteServerBtn.disabled = isRunning;
        serverSelector.disabled = isRunning;
        commandInput.disabled = !isRunning;
        sendCommandBtn.disabled = !isRunning;
        createServerForm.querySelector('button').disabled = isRunning;

        if (isRunning) {
            startButton.textContent = `Rodando: ${serverName}`;
            serverIpElement.textContent = 'Aguarde, o IP aparecerá em breve...';
        } else {
            startButton.textContent = '▶ Iniciar';
            serverIpElement.textContent = 'parado';
        }
    };

    const getSelectedServer = () => serverSelector.value;

    const sendCommand = () => {
        const command = commandInput.value.trim();
        if (command && serverRunning) {
            socket.emit('terminal-command', command);
            commandInput.value = '';
        }
    };

    const clearTerminal = (text = 'A saída do servidor aparecerá aqui...') => {
        terminal.textContent = text;
    };

    const clearCreationStatus = (text = 'O status da criação aparecerá aqui.') => {
        creationStatus.textContent = text;
    }

    const fetchVersionsForType = (serverType) => {
        versionSelector.innerHTML = '<option value="">Carregando...</option>';
        versionSelector.disabled = true;
        socket.emit('get-versions-for-type', serverType);
    };

    // --- Event Listeners ---
    serverTypeSelector.addEventListener('change', (e) => {
        fetchVersionsForType(e.target.value);
    });

    createServerForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const serverName = serverNameInput.value.trim();
        const versionName = versionSelector.value;
        const serverType = serverTypeSelector.value;

        if (!serverName || !versionName || !serverType) {
            alert('Por favor, selecione um tipo de servidor, uma versão e digite um nome para o servidor.');
            return;
        }
        if (serverRunning) {
            alert('Pare o servidor atual antes de criar um novo.');
            return;
        }
        clearCreationStatus(`Iniciando criação do servidor '${serverName}' (Tipo: ${serverType}, Versão: ${versionName})...`);
        socket.emit('create-server', { serverName, versionName, serverType });
        serverNameInput.value = '';
    });

    startButton.addEventListener('click', () => {
        const serverDir = getSelectedServer();
        if (!serverDir) {
            alert("Por favor, selecione um servidor para iniciar!");
            return;
        }
        if (serverRunning) return;
        clearTerminal(`Enviando comando para iniciar o servidor '${serverDir}'...`);
        socket.emit('start-script', { serverDir });
    });

    stopButton.addEventListener('click', () => {
        if (!serverRunning) return;
        socket.emit('stop-script');
    });

    restartButton.addEventListener('click', () => {
        if (!serverRunning) return;
        socket.emit('restart-script');
    });

    deleteServerBtn.addEventListener('click', async () => {
        const serverName = getSelectedServer();
        if (!serverName) {
            alert('Por favor, selecione um servidor para deletar.');
            return;
        }
        if (serverRunning) {
            alert('Você não pode deletar um servidor que está em execução. Pare-o primeiro.');
            return;
        }
        if (confirm(`Você tem CERTEZA que quer deletar o servidor '${serverName}'? Esta ação é irreversível.`)) {
            try {
                const response = await fetch(`/delete/${serverName}`, { method: 'DELETE' });
                const result = await response.json();
                alert(result.message);
                if (result.success) {
                    clearTerminal(`Servidor '${serverName}' foi deletado.`);
                }
            } catch (error) {
                console.error('Error deleting server:', error);
                alert('Ocorreu um erro na comunicação ao tentar deletar o servidor.');
            }
        }
    });

    copyIpButton.addEventListener('click', () => {
        const ip = serverIpElement.textContent;
        if (ip && ip !== 'parado' && ip !== 'Aguarde, o IP aparecerá em breve...') {
            navigator.clipboard.writeText(ip)
                .then(() => alert(`IP "${ip}" copiado!`))
                .catch(err => console.error('Falha ao copiar o IP:', err));
        }
    });

    sendCommandBtn.addEventListener('click', sendCommand);
    commandInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendCommand(); });

    // --- Socket.IO Handlers ---
    socket.on('connect', () => {
        console.log('Conectado ao backend!');
        fetchVersionsForType(serverTypeSelector.value); // Fetch initial versions
        socket.emit('get-initial-data');
    });

    socket.on('disconnect', () => {
        terminal.textContent += `\n\n--- DESCONECTADO DO PAINEL. ---`;
        updateButtonStates(false, null);
    });

    socket.on('version-list', (data) => {
        const { versions, type } = data;
        versionSelector.innerHTML = '<option value="">Selecione uma versão</option>';
        if (versions && versions.length > 0) {
            versions.forEach(v => {
                const option = document.createElement('option');
                option.value = v;
                option.textContent = v;
                versionSelector.appendChild(option);
            });
        } else {
             versionSelector.innerHTML = '<option value="">Nenhuma versão encontrada</option>';
        }
        versionSelector.disabled = false;
    });

    socket.on('existing-servers', (servers) => {
        const currentServer = getSelectedServer();
        serverSelector.innerHTML = '<option value="">Selecione um servidor</option>';
        servers.forEach(s => {
            const option = document.createElement('option');
            option.value = s;
            option.textContent = s;
            serverSelector.appendChild(option);
        });
        // Restore selection if possible
        if (servers.includes(currentServer)) {
            serverSelector.value = currentServer;
        } else {
            clearTerminal();
        }
    });

    socket.on('creation-status', (data) => {
        if (creationStatus.textContent.startsWith('O status da criação aparecerá aqui')) {
            creationStatus.textContent = '';
        }
        creationStatus.textContent += `${data}\n`;
        creationStatus.scrollTop = creationStatus.scrollHeight;
    });

    socket.on('terminal-output', (data) => {
        const playitUrlMatch = data.match(/(https?:\/\/[-a-zA-Z0-9.]*\.playit\.gg)/);
        if (playitUrlMatch) {
            const url = new URL(playitUrlMatch[0]);
            serverIpElement.textContent = url.hostname;
        }

        if (terminal.textContent.startsWith('A saída do servidor aparecerá aqui...') || terminal.textContent.startsWith('Enviando comando para')) {
            terminal.textContent = '';
        }
        terminal.textContent += data;
        terminal.scrollTop = terminal.scrollHeight;
    });

    socket.on('script-started', (serverName) => {
        console.log('Script started event for:', serverName);
        updateButtonStates(true, serverName);
        // Set the selector to the running server
        serverSelector.value = serverName;
        clearCreationStatus();
    });

    socket.on('script-stopped', () => {
        console.log('Script stopped event');
        updateButtonStates(false, null);
        terminal.textContent += `\n\n--- SERVIDOR PARADO. ---`;
    });

    // --- Initial State ---
    updateButtonStates(false, null);
    clearTerminal();
    clearCreationStatus();
});
