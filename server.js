const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const fsp = require('fs').promises;
const axios = require('axios');
const { rimraf } = require('rimraf');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    maxHttpBufferSize: 1e8 // 100 MB
});

const PORT = 3000;
let scriptProcess = null;
let activeServerDir = null;
const playitExecutableName = 'playit-linux-amd64';

// --- API URLs ---
const spigetApiUrl = 'https://api.spiget.org/v2';
const mojangVersionsUrl = 'https://launchermeta.mojang.com/mc/game/version_manifest.json';
const paperApiUrl = 'https://api.papermc.io/v2/projects/paper';
const purpurApiUrl = 'https://api.purpurmc.org/v2/purpur';
const spigotApiUrl = 'https://hub.spigotmc.org/versions/';
const spigotBuildToolsUrl = 'https://hub.spigotmc.org/jenkins/job/BuildTools/lastSuccessfulBuild/artifact/target/BuildTools.jar';
const forgePromotionsUrl = 'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json';
const forgeMavenUrl = 'https://maven.minecraftforge.net/net/minecraftforge/forge/';
const neoForgeMavenUrl = 'https://maven.neoforged.net/releases/net/neoforged/neoforge/';
const neoForgeMetadataUrl = `${neoForgeMavenUrl}maven-metadata.xml`;
const fabricMetaUrl = 'https://meta.fabricmc.net/v2/versions';

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '100mb' }));

// --- Helper Functions ---
const runCommand = (socket, command, args, cwd, outputEvent = 'creation-status') => {
    return new Promise((resolve, reject) => {
        const proc = spawn(command, args, { cwd, shell: true });
        const sendStatus = (msg) => socket.emit(outputEvent, msg);
        proc.stdout.on('data', (data) => sendStatus(data.toString()));
        proc.stderr.on('data', (data) => sendStatus(data.toString()));
        proc.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`Command failed with code ${code}: ${command} ${args.join(' ')}`));
        });
        proc.on('error', (err) => reject(err));
    });
};

async function downloadFile(url, destPath, socket, outputEvent = 'creation-status') {
    const sendStatus = (msg) => socket.emit(outputEvent, msg);
    sendStatus(`Downloading from ${url}...\n`);
    try {
        await runCommand(socket, 'curl', ['-fL', '-o', destPath, url], __dirname, outputEvent);
    } catch (e) {
        throw new Error(`Failed to download file from ${url}. Please check the URL and your connection.`);
    }
}

async function getExistingServers() {
    try {
        const entries = await fsp.readdir(__dirname, { withFileTypes: true });
        return entries
            .filter(dirent => dirent.isDirectory() && fs.existsSync(path.join(__dirname, dirent.name, 'server-meta.json')))
            .map(dirent => dirent.name);
    } catch (error) {
        console.error("Error reading server directories:", error);
        return [];
    }
}

async function getExistingServerMeta() {
    const servers = await getExistingServers();
    const meta = {};
    for (const serverName of servers) {
        try {
            const data = await fsp.readFile(path.join(__dirname, serverName, 'server-meta.json'), 'utf8');
            meta[serverName] = JSON.parse(data).type;
        } catch (e) {
            meta[serverName] = 'unknown';
        }
    }
    return meta;
}

// --- Version Fetching ---
async function getVanillaVersions() { const r = await axios.get(mojangVersionsUrl); return r.data.versions.map(v => v.id); }
async function getPaperVersions() { const r = await axios.get(paperApiUrl); return r.data.versions.reverse(); }
async function getPurpurVersions() { const r = await axios.get(purpurApiUrl); return r.data.versions.reverse(); }
async function getSpigotVersions() { const r = await axios.get(spigotApiUrl); const m = [...r.data.matchAll(/<a href="([0-9]+\.[0-9]+(\.[0-9]+)?)">/g)]; return [...new Set(m.map(i => i[1]))].sort((a, b) => b.localeCompare(a, undefined, { numeric: true })); }
async function getForgeVersions() { const r = await axios.get(forgePromotionsUrl); const p = r.data.promos, v = new Set(); for (const k in p) { const [mc, f] = [k.split('-')[0], p[k]]; if (mc && f) v.add(`${mc}-${f}`); } return Array.from(v).sort((a, b) => b.localeCompare(a, undefined, { numeric: true })); }
async function getFabricVersions() { const r = await axios.get(`${fabricMetaUrl}/game`); return r.data.filter(v => v.stable).map(v => v.version); }
async function getNeoForgeVersions() { const r = await axios.get(neoForgeMetadataUrl); const m = [...r.data.matchAll(/<version>(.*?)<\/version>/g)]; return m.map(i => i[1]).filter(v => !v.includes('snapshot')).sort((a, b) => b.localeCompare(a, undefined, { numeric: true })).map(v => ({ value: v, text: v })); }

