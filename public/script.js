document.addEventListener('DOMContentLoaded', () => {
    const socket = io();

    // --- DOM Elements ---
    const sections = document.querySelectorAll('.content-section');
    const navItems = document.querySelectorAll('.nav-item');
    const serverList = document.getElementById('server-list'); 
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
    let currentPath = []; // For file manager
    let selectedServerForFiles = null;

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
        document.querySelectorAll('.server-status-light').forEach(light => {
            light.classList.remove('running');
            light.classList.add('stopped');
        });

        if (activeServer) {
            const statusDisplay = document.getElementById(`status-${runningServer}`);
            if(statusDisplay) {
                statusDisplay.classList.remove('stopped');
                statusDisplay.classList.add('running');
            }
            serverStatusIndicator.className = 'status-indicator running';
            serverStatusText.textContent = `Running (${activeServer})`;
            stopBtn.disabled = false;
            restartBtn.disabled = false;
        } else {
            serverStatusIndicator.className = 'status-indicator stopped';
            serverStatusText.textContent = 'Stopped';
            stopBtn.disabled = true;
            restartBtn.disabled = true;
        }
        
        const anyServerSelected = !!selectedServerForFiles;
        startBtn.disabled = !anyServerSelected || !!activeServer;
    };
    
    const refreshFileList = () => {
        if (selectedServerForFiles) {
             socket.emit('list-files', { serverName: selectedServerForFiles, subDir: currentPath.join('/') });
        }
    };

    // --- Navigation ---
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const sectionId = e.currentTarget.dataset.section;
            showSection(sectionId);
            if (sectionId === 'files' && selectedServerForFiles) {
                currentPath = [];
                refreshFileList();
            }
        });
    });

    // --- Server Management ---
    startBtn.addEventListener('click', () => {
        if (selectedServerForFiles) socket.emit('start-script', { serverDir: selectedServerForFiles });
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
        creationOutput.textContent = ''; 
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
        fileBreadcrumbs.innerHTML = `<span class="breadcrumb-item" data-path="">${selectedServerForFiles} /</span>`;
        let current = '';
        currentPath.forEach(part => {
            current += (current ? '/' : '') + part;
            fileBreadcrumbs.innerHTML += ` <span class="breadcrumb-item" data-path="${current}">${part}</span> /`;
        });
    };
    
    fileBreadcrumbs.addEventListener('click', (e) => {
        if (e.target.classList.contains('breadcrumb-item')) {
            const path = e.target.dataset.path;
            currentPath = path ? path.split('/').filter(p => p) : [];
            refreshFileList();
        }
    });

    fileList.addEventListener('click', (e) => {
        const target = e.target;
        const item = target.closest('.file-item');
        if (!item) return;

        const { name, type } = item.dataset;
        const itemPath = [...currentPath, name].join('/');
        
        if (target.classList.contains('btn-delete')) {
            if (confirm(`Are you sure you want to delete '${name}'? This cannot be undone.`)) {
                socket.emit('delete-path', { serverName: selectedServerForFiles, pathToDelete: itemPath });
            }
            return;
        }
        
        if (target.classList.contains('btn-rename')) {
            const newName = prompt(`Enter new name for '${name}':`, name);
            if (newName && newName !== name) {
                socket.emit('rename-path', { serverName: selectedServerForFiles, oldPath: itemPath, newName: newName });
            }
            return;
        }
        
        if (type === 'directory') {
            currentPath.push(name);
            refreshFileList();
        } else {
            selectedFile = itemPath;
            socket.emit('get-file-content', { serverName: selectedServerForFiles, filePath: itemPath });
        }
    });

    saveFileBtn.addEventListener('click', () => {
        if (selectedFile) {
            const content = fileEditor.value;
            socket.emit('save-file-content', { serverName: selectedServerForFiles, filePath: selectedFile, content });
        }
    });

    // --- Socket.IO Event Handlers ---
    socket.on('existing-servers', ({ servers, activeServer: runningServer }) => {
        const previouslySelected = selectedServerForFiles;
        serverList.innerHTML = ''; 
        if (servers.length === 0) {
            serverList.innerHTML = '<p>No servers found. Create one to get started!</p>';
            selectedServerForFiles = null;
        } else {
            servers.forEach(server => {
                const serverCard = document.createElement('div');
                serverCard.className = 'server-card';
                serverCard.dataset.serverName = server;
                
                serverCard.innerHTML = `
                    <div class="server-name">${server}</div>
                    <div class="server-status">
                        <span id="status-${server}" class="server-status-light stopped"></span>
                    </div>
                    <div class="server-actions">
                         <button class="btn btn-secondary btn-manage-files">Files</button>
                         <button class="btn btn-danger btn-delete-server">Delete</button>
                    </div>
                `;
                serverList.appendChild(serverCard);
            });
             if (servers.includes(previouslySelected)) {
                selectedServerForFiles = previouslySelected;
            } else {
                selectedServerForFiles = servers[0] || null;
            }
        }

        if (selectedServerForFiles) {
             document.querySelector(`.server-card[data-server-name="${selectedServerForFiles}"]`)?.classList.add('selected');
        }
       
        updateServerStatus(runningServer);
    });
    
    serverList.addEventListener('click', (e) => {
        const card = e.target.closest('.server-card');
        if (!card) return;

        const serverName = card.dataset.serverName;
        
        document.querySelectorAll('.server-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        selectedServerForFiles = serverName;

        if (e.target.classList.contains('btn-delete-server')) {
             if (confirm(`Are you sure you want to permanently delete the server '${serverName}'? All data will be lost.`)) {
                socket.emit('delete-server', serverName);
            }
        } else if (e.target.classList.contains('btn-manage-files')){
            currentPath = [];
            showSection('files');
            refreshFileList();
        } 
        updateServerStatus(activeServer);
    });

    socket.on('version-list', ({ type, versions }) => {
        if (type === serverTypeSelect.value) {
            versionNameSelect.innerHTML = '';
            if (versions.length > 0) {
                 versions.forEach(version => {
                    const option = document.createElement('option');
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

    socket.on('file-list', ({ serverName, subDir, files }) => {
        if (serverName !== selectedServerForFiles) return;
        currentPath = subDir ? subDir.split('/').filter(p => p) : [];
        fileList.innerHTML = '';
        files.sort((a, b) => {
            if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
            return a.name.localeCompare(b.name);
        });

        renderBreadcrumbs();

        files.forEach(file => {
            const li = document.createElement('li');
            li.className = 'file-item';
            li.dataset.name = file.name;
            li.dataset.type = file.isDirectory ? 'directory' : 'file';
            li.innerHTML = `
                <span class="file-icon"><i class="fas ${file.isDirectory ? 'fa-folder' : 'fa-file-alt'}"></i></span>
                <span class="file-name">${file.name}</span>
                <span class="file-actions">
                    <button class="btn btn-sm btn-secondary btn-rename" title="Rename">Rename</button>
                    <button class="btn btn-sm btn-danger btn-delete" title="Delete">Delete</button>
                </span>
            `;
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

    // --- BUG FIX: Listen for server instruction and refresh file list ---
    socket.on('refresh-file-list', ({ serverName, subDir }) => {
        // Check if the update is for the currently viewed server and path
        const currentSubDir = currentPath.join('/');
        if (serverName === selectedServerForFiles && subDir === currentSubDir) {
            refreshFileList();
        }
    });
    
    // --- Initial Load ---
    showSection('servers'); 
});
