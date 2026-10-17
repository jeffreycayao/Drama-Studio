import { read, utils, type WorkBook, type WorkSheet } from 'xlsx';
import {
  MAX_SPREADSHEET_CELLS_PER_SHEET,
  MAX_SPREADSHEET_CELLS_PER_WORKBOOK,
  MAX_SPREADSHEET_CELL_TEXT_CHARS,
  MAX_SPREADSHEET_COLUMNS_PER_SHEET,
  MAX_SPREADSHEET_FILE_BYTES,
  MAX_SPREADSHEET_ROWS_PER_SHEET,
  MAX_SPREADSHEET_SHEETS,
  MAX_SPREADSHEET_TOTAL_TEXT_CHARS,
  MAX_XLSX_ARCHIVE_ENTRIES,
  MAX_XLSX_ENTRY_BYTES,
  MAX_XLSX_EXPANDED_BYTES,
  MAX_XLSX_EXPANSION_RATIO,
} from './spreadsheet-limits';

export { MAX_SPREADSHEET_FILE_BYTES } from './spreadsheet-limits';

export const SUPPORTED_SPREADSHEET_EXTENSIONS = ['csv', 'xls', 'xlsx'] as const;

export type SupportedSpreadsheetExtension =
  (typeof SUPPORTED_SPREADSHEET_EXTENSIONS)[number];

export interface ParseSpreadsheetInput {
  data: ArrayBuffer | Uint8Array;
  fileName: string;
  /** Defaults to true. The first row is retained as labels, not prompt data. */
  hasHeader?: boolean;
}

export type SpreadsheetImportErrorCode =
  | 'UNSUPPORTED_FILE_TYPE'
  | 'EMPTY_FILE'
  | 'FILE_TOO_LARGE'
  | 'EXPANSION_LIMIT_EXCEEDED'
  | 'STRUCTURE_LIMIT_EXCEEDED'
  | 'PARSE_FAILED'
  | 'NO_SHEETS'
  | 'NO_TEXT_COLUMN'
  | 'SHEET_NOT_FOUND'
  | 'COLUMN_OUT_OF_RANGE';

export interface SpreadsheetImportError {
  code: SpreadsheetImportErrorCode;
  message: string;
  sheetName?: string;
  columnIndex?: number;
}

export interface SpreadsheetColumnModel {
  /** Zero-based column index. */
  index: number;
  /** Spreadsheet column key, for example A or AB. */
  key: string;
  label: string;
  nonEmptyCount: number;
  longestTextLength: number;
  totalTextLength: number;
}

export interface SpreadsheetSheetModel {
  name: string;
  hasHeader: boolean;
  /** Normalized rows including the header, when one is configured. */
  rows: string[][];
  dataRowCount: number;
  columns: SpreadsheetColumnModel[];
  /** The column containing the longest text cell, with deterministic ties. */
  autoColumnIndex: number | null;
}

export interface SpreadsheetWorkbookModel {
  fileName: string;
  extension: SupportedSpreadsheetExtension;
  sheets: SpreadsheetSheetModel[];
  selectedSheetName: string;
  selectedColumnIndex: number | null;
}

export interface SpreadsheetParseResult {
  valid: boolean;
  workbook: SpreadsheetWorkbookModel | null;
  errors: SpreadsheetImportError[];
}

export interface SpreadsheetColumnSelection {
  sheetName?: string;
  /** Zero-based. Omit to use the sheet's longest-text auto-selection. */
  columnIndex?: number;
}

export interface SpreadsheetColumnExtractionMetadata {
  sheetName: string;
  columnIndex: number;
  columnKey: string;
  columnLabel: string;
  usedAutoSelection: boolean;
  sourceRowCount: number;
  extractedValueCount: number;
  skippedEmptyRowCount: number;
}

export interface SpreadsheetColumnExtractionResult {
  valid: boolean;
  values: string[];
  metadata: SpreadsheetColumnExtractionMetadata | null;
  errors: SpreadsheetImportError[];
}

