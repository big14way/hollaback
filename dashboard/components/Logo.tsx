/** Hollaback mark: a reply arrow inside a rounded square. */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="1" y="1" width="30" height="30" rx="9" fill="var(--brand)" />
      <path d="M11 13.5h8a4.25 4.25 0 0 1 0 8.5h-6" fill="none" stroke="var(--brand-glow)" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M14.5 9.75 10.75 13.5l3.75 3.75" fill="none" stroke="var(--brand-glow)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
