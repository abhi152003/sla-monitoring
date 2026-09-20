/**
 * Deterministic RFC 4180-style CSV parser: quoted fields, escaped quotes,
 * CR/LF inside quotes, LF/CRLF/CR endings, BOM stripping. Fully-empty records
 * are skipped anywhere. Unterminated quotes and junk after a closing quote
 * throw CsvSyntaxError (file-level malformed_csv).
 */

export class CsvSyntaxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvSyntaxError";
  }
}

export type CsvRecord = string[];

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function isBlankRecord(record: CsvRecord): boolean {
  return record.length === 0 || (record.length === 1 && record[0] === "");
}

export function parseCsv(text: string): CsvRecord[] {
  const records: CsvRecord[] = [];
  let record: CsvRecord = [];
  let field = "";
  let inQuotes = false;
  let afterClosingQuote = false;
  let sawAnyChar = false;

  const endField = () => {
    record.push(field);
    field = "";
    afterClosingQuote = false;
  };

  const endRecord = () => {
    endField();
    if (!isBlankRecord(record)) records.push(record);
    record = [];
    sawAnyChar = false;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
          afterClosingQuote = true;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (afterClosingQuote) {
      // RFC 4180: a closing quote may only be followed by a delimiter or EOL.
      if (ch === ",") {
        endField();
      } else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        endRecord();
      } else {
        throw new CsvSyntaxError(`Unexpected character ${JSON.stringify(ch)} after closing quote at offset ${i}`);
      }
      continue;
    }

    if (ch === '"' && field === "" && !sawAnyChar) {
      inQuotes = true;
      sawAnyChar = true;
      continue;
    }

    sawAnyChar = true;

    if (ch === ",") {
      endField();
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endRecord();
    } else {
      field += ch;
    }
  }

  if (inQuotes) {
    throw new CsvSyntaxError("Unterminated quoted field at end of input");
  }

  // Final record without a trailing newline.
  if (sawAnyChar || field !== "" || record.length > 0) {
    endField();
    if (!isBlankRecord(record)) records.push(record);
  }

  return records;
}