function fileExtension(fileName: string): string {
  const match = /\.([^.]+)$/.exec(fileName.trim());
  return match?.[1]?.toLocaleLowerCase() ?? '';
}

function supportedExtension(
  extension: string,
): extension is SupportedSpreadsheetExtension {
  return (SUPPORTED_SPREADSHEET_EXTENSIONS as readonly string[]).includes(
    extension,
  );
}

function byteLength(data: ArrayBuffer | Uint8Array): number {
  return data.byteLength;
}

function dataBytes(data: ArrayBuffer | Uint8Array): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

class SpreadsheetLimitError extends Error {}

interface TextBudget {
  cellCount: number;
  textChars: number;
}

interface ZipLocalRange {
  start: number;
  end: number;
}

function readUint16(view: DataView, offset: number): number {
  if (offset < 0 || offset + 2 > view.byteLength) {
    throw new SpreadsheetLimitError('The XLSX directory is truncated.');
  }
  return view.getUint16(offset, true);
}

function readUint32(view: DataView, offset: number): number {
  if (offset < 0 || offset + 4 > view.byteLength) {
    throw new SpreadsheetLimitError('The XLSX directory is truncated.');
  }
  return view.getUint32(offset, true);
}

function rejectZip64ExtraField(
  view: DataView,
  offset: number,
  length: number,
): void {
  const end = offset + length;
  if (offset < 0 || end > view.byteLength || end < offset) {
    throw new SpreadsheetLimitError('An XLSX extra field is truncated.');
  }
  while (offset < end) {
    if (offset + 4 > end) {
      throw new SpreadsheetLimitError('An XLSX extra field is truncated.');
    }
    const fieldId = readUint16(view, offset);
    const fieldLength = readUint16(view, offset + 2);
    offset += 4;
    if (offset + fieldLength > end) {
      throw new SpreadsheetLimitError('An XLSX extra field is truncated.');
    }
    if (fieldId === 0x0001) {
      throw new SpreadsheetLimitError('ZIP64 XLSX entries are not supported.');
    }
    offset += fieldLength;
  }
}

function equalByteRanges(
  bytes: Uint8Array,
  firstOffset: number,
  secondOffset: number,
  length: number,
): boolean {
  if (
    firstOffset < 0 ||
    secondOffset < 0 ||
    firstOffset + length > bytes.byteLength ||
    secondOffset + length > bytes.byteLength
  ) {
    return false;
  }
  for (let index = 0; index < length; index += 1) {
    if (bytes[firstOffset + index] !== bytes[secondOffset + index])
      return false;
  }
  return true;
}

function findEndOfCentralDirectory(bytes: Uint8Array): number {
  const minimumOffset = Math.max(0, bytes.byteLength - 65_557);
  for (
    let offset = bytes.byteLength - 22;
    offset >= minimumOffset;
    offset -= 1
  ) {
    if (
      bytes[offset] === 0x50 &&
      bytes[offset + 1] === 0x4b &&
      bytes[offset + 2] === 0x05 &&
      bytes[offset + 3] === 0x06
    ) {
      return offset;
    }
  }
  throw new SpreadsheetLimitError('The XLSX central directory is missing.');
}

