// 站标（重设计）：朱砂方印（印章）+ 内框 + 一条自下而上的「求学之路」——蜿蜒折线由起点圆点
// 通向顶部更大的终点圆点（求学路 = 拾级而上的路）。纯 SVG 矢量：清晰可缩放、随明暗主题着色。
// 装饰性元素，aria-hidden——相邻文字（站名）承担可读名称。
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      aria-hidden
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* 朱砂方印底 */}
      <rect x="1.5" y="1.5" width="21" height="21" rx="5.5" fill="var(--color-danger-fill)" />
      {/* 印框：内嵌细线，呼应真实印章的边栏 */}
      <rect
        x="4.25"
        y="4.25"
        width="15.5"
        height="15.5"
        rx="3.5"
        stroke="var(--color-on-fill)"
        strokeOpacity="0.4"
        strokeWidth="0.9"
      />
      {/* 上行之路：起点（左下）蜿蜒至终点（右上） */}
      <path
        d="M7.2 16.6 C 10 16.4 9.2 12.4 12 11.2 C 14.8 10 14 8 16.6 7.4"
        stroke="var(--color-on-fill)"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* 起点（小） */}
      <circle cx="7.2" cy="16.6" r="1.15" fill="var(--color-on-fill)" fillOpacity="0.85" />
      {/* 终点（大，目的地） */}
      <circle cx="16.8" cy="7.2" r="1.85" fill="var(--color-on-fill)" />
    </svg>
  );
}
