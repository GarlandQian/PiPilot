/**
 * PiPilot logo mark: the π glyph, rendered as currentColor
 * so it inherits the surrounding text color.
 */
export function PiLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden focusable="false">
      <text
        x="12"
        y="18.5"
        textAnchor="middle"
        fontSize="19"
        fontWeight="600"
        fill="currentColor"
        fontFamily="Georgia, 'Times New Roman', 'Songti SC', serif"
      >
        π
      </text>
    </svg>
  )
}
