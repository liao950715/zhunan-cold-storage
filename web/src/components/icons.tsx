import type { SVGProps } from "react";

/** 線條式簡約圖示（2px 描邊、圓角），一律搭配文字使用，不單獨當主要按鈕。 */
type P = SVGProps<SVGSVGElement> & { size?: number };
const base = (size = 22): SVGProps<SVGSVGElement> => ({ width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true });

export const HomeIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M3 11.5 12 4l9 7.5" /><path d="M5 10v10h14V10" /><path d="M10 20v-6h4v6" /></svg>
);
export const SearchIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></svg>
);
export const InboundIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M12 3v11" /><path d="m8 10 4 4 4-4" /><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" /></svg>
);
export const OutboundIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M12 14V3" /><path d="m8 7 4-4 4 4" /><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" /></svg>
);
export const MenuIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M4 7h16" /><path d="M4 12h16" /><path d="M4 17h16" /></svg>
);
export const TransferIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M4 8h13" /><path d="m14 5 3 3-3 3" /><path d="M20 16H7" /><path d="m10 13-3 3 3 3" /></svg>
);
export const DamageIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M12 4 3 19h18L12 4Z" /><path d="M12 10v4" /><path d="M12 17h.01" /></svg>
);
export const ClipboardIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><rect x="6" y="5" width="12" height="16" rx="2" /><path d="M9 5V3h6v2" /><path d="M9 11h6" /><path d="M9 15h6" /></svg>
);
export const HistoryIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>
);
export const LeafIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M5 19c0-8 5-13 14-14-1 9-6 14-14 14Z" /><path d="M5 19c3-4 6-7 9-9" /></svg>
);
export const SettingsIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></svg>
);
export const MapIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M3 6.5 9 4l6 2.5 6-2.5v13.5L15 20l-6-2.5-6 2.5V6.5Z" /><path d="M9 4v13.5" /><path d="M15 6.5V20" /></svg>
);
export const CheckIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
);
export const ChevronIcon = ({ size, open, ...p }: P & { open?: boolean }) => (
  <svg {...base(size)} {...p} style={{ transform: open ? "rotate(90deg)" : undefined, transition: "transform .15s" }}><path d="m9 6 6 6-6 6" /></svg>
);
export const LogoutIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4" /><path d="M14 8l4 4-4 4" /><path d="M18 12H9" /></svg>
);
