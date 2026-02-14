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
const runCommand = (socket, command, args, cwd) => {
    return new Promise((resolve, reject) => {
        const proc = spawn(command, args, { cwd, shell: true });
        const sendStatus = (msg) => socket.emit('creation-status', msg);

        proc.stdout.on('data', (data) => sendStatus(data.toString()));
        proc.stderr.on('data', (data) => sendStatus(data.toString()));

        proc.on('close', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`Command failed with code ${code}: ${command} ${args.join(' ')}`));
            }
        });
        proc.on('error', (err) => reject(err));
    });
};

async function downloadFile(url, destPath, socket) {
    const sendStatus = (msg) => socket.emit('creation-status', msg);
    sendStatus(`Downloading from ${url}...\n`);
    await runCommand(socket, 'curl', ['-L', '-o', destPath, url], __dirname);
}

// --- Version Fetching ---
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
        const regex = /<a href="([0-9]+\.[0-9]+(\.[0-9]+)?)">/g;
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
            if (parts.length < 3) return { value: version, text: version };
            const mcVersion = `1.${parts[0]}.${parts[1]}`;
            if (parseInt(parts[0]) > 1) {
                 return { value: version, text: `MC 1.${version}` };
            }
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

// --- JDK & Start Script Logic ---
function getJdkPackage(mcVersion, forBuildTools = false) {
    if (forBuildTools) {
        return 'pkgs.jdk17_headless';
    }

    const versionStr = mcVersion.split('-')[0];
    const parts = versionStr.split('.').map(Number);

    if (parts.some(isNaN)) {
        console.warn(`Could not parse version: ${mcVersion}. Defaulting to jdk17.`);
        return 'pkgs.jdk17_headless';
    }

    // New format (NeoForge, e.g., "21.0.30")
    if (parts.length > 0 && parts[0] > 1) {
        if (parts[0] >= 21) return 'pkgs.jdk21_headless'; // For MC 1.21+
        if (parts[0] === 20 && parts.length > 1 && parts[1] >= 5) return 'pkgs.jdk21_headless'; // For MC 1.20.5+
        return 'pkgs.jdk17_headless'; // For MC 1.20.4 and below
    }

    // Classic format (e.g., "1.20.5")
    if (parts.length > 1 && parts[0] === 1) {
        if (parts[1] < 17) return 'pkgs.jdk8_headless';   // MC < 1.17
        if (parts[1] < 20) return 'pkgs.jdk17_headless';  // MC 1.17 - 1.19
        if (parts[1] === 20) {
            if (parts.length > 2 && parts[2] >= 5) return 'pkgs.jdk21_headless'; // MC 1.20.5+
            return 'pkgs.jdk17_headless'; // MC 1.20.0 - 1.20.4
        }
        if (parts[1] >= 21) return 'pkgs.jdk21_headless'; // MC 1.21+
    }

    return 'pkgs.jdk17_headless'; // Fallback
}

