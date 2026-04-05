# Coding Island

<div align="center">

一个通用的 AI 编程助手平台 - 统一管理多种 AI 工具和服务商的开发体验。

[English](./README.md) | 简体中文

</div>

## ✨ 特性

- **🎯 通用 Runner 支持** - 一处集成多种 AI 工具：Claude Code、OpenAI Codex、自定义 CLI、内置原生 Harness
- **🤖 多服务商集成** - 支持 Anthropic Claude、OpenAI GPT、DeepSeek、OpenAI 兼容接口（默认：智谱 GLM）
- **🔧 原生 Harness** - 内置 LLM 集成，无需外部 CLI 即可直接调用 API
- **🎯 会话管理** - 集中管理多个 AI 会话，支持按工作区分组
- **📁 工作区支持** - 多工作区管理，快速切换不同项目，支持 Git worktree
- **🖥️ 集成终端** - 内置 xterm 终端，支持 PTY 直接执行命令
- **📊 Git Diff 查看** - 可视化展示代码变更，支持 diff2html 渲染和自动刷新
- **🎨 现代化 UI** - 使用 Tailwind CSS + Framer Motion 构建的流畅界面
- **⚙️ 丰富设置** - 可自定义主题、快捷键、API 密钥和行为偏好

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

### 通用 Runner 系统
- **Claude Code** - 官方 Anthropic Claude Code CLI 集成
- **OpenAI Codex** - OpenAI 的 GPT 模型 CLI
- **自定义 CLI** - 支持任意自定义 AI CLI 工具
- **原生 Harness** - 内置 LLM 集成（无需 CLI）

### 多服务商支持
- **Anthropic** - Claude Opus、Sonnet、Haiku 模型
- **OpenAI** - GPT-4o、GPT-4.1、O3、O4-mini 模型
- **DeepSeek** - DeepSeek Chat、Reasoner 模型
- **OpenAI 兼容** - 任何遵循 OpenAI 格式的 API（默认：智谱 GLM-4-Flash）

### 会话管理
- 创建、编辑、删除会话
- 会话分组和标签
- 会话状态持久化
- 快速搜索和过滤
- 实时输出流式传输

### 工作区管理
- 添加和管理多个代码工作区
- 自动信任工作区目录
- 工作区间快速切换
- Git worktree 支持及自动清理

### 终端功能
- 完整的 PTY 终端模拟器支持
- 多会话终端管理
- 自动适配窗口大小
- 丰富的终端配置选项

### Git 集成
- 可视化 Git diff
- 支持分文件查看变更及语法高亮
- 行内差异显示
- 可配置的自动刷新间隔

## 🛠️ 技术栈

### 前端
- **框架**: React 19.1 + TypeScript
- **构建工具**: Vite 7
- **样式**: Tailwind CSS 4
- **动画**: Framer Motion
- **状态管理**: Zustand（带持久化）
- **终端**: xterm.js（支持 PTY）
- **Diff 渲染**: diff2html
- **LLM 客户端**: 原生 API 集成

### 后端
- **框架**: Tauri 2 (Rust)
- **系统 API**: Tauri API
- **插件**: Tauri Plugin Opener
- **密钥链**: 安全的 API 密钥存储
- **进程管理**: PTY 生成及输出流式传输

### 开发工具
- **IDE 推荐**: VS Code + Tauri 扩展 + rust-analyzer
- **包管理器**: pnpm
- **类型检查**: TypeScript 5.8

## 📁 项目结构

```
coding-island/
├── src/                    # 前端源代码
│   ├── components/         # React 组件
│   ├── harness/           # Claude Code 集成
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

- **窗口设置**: 360×220 像素，透明背景
- **行为**: 始终置顶，可调整大小
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
- [Anthropic Claude](https://www.anthropic.com/claude) - Claude 模型
- [OpenAI](https://openai.com/) - GPT 模型
- [DeepSeek](https://www.deepseek.com/) - DeepSeek 模型
- [智谱 AI](https://open.bigmodel.cn/) - GLM 模型
- [xterm.js](https://xtermjs.org/) - 终端模拟器
- [diff2html](https://diff2html.xyz/) - Git diff 可视化