// --- JDK & Start Script Logic ---
function getJdkPackage(versionName, forBuildTools = false) {
    if (forBuildTools) return 'pkgs.jdk17_headless';
    const versionStr = versionName.split('-')[0];
    const parts = versionStr.split('.').map(Number);
    if (parts.some(isNaN)) return 'pkgs.jdk17_headless';
    if (parts.length > 1 && parts[0] === 1) { // 1.x.x format
        if (parts[1] >= 21) return 'pkgs.jdk21_headless'; // 1.21+
        if (parts[1] === 20 && parts.length > 2 && parts[2] >= 5) return 'pkgs.jdk21_headless'; // 1.20.5+
        if (parts[1] >= 17) return 'pkgs.jdk17_headless'; // 1.17 - 1.20.4
        return 'pkgs.jdk8_headless'; // < 1.17
    }
    return 'pkgs.jdk17_headless'; // Fallback for other formats
}

const createStartScript = (javaCmd, jdk, rootDir) => `#!/bin/bash\n# Autogenerated script for MC Panel\n\nABSOLUTE_PLAYIT_PATH=${path.resolve(rootDir, playitExecutableName)}\n\nchmod +x \"$ABSOLUTE_PLAYIT_PATH\"\n\necho \"Starting playit.gg tunnel...\"\n\"$ABSOLUTE_PLAYIT_PATH\" > /dev/null 2>&1 &\nPLAYIT_PID=$!\n\ntrap 'echo \"Stopping server and playit.gg tunnel...\"; kill $PLAYIT_PID; exit' SIGINT SIGTERM\n\necho \"Waiting for tunnel...\"\nsleep 5\n\necho \"Starting Minecraft server...\"\nnix-shell -p ${jdk} --run \"${javaCmd}\"\n`;

