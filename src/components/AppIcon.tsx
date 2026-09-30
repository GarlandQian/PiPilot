import { cn } from '@/lib/utils'

const PI_PATH = 'M 713.92 662.93 Q 689.10 674.13 667.61 679.89 Q 646.11 685.64 623.41 685.64 Q 580.12 685.64 559.23 664.75 Q 538.34 643.86 538.34 596.94 L 538.34 428.31 L 477.49 428.31 L 477.49 439.82 Q 477.49 504.60 467.80 552.28 Q 458.11 599.96 442.07 629.33 Q 426.33 659.00 404.23 673.74 Q 382.13 688.48 355.79 688.48 Q 329.75 688.48 313.41 673.74 Q 297.06 659.00 297.06 635.69 Q 297.06 618.73 306.44 608.14 Q 315.83 597.54 330.96 597.54 Q 340.35 597.54 348.83 602.99 Q 357.30 608.44 369.41 622.67 Q 381.82 637.20 388.48 641.14 Q 395.14 645.07 401.50 645.07 Q 413.91 645.07 422.39 631.45 Q 430.87 617.82 435.11 591.18 Q 439.65 564.54 441.16 524.59 Q 442.98 484.64 442.98 428.31 L 376.38 428.31 Q 350.65 428.31 338.54 445.57 Q 326.43 462.83 326.43 498.53 L 300.39 498.53 L 300.39 457.37 Q 300.39 421.36 321.58 400.17 Q 342.77 378.98 378.48 378.98 L 716.04 378.98 L 716.04 428.31 L 625.53 428.31 L 625.53 588.76 Q 625.53 614.19 637.33 626.90 Q 649.14 639.61 672.45 639.61 Q 690.62 639.61 713.92 630.23 Z'

/**
 * The PiPilot app icon as a macOS squircle tile — used where macOS shows the
 * application icon (alerts, About, empty states).
 */
export function AppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 1024 1024" className={cn('size-16 drop-shadow-[0_2px_4px_rgb(0_0_0/0.22)]', className)} aria-hidden focusable="false">
      <defs>
        <linearGradient id="pipilot-app-icon-tile" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#343842" />
          <stop offset="1" stopColor="#121317" />
        </linearGradient>
        <linearGradient id="pipilot-app-icon-glyph" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#a6dccf" />
          <stop offset="1" stopColor="#6fae9f" />
        </linearGradient>
      </defs>
      <rect x="100" y="100" width="824" height="824" rx="185" fill="url(#pipilot-app-icon-tile)" />
      <rect x="100.5" y="100.5" width="823" height="823" rx="184.5" fill="none" stroke="rgb(255 255 255 / 0.14)" strokeWidth="3" />
      <g transform="translate(512 512) scale(1.1) translate(-506.5 -533.5)">
        <path fill="url(#pipilot-app-icon-glyph)" d={PI_PATH} />
      </g>
    </svg>
  )
}
