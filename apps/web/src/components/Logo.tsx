/**
 * La bague : un anneau ouvert en haut, et le chaton qui s’y reverse.
 * L’anneau est la solera — la recette qui ne bouge pas ; le triangle inversé est
 * ce qu’on y recomplète. `currentColor` préserve la teinte choisie dans les réglages.
 *
 * Le tracé de référence vit dans `docs/brand/symbol.svg`. Les copies autonomes
 * (favicons, site, signatures) doivent rester identiques ; les PNG se régénèrent
 * avec `node scripts/brand-assets.mjs`.
 */
export function Logo({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="currentColor"
      className={className}
      aria-hidden
      focusable="false"
    >
      <path d="M70 19.36A40 40 0 1 1 30 19.36L37 31.48A26 26 0 1 0 63 31.48Z" />
      <path d="M33 2H67L50 26Z" />
    </svg>
  )
}
