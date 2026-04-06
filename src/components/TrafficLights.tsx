import { useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

// macOS 原生交通灯 hover 图标 SVG
// 关闭：× 交叉线
const IconClose = () => (
  <svg width="6" height="6" viewBox="0 0 6 6" fill="none">
    <path d="M1 1l4 4M5 1L1 5" stroke="rgba(100,0,0,0.65)" strokeWidth="1.25" strokeLinecap="round"/>
  </svg>
);

// 最小化：— 横线
const IconMinimize = () => (
  <svg width="6" height="6" viewBox="0 0 6 6" fill="none">
    <path d="M1 3h4" stroke="rgba(80,50,0,0.65)" strokeWidth="1.25" strokeLinecap="round"/>
  </svg>
);

// 全屏/放大：macOS 原生样式 —— 左上角 + 右下角各一个实心三角
const IconMaximize = () => (
  <svg width="7" height="7" viewBox="0 0 8 8" fill="rgba(0,60,10,0.65)">
    {/* 左上角三角 */}
    <polygon points="0,0 0,4.5 4.5,0"/>
    {/* 右下角三角 */}
    <polygon points="8,8 8,3.5 3.5,8"/>
  </svg>
);

interface TrafficLightsProps {
  /** 关闭按钮的行为，默认隐藏窗口 */
  onClose?: () => void;
  /** 按钮尺寸，默认 13 */
  size?: number;
  /** 按钮间距，默认 7 */
  gap?: number;
}

export function TrafficLights({ onClose, size = 13, gap = 7 }: TrafficLightsProps) {
  const [hoverClose, setHoverClose] = useState(false);
  const [hoverMin,   setHoverMin]   = useState(false);
  const [hoverMax,   setHoverMax]   = useState(false);

  const handleMinimize = () => getCurrentWindow().minimize().catch(() => {});
  const handleMaximize = () => getCurrentWindow().toggleMaximize().catch(() => {});
  const handleClose    = onClose ?? (() => getCurrentWindow().hide().catch(() => {}));

  const dot = (
    color: string,
    border: string,
    hovered: boolean,
    onEnter: () => void,
    onLeave: () => void,
    onClick: () => void,
    title: string,
    icon: React.ReactNode,
  ) => (
    <button
      onClick={onClick}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      title={title}
      style={{
        width: size, height: size,
        borderRadius: "50%",
        background: color,
        border: `0.5px solid ${border}`,
        cursor: "pointer",
        padding: 0,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "filter 0.1s",
        filter: hovered ? "brightness(0.82)" : "none",
      }}
    >
      {hovered && icon}
    </button>
  );

  return (
    <div style={{ display: "flex", alignItems: "center", gap }}>
      {dot(
        "#ff5f57", "rgba(0,0,0,0.12)",
        hoverClose,
        () => setHoverClose(true), () => setHoverClose(false),
        handleClose, "关闭",
        <IconClose />,
      )}
      {dot(
        "#febc2e", "rgba(0,0,0,0.10)",
        hoverMin,
        () => setHoverMin(true), () => setHoverMin(false),
        handleMinimize, "最小化",
        <IconMinimize />,
      )}
      {dot(
        "#28c840", "rgba(0,0,0,0.10)",
        hoverMax,
        () => setHoverMax(true), () => setHoverMax(false),
        handleMaximize, "全屏 / 还原",
        <IconMaximize />,
      )}
    </div>
  );
}
