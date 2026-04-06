# Coding Island

<div align="center">

一个基于 Tauri + React 的 macOS 菜单栏应用，统一管理多种 AI 编程工具（Claude Code、Codex、自定义 CLI、内置 Harness）的会话，并提供 Git worktree 隔离、终端集成等开发增强功能。

[English](./README.md) | 简体中文

</div>

## ✨ 特性

- **🎯 多 Runner 支持** - 一处统管：Claude Code、OpenAI Codex、自定义 CLI、内置 Native Harness
- **🤖 多 Provider 集成** - 支持 Anthropic Claude、OpenAI GPT、DeepSeek、OpenAI 兼容接口（默认：智谱 GLM）
- **🌿 Git Worktree 隔离** - 每个 session 自动在独立 worktree 分支中工作，彻底消除多 session 代码冲突
- **🎯 会话管理** - 集中管理多个 AI 会话，按工作区分组，支持多并发
- **📁 工作区支持** - 多工作区管理，快速切换不同项目
- **🖥️ 集成终端** - 内置 xterm PTY 终端，直接在应用中与 AI CLI 交互
- **📊 Git Diff 查看** - 可视化展示代码变更，自动刷新，支持 diff2html 渲染
- **🔧 内置 Harness** - 无需外部 CLI，直接调用 LLM API 执行任务
- **🎨 现代化 UI** - 基于 Framer Motion 的流畅动画界面，macOS 菜单栏常驻
- **⚙️ 丰富设置** - 可自定义 Runner、API Key、模型、工具权限等

## 🚀 快速开始

### 环境要求

- Node.js 18+
- pnpm
- Rust (用于 Tauri 后端)
- 系统依赖：
  - **macOS**: Xcode Command Line Tools
  - **Linux**: libwebkit2gtk-4.1-dev, build-essential
  - **Windows**: WebView2 Runtime, Microsoft C++ Build Tools

### 安装

```bash
# 克隆仓库
git clone https://github.com/xiangbingzhou/coding-island.git
cd coding-island

# 安装依赖
pnpm install
```

### 开发

```bash
# 启动开发服务器
pnpm dev

# 在另一个终端运行 Tauri
pnpm tauri dev
```

### 构建

```bash
# 构建生产版本
pnpm build

# 打包应用
pnpm tauri build
```

## 📖 功能说明

### 会话管理
- 创建、删除会话，按工作区分组
- 会话状态持久化（跨重启保留）
- 实时输出流式展示
- 多会话并发，互不干扰

### 工作区管理
- 添加和管理多个代码工作区
- 自动信任工作区目录（写入 Claude 配置）
- 工作区间快速切换
- **Git Worktree 自动隔离**：新建 session 时自动创建 `ci/session-N` 分支的 worktree，PTY 在隔离目录中运行；session 删除时自动清理；启动时自动清理孤儿 worktree

### 终端功能
- 完整的终端模拟器支持
- 多会话终端管理
- 自动适配窗口大小
- 丰富的终端配置选项

### Git 集成
- 可视化 Git diff
- 支持分文件查看变更
- 语法高亮
- 行内差异显示

## 🛠️ 技术栈

### 前端
- **框架**: React 19.1 + TypeScript
- **构建工具**: Vite 7
- **动画**: Framer Motion
- **状态管理**: Zustand（含持久化）
- **终端**: xterm.js（PTY 支持）
- **Diff 渲染**: diff2html
- **LLM 客户端**: 内置 API 集成

### 后端
- **框架**: Tauri 2 (Rust)
- **系统 API**: Tauri API
- **插件**: Tauri Plugin Opener
- **密钥管理**: 系统 Keychain 加密存储
- **进程管理**: PTY 启动 / 输出流 / Git Worktree 管理

### 开发工具
- **IDE 推荐**: VS Code + Tauri 扩展 + rust-analyzer
- **包管理器**: pnpm
- **类型检查**: TypeScript 5.8

## 📁 项目结构

```
coding-island/
├── src/                    # 前端源代码
│   ├── components/         # React 组件
│   ├── harness/           # LLM Native Harness（直接调用 LLM API）
│   ├── store/             # Zustand 状态管理
│   ├── assets/            # 静态资源
│   └── App.tsx            # 主应用组件
├── src-tauri/             # Tauri 后端 (Rust)
│   ├── src/
│   └── tauri.conf.json    # Tauri 配置
├── public/                # 公共资源
└── package.json           # 项目配置
```

## 🎯 快捷键

- `Esc` - 关闭弹窗
- `Ctrl/Cmd + ,` - 打开设置
- 更多快捷键可在设置中自定义

## ⚙️ 配置

应用配置文件位于 `src-tauri/tauri.conf.json`，主要配置项：

- **窗口设置**: 初始 360×220 像素，展开终端时自动扩展至 700×600，透明背景
- **行为**: 始终置顶，macOS 菜单栏常驻
- **安全**: 内容安全策略 (CSP)

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

## 📄 许可证

本项目采用 MIT 许可证 - 详见 [LICENSE](LICENSE) 文件

## 👤 作者

[@xiangbingzhou](https://github.com/xiangbingzhou)

## 🙏 致谢

- [Tauri](https://tauri.app/) - 跨平台桌面应用框架
- [React](https://react.dev/) - 用户界面库
- [Claude Code](https://claude.ai/code) - AI 编程助手
- [xterm.js](https://xtermjs.org/) - 终端模拟器
- [diff2html](https://diff2html.xyz/) - Git diff 可视化
