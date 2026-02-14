document.addEventListener('DOMContentLoaded', () => {
    const socket = io({ transports: ['websocket'] });

    // --- Mock for Node.js 'path' module in the browser ---
    const path = {
        basename: (p) => (p && typeof p === 'string') ? p.split('/').pop() : '',
        dirname: (p) => (p && typeof p === 'string') ? p.split('/').slice(0, -1).join('/') : '',
        join: (...args) => args.filter(Boolean).join('/')
    };

    // --- Global State ---
    let activeServer = null;
    let selectedFile = { path: null, isDirty: false };
    let currentDirectory = '';
    let serverMeta = {};

    // --- UI Element Cache ---
    const ui = {
        sections: document.querySelectorAll('.content-section'),
        navItems: document.querySelectorAll('.nav-item'),
        serverSelect: document.getElementById('server-select'),
        startBtn: document.getElementById('start-btn'),
        stopBtn: document.getElementById('stop-btn'),
        restartBtn: document.getElementById('restart-btn'),
        renameServerBtn: document.getElementById('rename-server-btn'),
        deleteServerBtn: document.getElementById('delete-server-btn'),
        statusIndicator: document.getElementById('server-status-indicator'),
        statusText: document.getElementById('server-status-text'),
        creationForm: document.getElementById('create-server-form'),
        serverNameInput: document.getElementById('server-name'),
        serverTypeSelect: document.getElementById('server-type'),
        versionNameSelect: document.getElementById('version-name'),
        ramAmountInput: document.getElementById('ram-amount'),
        creationOutput: document.getElementById('creation-output'),
        terminalOutput: document.getElementById('terminal-output'),
        terminalInput: document.getElementById('terminal-input'),
        sendCommandBtn: document.getElementById('send-command-btn'),
        fmBreadcrumbs: document.getElementById('file-breadcrumbs'),
        fmList: document.getElementById('file-list'),
        fmEditor: document.getElementById('file-editor'),
        fmInfo: document.getElementById('editor-info'),
        fmActions: document.getElementById('editor-actions'),
        fmSaveBtn: document.getElementById('save-file-btn'),
        fmRenameBtn: document.getElementById('rename-file-btn'),
        fmDeleteBtn: document.getElementById('delete-file-btn'),
        fmUploadBtn: document.getElementById('upload-file-btn'),
        fmUploadInput: document.getElementById('file-upload-input'),
        pluginNotice: document.getElementById('plugin-compatibility-notice'),
        pluginEssentialsBtn: document.getElementById('download-plugins-btn'),
        pluginSearchInput: document.getElementById('plugin-search-input'),
        pluginSearchBtn: document.getElementById('plugin-search-btn'),
        pluginSearchResults: document.getElementById('plugin-search-results')
    };

    // --- Helper Functions ---
    const showSection = (sectionId) => {
        ui.sections.forEach(s => s.classList.remove('active'));
        document.getElementById(sectionId)?.classList.add('active');
        ui.navItems.forEach(n => n.classList.toggle('active', n.dataset.section === sectionId));
    };
    const logTo = (element, message) => { element.textContent += message; element.scrollTop = element.scrollHeight; };
    const showAlert = (message, type = 'error') => alert(`[${type.toUpperCase()}] ${message}`);

    // --- Event Listeners ---

    // Navigation
    ui.navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const sectionId = e.currentTarget.dataset.section;
            showSection(sectionId);
            if (sectionId === 'files' && ui.serverSelect.value) {
                socket.emit('list-files', { serverName: ui.serverSelect.value, subDir: '' });
            }
            if (sectionId === 'plugins') {
                checkPluginCompatibility();
            }
        });
    });

    // Server Controls
    const updateServerControls = () => {
        const selected = ui.serverSelect.value;
        const isRunning = activeServer != null;
        const isThisServerRunning = activeServer === selected;
        ui.startBtn.disabled = isRunning || !selected;
        ui.stopBtn.disabled = !isThisServerRunning;
        ui.restartBtn.disabled = !isThisServerRunning;
        ui.renameServerBtn.disabled = isRunning || !selected;
        ui.deleteServerBtn.disabled = isRunning || !selected;
        ui.statusText.textContent = isRunning ? `Running (${activeServer})` : 'Stopped';
        ui.statusIndicator.className = `status-indicator ${isRunning ? 'running' : 'stopped'}`;
    };

    ui.serverSelect.addEventListener('change', () => {
        updateServerControls();
        const activeSectionId = document.querySelector('.content-section.active')?.id;
        if (activeSectionId === 'files') socket.emit('list-files', { serverName: ui.serverSelect.value, subDir: '' });
        if (activeSectionId === 'plugins') checkPluginCompatibility();
    });

    ui.startBtn.addEventListener('click', () => ui.serverSelect.value && socket.emit('start-script', { serverDir: ui.serverSelect.value }));
    ui.stopBtn.addEventListener('click', () => socket.emit('stop-script'));
    ui.restartBtn.addEventListener('click', () => socket.emit('restart-script'));
    ui.renameServerBtn.addEventListener('click', () => {
        const oldName = ui.serverSelect.value;
        if (!oldName) return;
        const newName = prompt('Enter new server name:', oldName);
        if (newName && newName.trim() !== oldName) socket.emit('rename-server', { oldName, newName: newName.trim() });
    });
    ui.deleteServerBtn.addEventListener('click', () => {
        const name = ui.serverSelect.value;
        if (name && confirm(`Delete server '${name}'? This is permanent.`)) socket.emit('delete-server', { serverName: name });
    });

    // Server Creation
    ui.serverTypeSelect.addEventListener('change', () => {
        ui.versionNameSelect.innerHTML = '<option>Loading...</option>';
        ui.versionNameSelect.disabled = true;
        if (ui.serverTypeSelect.value) socket.emit('get-versions-for-type', ui.serverTypeSelect.value);
    });
    ui.creationForm.addEventListener('submit', (e) => {
        e.preventDefault();
        ui.creationOutput.textContent = '';
        socket.emit('create-server', { serverName: ui.serverNameInput.value.trim(), serverType: ui.serverTypeSelect.value, versionName: ui.versionNameSelect.value, ram: ui.ramAmountInput.value });
    });

    // Console
    ui.sendCommandBtn.addEventListener('click', () => {
        if (ui.terminalInput.value) socket.emit('terminal-command', ui.terminalInput.value);
        ui.terminalInput.value = '';
    });
    ui.terminalInput.addEventListener('keypress', (e) => e.key === 'Enter' && ui.sendCommandBtn.click());

    // File Manager
    const resetEditor = () => {
        ui.fmEditor.value = '';
        ui.fmEditor.disabled = true;
        ui.fmInfo.textContent = 'Select a file to view or edit';
        ui.fmActions.style.display = 'none';
        selectedFile = { path: null, isDirty: false };
        document.querySelectorAll('.file-item.selected').forEach(el => el.classList.remove('selected'));
    };
    ui.fmList.addEventListener('click', e => {
        const item = e.target.closest('.file-item');
        if (!item) return;
        const filePath = path.join(currentDirectory, item.dataset.name);
        document.querySelectorAll('.file-item.selected').forEach(el => el.classList.remove('selected'));
        item.classList.add('selected');
        if (item.dataset.type === 'directory') {
            socket.emit('list-files', { serverName: ui.serverSelect.value, subDir: filePath });
        } else {
            selectedFile = { path: filePath, isDirty: false };
            ui.fmInfo.textContent = `Selected: ${item.dataset.name}`;
            ui.fmActions.style.display = 'flex';
            socket.emit('get-file-content', { serverName: ui.serverSelect.value, filePath });
        }
    });
    ui.fmBreadcrumbs.addEventListener('click', e => {
        if (e.target.dataset.path !== undefined) socket.emit('list-files', { serverName: ui.serverSelect.value, subDir: e.target.dataset.path });
    });
    ui.fmSaveBtn.addEventListener('click', () => selectedFile.path && socket.emit('save-file-content', { serverName: ui.serverSelect.value, filePath: selectedFile.path, content: ui.fmEditor.value }));
    ui.fmRenameBtn.addEventListener('click', () => {
        if (!selectedFile.path) return;
        const oldName = path.basename(selectedFile.path);
        const newName = prompt('Enter new name:', oldName);
        if (newName && newName.trim() !== oldName) socket.emit('rename-file', { serverName: ui.serverSelect.value, subDir: currentDirectory, oldName, newName: newName.trim() });
    });
    ui.fmDeleteBtn.addEventListener('click', () => {
        if (!selectedFile.path) return;
        if (confirm(`Delete '${path.basename(selectedFile.path)}'?`)) socket.emit('delete-file', { serverName: ui.serverSelect.value, path: selectedFile.path });
    });
    ui.fmUploadBtn.addEventListener('click', () => ui.fmUploadInput.click());
    ui.fmUploadInput.addEventListener('change', e => {
        for (const file of e.target.files) {
            socket.emit('upload-file', { serverName: ui.serverSelect.value, subDir: currentDirectory, fileName: file.name, content: file });
        }
        e.target.value = '';
    });

    // Plugins
    const checkPluginCompatibility = () => {
        const type = serverMeta[ui.serverSelect.value];
        const isCompatible = ['paper', 'spigot', 'purpur'].includes(type);
        ui.pluginNotice.style.display = ui.serverSelect.value && !isCompatible ? 'flex' : 'none';
        ui.pluginEssentialsBtn.disabled = !isCompatible;
        ui.pluginSearchBtn.disabled = !isCompatible;
        ui.pluginSearchInput.disabled = !isCompatible;
    };
    ui.pluginSearchBtn.addEventListener('click', () => ui.pluginSearchInput.value && socket.emit('search-plugins', { query: ui.pluginSearchInput.value }));
    ui.pluginSearchInput.addEventListener('keypress', e => e.key === 'Enter' && ui.pluginSearchBtn.click());
    ui.pluginEssentialsBtn.addEventListener('click', () => { showSection('terminal'); socket.emit('download-essentials', { serverName: ui.serverSelect.value }); });
    ui.pluginSearchResults.addEventListener('click', e => {
        const btn = e.target.closest('.download-btn');
        if (btn) {
            showSection('terminal');
            socket.emit('install-plugin', { serverName: ui.serverSelect.value, pluginId: btn.dataset.pluginId, pluginName: btn.dataset.pluginName });
            btn.disabled = true; btn.textContent = 'Installed';
        }
    });

    // --- Socket Handlers ---
    socket.on('connect', () => console.log('Socket connected!'));
    socket.on('disconnect', () => showAlert('Disconnected from server!'));
    socket.on('existing-servers', ({ servers, activeServer: running, serverMeta: meta }) => {
        const current = ui.serverSelect.value;
        ui.serverSelect.innerHTML = servers.length ? '' : '<option disabled>No servers yet</option>';
        servers.forEach(s => ui.serverSelect.innerHTML += `<option value="${s}">${s}</option>`);
        if (servers.includes(current)) ui.serverSelect.value = current;
        serverMeta = meta;
        activeServer = running;
        updateServerControls();
        checkPluginCompatibility();
    });
    socket.on('version-list', ({ versions }) => {
        ui.versionNameSelect.innerHTML = '';
        versions.forEach(v => {
            const val = typeof v === 'object' ? v.value : v;
            const txt = typeof v === 'object' ? v.text : v;
            ui.versionNameSelect.innerHTML += `<option value="${val}">${txt}</option>`;
        });
        ui.versionNameSelect.disabled = false;
    });
    socket.on('script-started', dir => { activeServer = dir; updateServerControls(); showSection('terminal'); logTo(ui.terminalOutput, `\n--- Server '${dir}' started ---\n`); });
    socket.on('script-stopped', () => { activeServer = null; updateServerControls(); logTo(ui.terminalOutput, `\n--- Server stopped ---\n`); });
    socket.on('terminal-output', msg => logTo(ui.terminalOutput, msg));
    socket.on('creation-status', msg => logTo(ui.creationOutput, msg));
    socket.on('plugin-install-log', msg => { showSection('terminal'); logTo(ui.terminalOutput, msg); });
    socket.on('server-action-error', msg => showAlert(msg, 'error'));
    socket.on('file-list', ({ subDir, files }) => {
        currentDirectory = subDir || '';
        const parts = currentDirectory.split('/').filter(Boolean);
        ui.fmBreadcrumbs.innerHTML = '<span data-path="">/</span>';
        parts.forEach((p, i) => ui.fmBreadcrumbs.innerHTML += ` <span data-path="${parts.slice(0, i + 1).join('/')}">${p}</span> /`);
        ui.fmList.innerHTML = '';
        files.sort((a,b)=>(a.isDirectory===b.isDirectory)?a.name.localeCompare(b.name):a.isDirectory?-1:1).forEach(f=>{
            ui.fmList.innerHTML += `<li class="file-item" data-name="${f.name}" data-type="${f.isDirectory?'directory':'file'}"><i class="fas ${f.isDirectory?'fa-folder':'fa-file-alt'}"></i> ${f.name}</li>`;
        });
        resetEditor();
    });
    socket.on('file-content', ({ content }) => { ui.fmEditor.value = content; ui.fmEditor.disabled = false; });
    socket.on('file-action-success', ({ message, subDir }) => {
        showAlert(message, 'success');
        socket.emit('list-files', { serverName: ui.serverSelect.value, subDir: subDir !== undefined ? subDir : currentDirectory });
    });
    socket.on('plugin-search-results', plugins => {
        ui.pluginSearchResults.innerHTML = !plugins?.length ? '<p>No plugins found.</p>' : '';
        plugins.forEach(p => ui.pluginSearchResults.innerHTML += `<div class="plugin-card"><h4>${p.name}</h4><p class="tagline">${p.tag}</p><button class="btn download-btn" data-plugin-id="${p.id}" data-plugin-name="${p.name}"><i class="fas fa-download"></i> Download</button></div>`);
    });

    // --- Initial Load ---
    showSection('servers');
});
