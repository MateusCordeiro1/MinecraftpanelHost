# Minecraft Server Control Panel - Blueprint

## 1. Overview

This project is a web-based control panel for creating, managing, and interacting with Minecraft servers. It provides a user-friendly interface to control the server lifecycle (start, stop, restart), create new servers of different types (Paper, Purpur, Fabric, etc.), and manage server files directly through a built-in file manager.

## 2. Core Features

- **Multi-Server Management**: The panel supports creating and managing multiple, isolated server instances.
- **Server Creation Wizard**: An intuitive form to create new servers, allowing users to choose the server type (e.g., Paper, Purpur, Fabric), version, and allocate RAM.
- **Lifecycle Control**: Easy-to-use buttons to start, stop, and restart the selected server.
- **Live Console**: A real-time terminal view of the server console, allowing users to monitor output and send commands.
- **File Manager**: A complete file explorer and editor integrated into the panel. Users can:
    - Browse the file system of a selected server.
    - Navigate through directories using breadcrumbs.
    - View and edit text-based files directly in the browser.
    - Save changes back to the server.
    - **Rename** files and directories.
    - **Delete** files and directories with a confirmation prompt.
- **Persistent Operation**: The backend server is designed to run continuously, managed by PM2, ensuring the panel remains online.

## 3. Design and UI/UX

- **Modern Aesthetic**: The UI is built with a clean, dark-themed design that is both professional and easy on the eyes.
- **Responsive Layout**: The interface is designed to be responsive and functional on various screen sizes.
- **Intuitive Navigation**: A clear sidebar allows users to switch between the main sections: Servers, Create Server, Console, and File Manager.
- **Status Indicators**: Visual cues, such as status dots and disabled buttons, provide immediate feedback on the server's state.
- **Interactive Components**: The panel uses modern web components, including dropdowns, buttons, and a dynamic file browser, to create a rich user experience.

## 4. Technical Stack

- **Backend**: Node.js with Express.js for the web server and Socket.IO for real-time, bidirectional communication between the client and server.
- **Frontend**: HTML5, CSS3, and modern JavaScript (ES6+). No external frontend frameworks are used, keeping the client-side code lightweight and fast.
- **Real-time Communication**: Socket.IO is used for all major interactions, including:
    - Sending server status updates.
    - Streaming console output.
    - Transmitting file system data.
    - Handling server creation progress.
- **Server Provisioning**: The backend automates the server setup process, including:
    - Downloading the specified server JARs (Paper, Purpur, etc.).
    - Running installers for modded servers like Forge and Fabric.
    - Generating necessary files like `eula.txt` and startup scripts.
- **Process Management**: The Node.js `child_process` module is used to spawn and manage the Minecraft server processes. The entire panel is managed as a persistent service by **PM2**.
- **Environment**: The application is designed to run within the Firebase Studio environment, leveraging `nix-shell` to provide the correct Java versions (JDK 8, 17, 21) as needed for different Minecraft versions.

## 5. Current Task: Enhance File Manager

- **Objective**: Add file and directory deletion and renaming capabilities.
- **Backend Plan**:
    - Create a new socket event listener `deletePath` that takes a server name and a path, validates them, and uses `fs.rm` to delete the file or directory recursively.
    - Create a new socket event listener `renamePath` that takes a server name, an old path, and a new name, validates them, and uses `fs.rename`.
    - Add error handling and emit a success or failure event back to the client.
- **Frontend Plan**:
    - In the file manager list, add a "Rename" and a "Delete" button to each file and directory entry.
    - **Delete**: When the "Delete" button is clicked, show a `confirm()` dialog to prevent accidental deletion. If confirmed, emit the `deletePath` event to the server and refresh the file list on success.
    - **Rename**: When the "Rename" button is clicked, show a `prompt()` dialog to ask for the new name. If a name is entered, emit the `renamePath` event and refresh the list on success.
