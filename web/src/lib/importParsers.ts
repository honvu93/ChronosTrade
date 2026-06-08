export type ImportFormat = "csv" | "json";

export type ParsedImportRow = Record<string, unknown>;

export interface ParsedImportDataset {
    rows: ParsedImportRow[];
    errors: string[];
}

const normalizeKey = (value: string) => value.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();

const parseCsvRecords = (input: string): string[][] => {
    const rows: string[][] = [];
    let currentRow: string[] = [];
    let currentField = "";
    let inQuotes = false;

    for (let index = 0; index < input.length; index += 1) {
        const char = input[index];
        const next = input[index + 1];

        if (char === '"') {
            if (inQuotes && next === '"') {
                currentField += '"';
                index += 1;
                continue;
            }

            inQuotes = !inQuotes;
            continue;
        }

        if (char === "," && !inQuotes) {
            currentRow.push(currentField);
            currentField = "";
            continue;
        }

        if ((char === "\n" || char === "\r") && !inQuotes) {
            if (char === "\r" && next === "\n") {
                index += 1;
            }

            currentRow.push(currentField);
            const hasValues = currentRow.some((value) => value.trim() !== "");
            if (hasValues) {
                rows.push(currentRow);
            }
            currentRow = [];
            currentField = "";
            continue;
        }

        currentField += char;
    }

    currentRow.push(currentField);
    if (currentRow.some((value) => value.trim() !== "")) {
        rows.push(currentRow);
    }

    return rows;
};

export const parseImportDataset = (content: string, format: ImportFormat): ParsedImportDataset => {
    if (content.trim() === "") {
        return { rows: [], errors: [] };
    }

    if (format === "json") {
        try {
            const parsed = JSON.parse(content);
            if (!Array.isArray(parsed)) {
                return { rows: [], errors: ["JSON input must be an array of objects."] };
            }

            const rows = parsed.map((item, index) => {
                if (!item || typeof item !== "object" || Array.isArray(item)) {
                    throw new Error(`Row ${index + 1} is not a valid object.`);
                }

                return Object.fromEntries(
                    Object.entries(item).map(([key, value]) => [normalizeKey(key), value])
                );
            });

            return { rows, errors: [] };
        } catch (error) {
            return { rows: [], errors: [error instanceof Error ? error.message : "Invalid JSON input."] };
        }
    }

    const records = parseCsvRecords(content);
    if (records.length === 0) {
        return { rows: [], errors: [] };
    }

    const [headerRow, ...dataRows] = records;
    const headers = headerRow.map((header) => normalizeKey(header));

    if (headers.some((header) => header === "")) {
        return { rows: [], errors: ["CSV header row contains an empty column name."] };
    }

    const rows = dataRows.map((row) => {
        const record: ParsedImportRow = {};
        headers.forEach((header, index) => {
            record[header] = row[index] ?? "";
        });
        return record;
    });

    return { rows, errors: [] };
};

export const readImportField = (row: ParsedImportRow, aliases: string[]) => {
    for (const alias of aliases) {
        const key = normalizeKey(alias);
        if (key in row) {
            return row[key];
        }
    }

    return undefined;
};
