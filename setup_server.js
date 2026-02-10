const https = require('https');
const fs = require('fs');
const path = require('path');

const MINECRAFT_VERSION_MANIFEST_URL = 'https://launchermeta.mojang.com/mc/game/version_manifest.json';

// Helper to perform GET requests
function getJSON(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            if (res.statusCode !== 200) {
                return reject(new Error(`Failed to get JSON, status code: ${res.statusCode}`));
            }
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => resolve(JSON.parse(data)));
        }).on('error', reject);
    });
}

// Helper to download a file
function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        https.get(url, (response) => {
            if (response.statusCode !== 200) {
                return reject(new Error(`Failed to download file, status code: ${response.statusCode}`));
            }
            response.pipe(file);
            file.on('finish', () => {
                file.close(resolve);
            });
        }).on('error', (err) => {
            fs.unlink(dest, () => reject(err));
        });
    });
}

async function setupServer(version) {
    if (!version) {
        console.error('Error: Minecraft version not specified.');
        process.exit(1);
    }

    try {
        console.log('Fetching version manifest...');
        const manifest = await getJSON(MINECRAFT_VERSION_MANIFEST_URL);

        const versionData = manifest.versions.find(v => v.id === version);
        if (!versionData) {
            throw new Error(`Version ${version} not found in the manifest.`);
        }

        console.log(`Fetching details for version ${version}...`);
        const versionDetails = await getJSON(versionData.url);

        const serverDownload = versionDetails.downloads.server;
        if (!serverDownload) {
            throw new Error(`Server download not available for version ${version}.`);
        }

        const serverDir = path.join(__dirname, 'server');
        if (!fs.existsSync(serverDir)) {
            console.log(`Creating directory: ${serverDir}`);
            fs.mkdirSync(serverDir);
        }

        const serverJarPath = path.join(serverDir, 'server.jar');
        console.log(`Downloading server.jar for version ${version} to ${serverJarPath}...`);
        await downloadFile(serverDownload.url, serverJarPath);
        console.log('Download complete!');

        const eulaPath = path.join(serverDir, 'eula.txt');
        console.log(`Creating eula.txt at ${eulaPath}...`);
        fs.writeFileSync(eulaPath, 'eula=true');
        console.log('EULA accepted.');

        console.log(`\nServer setup for Minecraft ${version} is complete.`)
        console.log("To start the server, run the following command inside the 'server' directory:");
        console.log('java -Xmx1024M -Xms1024M -jar server.jar nogui');

    } catch (error) {
        console.error('\nAn error occurred during server setup:');
        console.error(error.message);
        process.exit(1);
    }
}

// The version is passed as a command-line argument
const selectedVersion = process.argv[2];
setupServer(selectedVersion);