export function preflightXlsxArchive(data: ArrayBuffer | Uint8Array): void {
  const bytes = dataBytes(data);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const endOffset = findEndOfCentralDirectory(bytes);
  const diskNumber = readUint16(view, endOffset + 4);
  const centralDirectoryDisk = readUint16(view, endOffset + 6);
  const entriesOnDisk = readUint16(view, endOffset + 8);
  const totalEntries = readUint16(view, endOffset + 10);
  const centralDirectoryBytes = readUint32(view, endOffset + 12);
  const centralDirectoryOffset = readUint32(view, endOffset + 16);
  const archiveCommentLength = readUint16(view, endOffset + 20);
  if (
    diskNumber !== 0 ||
    centralDirectoryDisk !== 0 ||
    entriesOnDisk !== totalEntries ||
    totalEntries === 0xffff ||
    centralDirectoryBytes === 0xffffffff ||
    centralDirectoryOffset === 0xffffffff
  ) {
    throw new SpreadsheetLimitError(
      'Multi-disk and ZIP64 XLSX files are not supported.',
    );
  }
  if (totalEntries < 1 || totalEntries > MAX_XLSX_ARCHIVE_ENTRIES) {
    throw new SpreadsheetLimitError(
      'The XLSX archive contains too many entries.',
    );
  }
  if (
    endOffset + 22 + archiveCommentLength !== bytes.byteLength ||
    centralDirectoryOffset + centralDirectoryBytes !== endOffset ||
    centralDirectoryOffset + centralDirectoryBytes > bytes.byteLength
  ) {
    throw new SpreadsheetLimitError('The XLSX central directory is invalid.');
  }

  let offset = centralDirectoryOffset;
  let expandedBytes = 0;
  const entryNames = new Set<string>();
  const localRanges: ZipLocalRange[] = [];
  const filenameDecoder = new TextDecoder('utf-8', { fatal: true });
  for (let index = 0; index < totalEntries; index += 1) {
    if (readUint32(view, offset) !== 0x02014b50) {
      throw new SpreadsheetLimitError('The XLSX central directory is invalid.');
    }
    const flags = readUint16(view, offset + 8);
    const compressionMethod = readUint16(view, offset + 10);
    const compressedBytes = readUint32(view, offset + 20);
    const uncompressedBytes = readUint32(view, offset + 24);
    const fileNameLength = readUint16(view, offset + 28);
    const extraLength = readUint16(view, offset + 30);
    const commentLength = readUint16(view, offset + 32);
    const startingDisk = readUint16(view, offset + 34);
    const localHeaderOffset = readUint32(view, offset + 42);
    const centralEntryEnd =
      offset + 46 + fileNameLength + extraLength + commentLength;
    if (centralEntryEnd > centralDirectoryOffset + centralDirectoryBytes) {
      throw new SpreadsheetLimitError(
        'The XLSX central directory is truncated.',
      );
    }
    let entryName: string;
    try {
      entryName = filenameDecoder.decode(
        bytes.subarray(offset + 46, offset + 46 + fileNameLength),
      );
    } catch {
      throw new SpreadsheetLimitError('An XLSX entry name is invalid.');
    }
    const entrySegments = entryName.split('/');
    if (
      entryName.length < 1 ||
      entryName.length > 512 ||
      entryName.startsWith('/') ||
      entryName.includes('\\') ||
      entryName.includes('\0') ||
      entrySegments.includes('..') ||
      entryNames.has(entryName)
    ) {
      throw new SpreadsheetLimitError('An XLSX entry path is unsafe.');
    }
    entryNames.add(entryName);
    rejectZip64ExtraField(view, offset + 46 + fileNameLength, extraLength);
    if (
      startingDisk !== 0 ||
      (flags & ~0x0800) !== 0 ||
      ![0, 8].includes(compressionMethod)
    ) {
      throw new SpreadsheetLimitError(
        'Data-descriptor, encrypted, multi-disk, or unsupported XLSX entries are not allowed.',
      );
    }
    if (uncompressedBytes > MAX_XLSX_ENTRY_BYTES) {
      throw new SpreadsheetLimitError(
        'An XLSX entry exceeds the expanded-size limit.',
      );
    }
    if (uncompressedBytes > 0 && compressedBytes === 0) {
      throw new SpreadsheetLimitError(
        'An XLSX entry has invalid compressed-size metadata.',
      );
    }
    if (compressionMethod === 0 && compressedBytes !== uncompressedBytes) {
      throw new SpreadsheetLimitError(
        'A stored XLSX entry has inconsistent sizes.',
      );
    }
    if (
      compressionMethod === 8 &&
      compressedBytes > 0 &&
      uncompressedBytes / compressedBytes > MAX_XLSX_EXPANSION_RATIO
    ) {
      throw new SpreadsheetLimitError('The XLSX expansion ratio is unsafe.');
    }
    expandedBytes += uncompressedBytes;
    if (expandedBytes > MAX_XLSX_EXPANDED_BYTES) {
      throw new SpreadsheetLimitError(
        'The XLSX expanded data exceeds the size limit.',
      );
    }
    if (readUint32(view, localHeaderOffset) !== 0x04034b50) {
      throw new SpreadsheetLimitError('An XLSX local entry header is invalid.');
    }
    const localFlags = readUint16(view, localHeaderOffset + 6);
    const localMethod = readUint16(view, localHeaderOffset + 8);
    const localCrc32 = readUint32(view, localHeaderOffset + 14);
    const localCompressedBytes = readUint32(view, localHeaderOffset + 18);
    const localUncompressedBytes = readUint32(view, localHeaderOffset + 22);
    const localNameLength = readUint16(view, localHeaderOffset + 26);
    const localExtraLength = readUint16(view, localHeaderOffset + 28);
    const centralCrc32 = readUint32(view, offset + 16);
    if (
      localFlags !== flags ||
      localMethod !== compressionMethod ||
      localCrc32 !== centralCrc32 ||
      localCompressedBytes !== compressedBytes ||
      localUncompressedBytes !== uncompressedBytes ||
      localNameLength !== fileNameLength ||
      !equalByteRanges(
        bytes,
        localHeaderOffset + 30,
        offset + 46,
        fileNameLength,
      )
    ) {
      throw new SpreadsheetLimitError(
        'An XLSX entry has inconsistent headers.',
      );
    }
    rejectZip64ExtraField(
      view,
      localHeaderOffset + 30 + localNameLength,
      localExtraLength,
    );
    const dataOffset =
      localHeaderOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataOffset + compressedBytes;
    if (
      dataOffset > centralDirectoryOffset ||
      dataEnd > centralDirectoryOffset ||
      dataEnd < dataOffset
    ) {
      throw new SpreadsheetLimitError(
        'An XLSX entry exceeds its archive boundary.',
      );
    }
    localRanges.push({ start: localHeaderOffset, end: dataEnd });
    offset = centralEntryEnd;
  }
  if (offset !== centralDirectoryOffset + centralDirectoryBytes) {
    throw new SpreadsheetLimitError(
      'The XLSX central directory length is invalid.',
    );
  }
  localRanges.sort((first, second) => first.start - second.start);
  for (let index = 1; index < localRanges.length; index += 1) {
    if (localRanges[index - 1]!.end > localRanges[index]!.start) {
      throw new SpreadsheetLimitError('XLSX entries overlap in the archive.');
    }
  }
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value.trim();
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value);
  }
  return '';
}

