document.addEventListener('DOMContentLoaded', () => {
    const socket = io();

    // --- DOM Elements ---
    const sections = document.querySelectorAll('.content-section');
    const navItems = document.querySelectorAll('.nav-item');
    const serverSelect = document.getElementById('server-select');
    const startBtn = document.getElementById('start-btn');
    const stopBtn = document.getElementById('stop-btn');
    const restartBtn = document.getElementById('restart-btn');
    const serverStatusIndicator = document.getElementById('server-status-indicator');
    const serverStatusText = document.getElementById('server-status-text');
    const terminalOutput = document.getElementById('terminal-output');
    const terminalInput = document.getElementById('terminal-input');
    const sendCommandBtn = document.getElementById('send-command-btn');
    const createServerForm = document.getElementById('create-server-form');
    const serverNameInput = document.getElementById('server-name');
    const serverTypeSelect = document.getElementById('server-type');
    const versionNameSelect = document.getElementById('version-name');
    const ramAmountInput = document.getElementById('ram-amount');
    const creationOutput = document.getElementById('creation-output');
    
    // File Manager Elements
    const fileBreadcrumbs = document.getElementById('file-breadcrumbs');
    const fileList = document.getElementById('file-list');
    const fileEditor = document.getElementById('file-editor');
    const editorInfo = document.getElementById('editor-info');
    const saveFileBtn = document.getElementById('save-file-btn');

    // --- State ---
    let activeServer = null;
    let selectedFile = null;
    let currentPath = [];

    // --- Helper Functions ---
    const showSection = (sectionId) => {
        sections.forEach(section => section.classList.remove('active'));
        navItems.forEach(item => item.classList.remove('active'));
        document.getElementById(sectionId)?.classList.add('active');
        document.querySelector(`.nav-item[data-section='${sectionId}']`)?.classList.add('active');
    };

    const logToTerminal = (message) => {
        terminalOutput.textContent += message;
        terminalOutput.scrollTop = terminalOutput.scrollHeight;
    };
    
    const logToCreation = (message) => {
        creationOutput.textContent += message;
        creationOutput.scrollTop = creationOutput.scrollHeight;
    };

    const updateServerStatus = (runningServer) => {
        activeServer = runningServer;
        if (activeServer) {
            serverStatusIndicator.className = 'status-indicator running';
            serverStatusText.textContent = `Running (${activeServer})`;
            startBtn.disabled = true;
            stopBtn.disabled = false;
            restartBtn.disabled = false;
        } else {
            serverStatusIndicator.className = 'status-indicator stopped';
            serverStatusText.textContent = 'Stopped';
            startBtn.disabled = !serverSelect.value;
            stopBtn.disabled = true;
            restartBtn.disabled = true;
        }
    };

    // --- Navigation ---
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const sectionId = e.currentTarget.dataset.section;
            showSection(sectionId);
            if (sectionId === 'files' && serverSelect.value) {
                currentPath = [];
                socket.emit('list-files', { serverName: serverSelect.value, subDir: '' });
            }
        });
    });

    // --- Server Management ---
    serverSelect.addEventListener('change', () => {
        const selected = serverSelect.value;
        startBtn.disabled = !selected || activeServer;
        // Refresh file manager if it's the active view
        if (document.getElementById('files').classList.contains('active')) {
            currentPath = [];
            socket.emit('list-files', { serverName: selected, subDir: '' });
        }
    });

    startBtn.addEventListener('click', () => {
        const serverDir = serverSelect.value;
        if (serverDir) socket.emit('start-script', { serverDir });
    });

    stopBtn.addEventListener('click', () => socket.emit('stop-script'));
    restartBtn.addEventListener('click', () => socket.emit('restart-script'));

    // --- Terminal ---
    sendCommandBtn.addEventListener('click', () => {
        const command = terminalInput.value;
        if (command) {
            socket.emit('terminal-command', command);
            terminalInput.value = '';
        }
    });
    terminalInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendCommandBtn.click();
    });

    // --- Server Creation ---
    serverTypeSelect.addEventListener('change', () => {
        const serverType = serverTypeSelect.value;
        versionNameSelect.innerHTML = '<option>Loading...</option>';
        versionNameSelect.disabled = true;
        if (serverType) {
            socket.emit('get-versions-for-type', serverType);
        }
    });

    createServerForm.addEventListener('submit', (e) => {
        e.preventDefault();
        creationOutput.textContent = ''; // Clear previous logs
        const serverName = serverNameInput.value;
        const serverType = serverTypeSelect.value;
        const versionName = versionNameSelect.value;
        const ram = ramAmountInput.value;
        if (serverName && serverType && versionName) {
            socket.emit('create-server', { serverName, versionName, serverType, ram });
        }
    });
    
    // --- File Manager ---
    const renderBreadcrumbs = () => {
        fileBreadcrumbs.innerHTML = '<span class="breadcrumb-item" data-path="">/</span>';
        let current = '';
        currentPath.forEach(part => {
            current += (current ? '/' : '') + part;
            fileBreadcrumbs.innerHTML += ` <span class="breadcrumb-item" data-path="${current}">${part}</span> /`;
        });
    };
    
    fileBreadcrumbs.addEventListener('click', (e) => {
        if (e.target.classList.contains('breadcrumb-item')) {
            const path = e.target.dataset.path;
            currentPath = path ? path.split('/') : [];
            socket.emit('list-files', { serverName: serverSelect.value, subDir: path });
        }
    });

    fileList.addEventListener('click', (e) => {
        const item = e.target.closest('.file-item');
        if (!item) return;
        const { name, type } = item.dataset;
        const newPath = [...currentPath, name].join('/');

        if (type === 'directory') {
            currentPath.push(name);
            socket.emit('list-files', { serverName: serverSelect.value, subDir: newPath });
        } else {
            selectedFile = newPath;
            socket.emit('get-file-content', { serverName: serverSelect.value, filePath: newPath });
        }
    });

    saveFileBtn.addEventListener('click', () => {
        if (selectedFile) {
            const content = fileEditor.value;
            socket.emit('save-file-content', { serverName: serverSelect.value, filePath: selectedFile, content });
        }
    });

    // --- Socket.IO Event Handlers ---
    socket.on('existing-servers', ({ servers, activeServer: runningServer }) => {
        serverSelect.innerHTML = '<option value="" disabled selected>Select a server</option>';
        servers.forEach(server => {
            const option = document.createElement('option');
            option.value = server;
            option.textContent = server;
            serverSelect.appendChild(option);
        });
        updateServerStatus(runningServer);
    });

    socket.on('version-list', ({ type, versions }) => {
        if (type === serverTypeSelect.value) {
            versionNameSelect.innerHTML = '';
            if (versions.length > 0) {
                 versions.forEach(version => {
                    const option = document.createElement('option');
                    // Handle both string and object versions
                    if (typeof version === 'object') {
                        option.value = version.value;
                        option.textContent = version.text;
                    } else {
                        option.value = version;
                        option.textContent = version;
                    }
                    versionNameSelect.appendChild(option);
                });
                versionNameSelect.disabled = false;
            } else {
                versionNameSelect.innerHTML = '<option>No versions found</option>';
            }
        }
    });

    socket.on('script-started', (serverDir) => {
        updateServerStatus(serverDir);
        showSection('terminal');
        logToTerminal(`--- Server "${serverDir}" started ---\n`);
    });

    socket.on('script-stopped', () => {
        updateServerStatus(null);
        logToTerminal(`\n--- Server stopped ---\n`);
    });

    socket.on('terminal-output', logToTerminal);
    socket.on('creation-status', logToCreation);

    // File Manager Sockets
    socket.on('file-list', ({ serverName, subDir, files }) => {
        if (serverName !== serverSelect.value) return;
        fileList.innerHTML = '';
        // Sort: folders first, then alphabetically
        files.sort((a, b) => {
            if (a.isDirectory !== b.isDirectory) {
                return a.isDirectory ? -1 : 1;
            }
            return a.name.localeCompare(b.name);
        });

        renderBreadcrumbs();

        files.forEach(file => {
            const li = document.createElement('li');
            li.className = 'file-item';
            li.dataset.name = file.name;
            li.dataset.type = file.isDirectory ? 'directory' : 'file';
            li.innerHTML = `<i class="fas ${file.isDirectory ? 'fa-folder' : 'fa-file-alt'}"></i> ${file.name}`;
            fileList.appendChild(li);
        });
    });

    socket.on('file-content', ({ filePath, content }) => {
        selectedFile = filePath;
        editorInfo.textContent = `Editing: ${filePath}`;
        fileEditor.value = content;
        fileEditor.disabled = false;
        saveFileBtn.disabled = false;
    });
    
    // --- Initial Load ---
    showSection('servers'); // Show servers section by default
});