const createStartScript = (javaCommand, jdkPackage, projectRoot) => {
    const absolutePlayitPath = path.resolve(projectRoot, playitExecutableName);
    return `#!/bin/bash\n# Script to run a Minecraft server with a playit.gg tunnel\n\necho "Starting playit.gg tunnel in the background..."\n${absolutePlayitPath} > /dev/null 2>&1 &\nPLAYIT_PID=$!\n\ntrap 'echo "Stopping playit.gg tunnel..."; kill $PLAYIT_PID' EXIT\n\necho "Waiting for the tunnel to establish..."\nsleep 5\n\necho "Starting Minecraft server..."\nnix-shell -p ${jdkPackage} --run "${javaCommand}"\n\necho "Minecraft server process has finished."\n`;
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

// --- Server Installation Logic ---
async function installVanilla(serverDir, versionName, ram, socket) {
    const serverJarName = 'server.jar';
    const response = await axios.get(mojangVersionsUrl);
    const versionMetaUrl = response.data.versions.find(v => v.id === versionName)?.url;
    if (!versionMetaUrl) throw new Error(`Metadata for Vanilla ${versionName} not found.`);
    const metaResponse = await axios.get(versionMetaUrl);
    await downloadFile(metaResponse.data.downloads.server.url, path.join(serverDir, serverJarName), socket);
    return `java -Xms${ram}G -Xmx${ram}G -jar ${serverJarName} nogui`;
}

async function installPaper(serverDir, versionName, ram, socket) {
    const buildsResponse = await axios.get(`${paperApiUrl}/versions/${versionName}/builds`);
    const latestBuild = buildsResponse.data.builds.pop();
    if (!latestBuild) throw new Error(`No builds for Paper ${versionName} found.`);
    const serverJarName = latestBuild.downloads.application.name;
    const downloadUrl = `${paperApiUrl}/versions/${versionName}/builds/${latestBuild.build}/downloads/${serverJarName}`;
    await downloadFile(downloadUrl, path.join(serverDir, serverJarName), socket);
    return `java -Xms${ram}G -Xmx${ram}G -jar ${serverJarName} nogui`;
}

async function installPurpur(serverDir, versionName, ram, socket) {
    const serverJarName = `purpur-${versionName}.jar`;
    const downloadUrl = `${purpurApiUrl}/${versionName}/latest/download`;
    await downloadFile(downloadUrl, path.join(serverDir, serverJarName), socket);
    return `java -Xms${ram}G -Xmx${ram}G -jar ${serverJarName} nogui`;
}

async function installSpigot(serverDir, versionName, ram, socket) {
    socket.emit('creation-status', '--- Starting Spigot BuildTools ---\nThis will take a while...\n');
    const buildToolsJar = 'BuildTools.jar';
    await downloadFile(spigotBuildToolsUrl, path.join(serverDir, buildToolsJar), socket);
    const buildJdk = getJdkPackage(versionName, true);
    socket.emit('creation-status', `Using ${buildJdk} to run BuildTools...\n`);
    const command = `nix-shell -p ${buildJdk} pkgs.git --run "java -jar ${buildToolsJar} --rev ${versionName}"`;
    await runCommand(socket, command, [], serverDir);
    const serverJarName = `spigot-${versionName}.jar`;
    if (!fs.existsSync(path.join(serverDir, serverJarName))) {
        throw new Error('BuildTools did not create the Spigot JAR.');
    }
    return `java -Xms${ram}G -Xmx${ram}G -jar ${serverJarName} nogui`;
}

async function installFabric(serverDir, versionName, ram, socket) {
    socket.emit('creation-status', '--- Starting Fabric Installer ---\n');
    const installerMeta = await axios.get(`${fabricMetaUrl}/installer`);
    const installerUrl = installerMeta.data[0]?.url;
    if (!installerUrl) throw new Error('Could not fetch Fabric installer URL.');
    const installerJar = 'fabric-installer.jar';
    await downloadFile(installerUrl, path.join(serverDir, installerJar), socket);
    const installJdk = getJdkPackage(versionName);
    const command = `nix-shell -p ${installJdk} --run "java -jar ${installerJar} server -mcversion ${versionName} -downloadMinecraft"`;
    await runCommand(socket, command, [], serverDir);
    const serverLaunchJar = 'fabric-server-launch.jar';
    if (!fs.existsSync(path.join(serverDir, serverLaunchJar))) {
        throw new Error('Fabric installer did not create the launch JAR.');
    }
    return `java -Xms${ram}G -Xmx${ram}G -jar ${serverLaunchJar} nogui`;
}

async function installForge(serverDir, versionName, ram, socket) {
    socket.emit('creation-status', '--- Starting Forge Installer ---\n');
    const [mcVersion, forgeVersion] = versionName.split('-');
    const installerUrl = `${forgeMavenUrl}${mcVersion}-${forgeVersion}/forge-${mcVersion}-${forgeVersion}-installer.jar`;
    const installerJar = `forge-${versionName}-installer.jar`;
    await downloadFile(installerUrl, path.join(serverDir, installerJar), socket);
    const installJdk = getJdkPackage(mcVersion);
    const command = `nix-shell -p ${installJdk} --run "java -jar ${installerJar} --installServer"`;
    await runCommand(socket, command, [], serverDir);
    const runScript = path.join(serverDir, 'run.sh');
    if (!fs.existsSync(runScript)) {
        throw new Error('Forge installer did not create a run.sh script.');
    }
    await fsp.chmod(runScript, '755');
    return './run.sh nogui';
}

async function installNeoForge(serverDir, versionName, ram, socket) {
    socket.emit('creation-status', '--- Starting NeoForge Installer ---\n');
    const installerUrl = `${neoForgeMavenUrl}${versionName}/neoforge-${versionName}-installer.jar`;
    const installerJar = `neoforge-${versionName}-installer.jar`;
    await downloadFile(installerUrl, path.join(serverDir, installerJar), socket);
    const installJdk = getJdkPackage(versionName);
    const command = `nix-shell -p ${installJdk} --run "java -jar ${installerJar} --installServer"`;
    await runCommand(socket, command, [], serverDir);
    const runScript = path.join(serverDir, 'run.sh');
    if (!fs.existsSync(runScript)) {
        throw new Error('NeoForge installer did not create a run.sh script.');
    }
    await fsp.chmod(runScript, '755');
    return './run.sh --nogui';
}


// --- Main Socket Handler ---
io.on('connection', (socket) => {
    console.log('Client connected');

    const refreshServers = async () => {
        const servers = await getExistingServers();
        io.emit('existing-servers', { servers, activeServer: activeServerDir });
    };
    
    refreshServers(); // Initial send

    socket.on('get-servers', refreshServers);

    socket.on('get-versions-for-type', async (serverType) => {
        try {
            const versionFetchers = {
                vanilla: getVanillaVersions,
                paper: getPaperVersions,
                spigot: getSpigotVersions,
                forge: getForgeVersions,
                purpur: getPurpurVersions,
                neoforge: getNeoForgeVersions,
                fabric: getFabricVersions
            };
            const versions = await versionFetchers[serverType]();
            socket.emit('version-list', { type: serverType, versions });
        } catch (error) {
            socket.emit('server-action-error', `Failed to fetch versions: ${error.message}`);
        }
    });

    socket.on('create-server', async ({ serverName, versionName, serverType, ram }) => {
        const serverDir = path.join(__dirname, serverName);
        const ramAlloc = ram || '2';
        const sendStatus = (msg) => socket.emit('creation-status', msg);

        try {
            sendStatus(`Creating '${serverName}'\nType: ${serverType}, Version: ${versionName}\n`);
            await fsp.mkdir(serverDir, { recursive: true });

            const runtimeJdk = getJdkPackage(versionName);
            sendStatus(`Runtime JDK will be: ${runtimeJdk}\n`);

            const installers = {
                vanilla: installVanilla,
                paper: installPaper,
                purpur: installPurpur,
                spigot: installSpigot,
                fabric: installFabric,
                forge: installForge,
                neoforge: installNeoForge
            };
            if (!installers[serverType]) throw new Error(`Unknown server type: ${serverType}`);
            const javaCommand = await installers[serverType](serverDir, versionName, ramAlloc, socket);

            sendStatus('\nAccepting Minecraft EULA...\n');
            await fsp.writeFile(path.join(serverDir, 'eula.txt'), 'eula=true\n');

            sendStatus('Creating start.sh script...\n');
            const startScriptContent = createStartScript(javaCommand, runtimeJdk, __dirname);
            await fsp.writeFile(path.join(serverDir, 'start.sh'), startScriptContent, { mode: 0o755 });

            sendStatus(`\nSUCCESS: Server '${serverName}' created!`);
            refreshServers();

        } catch (error) {
            console.error('[CREATE-SERVER] FATAL ERROR:', error);
            sendStatus(`\n--- FATAL ERROR ---\n${error.message}\n${error.stack || ''}\n\n`);
            sendStatus('Attempting to clean up...\n');
            try {
                await rimraf(serverDir);
                sendStatus('Cleanup successful.\n');
            } catch (e) {
                console.error('Cleanup failed:', e);
                sendStatus('Cleanup failed. You may need to delete the directory manually.\n');
            }
        }
    });

    socket.on('delete-server', async ({ serverName }) => {
        if (!serverName || serverName.includes('..') || serverName.includes('/')) {
            return socket.emit('server-action-error', 'Invalid server name.');
        }
        if (activeServerDir === serverName) {
            return socket.emit('server-action-error', 'Cannot delete a running server. Please stop it first.');
        }
        try {
            await rimraf(path.join(__dirname, serverName));
            socket.emit('server-action-success', `Server '${serverName}' was successfully deleted.`);
            refreshServers();
        } catch (error) {
            console.error(`Error deleting server ${serverName}:`, error);
            socket.emit('server-action-error', `Failed to delete server: ${error.message}`);
        }
    });

    socket.on('rename-server', async ({ oldServerName, newServerName }) => {
        const invalidName = (name) => !name || name.includes('..') || name.includes('/');
        if (invalidName(oldServerName) || invalidName(newServerName)) {
            return socket.emit('server-action-error', 'Invalid server name provided.');
        }
        if (activeServerDir === oldServerName) {
            return socket.emit('server-action-error', 'Cannot rename a running server. Please stop it first.');
        }
        try {
            const oldPath = path.join(__dirname, oldServerName);
            const newPath = path.join(__dirname, newServerName);
            await fsp.rename(oldPath, newPath);
            socket.emit('server-action-success', `Server '${oldServerName}' was renamed to '${newServerName}'.`);
            refreshServers();
        } catch (error) {
            console.error(`Error renaming server:`, error);
            socket.emit('server-action-error', `Failed to rename server: ${error.message}`);
        }
    });

    // --- Process Management ---
    const stopServerProcess = (callback) => {
        if (!scriptProcess) {
            if (callback) callback();
            return;
        }
        io.emit('terminal-output', `\n--- Stopping server... ---\n`);
        scriptProcess.kill('SIGKILL');
        const cleanupCommand = `pkill -f java && pkill -f "${playitExecutableName}"`;
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
            io.emit('terminal-output', `\n--- ERROR: 'start.sh' not found in '${serverDir}'. ---\n`);
            return;
        }
        activeServerDir = serverDir;
        scriptProcess = spawn('bash', [scriptPath], { cwd: fullServerDir, stdio: 'pipe' });
        io.emit('script-started', serverDir);
        scriptProcess.stdout.on('data', (data) => io.emit('terminal-output', data.toString()));
        scriptProcess.stderr.on('data', (data) => io.emit('terminal-output', `STDERR: ${data.toString()}`));
        scriptProcess.on('close', (code) => {
            io.emit('script-stopped');
            io.emit('terminal-output', `\n--- Server process finished (code: ${code}) ---\n`);
            activeServerDir = null;
            scriptProcess = null;
        });
    };

    socket.on('start-script', ({ serverDir }) => {
        if (scriptProcess) {
            return socket.emit('terminal-output', `\n--- A server is already running. ---\n`);
        }
        if (!serverDir) {
            return socket.emit('terminal-output', `\n--- Please select a server. ---\n`);
        }
        startScriptProcess(socket, serverDir);
    });

    socket.on('stop-script', () => {
        if (!scriptProcess) {
             return socket.emit('terminal-output', `\n--- No server is running. ---\n`);
        }
        stopServerProcess();
    });
    
    socket.on('restart-script', () => {
        if (!scriptProcess || !activeServerDir) {
            return socket.emit('terminal-output', `\n--- No server running to restart. ---\n`);
        }
        const serverToRestart = activeServerDir;
        io.emit('terminal-output', `\n--- Restarting server '${serverToRestart}'... ---\n`);
        stopServerProcess(() => {
            setTimeout(() => startScriptProcess(socket, serverToRestart), 1500);
        });
    });
    
    socket.on('terminal-command', (command) => {
        if (scriptProcess && scriptProcess.stdin) {
            scriptProcess.stdin.write(command + "\n");
        } else {
            socket.emit('terminal-output', `\n--- No server is running to send commands to. ---\n`);
        }
    });

    // --- File Management Sockets ---
    socket.on('list-files', async ({ serverName, subDir }) => {
        try {
            const serverPath = path.join(__dirname, serverName);
            const requestedPath = subDir ? path.join(serverPath, subDir) : serverPath;

            if (!requestedPath.startsWith(serverPath)) throw new Error('Access denied.');
            
            const entries = await fsp.readdir(requestedPath, { withFileTypes: true });
            const files = entries.map(e => ({ name: e.name, isDirectory: e.isDirectory() }));
            socket.emit('file-list', { serverName, subDir, files });
        } catch (error) {
            socket.emit('server-action-error', `Error listing files: ${error.message}`);
        }
    });

    socket.on('get-file-content', async ({ serverName, filePath }) => {
        try {
            const serverPath = path.join(__dirname, serverName);
            const fullPath = path.join(serverPath, filePath);
            if (!fullPath.startsWith(serverPath)) throw new Error('Access denied.');
            const content = await fsp.readFile(fullPath, 'utf-8');
            socket.emit('file-content', { serverName, filePath, content });
        } catch (error) {
            socket.emit('server-action-error', `Error reading file: ${error.message}`);
        }
    });

    socket.on('save-file-content', async ({ serverName, filePath, content }) => {
        try {
            const serverPath = path.join(__dirname, serverName);
            const fullPath = path.join(serverPath, filePath);
            if (!fullPath.startsWith(serverPath)) throw new Error('Access denied.');
            await fsp.writeFile(fullPath, content, 'utf-8');
            socket.emit('server-action-success', `File saved: ${filePath}`);
        } catch (error) {
            socket.emit('server-action-error', `Error saving file: ${error.message}`);
        }
    });

    socket.on('upload-file', async ({ serverName, path: subDir, fileName, content }) => {
        try {
            const serverPath = path.join(__dirname, serverName);
            const targetDir = subDir ? path.join(serverPath, subDir) : serverPath;
            if (!targetDir.startsWith(serverPath)) throw new Error('Access denied.');

            const safeFileName = path.basename(fileName); // Sanitize filename
            const fullPath = path.join(targetDir, safeFileName);

            await fsp.writeFile(fullPath, Buffer.from(content));
            socket.emit('file-upload-success', { path: subDir });
        } catch (error) {
            console.error('File upload error:', error);
            socket.emit('file-upload-error', { message: error.message });
        }
    });
    
    socket.on('rename-file', async ({ serverName, subDir, oldName, newName }) => {
        try {
            const serverPath = path.join(__dirname, serverName);
            const directoryPath = path.join(serverPath, subDir);
            if (!directoryPath.startsWith(serverPath)) throw new Error('Access denied.');

            const oldPath = path.join(directoryPath, oldName);
            const newPath = path.join(directoryPath, newName);

            await fsp.rename(oldPath, newPath);
            socket.emit('file-action-success', { 
                message: `Successfully renamed "${oldName}" to "${newName}"`, 
                subDir 
            });
        } catch (error) {
            console.error('File rename error:', error);
            socket.emit('server-action-error', `Error renaming file: ${error.message}`);
        }
    });

    socket.on('delete-file', async ({ serverName, path: fileOrDirPath }) => {
        try {
            const serverPath = path.join(__dirname, serverName);
            const targetPath = path.join(serverPath, fileOrDirPath);
            if (!targetPath.startsWith(serverPath)) throw new Error('Access denied.');

            await rimraf(targetPath);
            socket.emit('file-action-success', { 
                message: `Successfully deleted "${path.basename(fileOrDirPath)}"`, 
                subDir: path.dirname(fileOrDirPath)
            });
        } catch (error) {
            console.error('File deletion error:', error);
            socket.emit('server-action-error', `Error deleting file: ${error.message}`);
        }
    });


    socket.on('disconnect', () => console.log('Client disconnected'));
});

// --- Server Initialization ---
server.listen(PORT, () => {
  console.log(`Control Panel started on http://localhost:${PORT}`);
});
