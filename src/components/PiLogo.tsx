/** The π of the app icon (build/icon.svg), as one outline in currentColor. */
const PI_PATH = 'M301.6 213.5 H892.9 Q921.4 213.5 921.4 241.9 V315.9 Q921.4 344.3 892.9 344.3 H762.2 V639.9 Q762.2 696.8 819 696.8 H850.3 Q892.9 696.8 892.9 739.4 V767.8 Q892.9 810.5 850.3 810.5 H787.7 Q631.4 810.5 631.4 657 V344.3 H458 C458 526.2 446.6 691.1 386.9 779.2 Q364.2 813.3 327.2 810.5 Q281.7 807.6 273.2 770.7 Q267.5 747.9 281.7 725.2 C321.5 639.9 330.1 497.8 330.1 344.3 H298.8 C267.5 344.3 241.9 350 227.7 355.7 Q219.2 375.5 196.5 372.7 L165.2 367 Q139.6 361.3 145.3 332.9 C165.2 253.3 219.2 213.5 301.6 213.5 Z'

/**
 * PiPilot logo mark: the π glyph, rendered as currentColor
 * so it inherits the surrounding text color.
 */
export function PiLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="132 113 800 800" className={className} aria-hidden focusable="false">
      <path d={PI_PATH} fill="currentColor" />
    </svg>
  )
}
