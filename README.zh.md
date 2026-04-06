# Code Bar

<div align="center">

一个基于 Tauri + React 的 macOS 菜单栏应用，统一管理多种 AI 编程工具（Claude Code、Codex、自定义 CLI、内置 Harness）的会话，提供 Git worktree 隔离、PTY 终端集成、会话状态持久化等开发增强功能。

[English](./README.md) | 简体中文

</div>

## ✨ 特性

- **🎯 通用 Runner** - Claude Code、OpenAI Codex、自定义 CLI、内置 Native Harness，统一管理
- **🤖 多 Provider** - Anthropic Claude、OpenAI GPT、DeepSeek、任意 OpenAI 兼容接口（默认：智谱 GLM-4-Flash）
- **🌿 Git Worktree 隔离** - 每个 session 自动在独立 `ci/session-N` worktree 分支中工作，彻底消除多 session 代码冲突
- **🖥️ PTY 终端** - 每个 session 独立 xterm.js PTY 终端，直接在应用中与 AI CLI 交互
- **📊 Git Diff 查看** - 实时 diff 展示（diff2html 渲染），可配置自动刷新间隔
- **🔧 内置 Harness** - 无需外部 CLI，直接调用 LLM API 执行任务
- **🎨 自适应主题** - 浅色 / 深色 / 跟随系统，Framer Motion 流畅动画，macOS 菜单栏常驻
- **📍 位置记忆** - 浮窗位置与大小跨重启自动恢复
- **🔔 通知回调** - macOS 原生通知，点击通知可直接唤起并聚焦对应 session
- **⚙️ 丰富设置** - Runner、模型、API Key、工具权限、外观，全部可自定义

## 🚀 快速开始

### 环境要求

- Node.js 18+
- pnpm
- Rust（用于 Tauri 后端）
- 系统依赖：
  - **macOS**: Xcode Command Line Tools

### 安装

```bash
# 克隆仓库
git clone https://github.com/For-Tr/code-bar.git
cd code-bar

# 安装依赖
pnpm install
```

### 开发

