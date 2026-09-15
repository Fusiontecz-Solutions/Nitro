import type { KycUploadSlot } from './contractKycPrefillMapper';

export type BatchDocKind = 'application' | 'driverLicense' | 'voidedCheck' | 'unknown';

export type UploadedFileLike = {
  name?: string;
  mimetype?: string;
  tempFilePath?: string;
  filepath?: string;
  path?: string;
  data?: Buffer;
  size?: number;
};

export type ClassifiedBatchFile = {
  file: UploadedFileLike;
  kind: BatchDocKind;
  score: number;
  reason: string;
};

function str(v: unknown): string {
  return v == null ? '' : String(v).trim();
}

function fileNameLower(file: UploadedFileLike): string {
  return str(file.name).toLowerCase();
}

/**
 * Filename heuristics for a one-shot multi-PDF upload
 * (e.g. "DL.pdf", "Void check.pdf", "Nitro Advance LINDER.pdf").
 */
export function classifyFileByName(file: UploadedFileLike): ClassifiedBatchFile {
  const name = fileNameLower(file);
  const base = name.replace(/\.[^.]+$/, '');

  if (
    /\bvoid(?:ed)?\b/.test(base) ||
    /\bcheck\b/.test(base) ||
    /\bach\b/.test(base) ||
    /\bbank\b/.test(base) ||
    /\brouting\b/.test(base) ||
    /\bdirect[_\s-]?deposit\b/.test(base)
  ) {
    return { file, kind: 'voidedCheck', score: 90, reason: 'filename:voided-check' };
  }

  if (
    /\bdl\b/.test(base) ||
    /\bdriver'?s?\b/.test(base) ||
    /\blicen[cs]e\b/.test(base) ||
    /\bstate[_\s-]?id\b/.test(base) ||
    /\bid[_\s-]?card\b/.test(base)
  ) {
    return { file, kind: 'driverLicense', score: 90, reason: 'filename:driver-license' };
  }

  if (
    /\bapplication\b/.test(base) ||
    /\bfunding\b/.test(base) ||
    /\bmerchant\b/.test(base) ||
    /\bmca\b/.test(base) ||
    /\bloan\b/.test(base) ||
    /\bnitro\b/.test(base) ||
    /\badvance\b/.test(base)
  ) {
    return { file, kind: 'application', score: 85, reason: 'filename:application' };
  }

  // PDF without KYC cues — likely the funding application.
  const mime = str(file.mimetype).toLowerCase();
  const isPdf = mime.includes('pdf') || name.endsWith('.pdf');
  if (isPdf) {
    return { file, kind: 'application', score: 40, reason: 'filename:default-pdf-application' };
  }

  return { file, kind: 'unknown', score: 10, reason: 'filename:unknown' };
}

export function classifyFileByOcrText(
  file: UploadedFileLike,
  text: string,
): ClassifiedBatchFile {
  const t = String(text || '').toLowerCase();
  if (!t.trim()) {
    return classifyFileByName(file);
  }

  if (
    /void(?:ed)?\s*check/.test(t) ||
    (/routing/.test(t) && /account/.test(t)) ||
    /aba\s*routing/.test(t) ||
    /direct\s*deposit/.test(t)
  ) {
    return { file, kind: 'voidedCheck', score: 95, reason: 'ocr:voided-check' };
  }

  if (
    /driver'?s?\s*licen[cs]e/.test(t) ||
    /\bclass\s*[a-d]\b/.test(t) ||
    /date of birth/.test(t) && /licen[cs]e/.test(t) ||
    /dmv|motor vehicle/.test(t)
  ) {
    return { file, kind: 'driverLicense', score: 95, reason: 'ocr:driver-license' };
  }

  if (
    /merchant\s*(cash\s*)?advance|funding\s*application|loan\s*amount|requested\s*amount|business\s*name|ein|federal\s*tax/.test(
      t,
    )
  ) {
    return { file, kind: 'application', score: 90, reason: 'ocr:application' };
  }

  return classifyFileByName(file);
}

