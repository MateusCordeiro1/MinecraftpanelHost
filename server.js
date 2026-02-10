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
const io = socketIo(server);

const PORT = 3000;
let scriptProcess = null;
let activeServerDir = null;
const playitExecutableName = 'playit-linux-amd64';

// --- API URLs ---
const mojangVersionsUrl = 'https://launchermeta.mojang.com/mc/game/version_manifest.json';
const paperApiUrl = 'https://api.papermc.io/v2/projects/paper';
const spigotApiUrl = 'https://hub.spigotmc.org/versions/';
const forgePromotionsUrl = 'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json';
const forgeMavenUrl = 'https://maven.minecraftforge.net/net/minecraftforge/forge/';
const spigotDownloadUrl = 'https://cdn.getbukkit.org/spigot/spigot-[version].jar';

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// --- Version Fetching Functions ---
async function getVanillaVersions() {
    try {
        const response = await axios.get(mojangVersionsUrl);
        return response.data.versions.map(v => v.id);
    } catch (error) {
        console.error('Error fetching Vanilla versions:', error);
        return [];
    }
}

async function getPaperVersions() {
    try {
        const response = await axios.get(paperApiUrl);
        return response.data.versions.reverse();
    } catch (error) {
        console.error('Error fetching Paper versions:', error);
        return [];
    }
}

async function getSpigotVersions() {
    try {
        const response = await axios.get(spigotApiUrl);
        const regex = /<a href="([0-9]+\.[0-9]+(\.[0-9]+)?)\.json">/g;
        const matches = [...response.data.matchAll(regex)];
        const versions = [...new Set(matches.map(m => m[1]))];
        versions.sort((a, b) => {
            const partsA = a.split('.').map(Number);
            const partsB = b.split('.').map(Number);
            for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
                const partA = partsA[i] || 0;
                const partB = partsB[i] || 0;
                if (partA !== partB) return partB - partA;
            }
            return 0;
        });
        return versions;
    } catch (error) {
        console.error('Error fetching Spigot versions:', error);
        return [];
    }
}

async function getForgeVersions() {
    console.log("Fetching Forge versions from promotions_slim.json...");
    try {
        const response = await axios.get(forgePromotionsUrl);
        const promos = response.data.promos;

        const versions = new Set();
        for (const key in promos) {
            // Key is like "1.20.1-latest" or "1.20.1-recommended"
            // Value is the forge build number, e.g., "47.2.20"
            const mcVersion = key.split('-')[0];
            const forgeBuild = promos[key];
            if (mcVersion && forgeBuild) {
                // This creates the full version string like "1.20.1-47.2.20"
                versions.add(`${mcVersion}-${forgeBuild}`);
            }
        }

        const sortedVersions = Array.from(versions).sort((a, b) => {
            const [mcA, buildA] = a.split('-');
            const [mcB, buildB] = b.split('-');
            const mcPartsA = mcA.split('.').map(Number);
            const mcPartsB = mcB.split('.').map(Number);

            for (let i = 0; i < Math.max(mcPartsA.length, mcPartsB.length); i++) {
                const partA = mcPartsA[i] || 0;
                const partB = mcPartsB[i] || 0;
                if (partA !== partB) return partB - partA; // Sort MC versions descending
            }
            
            if (!buildA || !buildB) return 0; // Handle cases where split might fail

            const buildPartsA = buildA.split('.').map(Number);
            const buildPartsB = buildB.split('.').map(Number);

            for (let i = 0; i < Math.max(buildPartsA.length, buildPartsB.length); i++) {
                 const partA = buildPartsA[i] || 0;
                const partB = buildPartsB[i] || 0;
                if (partA !== partB) return partB - partA; // Sort builds descending
            }

            return 0;
        });

        console.log(`Found ${sortedVersions.length} unique Forge promo versions.`);
        return sortedVersions;
    } catch (error) {
        console.error('Error fetching Forge versions from promotions JSON:', error.message);
        return [];
    }
}