function boundedCellText(value: unknown, budget: TextBudget): string {
  const text = cellText(value);
  if (text.length > MAX_SPREADSHEET_CELL_TEXT_CHARS) {
    throw new SpreadsheetLimitError(
      'A spreadsheet cell exceeds the text limit.',
    );
  }
  budget.cellCount += 1;
  budget.textChars += text.length;
  if (
    budget.cellCount > MAX_SPREADSHEET_CELLS_PER_WORKBOOK ||
    budget.textChars > MAX_SPREADSHEET_TOTAL_TEXT_CHARS
  ) {
    throw new SpreadsheetLimitError(
      'The spreadsheet exceeds the workbook data limits.',
    );
  }
  return text;
}

function normalizeRows(sheet: WorkSheet, budget: TextBudget): string[][] {
  const rawRows = utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: false,
    defval: '',
    blankrows: false,
  });
  return rawRows.map((row) =>
    row.map((value) => boundedCellText(value, budget)),
  );
}

function worksheetRangeSize(sheet: WorkSheet): {
  rows: number;
  columns: number;
  cells: number;
} {
  const reference = sheet['!ref'];
  if (!reference) return { rows: 0, columns: 0, cells: 0 };
  if (reference.length > 100) {
    throw new SpreadsheetLimitError('A spreadsheet range is invalid.');
  }
  const range = utils.decode_range(reference);
  const rows = range.e.r - range.s.r + 1;
  const columns = range.e.c - range.s.c + 1;
  const cells = rows * columns;
  if (
    rows < 1 ||
    columns < 1 ||
    !Number.isSafeInteger(cells) ||
    rows > MAX_SPREADSHEET_ROWS_PER_SHEET ||
    columns > MAX_SPREADSHEET_COLUMNS_PER_SHEET ||
    cells > MAX_SPREADSHEET_CELLS_PER_SHEET
  ) {
    throw new SpreadsheetLimitError(
      'A spreadsheet sheet exceeds the range limits.',
    );
  }
  return { rows, columns, cells };
}

