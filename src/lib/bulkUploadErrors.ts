import * as XLSX from "xlsx";

export type BulkImportRowError = {
    excelRowNumber: number;
    message: string;
    dealId?: string | null;
    dealName?: string | null;
};

function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
        reader.readAsArrayBuffer(file);
    });
}

/**
 * Builds an Excel file containing only the rows that failed during bulk upload
 * (matched by 1-based Excel row number from the server) and triggers a download.
 */
export async function downloadFailedBulkUploadRows(
    file: File,
    errors: BulkImportRowError[],
): Promise<void> {
    const failedRowNumbers = new Set(
        errors.map((e) => e.excelRowNumber).filter((n) => n > 1),
    );
    if (failedRowNumbers.size === 0) {
        throw new Error("No data rows to export — failures may be file-level parse errors.");
    }

    const buffer = await readFileAsArrayBuffer(file);
    const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
        throw new Error("Workbook has no sheets.");
    }

    const ws = workbook.Sheets[sheetName];
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, {
        header: 1,
        defval: "",
        raw: true,
    });
    if (aoa.length < 2) {
        throw new Error("Uploaded sheet has no data rows.");
    }

    const headerRow = aoa[0] ?? [];
    const failedRows: unknown[][] = [headerRow];

    for (let r = 1; r < aoa.length; r++) {
        const excelRowNumber = r + 1;
        if (failedRowNumbers.has(excelRowNumber)) {
            failedRows.push(aoa[r] as unknown[]);
        }
    }

    if (failedRows.length <= 1) {
        throw new Error(
            "Could not match failed rows in the uploaded file. Fix the issues listed in the report and re-upload the full file.",
        );
    }

    const outWs = XLSX.utils.aoa_to_sheet(failedRows);
    const outWb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(outWb, outWs, "Failed Rows");

    const baseName = file.name.replace(/\.[^.]+$/, "");
    XLSX.writeFile(outWb, `${baseName}-failed-rows.xlsx`);
}
