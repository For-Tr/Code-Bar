# Code Bar

<div align="center">

A macOS menu bar app built with Tauri + React. Unified management of multiple AI coding tools (Claude Code, Codex, custom CLI, built-in Harness) with Git worktree isolation, PTY terminal integration, and persistent session state.

English | [简体中文](./README.zh.md)

</div>

## ✨ Features

- **🎯 Universal Runner** - Claude Code, OpenAI Codex, custom CLI, and built-in Native Harness — all in one place
- **🤖 Multi-Provider** - Anthropic Claude, OpenAI GPT, DeepSeek, and any OpenAI-compatible API (default: Zhipu GLM-4-Flash)
- **🌿 Git Worktree Isolation** - Each session automatically gets its own `ci/session-N` worktree branch, eliminating multi-session code conflicts
- **🖥️ PTY Terminal** - Full xterm.js PTY terminal per session; interact with AI CLIs directly in the app
- **📊 Git Diff Viewer** - Live diff display with diff2html rendering, auto-refresh at configurable intervals
- **🔧 Native Harness** - Direct LLM API calls without any external CLI dependency
- **🎨 Adaptive Theme** - Light / Dark / System themes with Framer Motion animations, macOS menu bar resident
- **📍 Position Memory** - Window position and size are remembered across restarts
- **🔔 Notification Callback** - Native macOS notifications with click-to-focus support
- **⚙️ Rich Settings** - Runner, model, API keys, tool permissions, and appearance — all configurable

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- pnpm
- Rust (for Tauri backend)
- System dependencies:
  - **macOS**: Xcode Command Line Tools

### Installation

```bash
# Clone the repository
git clone https://github.com/For-Tr/code-bar.git
cd code-bar

# Install dependencies
pnpm install
```

### Development

```bash
# Start development server
pnpm dev

# Run Tauri in another terminal
pnpm tauri dev
```

### Build

```bash
# Build for production
pnpm build

# Bundle the application
pnpm tauri build
```

## 📖 Features

### Runner System

| Runner | Description |
|--------|-------------|
| **Claude Code** | Official Anthropic Claude Code CLI (`@anthropic-ai/claude-code`) |
| **OpenAI Codex** | OpenAI Codex CLI (`@openai/codex`) |
| **Custom CLI** | Bring your own AI CLI tool |
| **Native Harness** | Built-in LLM integration — no CLI required |

Each CLI runner supports:
- Custom binary path (auto-detects from PATH via nvm/mise/pyenv)
- Extra CLI arguments
- Custom API base URL override (e.g. for proxies or OpenRouter)
- Per-runner API key override
- In-app install terminal (one-click `npm install -g` for Claude Code / Codex)

### Multi-Provider Support

| Provider | Models |
|----------|--------|
| **Anthropic** | claude-opus-4-5, claude-sonnet-4-5, claude-haiku-3-5 |
| **OpenAI** | o3, o4-mini, gpt-4o, gpt-4.1 |
| **DeepSeek** | deepseek-chat, deepseek-reasoner |
| **OpenAI-Compatible** | Any model (default: glm-4-flash via Zhipu AI) |

API keys are stored securely in the system Keychain via Tauri's Rust backend.

### Session Management
- Create and delete sessions, grouped by workspace
- Session status tracking: idle / running / waiting / done / error
- Persistent session state across restarts
- Real-time PTY output streaming
- System notification on task completion (click to focus)

### Workspace Management
- Add and manage multiple code workspaces
- Automatic workspace directory trust (writes to `~/.claude/settings.json`)
- Quick workspace switching with color-coded cards
- **Git Worktree Auto-Isolation**: creates a `ci/session-N` branch worktree per session; cleans up on session delete; prunes orphan worktrees on startup

### PTY Terminal
- Full xterm.js PTY per session
- Pre-warm launch — terminal is ready before you type
- Injects `CODE_BAR_*` context environment variables for AI awareness
- Resizable panel with size memory
- Interactive login shell to support nvm/mise/pyenv-managed CLIs

### Git Integration
- Visual Git diff with diff2html rendering
- Branch-aware diff (`base...session` branch)
- Per-file change viewing with syntax highlighting
- Inline diff display
- Auto-refresh at configurable intervals (default: 5s)

## 🛠️ Tech Stack

### Frontend
- **Framework**: React 19.1 + TypeScript
- **Build Tool**: Vite 7
- **Styling**: Tailwind CSS v4
- **Animation**: Framer Motion
- **State Management**: Zustand with persistence
- **Terminal**: xterm.js with PTY support
- **Diff Rendering**: diff2html

### Backend
- **Framework**: Tauri 2 (Rust)
- **PTY**: portable-pty
- **Keychain**: Secure API key storage via Tauri keystore
- **Notifications**: mac-notification-sys (native macOS click callbacks)
- **Git**: libgit2-style Rust commands (branch, worktree, diff)
- **Hook Server**: Unix Domain Socket for Claude Code hooks

### Development Tools
- **Package Manager**: pnpm
- **Type Checking**: TypeScript 5.8
- **Linting**: rust-analyzer

## 📁 Project Structure

```
code-bar/
├── src/                    # Frontend source code
│   ├── components/         # React components
│   ├── harness/            # LLM Native Harness (direct LLM API calls)
│   ├── store/              # Zustand state management
│   ├── assets/             # Static assets
│   └── App.tsx             # Main application component
├── src-tauri/              # Tauri backend (Rust)
│   ├── src/
│   │   ├── cli_detect.rs   # CLI path resolution (nvm/mise/pyenv aware)
│   │   ├── git/            # Git branch, worktree, diff commands
│   │   ├── hooks.rs        # Claude Code hook socket server
│   │   ├── notification.rs # Native macOS notifications with click callback
│   │   ├── pty.rs          # PTY session management
│   │   ├── window.rs       # Popup window control & bounds persistence
│   │   └── lib.rs          # App entry, tray, setup
│   └── tauri.conf.json     # Tauri configuration
├── public/                 # Public assets
└── package.json            # Project configuration
```

## 🎯 Keyboard Shortcuts

- `Esc` - Close popup
- `Ctrl/Cmd + ,` - Open settings

## ⚙️ Configuration

Application configuration is located at `src-tauri/tauri.conf.json`:

- **Window**: Initial 360×220 px, transparent background, always-on-top, no taskbar entry
- **Expansion**: Auto-expands to ~700×600 when PTY terminal is open
- **Position Memory**: Last window position/size restored on next launch
- **Behavior**: macOS menu bar resident (`Accessory` activation policy)
- **Bundle ID**: `com.xiangbingzhou.code-bar`

## 🤝 Contributing

Issues and Pull Requests are welcome!

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the Apache License 2.0 - see [LICENSE](LICENSE) for details

## 👤 Author

[@For-Tr](https://github.com/For-Tr)

## 🙏 Acknowledgments

- [Tauri](https://tauri.app/) - Cross-platform desktop application framework
- [React](https://react.dev/) - UI library
- [Anthropic Claude](https://www.anthropic.com/claude) - AI models
- [OpenAI](https://openai.com/) - GPT models
- [DeepSeek](https://www.deepseek.com/) - DeepSeek models
- [Zhipu AI](https://open.bigmodel.cn/) - GLM models
- [xterm.js](https://xtermjs.org/) - Terminal emulator
- [diff2html](https://diff2html.xyz/) - Git diff visualization
- [mac-notification-sys](https://github.com/h4llow3En/mac-notification-sys) - Native macOS notifications
