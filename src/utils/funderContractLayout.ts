export const DEFAULT_FUNDER_CONTRACT_LAYOUT_KEY = 'contract';
export const DEFAULT_FUNDER_CONTRACT_FILENAME = 'Contract.pdf';

export function funderContractLayoutKey(funderId: string): string {
  return `funder_${String(funderId || '').trim()}`;
}

export function isFunderContractLayoutKey(layoutKey: string | null | undefined): boolean {
  return String(layoutKey || '')
    .trim()
    .startsWith('funder_');
}
