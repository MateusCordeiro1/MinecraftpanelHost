# Blueprint: Minecraft Server Control Panel

## 1. Project Overview

This project is a web-based control panel for creating, managing, and customizing Minecraft servers. It provides an intuitive interface for users to set up various server types (like Vanilla, Paper, Spigot), manage server processes, edit server files, and install plugins directly from the web browser.

## 2. Core Features & Design

### Backend (server.js)
- **Web Server:** Uses Express.js to serve the frontend and handle API requests.
- **Real-time Communication:** Implements Socket.IO for instant communication between the client and server (e.g., terminal output, status updates).
- **Server Types:** Supports creating multiple server versions, including:
  - Vanilla
  - Paper
  - Spigot
  - Purpur
  - Fabric
  - Forge
  - NeoForge
- **Process Management:** Spawns server processes in a child process, allowing for start, stop, restart, and command input.
- **File Management:** Provides a complete set of tools for file operations within each server's directory (list, read, save, upload, rename, delete).
- **Plugin Management:** Integrates with the Spiget API to search for and install plugins for Spigot and Paper servers.
- **Automatic Tunneling:** Uses playit.gg to automatically create a public tunnel to the server.

### Frontend (public/)
- **Structure (index.html):** A single-page application layout.
- **Styling (style.css):** A dark-themed, functional interface with clear sections for server management.
- **Logic (script.js):**
  - Manages the UI and all interactions.
  - Communicates with the backend via Socket.IO to send commands and receive updates.
  - Dynamically populates server lists, version dropdowns, file browsers, and plugin search results.
  - Features a real-time terminal viewer.

### Design Principles
- **Modern Look:** Dark theme with blue and green accents for interactive elements.
- **Clear Layout:** A three-column layout:
  - **Left:** Server creation and selection.
  - **Middle:** Main control panel with terminal and server actions.
  - **Right:** File manager and plugin installer.
- **Interactivity:** Buttons and inputs have hover effects, and the terminal provides real-time feedback.
- **Accessibility:** Clear text and logical component grouping enhance usability.

## 3. Current Plan: Display Installed Plugins

The user has approved the addition of a new feature to display a list of currently installed plugins.

**Actionable Steps:**

1.  **Update Backend:** Create a new socket event (`get-installed-plugins`) in `server.js` that reads the contents of the `plugins` directory for a given server and returns a list of `.jar` files.
2.  **Update Frontend HTML:** Add a new section to `public/index.html` within the **Plugin Management** area to display the list of installed plugins.
3.  **Update Frontend JS:** In `public/script.js`:
    -   Emit the `get-installed-plugins` event when the user navigates to the Plugins section.
    -   Create a socket handler for the response (`installed-plugins-list`) to populate the new UI with the list of plugins.
    -   Refresh the list automatically after a new plugin is successfully installed.