// --- Server Installation Logic ---
async function installVanilla(d, v, r, s) { const j = 'server.jar'; const m = await axios.get(mojangVersionsUrl); const u = m.data.versions.find(i => i.id === v)?.url; if (!u) throw new Error('Version metadata not found'); const mu = await axios.get(u); await downloadFile(mu.data.downloads.server.url, path.join(d, j), s); return `java -Xms${r}G -Xmx${r}G -jar ${j} nogui`; }
async function installPaper(d, v, r, s) { const b = await axios.get(`${paperApiUrl}/versions/${v}/builds`); const l = b.data.builds.pop(); if (!l) throw new Error('No builds found'); const n = l.downloads.application.name; const u = `${paperApiUrl}/versions/${v}/builds/${l.build}/downloads/${n}`; await downloadFile(u, path.join(d, n), s); return `java -Xms${r}G -Xmx${r}G -jar ${n} nogui`; }
async function installPurpur(d, v, r, s) { const n = `purpur-${v}.jar`; const u = `${purpurApiUrl}/${v}/latest/download`; await downloadFile(u, path.join(d, n), s); return `java -Xms${r}G -Xmx${r}G -jar ${n} nogui`; }
async function installSpigot(d, v, r, s) { s.emit('creation-status', '--- Starting Spigot BuildTools (this may take several minutes)...\n'); const j = 'BuildTools.jar'; await downloadFile(spigotBuildToolsUrl, path.join(d, j), s); const c = `nix-shell -p ${getJdkPackage(v, true)} pkgs.git --run "java -jar ${j} --rev ${v}"`; await runCommand(s, c, [], d); const n = `spigot-${v}.jar`; if (!fs.existsSync(path.join(d, n))) throw new Error('BuildTools did not create the server JAR. Build may have failed.'); return `java -Xms${r}G -Xmx${r}G -jar ${n} nogui`; }
async function installFabric(d, v, r, s) { s.emit('creation-status', '--- Starting Fabric Installer...\n'); const m = await axios.get(`${fabricMetaUrl}/installer`); const u = m.data[0]?.url; if (!u) throw new Error('Could not get Fabric installer URL'); const i = 'fabric-installer.jar'; await downloadFile(u, path.join(d, i), s); const c = `nix-shell -p ${getJdkPackage(v)} --run "java -jar ${i} server -mcversion ${v} -downloadMinecraft"`; await runCommand(s, c, [], d); const l = 'fabric-server-launch.jar'; if (!fs.existsSync(path.join(d, l))) throw new Error('Fabric installer failed to create the launch JAR.'); return `java -Xms${r}G -Xmx${r}G -jar ${l} nogui`; }
async function installForge(d, v, r, s) { s.emit('creation-status', '--- Starting Forge Installer...\n'); const [mc, fv] = v.split('-'); const u = `${forgeMavenUrl}${mc}-${fv}/forge-${mc}-${fv}-installer.jar`; const i = `forge-${v}-installer.jar`; await downloadFile(u, path.join(d, i), s); const c = `nix-shell -p ${getJdkPackage(mc)} --run "java -jar ${i} --installServer"`; await runCommand(s, c, [], d); const runSh = path.join(d, 'run.sh'); if (!fs.existsSync(runSh)) throw new Error('Forge installer did not create a run.sh script.'); await fsp.chmod(runSh, '755'); return './run.sh nogui'; }
async function installNeoForge(d, v, r, s) { s.emit('creation-status', '--- Starting NeoForge Installer...\n'); const u = `${neoForgeMavenUrl}${v}/neoforge-${v}-installer.jar`; const i = `neoforge-${v}-installer.jar`; await downloadFile(u, path.join(d, i), s); const c = `nix-shell -p ${getJdkPackage(v)} --run "java -jar ${i} --installServer"`; await runCommand(s, c, [], d); const runSh = path.join(d, 'run.sh'); if (!fs.existsSync(runSh)) throw new Error('NeoForge installer did not create a run.sh script.'); await fsp.chmod(runSh, '755'); return './run.sh --nogui'; }