```bash
# 启动前端开发服务器
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

### Runner 系统

| Runner | 说明 |
|--------|------|
| **Claude Code** | Anthropic 官方 CLI（`@anthropic-ai/claude-code`） |
| **OpenAI Codex** | OpenAI Codex CLI（`@openai/codex`） |
| **自定义 CLI** | 任意 AI CLI 工具 |
| **Native Harness** | 内置 LLM 集成，无需外部 CLI |

每种 CLI Runner 支持：
- 自定义可执行文件路径（自动从 PATH 检测，兼容 nvm/mise/pyenv）
- 附加 CLI 参数
- 自定义 API Base URL（适用于代理/OpenRouter 等场景）
- 独立 API Key 覆盖
- 应用内安装终端（一键 `npm install -g` 安装 Claude Code / Codex）

### 多 Provider 支持

| Provider | 可用模型 |
|----------|---------|
| **Anthropic** | claude-opus-4-5、claude-sonnet-4-5、claude-haiku-3-5 |
| **OpenAI** | o3、o4-mini、gpt-4o、gpt-4.1 |
| **DeepSeek** | deepseek-chat、deepseek-reasoner |
| **OpenAI 兼容** | 任意模型（默认：智谱 glm-4-flash） |

API Key 通过 Tauri Rust 后端加密存储在系统 Keychain 中。

### 会话管理
- 创建、删除会话，按工作区分组
- 状态跟踪：空闲 / 运行中 / 等待确认 / 完成 / 出错
- 会话状态跨重启持久化
- PTY 实时输出流
- 任务完成时发送系统通知（点击通知聚焦 session）

### 工作区管理
- 添加和管理多个代码工作区
- 自动信任工作区目录（写入 `~/.claude/settings.json`）
- 彩色卡片快速切换工作区
- **Git Worktree 自动隔离**：新建 session 时自动创建 `ci/session-N` 分支的 worktree，PTY 在隔离目录中运行；session 删除时自动清理；启动时自动清理孤儿 worktree

### PTY 终端
- 每个 session 独立 xterm.js PTY
- 预热启动——终端在用户输入前已就绪
- 自动注入 `CODE_BAR_*` 上下文环境变量，供 AI 感知 session 信息
- 可调整大小的面板，尺寸持久化
- 交互式登录 shell，兼容 nvm/mise/pyenv 管理的 CLI 路径

### Git 集成
- diff2html 可视化 Git diff
- 分支感知 diff（对比 `base...session` 分支）
- 支持分文件查看变更，语法高亮
- 行内差异显示
- 可配置自动刷新间隔（默认 5 秒）

## 🛠️ 技术栈

### 前端
- **框架**: React 19.1 + TypeScript
- **构建工具**: Vite 7
- **样式**: Tailwind CSS v4
- **动画**: Framer Motion
- **状态管理**: Zustand（含持久化）
- **终端**: xterm.js（PTY 支持）
- **Diff 渲染**: diff2html

### 后端
- **框架**: Tauri 2 (Rust)
- **PTY**: portable-pty
- **密钥管理**: Tauri keystore 系统 Keychain 加密存储
- **通知**: mac-notification-sys（原生 macOS 点击回调）
- **Git**: Rust 命令（分支、worktree、diff）
- **Hook 服务**: Unix Domain Socket 接收 Claude Code hooks

### 开发工具
- **包管理器**: pnpm
- **类型检查**: TypeScript 5.8
- **Rust 分析**: rust-analyzer

## 📁 项目结构

```
code-bar/
├── src/                    # 前端源代码
│   ├── components/         # React 组件
│   ├── harness/            # LLM Native Harness（直接调用 LLM API）
│   ├── store/              # Zustand 状态管理
│   ├── assets/             # 静态资源
│   └── App.tsx             # 主应用组件
├── src-tauri/              # Tauri 后端 (Rust)
│   ├── src/
│   │   ├── cli_detect.rs   # CLI 路径解析（兼容 nvm/mise/pyenv）
│   │   ├── git/            # Git 分支、worktree、diff 命令
│   │   ├── hooks.rs        # Claude Code hook socket 服务器
│   │   ├── notification.rs # macOS 原生通知（含点击回调）
│   │   ├── pty.rs          # PTY 会话管理
│   │   ├── window.rs       # 浮窗控制与位置持久化
│   │   └── lib.rs          # 应用入口、托盘、初始化
│   └── tauri.conf.json     # Tauri 配置
├── public/                 # 公共资源
└── package.json            # 项目配置
```

## 🎯 快捷键

- `Esc` - 关闭弹窗
- `Ctrl/Cmd + ,` - 打开设置

## ⚙️ 配置

应用配置文件位于 `src-tauri/tauri.conf.json`：

- **窗口**: 初始 360×220 像素，透明背景，始终置顶，不显示在 Dock/任务栏
- **展开**: 打开 PTY 终端时自动扩展至约 700×600
- **位置记忆**: 下次启动时自动恢复上次的窗口位置和尺寸
- **行为**: macOS `Accessory` 激活策略，菜单栏常驻
- **Bundle ID**: `com.xiangbingzhou.code-bar`

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

## 📄 许可证

本项目采用 Apache License 2.0 - 详见 [LICENSE](LICENSE) 文件

## 👤 作者

[@For-Tr](https://github.com/For-Tr)

## 🙏 致谢

- [Tauri](https://tauri.app/) - 跨平台桌面应用框架
- [React](https://react.dev/) - 用户界面库
- [Claude Code](https://claude.ai/code) - AI 编程助手
- [xterm.js](https://xtermjs.org/) - 终端模拟器
- [diff2html](https://diff2html.xyz/) - Git diff 可视化
- [mac-notification-sys](https://github.com/h4llow3En/mac-notification-sys) - macOS 原生通知
