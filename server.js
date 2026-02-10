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
const purpurApiUrl = 'https://api.purpurmc.org/v2/purpur';
const spigotApiUrl = 'https://hub.spigotmc.org/versions/';
const forgePromotionsUrl = 'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json';
const forgeMavenUrl = 'https://maven.minecraftforge.net/net/minecraftforge/forge/';
const neoForgeMavenUrl = 'https://maven.neoforged.net/releases/net/neoforged/neoforge/';
const neoForgeMetadataUrl = `${neoForgeMavenUrl}maven-metadata.xml`;
const spigotDownloadUrl = 'https://cdn.getbukkit.org/spigot/spigot-[version].jar';
const fabricMetaUrl = 'https://meta.fabricmc.net/v2/versions';

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

async function getPurpurVersions() {
    try {
        const response = await axios.get(purpurApiUrl);
        return response.data.versions.reverse();
    } catch (error) {
        console.error('Error fetching Purpur versions:', error);
        return [];
    }
}

async function getSpigotVersions() {
    try {
        const response = await axios.get(spigotApiUrl);
        const regex = /<a href="([0-9]+\.[0-9]+(\.[0-9]+)?)\.json">/g;
        const matches = [...response.data.matchAll(regex)];
        const versions = [...new Set(matches.map(m => m[1]))];
        return versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    } catch (error) {
        console.error('Error fetching Spigot versions:', error);
        return [];
    }
}

async function getForgeVersions() {
    try {
        const response = await axios.get(forgePromotionsUrl);
        const promos = response.data.promos;
        const versions = new Set();
        for (const key in promos) {
            const mcVersion = key.split('-')[0];
            const forgeBuild = promos[key];
            if (mcVersion && forgeBuild) {
                versions.add(`${mcVersion}-${forgeBuild}`);
            }
        }
        return Array.from(versions).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    } catch (error) {
        console.error('Error fetching Forge versions:', error);
        return [];
    }
}

async function getFabricVersions() {
    try {
        const response = await axios.get(`${fabricMetaUrl}/game`);
        return response.data.filter(v => v.stable).map(v => v.version);
    } catch (error) {
        console.error('Error fetching Fabric versions:', error);
        return [];
    }
}

async function getNeoForgeVersions() {
    try {
        const response = await axios.get(neoForgeMetadataUrl);
        const xml = response.data;
        const versionRegex = /<version>(.*?)<\/version>/g;
        const matches = [...xml.matchAll(versionRegex)];
        const versions = matches.map(m => m[1])
            .filter(v => !v.includes('snapshot'))
            .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
        
        return versions.map(version => {
            const parts = version.split('.');
            const mcVersion = `1.${parts[0]}.${parts[1]}`;
            return {
                value: version,
                text: `MC ${mcVersion} (${version})`
            };
        });
    } catch (error) {
        console.error('Error fetching NeoForge versions:', error);
        return [];
    }
}

// --- Utility & Initial Data ---

function getJdkPackage(mcVersion) {
    const versionStr = mcVersion.split('-')[0];
    if (!versionStr) return 'pkgs.jdk17';
    const parts = versionStr.split('.').map(Number);
    if (parts.length < 2) return 'pkgs.jdk17'; 
    if (parts[0] === 1 && parts[1] <= 16) return 'pkgs.jdk8';
    if (parts[0] === 1 && parts[1] >= 21) return 'pkgs.jdk21';
    if (parts[0] > 1) return 'pkgs.jdk21'; // For future MC versions
    return 'pkgs.jdk17';
}

