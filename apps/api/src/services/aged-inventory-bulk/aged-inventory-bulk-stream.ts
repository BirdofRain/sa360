import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { stat } from "node:fs/promises";

/** RFC4180-ish CSV line parser (handles quotes). */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(filePath);
  for await (const chunk of stream) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

export async function assertFileSha256(
  filePath: string,
  expectedSha256: string
): Promise<{ sha256: string; sizeBytes: number }> {
  const sizeBytes = (await stat(filePath)).size;
  const sha256 = await sha256File(filePath);
  if (sha256.toLowerCase() !== expectedSha256.trim().toLowerCase()) {
    throw new Error(
      `file_checksum_mismatch:expected=${expectedSha256.toLowerCase()};actual=${sha256}`
    );
  }
  return { sha256, sizeBytes };
}

export type StreamCsvHandlers = {
  onHeader: (headers: string[]) => void | Promise<void>;
  onRow: (rowNumber: number, cols: string[]) => void | Promise<void>;
  /** 1-based data row number to start processing (inclusive). Rows before are skipped. */
  startRowNumber?: number;
};

/** Stream a UTF-8 CSV file row-by-row without loading the full file into memory. */
export async function streamCsvFile(
  filePath: string,
  handlers: StreamCsvHandlers
): Promise<{ dataRows: number; blankRows: number }> {
  const rl = createInterface({
    input: createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  let headerDone = false;
  let dataRows = 0;
  let blankRows = 0;
  const startRow = handlers.startRowNumber ?? 1;

  for await (const line of rl) {
    if (!headerDone) {
      headerDone = true;
      await handlers.onHeader(parseCsvLine(line));
      continue;
    }
    if (!line.trim()) {
      blankRows += 1;
      continue;
    }
    dataRows += 1;
    if (dataRows < startRow) continue;
    await handlers.onRow(dataRows, parseCsvLine(line));
  }

  return { dataRows, blankRows };
}
