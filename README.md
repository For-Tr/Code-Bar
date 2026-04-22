<p align="center">
  <img src="src-tauri/icons/128x128.png" alt="Code Bar" width="104" height="104">
</p>

<h1 align="center">Code Bar</h1>

<p align="center">
  <strong>Parallel AI coding, without repo chaos.</strong>
  <br>
  A desktop workbench for Claude Code, Codex, and custom AI CLIs.
  <br>
  Run multiple coding sessions across repos, isolate each one in its own git worktree, and review terminal output, files, and diffs in one place.
  <br><br>
  <strong>English</strong> | <a href="./README.zh.md">简体中文</a>
</p>

<p align="center">
  <a href="https://github.com/For-Tr/Code-Bar/releases/latest"><img src="https://img.shields.io/github/v/release/For-Tr/Code-Bar?style=flat-square&label=release&color=blue" alt="Latest Release"></a>
  <a href="https://github.com/For-Tr/Code-Bar/stargazers"><img src="https://img.shields.io/github/stars/For-Tr/Code-Bar?style=flat-square&color=yellow" alt="Stars"></a>
  <a href="https://github.com/For-Tr/Code-Bar/releases"><img src="https://img.shields.io/github/downloads/For-Tr/Code-Bar/total?style=flat-square&label=downloads" alt="Downloads"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/For-Tr/Code-Bar?style=flat-square" alt="License"></a>
</p>

<p align="center">
  <a href="https://github.com/For-Tr/Code-Bar/releases/latest/download/code-bar-windows-x64.msi">Windows</a> ·
  <a href="https://github.com/For-Tr/Code-Bar/releases/latest/download/code-bar-macos-apple-silicon.dmg">macOS Apple Silicon</a> ·
  <a href="https://github.com/For-Tr/Code-Bar/releases/latest/download/code-bar-macos-intel.dmg">macOS Intel</a>
</p>

<p align="center">
  <a href="https://github.com/For-Tr/Code-Bar/releases/latest">Download</a> ·
  <a href="#quick-start">Quick Start</a> ·
  <a href="#features">Features</a> ·
  <a href="#build-from-source">Build from Source</a> ·
  <a href="https://github.com/For-Tr/Code-Bar/stargazers">Star</a>
</p>

<p align="center">
  <img src="https://github.com/user-attachments/assets/483c38de-69ed-4c90-9cb5-8548aa37fec2" alt="Code Bar demo" width="960" />
</p>

## Why Code Bar

AI coding gets messy fast: too many terminal tabs, mixed branches, and no clean place to review what changed.

Code Bar gives each task its own session and worktree so you can run AI coding in parallel without losing control.

- Run multiple AI coding sessions in parallel
- Auto-isolate every session in its own git worktree
- Review terminal output, files, SCM, and diffs in one app
- Use Claude Code, Codex, a custom CLI, or the built-in Native Harness
- Resume sessions across restarts and get notified when work finishes

## Best for

- Claude Code and Codex power users
- Full-stack developers working across multiple repos
- Developers who want safer parallel AI-assisted coding workflows
- Anyone who wants a desktop workflow around terminal-native AI tools

<p align="center">
  <img src="https://github.com/user-attachments/assets/c030fa66-e6ea-4274-a15d-0e2fb499a58b" alt="Code Bar screenshot" width="960" />
</p>

## How it works

1. Add one or more workspaces.
2. Start a session with Claude Code, Codex, a custom CLI, or Native Harness.
3. Code Bar creates an isolated git worktree for that session.
4. Watch terminal output and review files and diffs without leaving the app.

## Quick Start

### Step 1: Download the app

- [Windows x64 MSI](https://github.com/For-Tr/Code-Bar/releases/latest/download/code-bar-windows-x64.msi)
- [macOS Apple Silicon DMG](https://github.com/For-Tr/Code-Bar/releases/latest/download/code-bar-macos-apple-silicon.dmg)
- [macOS Intel DMG](https://github.com/For-Tr/Code-Bar/releases/latest/download/code-bar-macos-intel.dmg)

### Step 2: Choose your runner

Use the AI coding tool you already prefer:

- **Claude Code**
- **OpenAI Codex**
- **Custom CLI**
- **Native Harness** for direct model access without an external CLI

### Step 3: Add a workspace and start a session

Open your repo, create a session, and let Code Bar keep each task isolated in its own worktree.

## Features

### Parallel session workflow

- Create and manage multiple AI coding sessions
- Track session status: `idle` / `running` / `waiting` / `suspended` / `done` / `error`
- Persist session state across restarts
- Get native notifications when tasks finish

### Git worktree isolation

- Automatically create a dedicated git worktree for each session
- Keep parallel AI changes separated and avoid branch conflicts
- Review branch-aware diffs inside the app
- Clean up worktrees when sessions are removed

### In-app review and terminal

- Full xterm.js PTY terminal for each session
- File explorer and SCM sidebar
- Inline diff viewing with diff2html
- Quick switching across workspaces and sessions

### Runner flexibility

- Claude Code, Codex, custom CLI, and Native Harness in one place
- Runner-specific API key and base URL overrides
- Local model/provider configuration for Native Harness
- In-app install terminal for supported CLIs

## Supported Runners

| Runner | Description |
| --- | --- |
| **Claude Code** | Official Anthropic Claude Code CLI (`@anthropic-ai/claude-code`) |
| **OpenAI Codex** | OpenAI Codex CLI (`@openai/codex`) |
| **Custom CLI** | Bring your own AI CLI tool |
| **Native Harness** | Built-in LLM integration with no external CLI required |

## Platforms

- **macOS**: standard app activation with a menu bar icon and native click-to-focus notifications
- **Windows**: tray mode, PowerShell hook bridge, CLI path detection, and `.cmd` / `.bat` PTY compatibility

## Build from Source

### Prerequisites

- Node.js 18+
- pnpm
- Rust
- System dependencies:
  - **macOS**: Xcode Command Line Tools
  - **Windows**: Microsoft C++ Build Tools and WebView2 (see [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/))

### Install

```bash
git clone https://github.com/For-Tr/code-bar.git
cd code-bar
pnpm install
```

### Development

```bash
pnpm tauri dev
```

For frontend-only development:

```bash
pnpm dev
```

### Production build

```bash
pnpm build
pnpm tauri build
```

<details>
<summary>Development notes</summary>

When multiple worktrees run `pnpm tauri dev` at the same time, Code Bar automatically picks a free Vite/HMR port pair and updates Tauri `devUrl` to match.

</details>

## Contributing

Issues and pull requests are welcome.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push the branch (`git push origin feature/amazing-feature`)
5. Open a pull request

## License

This project is licensed under the [Apache License 2.0](LICENSE).

## Author

[@For-Tr](https://github.com/For-Tr)
