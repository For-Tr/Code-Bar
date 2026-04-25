<p align="center">
  <img src="apps/desktop/src-tauri/icons/128x128.png" alt="Code Bar" width="104" height="104">
</p>

<h1 align="center">Code Bar</h1>

<p align="center">
  <strong>Parallel AI coding, without repo chaos.</strong>
  <br>
  A desktop workbench for Claude Code and Codex.
  <br>
  Run multiple coding sessions across repos, isolate each one in its own git worktree, and work with terminal, editor, SCM, and diffs in one place.
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

AI coding gets messy fast: too many terminal tabs, mixed branches, and no clear place to review what changed.

Code Bar gives each task its own session and git worktree so you can run parallel AI work without losing control.

- Run multiple Claude Code or Codex sessions in parallel
- Auto-isolate every session in its own git worktree
- Work with terminal, file explorer, editor, SCM, and diffs in one app
- Resume bound Claude Code / Codex sessions across restarts
- Get notifications and hook integration for supported runners

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
2. Create a session and choose Claude Code or Codex.
3. Code Bar creates an isolated git worktree for that session when the repo supports it.
4. Launch the runner, watch terminal output, and review files and diffs without leaving the app.

## Quick Start

### Step 1: Download the app

- [Windows x64 MSI](https://github.com/For-Tr/Code-Bar/releases/latest/download/code-bar-windows-x64.msi)
- [macOS Apple Silicon DMG](https://github.com/For-Tr/Code-Bar/releases/latest/download/code-bar-macos-apple-silicon.dmg)
- [macOS Intel DMG](https://github.com/For-Tr/Code-Bar/releases/latest/download/code-bar-macos-intel.dmg)

### Step 2: Install Claude Code or Codex

Code Bar currently supports these runners:

- **Claude Code** (`@anthropic-ai/claude-code`)
- **OpenAI Codex** (`@openai/codex`)

If the CLI is missing, Code Bar can open a one-click install terminal for the selected runner.

### Step 3: Add a workspace and start a session

Open a repo, create a session, and let Code Bar keep that task isolated in its own worktree.

## Features

### Parallel session workflow

- Create and manage multiple AI coding sessions
- Track session status: `idle` / `running` / `waiting` / `suspended` / `done` / `error`
- Persist and recover sessions across restarts
- Resume sessions using bound Claude Code / Codex provider session IDs when available

### Git worktree isolation

- Automatically create a dedicated git worktree for each session in git repos
- Keep parallel AI changes separated to avoid branch conflicts
- Track each session's branch, base branch, and worktree path
- Clean up worktrees when sessions are removed

### In-app terminal and review workflow

- Full PTY terminal surface for each session
- Runner switching between Claude Code and Codex before launch
- Native notifications when a session finishes or waits for the next step
- Hook setup and integration toggles for Claude Code and Codex

### Explorer, editor, and SCM

- File explorer rooted to the current session worktree
- Built-in code editor with save support for session files
- Diff viewer with per-file and per-hunk review
- SCM sidebar with staged, unstaged, untracked, conflict, and committed-in-session sections
- Stage, unstage, discard, commit, and conflict resolution actions inside the app

### Customizable workspace UI

- Themes: light, dark, glass, and system
- Locale switching: system, English, Simplified Chinese, Arabic
- Configurable right-side widgets for terminal and usage panels
- Split editor groups and draggable widget layout

### Usage widgets

- Runner usage card for the selected session
- Claude usage snapshot from Anthropic API headers when API key env is available
- Codex usage snapshot from local auth + remote usage API
- 5-hour and 7-day usage windows shown in the UI

## Supported Runners

| Runner | Description |
| --- | --- |
| **Claude Code** | Official Anthropic Claude Code CLI (`@anthropic-ai/claude-code`) |
| **OpenAI Codex** | OpenAI Codex CLI (`@openai/codex`) |

## Platforms

- **macOS**: regular app activation, menu bar integration, native notifications, and Unix-socket-based hook flow
- **Windows**: tray-style behavior, PowerShell/notify compatibility for Codex integrations, and `.cmd` / `.bat` PTY handling

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