// --- Utility & Initial Data ---
async function getExistingServers() {
    try {
        const entries = await fsp.readdir(__dirname, { withFileTypes: true });
        return entries
            .filter(dirent => dirent.isDirectory() && !['node_modules', 'public', '.git', '.idx'].includes(dirent.name) && !dirent.name.startsWith('.'))
            .map(dirent => dirent.name);
    } catch (error) {
        console.error("Error reading server directories:", error);
        return [];
    }
}

async function sendInitialServerList(socket) {
    try {
        socket.emit('existing-servers', await getExistingServers());
    } catch (error) {
        console.error("Error sending initial server list:", error);
    }
}

// --- Process Management ---
const stopServerProcess = (callback) => {
    if (!scriptProcess) {
        if (callback) callback();
        return;
    }
    io.emit('terminal-output', `\n--- Parando o servidor... ---\n`);
    scriptProcess.kill('SIGKILL');
    const cleanupCommand = `pkill -f java && pkill -f playit`;
    exec(cleanupCommand, () => {
        scriptProcess = null;
        activeServerDir = null;
        io.emit('script-stopped');
        if (callback) callback();
    });
};

const startScriptProcess = (socket, serverDir) => {
    const fullServerDir = path.join(__dirname, serverDir);
    const scriptPath = path.join(fullServerDir, 'start.sh');
    if (!fs.existsSync(scriptPath)) {
        io.emit('terminal-output', `\n--- ERRO: O script 'start.sh' não foi encontrado em '${serverDir}'. ---\n`);
        return;
    }
    activeServerDir = serverDir;
    scriptProcess = spawn('bash', [scriptPath], { cwd: fullServerDir, stdio: 'pipe' });
    io.emit('script-started', serverDir);
    scriptProcess.stdout.on('data', (data) => io.emit('terminal-output', data.toString()));
    scriptProcess.stderr.on('data', (data) => io.emit('terminal-output', `STDERR: ${data.toString()}`));
    scriptProcess.on('close', (code) => {
        io.emit('script-stopped');
        io.emit('terminal-output', `\n--- Processo do servidor finalizado (código: ${code}) ---\n`);
        activeServerDir = null;
        scriptProcess = null;
    });
};

// --- API Endpoints ---
app.delete('/delete/:serverName', async (req, res) => {
    const { serverName } = req.params;
    const serverPath = path.join(__dirname, serverName);
    if (!serverName || serverName.includes('..') || serverName.includes('/')) {
        return res.status(400).json({ success: false, message: 'Nome de servidor inválido.' });
    }
    try {
        await rimraf(serverPath);
        io.emit('existing-servers', await getExistingServers());
        res.json({ success: true, message: `Servidor '${serverName}' deletado.` });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Erro ao deletar a pasta do servidor.' });
    }
});