function validateWorkbookStructure(workbook: WorkBook): void {
  if (workbook.SheetNames.length > MAX_SPREADSHEET_SHEETS) {
    throw new SpreadsheetLimitError('The workbook contains too many sheets.');
  }
  let totalCells = 0;
  for (const name of workbook.SheetNames) {
    const worksheet = workbook.Sheets[name];
    if (!worksheet) continue;
    totalCells += worksheetRangeSize(worksheet).cells;
    if (totalCells > MAX_SPREADSHEET_CELLS_PER_WORKBOOK) {
      throw new SpreadsheetLimitError('The workbook contains too many cells.');
    }
  }
}

function columnLabel(
  rows: readonly (readonly string[])[],
  columnIndex: number,
  hasHeader: boolean,
): string {
  const header = hasHeader ? rows[0]?.[columnIndex]?.trim() : '';
  return header || `Column ${utils.encode_col(columnIndex)}`;
}

function compareColumns(
  candidate: SpreadsheetColumnModel,
  current: SpreadsheetColumnModel,
): number {
  if (candidate.longestTextLength !== current.longestTextLength)
    return candidate.longestTextLength - current.longestTextLength;
  if (candidate.totalTextLength !== current.totalTextLength)
    return candidate.totalTextLength - current.totalTextLength;
  if (candidate.nonEmptyCount !== current.nonEmptyCount)
    return candidate.nonEmptyCount - current.nonEmptyCount;
  return current.index - candidate.index;
}

/** Builds a serializable sheet model from the SheetJS array-of-arrays API. */
export function buildSpreadsheetSheetModel(
  name: string,
  rows: readonly (readonly unknown[])[],
  hasHeader = true,
): SpreadsheetSheetModel {
  if (rows.length > MAX_SPREADSHEET_ROWS_PER_SHEET) {
    throw new SpreadsheetLimitError(
      'A spreadsheet sheet contains too many rows.',
    );
  }
  const budget: TextBudget = { cellCount: 0, textChars: 0 };
  const normalizedRows = rows.map((row) => {
    if (row.length > MAX_SPREADSHEET_COLUMNS_PER_SHEET) {
      throw new SpreadsheetLimitError(
        'A spreadsheet sheet contains too many columns.',
      );
    }
    return row.map((value) => boundedCellText(value, budget));
  });
  return buildNormalizedSpreadsheetSheetModel(name, normalizedRows, hasHeader);
}

