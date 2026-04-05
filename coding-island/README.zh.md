# Coding Island

<div align="center">

一个基于 Tauri + React 的桌面应用，专为 Claude Code 用户提供增强的会话管理和开发体验。

[English](./README.md) | 简体中文

</div>

## ✨ 特性

- **🎯 会话管理** - 集中管理多个 Claude Code 会话，支持按工作区分组
- **📁 工作区支持** - 多工作区管理，快速切换不同项目
- **🖥️ 集成终端** - 内置 xterm 终端，直接在应用中执行命令
- **📊 Git Diff 查看** - 可视化展示代码变更，支持 diff2html 渲染
- **🔧 Claude Code 集成** - 原生集成 Claude Code harness 功能
- **🎨 现代化 UI** - 使用 Tailwind CSS + Framer Motion 构建的流畅界面
- **⚙️ 丰富设置** - 可自定义主题、快捷键、行为偏好等

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
- 创建、编辑、删除会话
- 会话分组和标签
- 会话状态持久化
- 快速搜索和过滤

### 工作区管理
- 添加和管理多个代码工作区
- 自动信任工作区目录
- 工作区间快速切换
- Git worktree 支持

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
- **样式**: Tailwind CSS 4
- **动画**: Framer Motion
- **状态管理**: Zustand
- **终端**: xterm.js
- **Diff 渲染**: diff2html

### 后端
- **框架**: Tauri 2 (Rust)
- **系统 API**: Tauri API
- **插件**: Tauri Plugin Opener

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
- [Claude Code](https://claude.ai/code) - AI 编程助手
- [xterm.js](https://xtermjs.org/) - 终端模拟器
- [diff2html](https://diff2html.xyz/) - Git diff 可视化