// --- Socket.IO Connection ---
io.on('connection', (socket) => {
    console.log('Client connected');

    const refreshServers = async () => {
        const servers = await getExistingServers();
        const serverMeta = await getExistingServerMeta();
        io.emit('existing-servers', { servers, activeServer: activeServerDir, serverMeta });
    };
    
    refreshServers();

    socket.on('get-versions-for-type', async (type) => {
        try {
            const fetchers = {vanilla: getVanillaVersions, paper: getPaperVersions, spigot: getSpigotVersions, forge: getForgeVersions, purpur: getPurpurVersions, neoforge: getNeoForgeVersions, fabric: getFabricVersions};
            const versions = await fetchers[type]();
            socket.emit('version-list', { type, versions });
        } catch(e) { socket.emit('server-action-error', `Failed to fetch versions: ${e.message}`); }
    });

    socket.on('create-server', async ({ serverName, versionName, serverType, ram }) => {
        if (!serverName || !versionName || !serverType) return socket.emit('creation-status', '\n--- Invalid creation data. ---\n');
        const serverDir = path.join(__dirname, serverName);
        const sendStatus = (msg) => socket.emit('creation-status', msg);
        try {
            if (fs.existsSync(serverDir)) throw new Error(`Directory '${serverName}' already exists.`);
            sendStatus(`Creating server directory for '${serverName}'...\n`);
            await fsp.mkdir(serverDir, { recursive: true });
            
            const installers = {vanilla:installVanilla, paper:installPaper, purpur:installPurpur, spigot:installSpigot, fabric:installFabric, forge:installForge, neoforge:installNeoForge};
            const javaCommand = await installers[serverType](serverDir, versionName, ram || '2', socket);
            
            await fsp.writeFile(path.join(serverDir, 'eula.txt'), 'eula=true\n');
            const startScript = createStartScript(javaCommand, getJdkPackage(versionName), __dirname);
            await fsp.writeFile(path.join(serverDir, 'start.sh'), startScript, { mode: 0o755 });
            await fsp.writeFile(path.join(serverDir, 'server-meta.json'), JSON.stringify({ type: serverType, version: versionName }));

            sendStatus(`\nSUCCESS: Server '${serverName}' created successfully!`);
            refreshServers();
        } catch (error) {
            sendStatus(`\n--- FATAL ERROR ---\n${error.message}\nCleaning up failed directory...\n`);
            await rimraf(serverDir).catch(e => sendStatus(`Cleanup failed: ${e.message}\n`));
            refreshServers();
        }
    });

    socket.on('delete-server', async ({ serverName }) => {
        if (!serverName || activeServerDir === serverName) return socket.emit('server-action-error', 'Cannot delete a running or non-existent server.');
        try {
            await rimraf(path.join(__dirname, serverName));
            socket.emit('server-action-success', `Server '${serverName}' deleted.`);
            refreshServers();
        } catch(e){ socket.emit('server-action-error', `Error deleting: ${e.message}`); }
    });

    socket.on('rename-server', async ({ oldName, newName }) => {
        if (!oldName || !newName || activeServerDir === oldName || fs.existsSync(path.join(__dirname, newName))) return socket.emit('server-action-error', 'Invalid request for rename.');
        try {
            await fsp.rename(path.join(__dirname, oldName), path.join(__dirname, newName));
            socket.emit('server-action-success', `Renamed '${oldName}' to '${newName}'.`);
            refreshServers();
        } catch(e){ socket.emit('server-action-error', `Error renaming: ${e.message}`); }
    });

    // --- Process Management ---
    const stopServerProcess = (cb) => {
        if (!scriptProcess) return cb && cb();
        io.emit('terminal-output', '\n--- Sending stop command to server process... ---');
        scriptProcess.kill('SIGTERM');
        const timer = setTimeout(() => {
            io.emit('terminal-output', '\n--- Process did not exit gracefully, killing... ---');
            scriptProcess.kill('SIGKILL');
        }, 8000);
        scriptProcess.on('close', () => {
            clearTimeout(timer);
            exec(`pkill -f "${playitExecutableName}"`, () => { // Ensure playit is also stopped
                scriptProcess = null;
                activeServerDir = null;
                io.emit('script-stopped');
                if (cb) cb();
            });
        });
    };

    const startScriptProcess = (serverDir) => {
        if (scriptProcess) return io.emit('terminal-output', 'A server is already running.\n');
        const script = path.join(__dirname, serverDir, 'start.sh');
        if (!fs.existsSync(script)) return io.emit('terminal-output', `ERROR: start.sh not found for server '${serverDir}'.\n`);
        
        activeServerDir = serverDir;
        scriptProcess = spawn('bash', [script], { cwd: path.join(__dirname, serverDir) });
        io.emit('script-started', serverDir);
        scriptProcess.stdout.on('data', d => io.emit('terminal-output', d.toString()));
        scriptProcess.stderr.on('data', d => io.emit('terminal-output', `STDERR: ${d.toString()}`));
        scriptProcess.on('close', code => {
            io.emit('script-stopped');
            io.emit('terminal-output', `\n--- Server process exited with code: ${code} ---\n`);
            activeServerDir = null;
            scriptProcess = null;
        });
    };

    socket.on('start-script', ({ serverDir }) => startScriptProcess(serverDir));
    socket.on('stop-script', () => stopServerProcess());
    socket.on('restart-script', () => { if (!activeServerDir) return; const dir = activeServerDir; stopServerProcess(() => setTimeout(() => startScriptProcess(dir), 1000)); });
    socket.on('terminal-command', (cmd) => { if (scriptProcess) scriptProcess.stdin.write(cmd + '\n'); });

    // --- File Management ---
    const isValidPath = (serverName, ...paths) => {
        const serverPath = path.resolve(__dirname, serverName);
        const requestedPath = path.resolve(serverPath, ...paths);
        return requestedPath.startsWith(serverPath);
    }

    socket.on('list-files', async ({ serverName, subDir }) => { try { if (!isValidPath(serverName, subDir || '')) throw new Error('Invalid path'); const p = path.join(__dirname, serverName, subDir || ''); const files = (await fsp.readdir(p, {withFileTypes:true})).map(e=>({name:e.name, isDirectory:e.isDirectory()})); socket.emit('file-list', { serverName, subDir, files }); } catch(e){ socket.emit('server-action-error', e.message); } });
    socket.on('get-file-content', async ({ serverName, filePath }) => { try { if (!isValidPath(serverName, filePath)) throw new Error('Invalid path'); const p = path.join(__dirname, serverName, filePath); const content = await fsp.readFile(p, 'utf-8'); socket.emit('file-content', { filePath, content }); } catch(e){ socket.emit('server-action-error', e.message); } });
    socket.on('save-file-content', async ({ serverName, filePath, content }) => { try { if (!isValidPath(serverName, filePath)) throw new Error('Invalid path'); const p = path.join(__dirname, serverName, filePath); await fsp.writeFile(p, content, 'utf-8'); socket.emit('file-action-success', { message: `Saved ${path.basename(filePath)}` }); } catch(e){ socket.emit('server-action-error', e.message); } });
    socket.on('upload-file', async ({ serverName, subDir, fileName, content }) => { try { if (!isValidPath(serverName, subDir)) throw new Error('Invalid path'); const safeName = path.basename(fileName); const p = path.join(__dirname, serverName, subDir, safeName); await fsp.writeFile(p, Buffer.from(content)); socket.emit('file-action-success', { message: `Uploaded ${safeName}`, subDir }); } catch (e) { socket.emit('server-action-error', e.message); } });
    socket.on('rename-file', async ({ serverName, subDir, oldName, newName }) => { try { if (!isValidPath(serverName, subDir, oldName) || !isValidPath(serverName, subDir, newName)) throw new Error('Invalid name'); const p = path.join(__dirname, serverName, subDir); await fsp.rename(path.join(p, oldName), path.join(p, newName)); socket.emit('file-action-success', { message: `Renamed to ${newName}`, subDir }); } catch (e) { socket.emit('server-action-error', e.message); } });
    socket.on('delete-file', async ({ serverName, path: itemPath }) => { try { if (!isValidPath(serverName, itemPath)) throw new Error('Invalid path'); await rimraf(path.join(__dirname, serverName, itemPath)); socket.emit('file-action-success', { message: `Deleted ${path.basename(itemPath)}`, subDir: path.dirname(itemPath) }); } catch (e) { socket.emit('server-action-error', e.message); } });

    // --- Plugin Management ---
    const installPlugin = async (server, id, name) => { const log = m => socket.emit('plugin-install-log', m); try { const p = path.join(__dirname, server, 'plugins'); await fsp.mkdir(p, { recursive: true }); await downloadFile(`${spigetApiUrl}/resources/${id}/download`, path.join(p, `${name.replace(/[^a-zA-Z0-9_.-]/g, '')}.jar`), socket, 'plugin-install-log'); log(`Successfully installed ${name}\n`); } catch(e){ log(`--- ERROR installing ${name}: ${e.message} ---\n`); } };
    socket.on('search-plugins', async ({ query }) => { try { const r = await axios.get(`${spigetApiUrl}/search/resources/${encodeURIComponent(query)}?field=name&sort=-downloads`); socket.emit('plugin-search-results', r.data.map(p=>({id:p.id, name:p.name, tag:p.tag}))); } catch (e) { socket.emit('plugin-search-results', []); } });
    socket.on('install-plugin', async ({ serverName, pluginId, pluginName }) => installPlugin(serverName, pluginId, pluginName));
    socket.on('download-essentials', async ({ serverName }) => { logToTerminal('--- Downloading essential plugins (LuckPerms, Vault) ---\n'); for (const [name, id] of Object.entries({"LuckPerms":28140, "Vault":34315})) await installPlugin(serverName, id, name); logToTerminal('--- Finished essential plugin download ---\n'); });

    socket.on('disconnect', () => console.log('Client disconnected'));
});

server.listen(PORT, () => console.log(`MC Panel is live on http://localhost:${PORT}`));