function buildNormalizedSpreadsheetSheetModel(
  name: string,
  normalizedRows: string[][],
  hasHeader: boolean,
): SpreadsheetSheetModel {
  const dataRows = hasHeader ? normalizedRows.slice(1) : normalizedRows;
  const columnCount = normalizedRows.reduce(
    (maximum, row) => Math.max(maximum, row.length),
    0,
  );
  const columns: SpreadsheetColumnModel[] = Array.from(
    { length: columnCount },
    (_, index) => {
      const values = dataRows
        .map((row) => row[index]?.trim() ?? '')
        .filter(Boolean);
      return {
        index,
        key: utils.encode_col(index),
        label: columnLabel(normalizedRows, index, hasHeader),
        nonEmptyCount: values.length,
        longestTextLength: values.reduce(
          (maximum, value) => Math.max(maximum, value.length),
          0,
        ),
        totalTextLength: values.reduce(
          (total, value) => total + value.length,
          0,
        ),
      };
    },
  );
  const populatedColumns = columns.filter((column) => column.nonEmptyCount > 0);
  const autoColumn = populatedColumns.reduce<SpreadsheetColumnModel | null>(
    (current, candidate) =>
      current === null || compareColumns(candidate, current) > 0
        ? candidate
        : current,
    null,
  );

  return {
    name,
    hasHeader,
    rows: normalizedRows,
    dataRowCount: dataRows.length,
    columns,
    autoColumnIndex: autoColumn?.index ?? null,
  };
}

function buildSheetModels(
  workbook: WorkBook,
  hasHeader: boolean,
): SpreadsheetSheetModel[] {
  validateWorkbookStructure(workbook);
  const budget: TextBudget = { cellCount: 0, textChars: 0 };
  return workbook.SheetNames.flatMap((name) => {
    const worksheet = workbook.Sheets[name];
    if (!worksheet) return [];
    return [
      buildNormalizedSpreadsheetSheetModel(
        name,
        normalizeRows(worksheet, budget),
        hasHeader,
      ),
    ];
  });
}

function parseFailureMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return 'The spreadsheet data could not be decoded.';
}

/**
 * Parses local XLS, XLSX, or CSV bytes with pinned official SheetJS 0.20.3.
 * The read / sheet_to_json calls retain compatibility with the 0.18.5 API.
 * No formulas, macros, external links, HTML, or styles are evaluated or retained.
 */
export function parseSpreadsheet(
  input: ParseSpreadsheetInput,
): SpreadsheetParseResult {
  const extension = fileExtension(input.fileName);
  if (!supportedExtension(extension)) {
    return {
      valid: false,
      workbook: null,
      errors: [
        {
          code: 'UNSUPPORTED_FILE_TYPE',
          message: 'Choose a .csv, .xls, or .xlsx file.',
        },
      ],
    };
  }
  if (byteLength(input.data) === 0) {
    return {
      valid: false,
      workbook: null,
      errors: [
        {
          code: 'EMPTY_FILE',
          message: `${input.fileName} is empty.`,
        },
      ],
    };
  }
  if (byteLength(input.data) > MAX_SPREADSHEET_FILE_BYTES) {
    return {
      valid: false,
      workbook: null,
      errors: [
        {
          code: 'FILE_TOO_LARGE',
          message: `${input.fileName} exceeds the 10 MiB spreadsheet limit.`,
        },
      ],
    };
  }

  if (extension === 'xlsx') {
    try {
      preflightXlsxArchive(input.data);
    } catch (error) {
      return {
        valid: false,
        workbook: null,
        errors: [
          {
            code: 'EXPANSION_LIMIT_EXCEEDED',
            message: `Could not read ${input.fileName}: ${parseFailureMessage(error)}`,
          },
        ],
      };
    }
  }

  let parsed: WorkBook;
  try {
    parsed = read(input.data, {
      type: 'array',
      cellDates: false,
      cellFormula: false,
      cellHTML: false,
      cellStyles: false,
      bookFiles: false,
      bookVBA: false,
      dense: false,
      WTF: false,
    });
  } catch (error) {
    return {
      valid: false,
      workbook: null,
      errors: [
        {
          code: 'PARSE_FAILED',
          message: `Could not read ${input.fileName}: ${parseFailureMessage(error)}`,
        },
      ],
    };
  }

  let sheets: SpreadsheetSheetModel[];
  try {
    sheets = buildSheetModels(parsed, input.hasHeader ?? true);
  } catch (error) {
    return {
      valid: false,
      workbook: null,
      errors: [
        {
          code: 'STRUCTURE_LIMIT_EXCEEDED',
          message: `Could not read ${input.fileName}: ${parseFailureMessage(error)}`,
        },
      ],
    };
  }
  if (sheets.length === 0) {
    return {
      valid: false,
      workbook: null,
      errors: [
        {
          code: 'NO_SHEETS',
          message: `${input.fileName} does not contain a readable sheet.`,
        },
      ],
    };
  }
  const selectedSheet =
    sheets.find((sheet) => sheet.autoColumnIndex !== null) ?? sheets[0];
  if (!selectedSheet || selectedSheet.autoColumnIndex === null) {
    return {
      valid: false,
      workbook: null,
      errors: [
        {
          code: 'NO_TEXT_COLUMN',
          message: `${input.fileName} does not contain a non-empty prompt column.`,
        },
      ],
    };
  }

  return {
    valid: true,
    workbook: {
      fileName: input.fileName,
      extension,
      sheets,
      selectedSheetName: selectedSheet.name,
      selectedColumnIndex: selectedSheet.autoColumnIndex,
    },
    errors: [],
  };
}

