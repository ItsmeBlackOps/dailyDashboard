interface ConveyorChartItem {
  label: string;
  value: number;
  color?: string;
}

interface ConveyorChartProps {
  items: ConveyorChartItem[];
  title?: string;
  height?: number;
}

const ROLLER_POSITIONS = [20, 120, 240, 360, 480, 600, 720];
const PACKAGE_WIDTH = 72;
const PACKAGE_HEIGHT = 44;
const BELT_Y = 36;
const BELT_H = 56;
const ROLLER_Y = BELT_Y + BELT_H + 4;
const ROLLER_R = 10;
const ANIM_DURATION = 10; // seconds for one full pass

export default function ConveyorChart({ items, title, height = 240 }: ConveyorChartProps) {
  const total = items.reduce((s, i) => s + i.value, 0);
  const svgHeight = height - (title ? 52 : 32);
  const n = items.length || 1;
  // evenly space packages so they're spread across the belt width at any time
  const spacing = 100 / n; // percent of travel per item

  return (
    <div
      className="relative rounded-xl border border-white/10 bg-gradient-to-br from-[#8b5cf6]/5 via-[#22d3ee]/5 to-transparent backdrop-blur-md p-4 overflow-hidden"
      style={{ height }}
    >
      {/* header row */}
      <div className="flex items-center justify-between mb-1">
        {title && (
          <h4 className="font-semibold text-sm tracking-tight text-white/90">{title}</h4>
        )}
        <span className="ml-auto text-xs font-mono text-white/50 bg-white/5 px-2 py-0.5 rounded">
          Σ {total.toLocaleString()}
        </span>
      </div>

      <svg
        width="100%"
        height={svgHeight}
        className="block overflow-visible"
        style={{ minWidth: 300 }}
      >
        <defs>
          {/* animated belt stripe pattern */}
          <pattern
            id="cc-beltStripes"
            width="24"
            height={BELT_H}
            patternUnits="userSpaceOnUse"
            patternTransform="skewX(-18)"
          >
            <rect width="12" height={BELT_H} fill="rgba(139,92,246,0.13)" />
            <rect x="12" width="12" height={BELT_H} fill="rgba(34,211,238,0.09)" />
          </pattern>

          {/* belt gloss overlay */}
          <linearGradient id="cc-beltGloss" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0"   stopColor="rgba(255,255,255,0.14)" />
            <stop offset="0.45" stopColor="rgba(255,255,255,0.03)" />
            <stop offset="1"   stopColor="rgba(0,0,0,0.18)" />
          </linearGradient>

          {/* belt edge shadow */}
          <linearGradient id="cc-beltEdge" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0"   stopColor="rgba(255,255,255,0.22)" />
            <stop offset="1"   stopColor="rgba(0,0,0,0)" />
          </linearGradient>

          {/* clip the belt area */}
          <clipPath id="cc-beltClip">
            <rect x="0" y={BELT_Y} width="100%" height={BELT_H} rx="6" />
          </clipPath>

          {/* per-item package gradients */}
          {items.map((item, i) => {
            const color = item.color || '#8b5cf6';
            return (
              <linearGradient key={i} id={`cc-pkg-${i}`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0"   stopColor={color} stopOpacity="0.40" />
                <stop offset="1"   stopColor={color} stopOpacity="0.18" />
              </linearGradient>
            );
          })}
        </defs>

        {/* ─── Belt body ─── */}
        {/* base fill with animated stripes */}
        <g clipPath="url(#cc-beltClip)">
          <rect x="-48" y={BELT_Y} width="calc(100% + 96px)" height={BELT_H} fill="rgba(255,255,255,0.04)" />
          <rect x="0" y={BELT_Y} width="100%" height={BELT_H} fill="url(#cc-beltStripes)">
            {/* animate pattern offset to simulate movement */}
            <animate
              attributeName="x"
              from="0"
              to="-24"
              dur="0.8s"
              repeatCount="indefinite"
            />
          </rect>
        </g>

        {/* belt gloss */}
        <rect x="0" y={BELT_Y} width="100%" height={BELT_H} fill="url(#cc-beltGloss)" rx="6" />

        {/* belt top edge highlight */}
        <rect x="0" y={BELT_Y} width="100%" height="2" fill="url(#cc-beltEdge)" rx="1" />
        {/* belt bottom edge */}
        <rect x="0" y={BELT_Y + BELT_H - 2} width="100%" height="2" fill="rgba(0,0,0,0.3)" rx="1" />

        {/* ─── Rollers ─── */}
        {ROLLER_POSITIONS.map((cx, ri) => (
          <g key={ri}>
            {/* roller body */}
            <circle
              cx={cx}
              cy={ROLLER_Y}
              r={ROLLER_R}
              fill="rgba(30,30,40,0.85)"
              stroke="rgba(255,255,255,0.25)"
              strokeWidth="1.5"
            />
            {/* spoke lines — animated rotation group */}
            <g style={{ transformOrigin: `${cx}px ${ROLLER_Y}px` }}>
              <animateTransform
                attributeName="transform"
                type="rotate"
                from={`0 ${cx} ${ROLLER_Y}`}
                to={`360 ${cx} ${ROLLER_Y}`}
                dur={`${ANIM_DURATION * 0.25}s`}
                repeatCount="indefinite"
              />
              <line x1={cx - ROLLER_R + 2} y1={ROLLER_Y} x2={cx + ROLLER_R - 2} y2={ROLLER_Y}
                stroke="rgba(255,255,255,0.45)" strokeWidth="1.2" />
              <line x1={cx} y1={ROLLER_Y - ROLLER_R + 2} x2={cx} y2={ROLLER_Y + ROLLER_R - 2}
                stroke="rgba(255,255,255,0.45)" strokeWidth="1.2" />
            </g>
            {/* roller highlight */}
            <circle cx={cx - 2} cy={ROLLER_Y - 3} r={3} fill="rgba(255,255,255,0.12)" />
          </g>
        ))}

        {/* ─── Moving packages ─── */}
        {items.map((item, i) => {
          const color = item.color || '#8b5cf6';
          // stagger: each package offset by its index fraction of total duration
          const delay = -(i * (ANIM_DURATION / n));
          const pkgY = BELT_Y + (BELT_H - PACKAGE_HEIGHT) / 2;

          return (
            <g
              key={i}
              style={{
                animation: `cc-slideBelt ${ANIM_DURATION}s linear infinite`,
                animationDelay: `${delay}s`,
              }}
            >
              {/* package shadow */}
              <rect
                x={0}
                y={pkgY + 4}
                width={PACKAGE_WIDTH}
                height={PACKAGE_HEIGHT}
                rx="6"
                fill={color}
                fillOpacity="0.12"
                filter="blur(4px)"
              />
              {/* package body */}
              <rect
                x={0}
                y={pkgY}
                width={PACKAGE_WIDTH}
                height={PACKAGE_HEIGHT}
                rx="6"
                fill={`url(#cc-pkg-${i})`}
                stroke={color}
                strokeWidth="1.5"
                strokeOpacity="0.7"
              />
              {/* top gloss strip */}
              <rect
                x={2}
                y={pkgY + 2}
                width={PACKAGE_WIDTH - 4}
                height={8}
                rx="4"
                fill="rgba(255,255,255,0.12)"
              />
              {/* value text */}
              <text
                x={PACKAGE_WIDTH / 2}
                y={pkgY + 18}
                textAnchor="middle"
                fontSize="15"
                fontWeight="700"
                fill="white"
                fontFamily="'JetBrains Mono', monospace"
                style={{ filter: `drop-shadow(0 1px 3px ${color})` }}
              >
                {item.value.toLocaleString()}
              </text>
              {/* label text */}
              <text
                x={PACKAGE_WIDTH / 2}
                y={pkgY + 32}
                textAnchor="middle"
                fontSize="9"
                fill="rgba(255,255,255,0.65)"
                fontFamily="'Inter Tight', 'Inter', sans-serif"
                letterSpacing="0.08em"
              >
                {item.label.toUpperCase()}
              </text>
            </g>
          );
        })}

        {/* left + right fade masks so packages fade in/out */}
        <defs>
          <linearGradient id="cc-fadeL" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0"    stopColor="rgba(0,0,0,0.9)" />
            <stop offset="0.08" stopColor="rgba(0,0,0,0)" />
          </linearGradient>
          <linearGradient id="cc-fadeR" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0.92" stopColor="rgba(0,0,0,0)" />
            <stop offset="1"    stopColor="rgba(0,0,0,0.9)" />
          </linearGradient>
          <mask id="cc-beltMask">
            <rect width="100%" height="100%" fill="white" />
            <rect width="100%" height="100%" fill="url(#cc-fadeL)" />
            <rect width="100%" height="100%" fill="url(#cc-fadeR)" />
          </mask>
        </defs>

        {/* apply fade mask over the whole package area */}
        <rect
          x="0" y={BELT_Y - 4}
          width="100%" height={BELT_H + 12}
          fill="transparent"
          mask="url(#cc-beltMask)"
          style={{ pointerEvents: 'none' }}
        />
      </svg>

      {/* legend row */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
        {items.map((item, i) => (
          <span key={i} className="flex items-center gap-1 text-[10px] text-white/55">
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ background: item.color || '#8b5cf6' }}
            />
            {item.label}
          </span>
        ))}
      </div>

      <style>{`
        @keyframes cc-slideBelt {
          from { transform: translateX(-10%); }
          to   { transform: translateX(110%); }
        }
      `}</style>
    </div>
  );
}
