## 🎵 Ippos (Desktop Client for macOS)

An open-source desktop client designed for macOS, built with **Tauri v2**, **React**, and **TypeScript**. 

Ippos brings the **ArchiveTune** streaming experience to desktop, featuring an expressive **Material 3 UI** (Bento Grid dashboard, scalloped components, dynamic themes) alongside deep macOS integration.

---

## ✨ Features

- **Expressive UI:** Bento Grid settings layout, smooth animations, and responsive controls.
- **YouTube Music Sync:** Full library integration, real-time playlist management (sync, add, remove), and Google account authentication.
- **Synced Lyrics:** Real-time synchronized lyrics via LRCLIB with quick translation view.
- **Native macOS Performance:** Optimized for Apple Silicon (M-series), low memory footprint via Tauri v2, local audio proxy, and media shortcut integrations.
- **Ecosystem Companion:** Designed to communicate seamlessly with menu bar and desktop utilities.

---

## 🚀 Download & Installation

Download the latest pre-built `.dmg` from the **[Releases](https://github.com/marcoippoooo/ippos/releases)** page:

1. Open `Ippos_1.0.0_aarch64.dmg`.
2. Drag **Ippos** to your **Applications** folder.
3. *(First launch)* Right-click **Ippos** → **Open**, or run in terminal if blocked:
   ```bash
   xattr -cr /Applications/Ippos.app
🛠️ Tech Stack
Framework: Tauri v2 (Rust backend)

Frontend: React 18, TypeScript, Vite, Tailwind CSS

State Management: Zustand

Media Engine: Custom Rust audio proxy + WebKit Web Audio

💻 Development & Build
Prerequisites
Node.js (v18+)

Rust & Cargo

Xcode Command Line Tools

Setup
Bash
# Clone the repository
git clone [https://github.com/marcoippoooo/ippos.git](https://github.com/marcoippoooo/ippos.git)
cd ippos

# Install frontend dependencies
npm install

# Start desktop app in development mode
npm run tauri dev

# Build production bundle (.app and .dmg)
npm run tauri build
📄 License & Credits
Built as an open-source companion project inspired by the ArchiveTune Android application.


---

### Caricalo su GitHub:
Una volta salvato il file, basta lanciare nel terminale:

```bash
git add README.md
git commit -m "docs: add comprehensive project README"
git push origin main
La tua pagina GitHub mostrerà subito la panoramica completa, i badge e la guida al download per i file .dmg
