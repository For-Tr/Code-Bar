# Coding Island

<div align="center">

A Tauri + React desktop application providing enhanced session management and development experience for Claude Code users.

English | [简体中文](./README.zh.md)

</div>

## ✨ Features

- **🎯 Session Management** - Centralized management of multiple Claude Code sessions with workspace grouping
- **📁 Workspace Support** - Multi-workspace management for quick project switching
- **🖥️ Integrated Terminal** - Built-in xterm terminal for direct command execution
- **📊 Git Diff Viewer** - Visual code changes display with diff2html rendering
- **🔧 Claude Code Integration** - Native Claude Code harness functionality
- **🎨 Modern UI** - Fluid interface built with Tailwind CSS + Framer Motion
- **⚙️ Rich Settings** - Customizable themes, shortcuts, and behavior preferences

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- pnpm
- Rust (for Tauri backend)
- System dependencies:
  - **macOS**: Xcode Command Line Tools
  - **Linux**: libwebkit2gtk-4.1-dev, build-essential
  - **Windows**: WebView2 Runtime, Microsoft C++ Build Tools

### Installation

```bash
# Clone the repository
git clone https://github.com/xiangbingzhou/coding-island.git
cd coding-island

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

### Session Management
- Create, edit, and delete sessions
- Session grouping and tagging
- Persistent session state
- Quick search and filtering

### Workspace Management
- Add and manage multiple code workspaces
- Automatic workspace directory trust
- Quick workspace switching
- Git worktree support

### Terminal Features
- Full terminal emulator support
- Multi-session terminal management
- Automatic window size adaptation
- Rich terminal configuration options

### Git Integration
- Visual Git diff display
- Per-file change viewing
- Syntax highlighting
- Inline diff display

## 🛠️ Tech Stack

### Frontend
- **Framework**: React 19.1 + TypeScript
- **Build Tool**: Vite 7
- **Styling**: Tailwind CSS 4
- **Animation**: Framer Motion
- **State Management**: Zustand
- **Terminal**: xterm.js
- **Diff Rendering**: diff2html

### Backend
- **Framework**: Tauri 2 (Rust)
- **System API**: Tauri API
- **Plugins**: Tauri Plugin Opener

### Development Tools
- **IDE**: VS Code + Tauri extension + rust-analyzer
- **Package Manager**: pnpm
- **Type Checking**: TypeScript 5.8

## 📁 Project Structure

```
coding-island/
├── src/                    # Frontend source code
│   ├── components/         # React components
│   ├── harness/           # Claude Code integration
│   ├── store/             # Zustand state management
│   ├── assets/            # Static assets
│   └── App.tsx            # Main application component
├── src-tauri/             # Tauri backend (Rust)
│   ├── src/
│   └── tauri.conf.json    # Tauri configuration
├── public/                # Public assets
└── package.json           # Project configuration
```

## 🎯 Keyboard Shortcuts

- `Esc` - Close popup
- `Ctrl/Cmd + ,` - Open settings
- More shortcuts can be customized in settings

## ⚙️ Configuration

Application configuration is located at `src-tauri/tauri.conf.json`, main options:

- **Window Settings**: 360×220 pixels, transparent background
- **Behavior**: Always on top, resizable
- **Security**: Content Security Policy (CSP)

## 🤝 Contributing

Issues and Pull Requests are welcome!

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see [LICENSE](LICENSE) for details

## 👤 Author

[@xiangbingzhou](https://github.com/xiangbingzhou)

## 🙏 Acknowledgments

- [Tauri](https://tauri.app/) - Cross-platform desktop application framework
- [React](https://react.dev/) - UI library
- [Claude Code](https://claude.ai/code) - AI programming assistant
- [xterm.js](https://xtermjs.org/) - Terminal emulator
- [diff2html](https://diff2html.xyz/) - Git diff visualization