const createStartScript = (javaCommand, jdkPackage) => {
return `#!/bin/bash

chmod +x ./${playitExecutableName} > /dev/null 2>&1

echo "Starting playit.gg tunnel in the background..."
./${playitExecutableName} > /dev/null 2>&1 &
PLAYIT_PID=$!

trap 'echo "Stopping playit.gg tunnel..."; kill $PLAYIT_PID' EXIT

echo "Waiting for the tunnel to start..."
sleep 5

echo "Starting Minecraft server..."

nix-shell -p ${jdkPackage} --run "${javaCommand}"

echo "Minecraft server process has finished."
`;
};

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
        if (serverType === 'vanilla') versions = await getVanillaVersions();
        else if (serverType === 'paper') versions = await getPaperVersions();
        else if (serverType === 'spigot') versions = await getSpigotVersions();
        else if (serverType === 'forge') versions = await getForgeVersions();
        else if (serverType === 'purpur') versions = await getPurpurVersions();
        else if (serverType === 'neoforge') versions = await getNeoForgeVersions();
        else if (serverType === 'fabric') versions = await getFabricVersions();
        socket.emit('version-list', { type: serverType, versions });
    });

    socket.on('create-server', async ({ serverName, versionName, serverType }) => {
        const serverDir = path.join(__dirname, serverName);
        try {
            socket.emit('creation-status', `Criando diretório: ${serverName}`);
            await fsp.mkdir(serverDir, { recursive: true });

            let javaCommand;
            const jdkPackageForRunning = getJdkPackage(versionName);
            socket.emit('creation-status', `JDK para EXECUÇÃO: ${jdkPackageForRunning}.`);

            if (['forge', 'neoforge'].includes(serverType)) {
                const friendlyName = serverType === 'neoforge' ? 'NeoForge' : 'Forge';
                const mavenUrl = serverType === 'neoforge' ? neoForgeMavenUrl : forgeMavenUrl;
                const installerFilename = `${serverType}-${versionName}-installer.jar`;
                const finalDownloadUrl = `${mavenUrl}${versionName}/${installerFilename}`;
                const installerPath = path.join(serverDir, installerFilename);

                socket.emit('creation-status', `Baixando o instalador do ${friendlyName}...`);
                await new Promise((resolve, reject) => {
                    const curl = spawn('curl', ['-L', '-o', installerPath, finalDownloadUrl]);
                    curl.on('close', (code) => code === 0 ? resolve() : reject(new Error(`Falha no download do instalador.`)));
                });

                socket.emit('creation-status', `Executando o instalador do servidor com ${jdkPackageForRunning}...`);
                await new Promise((resolve, reject) => {
                    const installerCmd = `java -jar ${installerFilename} --installServer`;
                    const installerProcess = spawn('nix-shell', ['-p', jdkPackageForRunning, '--run', installerCmd], { cwd: serverDir });
                    installerProcess.stdout.on('data', (data) => socket.emit('creation-status', data.toString()));
                    installerProcess.stderr.on('data', (data) => socket.emit('creation-status', `STDERR: ${data.toString()}`));
                    installerProcess.on('close', (code) => code === 0 ? resolve() : reject(new Error(`O instalador falhou.`)));
                });
                await fsp.unlink(installerPath);

                const runShPath = path.join(serverDir, 'run.sh');
                if (!fs.existsSync(runShPath)) {
                    throw new Error(`A instalação falhou. O script run.sh não foi criado.`);
                }

                if (jdkPackageForRunning === 'pkgs.jdk8') {
                    socket.emit('creation-status', 'Detectado JDK 8. Criando script de arranque compatível (sem @-args).');
                    const runShContent = await fsp.readFile(runShPath, 'utf-8');
                    const argsFileMatch = runShContent.match(/@(libraries\/.*\/unix_args\.txt)/);
                    if (!argsFileMatch || !argsFileMatch[1]) {
                        throw new Error('Não foi possível encontrar o ficheiro de argumentos (unix_args.txt) no script run.sh.');
                    }
                    const argsFilePath = path.join(serverDir, argsFileMatch[1]);
                    if (!fs.existsSync(argsFilePath)) {
                        throw new Error(`O ficheiro de argumentos ${argsFilePath} não foi encontrado.`);
                    }
                    const argsFileContent = await fsp.readFile(argsFilePath, 'utf-8');
                    javaCommand = `java -Xms2G -Xmx4G ${argsFileContent.replace(/\r?\n/g, ' ')} nogui`;
                    await fsp.unlink(runShPath);
                } else {
                    socket.emit('creation-status', 'Detectado JDK moderno. Usando o método de arranque padrão (run.sh).');
                    await fsp.writeFile(path.join(serverDir, 'user_jvm_args.txt'), '-Xms2G -Xmx4G');
                    const runShContent = await fsp.readFile(runShPath, 'utf-8');
                    const modifiedRunShContent = runShContent.replace('"$@"', 'nogui');
                    await fsp.writeFile(runShPath, modifiedRunShContent);
                    javaCommand = './run.sh';
                }

            } else if (serverType === 'fabric') {
                const installerInfo = await axios.get(`${fabricMetaUrl}/installer`);
                const installerUrl = installerInfo.data[0].url;
                const installerFilename = 'fabric-installer.jar';
                const installerPath = path.join(serverDir, installerFilename);

                socket.emit('creation-status', `Baixando o instalador do Fabric...`);
                 await new Promise((resolve, reject) => {
                    const curl = spawn('curl', ['-L', '-o', installerPath, installerUrl]);
                    curl.on('close', (code) => code === 0 ? resolve() : reject(new Error('Falha no download do instalador do Fabric.')));
                });

                socket.emit('creation-status', `Executando o instalador do servidor...`);
                await new Promise((resolve, reject) => {
                    const installerCmd = `java -jar ${installerFilename} server -mcversion ${versionName} -downloadMinecraft`;
                    const installerProcess = spawn('nix-shell', ['-p', jdkPackageForRunning, '--run', installerCmd], { cwd: serverDir });
                    installerProcess.stdout.on('data', (data) => socket.emit('creation-status', data.toString()));
                    installerProcess.stderr.on('data', (data) => socket.emit('creation-status', `STDERR: ${data.toString()}`));
                    installerProcess.on('close', (code) => code === 0 ? resolve() : reject(new Error('O instalador do Fabric falhou.')));
                });

                await fsp.unlink(installerPath);
                const serverJarName = 'fabric-server-launch.jar';
                if (!fs.existsSync(path.join(serverDir, serverJarName))) {
                    throw new Error(`A instalação do Fabric falhou. O ficheiro ${serverJarName} não foi criado.`);
                }
                javaCommand = `java -Xms2G -Xmx4G -jar ${serverJarName} nogui`;

            } else { // Paper, Purpur, Spigot, Vanilla
                let serverJarName = 'server.jar';
                let downloadUrl;

                if (serverType === 'purpur') {
                    serverJarName = `purpur-${versionName}.jar`;
                    downloadUrl = `${purpurApiUrl}/${versionName}/latest/download`;
                } else if (serverType === 'paper') {
                    const buildsResponse = await axios.get(`${paperApiUrl}/versions/${versionName}/builds`);
                    const latestBuild = buildsResponse.data.builds.pop();
                    if (!latestBuild) throw new Error(`Nenhuma compilação encontrada para Paper ${versionName}.`);
                    serverJarName = latestBuild.downloads.application.name;
                    downloadUrl = `${paperApiUrl}/versions/${versionName}/builds/${latestBuild.build}/downloads/${serverJarName}`;
                } else if (serverType === 'vanilla') {
                    const response = await axios.get(mojangVersionsUrl);
                    const versionMetaUrl = response.data.versions.find(v => v.id === versionName)?.url;
                    if (!versionMetaUrl) throw new Error(`URL de metadados para Vanilla ${versionName} não encontrada.`);
                    const metaResponse = await axios.get(versionMetaUrl);
                    downloadUrl = metaResponse.data.downloads.server.url;
                } else if (serverType === 'spigot') {
                    serverJarName = `spigot-${versionName}.jar`;
                    downloadUrl = spigotDownloadUrl.replace('[version]', versionName);
                }

                if (!downloadUrl) throw new Error('URL de download do JAR não pôde ser determinada.');
                
                const finalJarPath = path.join(serverDir, serverJarName);
                socket.emit('creation-status', `Baixando ${serverJarName}...`);
                await new Promise((resolve, reject) => {
                    const curl = spawn('curl', ['-L', '-o', finalJarPath, downloadUrl]);
                    curl.on('close', (code) => code === 0 ? resolve() : reject(new Error('Falha no download do JAR do servidor.')));
                });
                javaCommand = `java -Xms2G -Xmx4G -jar ${serverJarName} nogui`;
            }

            socket.emit('creation-status', 'Aceitando EULA...');
            await fsp.writeFile(path.join(serverDir, 'eula.txt'), 'eula=true');

            socket.emit('creation-status', 'Criando script de inicialização...');
            const startScriptContent = createStartScript(javaCommand, jdkPackageForRunning);
            const startScriptPath = path.join(serverDir, 'start.sh');
            await fsp.writeFile(startScriptPath, startScriptContent);
            await fsp.chmod(startScriptPath, '755');
            
            socket.emit('creation-status', 'Copiando executável do túnel...');
            const playitPath = path.join(__dirname, playitExecutableName);
            if (fs.existsSync(playitPath)) {
                await fsp.copyFile(playitPath, path.join(serverDir, playitExecutableName));
                await fsp.chmod(path.join(serverDir, playitExecutableName), '755');
            } else {
                 socket.emit('creation-status', 'AVISO: O executável playit.gg não foi encontrado.');
            }

            socket.emit('creation-status', `\nServidor '${serverName}' criado com sucesso!`);
            io.emit('existing-servers', await getExistingServers());

        } catch (error) {
            console.error('[CREATE-SERVER] FATAL ERROR:', error);
            socket.emit('creation-status', `\nERRO: ${error.message}\nStack: ${error.stack}`);
            try { await rimraf(serverDir); } catch (e) { console.error('Cleanup failed:', e); }
        }
    });
    
    socket.on('start-script', ({ serverDir }) => {
        if (scriptProcess) {
            socket.emit('terminal-output', `\n--- Um servidor já está em execução. ---\n`);
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
             socket.emit('terminal-output', `\n--- Nenhum servidor em execução. ---\n`);
             return;
        }
        stopServerProcess();
    });
    
    socket.on('restart-script', () => {
        if (!scriptProcess || !activeServerDir) {
            socket.emit('terminal-output', `\n--- Nenhum servidor em execução. ---\n`);
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
            socket.emit('terminal-output', `\n--- Nenhum servidor em execução. ---\n`);
        }
    });

    socket.on('disconnect', () => console.log('Client reconnected'));
});

// --- Server Initialization ---
server.listen(PORT, () => {
  console.log(`Painel de controle iniciado em http://localhost:${PORT}`);
});
