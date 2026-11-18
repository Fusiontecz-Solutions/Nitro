/** PCM / Preferred Capital Management leftovers — never serve as the Nitro Advance contract. */
export function isPreferredCapitalBranding(value: unknown): boolean {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return false;
  const spaced = raw.replace(/[_-]+/g, ' ');
  return (
    spaced.includes('preferred capital') ||
    spaced.includes('pcm contract') ||
    raw.includes('pcm_contract') ||
    raw.includes('preferredcapital')
  );
}
