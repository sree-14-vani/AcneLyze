export default function ScoreRing({
  value,
  size = 116,
  label,
  color = '#7052a8',
}: {
  value: number;
  size?: number;
  label?: string;
  color?: string;
}) {
  const radius = (size - 12) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, value));
  const offset = circumference - (clamped / 100) * circumference;

  return (
    <div className="flex flex-col items-center" style={{ width: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#e9eef5" strokeWidth={9} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={9}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          className="transition-all duration-700"
        />
        <text
          x="50%"
          y="47%"
          textAnchor="middle"
          dominantBaseline="middle"
          className="fill-ink font-display"
          fontSize={size * 0.26}
          fontWeight={600}
        >
          {Math.round(clamped)}
        </text>
        <text x="50%" y="67%" textAnchor="middle" className="fill-muted" fontSize={10} fontWeight={600}>
          / 100
        </text>
      </svg>
      {label && <p className="mt-1 text-center text-xs font-medium text-muted">{label}</p>}
    </div>
  );
}
