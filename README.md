# VibeMind 1.7 - The "Lazy" Guide (Single-File Launch)

VibeMind is a universal AI-powered note-taking and knowledge management system. It now supports a true zero-config, single-file deployment.

## Installation (3 Steps)

1. **Copy the `docker-compose.yml` file** to your server:
   ```bash
   mkdir vibemind && cd vibemind
   # Place docker-compose.yml here
   ```

2. **Run Docker Compose:**
   ```bash
   docker-compose up -d
   ```

3. **Login and Configure:**
   - Open `http://<YOUR_SERVER_IP>:3344` in your browser.
   - Login with the default credentials:
     - **Username:** `admin`
     - **Password:** `admin`
   - Go to Settings -> Integrations to configure your Universal LLM Provider (DeepSeek, Groq, OpenAI, Local, etc.).

## Features
- **Universal LLM Architecture:** Add any OpenAI-compatible API directly from the UI. No `.env` required.
- **Zero-Config:** The app auto-generates encryption keys and provisions necessary directories (`/storage/notes`, `/storage/logs`, `/storage/backups`) on startup.
- **Single Container:** The frontend and backend are bundled together for maximum simplicity.