function normalizeIncomingFiles(reqFiles: Record<string, any> | null | undefined): UploadedFileLike[] {
  if (!reqFiles || typeof reqFiles !== 'object') return [];

  const out: UploadedFileLike[] = [];
  const push = (input: unknown) => {
    if (!input) return;
    if (Array.isArray(input)) {
      for (const row of input) push(row);
      return;
    }
    out.push(input as UploadedFileLike);
  };

  // Preferred: one multi-select field.
  if (reqFiles.files) push(reqFiles.files);
  // Legacy / slot-based fields still accepted.
  if (reqFiles.pdf) push(reqFiles.pdf);
  if (reqFiles.driverLicense) push(reqFiles.driverLicense);
  if (reqFiles.driverLicenseOwner2) push(reqFiles.driverLicenseOwner2);
  if (reqFiles.voidedCheck) push(reqFiles.voidedCheck);

  // Dedupe by temp path / name+size when the same file is appended twice.
  const seen = new Set<string>();
  return out.filter((file) => {
    const key =
      str(file.tempFilePath || file.filepath || file.path) ||
      `${str(file.name)}:${Number(file.size || 0)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export type ResolvedAutoCreateBatch = {
  applicationFile: UploadedFileLike;
  /** Ordered driver-license files (owner assignment happens after name match). */
  driverLicenseFiles: UploadedFileLike[];
  voidedCheckFile: UploadedFileLike | null;
  classifications: ClassifiedBatchFile[];
};

/**
 * Resolve a multi-file upload into application + KYC slots using filename heuristics.
 * Content-based reclassification can refine kinds beforehand via classifyFileByOcrText.
 */
export function resolveAutoCreateBatch(
  reqFiles: Record<string, any> | null | undefined,
  classified?: ClassifiedBatchFile[],
): ResolvedAutoCreateBatch {
  const files = normalizeIncomingFiles(reqFiles);
  if (!files.length) {
    throw new Error('No files uploaded. Select the application PDF and any driver licenses / voided checks together.');
  }

  const rows =
    classified && classified.length === files.length
      ? classified
      : files.map((file) => classifyFileByName(file));

  const applications = rows
    .filter((r) => r.kind === 'application')
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return Number(b.file.size || 0) - Number(a.file.size || 0);
    });
  const licenses = rows.filter((r) => r.kind === 'driverLicense');
  const voids = rows
    .filter((r) => r.kind === 'voidedCheck')
    .sort((a, b) => b.score - a.score);
  const unknowns = rows.filter((r) => r.kind === 'unknown');

  let applicationFile = applications[0]?.file;
  if (!applicationFile) {
    // Fallback: largest PDF / first file.
    applicationFile =
      [...files]
        .filter((f) => {
          const n = fileNameLower(f);
          const m = str(f.mimetype).toLowerCase();
          return m.includes('pdf') || n.endsWith('.pdf');
        })
        .sort((a, b) => Number(b.size || 0) - Number(a.size || 0))[0] || files[0];
  }

  const driverLicenseFiles: UploadedFileLike[] = licenses
    .map((r) => r.file)
    .filter((f) => f !== applicationFile);

  // Extra weak "application" PDFs (generic names like PF.pdf) are usually extra DLs
  // when a stronger/larger application was already chosen.
  for (const row of applications.slice(1)) {
    if (row.file === applicationFile) continue;
    if (row.score >= 70) continue;
    if (driverLicenseFiles.length >= 2) break;
    driverLicenseFiles.push(row.file);
  }

  // Unknown leftovers that aren't the application: treat image-like as possible DL.
  for (const row of unknowns) {
    if (row.file === applicationFile) continue;
    if (driverLicenseFiles.length >= 2) break;
    const n = fileNameLower(row.file);
    const m = str(row.file.mimetype).toLowerCase();
    if (m.includes('image') || /\.(jpe?g|png|webp)$/i.test(n)) {
      driverLicenseFiles.push(row.file);
    }
  }

  const voidedCheckFile =
    voids.map((r) => r.file).find((f) => f !== applicationFile) || null;

  return {
    applicationFile,
    driverLicenseFiles,
    voidedCheckFile,
    classifications: rows,
  };
}

function normNamePart(v: unknown): string {
  return str(v)
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function fullNameKey(first?: unknown, last?: unknown, middle?: unknown): string {
  return [first, middle, last].map(normNamePart).filter(Boolean).join(' ');
}

/** Simple token overlap score for matching a DL name to application owners. */
export function scoreOwnerNameMatch(
  candidate: { firstName?: string; lastName?: string },
  target: { firstName?: string; lastName?: string },
): number {
  const cFirst = normNamePart(candidate.firstName);
  const cLast = normNamePart(candidate.lastName);
  const tFirst = normNamePart(target.firstName);
  const tLast = normNamePart(target.lastName);
  if (!cFirst && !cLast) return 0;
  if (!tFirst && !tLast) return 0;

  let score = 0;
  if (cLast && tLast && (cLast === tLast || cLast.includes(tLast) || tLast.includes(cLast))) {
    score += 60;
  }
  if (cFirst && tFirst) {
    if (cFirst === tFirst) score += 40;
    else if (cFirst.split(' ')[0] === tFirst.split(' ')[0]) score += 25;
    else if (cFirst.includes(tFirst) || tFirst.includes(cFirst)) score += 15;
  }
  return score;
}

export type OwnerNameHint = {
  ownerIndex: 1 | 2;
  firstName: string;
  lastName: string;
};

/**
 * Map extracted driver-license names onto owner 1 / owner 2 using application owner hints.
 * Unmatched licenses fill the next free owner slot in file order.
 */
export function assignDriverLicenseOwnerSlots(
  licenses: Array<{
    file: UploadedFileLike;
    firstName?: string;
    lastName?: string;
  }>,
  ownerHints: OwnerNameHint[],
): Array<{ file: UploadedFileLike; slot: KycUploadSlot; ownerIndex: 1 | 2 }> {
  const used = new Set<1 | 2>();
  const assigned: Array<{ file: UploadedFileLike; slot: KycUploadSlot; ownerIndex: 1 | 2 }> =
    [];
  const remaining = [...licenses];

  const pickSlot = (ownerIndex: 1 | 2): KycUploadSlot =>
    ownerIndex === 2 ? 'driverLicenseOwner2' : 'driverLicense';

  // Greedy best match against known application owners.
  for (const hint of ownerHints) {
    if (used.has(hint.ownerIndex)) continue;
    let bestIdx = -1;
    let bestScore = 0;
    for (let i = 0; i < remaining.length; i++) {
      const score = scoreOwnerNameMatch(remaining[i], hint);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0 && bestScore >= 40) {
      const [row] = remaining.splice(bestIdx, 1);
      used.add(hint.ownerIndex);
      assigned.push({
        file: row.file,
        ownerIndex: hint.ownerIndex,
        slot: pickSlot(hint.ownerIndex),
      });
    }
  }

  // Fill leftover licenses into free owner slots (1 then 2) in file order.
  for (const row of remaining) {
    if (!used.has(1)) {
      used.add(1);
      assigned.push({ file: row.file, ownerIndex: 1, slot: pickSlot(1) });
      continue;
    }
    if (!used.has(2)) {
      used.add(2);
      assigned.push({ file: row.file, ownerIndex: 2, slot: pickSlot(2) });
      continue;
    }
    break;
  }

  return assigned;
}

export function ownerHintsFromParsedApplication(parsedData: any): OwnerNameHint[] {
  const hints: OwnerNameHint[] = [];
  const owner = parsedData?.owner || {};
  const first = str(owner.owner_first_name || owner.firstName);
  const last = str(owner.owner_last_name || owner.lastName);
  if (first || last) {
    hints.push({ ownerIndex: 1, firstName: first, lastName: last });
  }

  const owners = Array.isArray(parsedData?.owners) ? parsedData.owners : [];
  const second = owners[1] || parsedData?.owner2 || parsedData?.second_owner;
  if (second) {
    const f = str(second.owner_first_name || second.firstName || second.first_name);
    const l = str(second.owner_last_name || second.lastName || second.last_name);
    if (f || l) {
      hints.push({ ownerIndex: 2, firstName: f, lastName: l });
    }
  }

  return hints;
}