/** Extracts trimmed, non-empty values from an explicit or auto-selected column. */
export function extractSpreadsheetColumn(
  workbook: SpreadsheetWorkbookModel,
  selection: SpreadsheetColumnSelection = {},
): SpreadsheetColumnExtractionResult {
  const sheetName = selection.sheetName ?? workbook.selectedSheetName;
  const sheet = workbook.sheets.find(
    (candidate) => candidate.name === sheetName,
  );
  if (!sheet) {
    return {
      valid: false,
      values: [],
      metadata: null,
      errors: [
        {
          code: 'SHEET_NOT_FOUND',
          message: `Sheet ${sheetName} was not found.`,
          sheetName,
        },
      ],
    };
  }

  const usedAutoSelection = selection.columnIndex === undefined;
  const columnIndex = selection.columnIndex ?? sheet.autoColumnIndex;
  if (columnIndex === null) {
    return {
      valid: false,
      values: [],
      metadata: null,
      errors: [
        {
          code: 'NO_TEXT_COLUMN',
          message: `Sheet ${sheet.name} does not contain a non-empty prompt column.`,
          sheetName: sheet.name,
        },
      ],
    };
  }
  if (
    !Number.isInteger(columnIndex) ||
    columnIndex < 0 ||
    columnIndex >= sheet.columns.length
  ) {
    return {
      valid: false,
      values: [],
      metadata: null,
      errors: [
        {
          code: 'COLUMN_OUT_OF_RANGE',
          message: `Column index ${columnIndex} is outside sheet ${sheet.name}.`,
          sheetName: sheet.name,
          columnIndex,
        },
      ],
    };
  }

  const column = sheet.columns[columnIndex];
  if (!column) {
    return {
      valid: false,
      values: [],
      metadata: null,
      errors: [
        {
          code: 'COLUMN_OUT_OF_RANGE',
          message: `Column index ${columnIndex} is outside sheet ${sheet.name}.`,
          sheetName: sheet.name,
          columnIndex,
        },
      ],
    };
  }
  const sourceRows = sheet.hasHeader ? sheet.rows.slice(1) : sheet.rows;
  const rawValues = sourceRows.map((row) => row[columnIndex]?.trim() ?? '');
  const values = rawValues.filter(Boolean);
  const metadata: SpreadsheetColumnExtractionMetadata = {
    sheetName: sheet.name,
    columnIndex,
    columnKey: column.key,
    columnLabel: column.label,
    usedAutoSelection,
    sourceRowCount: rawValues.length,
    extractedValueCount: values.length,
    skippedEmptyRowCount: rawValues.length - values.length,
  };
  if (values.length === 0) {
    return {
      valid: false,
      values: [],
      metadata,
      errors: [
        {
          code: 'NO_TEXT_COLUMN',
          message: `Column ${column.label} in sheet ${sheet.name} is empty.`,
          sheetName: sheet.name,
          columnIndex,
        },
      ],
    };
  }

  return { valid: true, values, metadata, errors: [] };
}
