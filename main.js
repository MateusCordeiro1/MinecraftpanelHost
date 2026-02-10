document.addEventListener('DOMContentLoaded', function() {
    const socket = io();

    const versionSelector = document.getElementById('server-version');
    const consoleOutput = document.getElementById('console-output');

    // Fetch Minecraft versions from Mojang API
    fetch('https://launchermeta.mojang.com/mc/game/version_manifest.json')
        .then(response => response.json())
        .then(data => {
            const versions = data.versions.filter(v => v.type === 'release');
            versions.forEach(version => {
                const option = document.createElement('option');
                option.value = version.id;
                option.textContent = version.id;
                versionSelector.appendChild(option);
            });
        })
        .catch(error => {
            console.error('Error fetching Minecraft versions:', error);
            const option = document.createElement('option');
            option.textContent = 'Error loading versions';
            versionSelector.appendChild(option);
        });

    const startServerButton = document.getElementById('startServer');
    const stopServerButton = document.getElementById('stopServer');
    const restartServerButton = document.getElementById('restartServer');

    startServerButton.addEventListener('click', () => {
        const serverType = document.getElementById('server-type').value;
        const serverVersion = document.getElementById('server-version').value;
        socket.emit('start-server', { serverType, serverVersion });
    });

    stopServerButton.addEventListener('click', () => {
        socket.emit('stop-server');
    });

    restartServerButton.addEventListener('click', () => {
        // For restart, we can just send a stop and then a start command
        // The backend could also implement a specific restart logic
        socket.emit('stop-server');
        // A delay might be needed here depending on how fast the server stops
        setTimeout(() => {
            const serverType = document.getElementById('server-type').value;
            const serverVersion = document.getElementById('server-version').value;
            socket.emit('start-server', { serverType, serverVersion });
        }, 5000); // 5-second delay before starting again
    });

    socket.on('console-output', (data) => {
        consoleOutput.innerHTML += data.replace(/\n/g, '<br>'); // Sanitize and format
        consoleOutput.scrollTop = consoleOutput.scrollHeight; // Scroll to bottom
    });
});

function openTab(evt, tabName) {
    var i, tabcontent, tablinks;
    tabcontent = document.getElementsByClassName("tab-content");
    for (i = 0; i < tabcontent.length; i++) {
        tabcontent[i].style.display = "none";
    }
    tablinks = document.getElementsByClassName("tab-link");
    for (i = 0; i < tablinks.length; i++) {
        tablinks[i].className = tablinks[i].className.replace(" active", "");
    }
    document.getElementById(tabName).style.display = "block";
    evt.currentTarget.className += " active";
}