// --- Socket.IO Handlers ---
io.on('connection', (socket) => {
    console.log('Client connected');
    sendInitialServerList(socket);

    socket.on('get-initial-data', () => sendInitialServerList(socket));

    socket.on('get-versions-for-type', async (serverType) => {
        let versions = [];
        if (serverType === 'vanilla') {
            versions = await getVanillaVersions();
        } else if (serverType === 'paper') {
            versions = await getPaperVersions();
        } else if (serverType === 'spigot') {
            versions = await getSpigotVersions();
        } else if (serverType === 'forge') {
            versions = await getForgeVersions();
        }
        socket.emit('version-list', { type: serverType, versions });
    });

    socket.on('create-server', async ({ serverName, versionName, serverType }) => {
        const serverDir = path.join(__dirname, serverName);
        try {
            socket.emit('creation-status', `Criando diretório: ${serverName}`);
            await fsp.mkdir(serverDir, { recursive: true });

            if (serverType === 'forge') {
                socket.emit('creation-status', `Preparando para baixar o Forge ${versionName}...`);
                
                const installerFilename = `forge-${versionName}-installer.jar`;
                const finalDownloadUrl = `${forgeMavenUrl}${versionName}/forge-${versionName}-installer.jar`;
                const installerPath = path.join(serverDir, installerFilename);

                socket.emit('creation-status', `Baixando o instalador do Forge: ${installerFilename}...`);
                const installerResponse = await axios({ url: finalDownloadUrl, responseType: 'stream' });
                const writer = fs.createWriteStream(installerPath);
                installerResponse.data.pipe(writer);
                await new Promise((resolve, reject) => {
                    writer.on('finish', resolve);
                    writer.on('error', reject);
                });

                socket.emit('creation-status', 'Download do instalador completo. Executando o instalador do servidor...');

                await new Promise((resolve, reject) => {
                    const installerProcess = spawn('java', ['-jar', installerFilename, '--installServer'], { cwd: serverDir });
                    installerProcess.stdout.on('data', (data) => socket.emit('creation-status', data.toString()));
                    installerProcess.stderr.on('data', (data) => socket.emit('creation-status', `ERRO DO INSTALADOR: ${data.toString()}`));
                    installerProcess.on('close', (code) => {
                        if (code === 0) {
                            socket.emit('creation-status', 'Instalador do Forge finalizado com sucesso.');
                            resolve();
                        } else {
                            reject(new Error(`O instalador do Forge falhou com o código ${code}. Verifique o log para mais detalhes.`));
                        }
                    });
                });

                await fsp.unlink(installerPath);

                socket.emit('creation-status', 'Aceitando o EULA...');
                await fsp.writeFile(path.join(serverDir, 'eula.txt'), 'eula=true');

                socket.emit('creation-status', 'Configurando o script de inicialização...');
                
                const runShPath = path.join(serverDir, 'run.sh');
                const startShPath = path.join(serverDir, 'start.sh');
                if (fs.existsSync(runShPath)) {
                     const runShContent = await fsp.readFile(runShPath, 'utf-8');
                     const modifiedStartScript = runShContent.replace(/"\$@"/, 'nogui "\$@"');
                     await fsp.writeFile(startShPath, modifiedStartScript);
                     await fsp.unlink(runShPath);
                } else {
                    const files = await fsp.readdir(serverDir);
                    const forgeJar = files.find(f => f.startsWith('forge-') && f.endsWith('.jar') && f.includes(versionName));
                    if (!forgeJar) throw new Error('Não foi possível encontrar o arquivo JAR do Forge para criar o script de inicialização.');
                    const startScriptContent = `#!/bin/bash\njava -Xms2G -Xmx2G -jar ${forgeJar} nogui`;
                    await fsp.writeFile(startShPath, startScriptContent);
                }
                await fsp.chmod(startShPath, '755');

                const filesToCopy = [playitExecutableName];
                for (const file of filesToCopy) {
                    await fsp.copyFile(path.join(__dirname, file), path.join(serverDir, file));
                    await fsp.chmod(path.join(serverDir, file), '755');
                }

            } else {
                let downloadUrl;
                let jarFilename = 'server.jar';

                if (serverType === 'vanilla') {
                    const response = await axios.get(mojangVersionsUrl);
                    const versionMetaUrl = response.data.versions.find(v => v.id === versionName)?.url;
                    if (!versionMetaUrl) throw new Error(`URL de metadados para Vanilla ${versionName} não encontrada.`);
                    const metaResponse = await axios.get(versionMetaUrl);
                    downloadUrl = metaResponse.data.downloads.server.url;
                } else if (serverType === 'paper') {
                    const buildsResponse = await axios.get(`${paperApiUrl}/versions/${versionName}/builds`);
                    const latestBuild = buildsResponse.data.builds.pop();
                    if (!latestBuild) throw new Error(`Nenhuma compilação encontrada para Paper ${versionName}.`);
                    const buildNumber = latestBuild.build;
                    jarFilename = latestBuild.downloads.application.name;
                    downloadUrl = `${paperApiUrl}/versions/${versionName}/builds/${buildNumber}/downloads/${jarFilename}`;
                } else if (serverType === 'spigot') {
                    jarFilename = `spigot-${versionName}.jar`;
                    downloadUrl = spigotDownloadUrl.replace('[version]', versionName);
                } else {
                    throw new Error('Tipo de servidor não suportado.');
                }
                
                if(!downloadUrl) throw new Error('URL de download do JAR não pôde ser determinada.');

                socket.emit('creation-status', `Baixando ${jarFilename}...`);
                const jarResponse = await axios({ url: downloadUrl, responseType: 'stream' });
                const writer = fs.createWriteStream(path.join(serverDir, jarFilename));
                jarResponse.data.pipe(writer);
                await new Promise((resolve, reject) => {
                    writer.on('finish', resolve);
                    writer.on('error', reject);
                });

                socket.emit('creation-status', 'Download completo. Aceitando EULA...');
                await fsp.writeFile(path.join(serverDir, 'eula.txt'), 'eula=true');

                socket.emit('creation-status', 'Copiando e ajustando arquivos de inicialização...');
                const startScriptContent = `#!/bin/bash\njava -Xms2G -Xmx2G -jar ${jarFilename} nogui`;
                await fsp.writeFile(path.join(serverDir, 'start.sh'), startScriptContent);
                await fsp.chmod(path.join(serverDir, 'start.sh'), '755');
                
                const filesToCopy = [playitExecutableName];
                for (const file of filesToCopy) {
                    await fsp.copyFile(path.join(__dirname, file), path.join(serverDir, file));
                    await fsp.chmod(path.join(serverDir, file), '755');
                }
            }

            socket.emit('creation-status', `\nServidor '${serverName}' criado com sucesso!`);
            io.emit('existing-servers', await getExistingServers());

        } catch (error) {
            console.error('[CREATE-SERVER] FATAL ERROR:', error);
            socket.emit('creation-status', `\nERRO: ${error.message}`);
            try { await rimraf(serverDir); } catch (e) { console.error('Cleanup failed:', e); }
        }
    });
    
    socket.on('start-script', ({ serverDir }) => {
        if (scriptProcess) {
            socket.emit('terminal-output', `\n--- Um servidor já está em execução. Pare-o primeiro. ---\n`);
            return;
        }
        if (!serverDir) {
            socket.emit('terminal-output', `\n--- Por favor, selecione um servidor. ---\n`);
            return;
        }
        startScriptProcess(socket, serverDir);
    });

    socket.on('stop-script', () => {
        if (!scriptProcess) {
             socket.emit('terminal-output', `\n--- Nenhum servidor em execução para parar. ---\n`);
             return;
        }
        stopServerProcess();
    });
    
    socket.on('restart-script', () => {
        if (!scriptProcess || !activeServerDir) {
            socket.emit('terminal-output', `\n--- Nenhum servidor em execução para reiniciar. ---\n`);
            return;
        }
        const serverToRestart = activeServerDir;
        io.emit('terminal-output', `\n--- Reiniciando o servidor '${serverToRestart}'... ---\n`);
        stopServerProcess(() => {
            setTimeout(() => {
                startScriptProcess(socket, serverToRestart);
            }, 1500);
        });
    });
    
    socket.on('terminal-command', (command) => {
        if (scriptProcess && scriptProcess.stdin) {
            scriptProcess.stdin.write(command + "\n");
        } else {
            socket.emit('terminal-output', `\n--- Nenhum servidor em execução para enviar o comando. ---\n`);
        }
    });

    socket.on('disconnect', () => console.log('Client connected'));
});

// --- Server Initialization ---
server.listen(PORT, () => {
  console.log(`Painel de controle iniciado em http://localhost:${PORT}`);
});
