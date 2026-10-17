import { utils, write, type BookType } from 'xlsx';
import { describe, expect, it } from 'vitest';

import {
  MAX_SPREADSHEET_FILE_BYTES,
  buildSpreadsheetSheetModel,
  extractSpreadsheetColumn,
  parseSpreadsheet,
} from '../../src/sidepanel/spreadsheet-import';
import {
  MAX_SPREADSHEET_CELL_TEXT_CHARS,
  MAX_SPREADSHEET_COLUMNS_PER_SHEET,
  MAX_XLSX_ENTRY_BYTES,
} from '../../src/sidepanel/spreadsheet-limits';

function workbookBytes(bookType: BookType): ArrayBuffer {
  const workbook = utils.book_new();
  utils.book_append_sheet(
    workbook,
    utils.aoa_to_sheet([
      ['ID', 'Prompt', 'Note'],
      [1, 'A cinematic sequence with carefully layered detail', 'short'],
      [2, 'Second detailed prompt', ''],
    ]),
    'Prompts',
  );
  utils.book_append_sheet(
    workbook,
    utils.aoa_to_sheet([['Prompt'], ['Alternate sheet prompt']]),
    'Alternates',
  );
  return write(workbook, { bookType, type: 'array' }) as ArrayBuffer;
}

function corruptFirstCentralDirectoryExpandedSize(
  data: ArrayBuffer,
): Uint8Array {
  const bytes = new Uint8Array(data.slice(0));
  const view = new DataView(bytes.buffer);
  for (let offset = 0; offset <= bytes.length - 46; offset += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) continue;
    view.setUint32(offset + 24, MAX_XLSX_ENTRY_BYTES + 1, true);
    return bytes;
  }
  throw new Error('Test workbook did not contain a ZIP central directory');
}

function mutateFirstZipEntry(
  data: ArrayBuffer,
  mutate: (view: DataView, centralOffset: number, localOffset: number) => void,
): Uint8Array {
  const bytes = new Uint8Array(data.slice(0));
  const view = new DataView(bytes.buffer);
  for (
    let centralOffset = 0;
    centralOffset <= bytes.length - 46;
    centralOffset += 1
  ) {
    if (view.getUint32(centralOffset, true) !== 0x02014b50) continue;
    mutate(view, centralOffset, view.getUint32(centralOffset + 42, true));
    return bytes;
  }
  throw new Error('Test workbook did not contain a ZIP central directory');
}

describe('spreadsheet prompt import', () => {
  it.each([
    ['prompts.xlsx', 'xlsx'],
    ['prompts.xls', 'xls'],
  ] as const)('parses sheets and columns from %s', (fileName, bookType) => {
    const result = parseSpreadsheet({
      fileName,
      data: workbookBytes(bookType),
    });

    expect(result.valid).toBe(true);
    expect(result.workbook?.sheets.map((sheet) => sheet.name)).toEqual([
      'Prompts',
      'Alternates',
    ]);
    const firstSheet = result.workbook?.sheets[0];
    expect(firstSheet?.columns.map((column) => column.label)).toEqual([
      'ID',
      'Prompt',
      'Note',
    ]);
    expect(firstSheet?.autoColumnIndex).toBe(1);
  });

  it('parses CSV bytes through the same SheetJS array API', () => {
    const csv = new TextEncoder().encode(
      'ID,Prompt,Note\r\n1,"A long, quoted cinematic prompt",short\r\n2,Another prompt,\r\n',
    );
    const result = parseSpreadsheet({ fileName: 'prompts.CSV', data: csv });

    expect(result.valid).toBe(true);
    expect(result.workbook).toMatchObject({
      extension: 'csv',
      selectedSheetName: 'Sheet1',
      selectedColumnIndex: 1,
    });
    const extraction = extractSpreadsheetColumn(result.workbook!);
    expect(extraction.valid).toBe(true);
    expect(extraction.values).toEqual([
      'A long, quoted cinematic prompt',
      'Another prompt',
    ]);
  });

  it('selects the column containing the longest text with deterministic tie breakers', () => {
    const sheet = buildSpreadsheetSheetModel('Prompts', [
      ['A', 'B', 'C'],
      ['123456', 'abcdef', 'abcdef'],
      ['', 'extra', 'extra'],
    ]);

    expect(sheet.columns).toMatchObject([
      { longestTextLength: 6, totalTextLength: 6, nonEmptyCount: 1 },
      { longestTextLength: 6, totalTextLength: 11, nonEmptyCount: 2 },
      { longestTextLength: 6, totalTextLength: 11, nonEmptyCount: 2 },
    ]);
    expect(sheet.autoColumnIndex).toBe(1);
  });

  it('can treat the first row as prompt data when the file has no header', () => {
    const csv = new TextEncoder().encode(
      'Brief,1\r\nA substantially longer prompt,2\r\n',
    );
    const parsed = parseSpreadsheet({
      fileName: 'no-header.csv',
      data: csv,
      hasHeader: false,
    });

    expect(parsed.valid).toBe(true);
    const sheet = parsed.workbook?.sheets[0];
    expect(sheet?.columns.map((column) => column.label)).toEqual([
      'Column A',
      'Column B',
    ]);
    const extraction = extractSpreadsheetColumn(parsed.workbook!);
    expect(extraction.values).toEqual([
      'Brief',
      'A substantially longer prompt',
    ]);
    expect(extraction.metadata).toMatchObject({
      sourceRowCount: 2,
      extractedValueCount: 2,
      skippedEmptyRowCount: 0,
    });
  });

  it('extracts an explicit sheet and column and reports skipped empty rows', () => {
    const parsed = parseSpreadsheet({
      fileName: 'prompts.xlsx',
      data: workbookBytes('xlsx'),
    });
    const extraction = extractSpreadsheetColumn(parsed.workbook!, {
      sheetName: 'Prompts',
      columnIndex: 2,
    });

    expect(extraction.valid).toBe(true);
    expect(extraction.values).toEqual(['short']);
    expect(extraction.metadata).toMatchObject({
      sheetName: 'Prompts',
      columnIndex: 2,
      columnKey: 'C',
      columnLabel: 'Note',
      usedAutoSelection: false,
      sourceRowCount: 2,
      extractedValueCount: 1,
      skippedEmptyRowCount: 1,
    });
  });

  it('returns structured file, sheet, column, and empty-data errors', () => {
    expect(
      parseSpreadsheet({
        fileName: 'prompts.txt',
        data: new TextEncoder().encode('prompt'),
      }).errors,
    ).toMatchObject([{ code: 'UNSUPPORTED_FILE_TYPE' }]);
    expect(
      parseSpreadsheet({
        fileName: 'prompts.csv',
        data: new Uint8Array(),
      }).errors,
    ).toMatchObject([{ code: 'EMPTY_FILE' }]);
    expect(
      parseSpreadsheet({
        fileName: 'oversized.xlsx',
        data: new Uint8Array(MAX_SPREADSHEET_FILE_BYTES + 1),
      }).errors,
    ).toMatchObject([{ code: 'FILE_TOO_LARGE' }]);

    const headerOnly = parseSpreadsheet({
      fileName: 'header-only.csv',
      data: new TextEncoder().encode('Prompt,Note\r\n'),
    });
    expect(headerOnly.errors).toMatchObject([{ code: 'NO_TEXT_COLUMN' }]);

    const parsed = parseSpreadsheet({
      fileName: 'prompts.xlsx',
      data: workbookBytes('xlsx'),
    });
    expect(
      extractSpreadsheetColumn(parsed.workbook!, { sheetName: 'Missing' })
        .errors,
    ).toMatchObject([{ code: 'SHEET_NOT_FOUND', sheetName: 'Missing' }]);
    expect(
      extractSpreadsheetColumn(parsed.workbook!, {
        sheetName: 'Prompts',
        columnIndex: 99,
      }).errors,
    ).toMatchObject([
      {
        code: 'COLUMN_OUT_OF_RANGE',
        sheetName: 'Prompts',
        columnIndex: 99,
      },
    ]);
  });

  it('rejects XLSX expansion metadata before SheetJS materializes the workbook', () => {
    const result = parseSpreadsheet({
      fileName: 'bomb.xlsx',
      data: corruptFirstCentralDirectoryExpandedSize(workbookBytes('xlsx')),
    });

    expect(result.errors).toMatchObject([{ code: 'EXPANSION_LIMIT_EXCEEDED' }]);
  });

  it('rejects a central-small/local-huge XLSX size mismatch before SheetJS', () => {
    const data = mutateFirstZipEntry(
      workbookBytes('xlsx'),
      (view, _centralOffset, localOffset) => {
        view.setUint32(localOffset + 22, MAX_XLSX_ENTRY_BYTES + 1, true);
      },
    );

    expect(
      parseSpreadsheet({ fileName: 'local-huge.xlsx', data }).errors,
    ).toMatchObject([{ code: 'EXPANSION_LIMIT_EXCEEDED' }]);
  });

  it('rejects XLSX data-descriptor flags before SheetJS can grow dynamically', () => {
    const data = mutateFirstZipEntry(
      workbookBytes('xlsx'),
      (view, centralOffset, localOffset) => {
        view.setUint16(centralOffset + 8, 0x0008, true);
        view.setUint16(localOffset + 6, 0x0008, true);
        view.setUint32(localOffset + 18, 0, true);
        view.setUint32(localOffset + 22, 0, true);
      },
    );

    expect(
      parseSpreadsheet({ fileName: 'descriptor.xlsx', data }).errors,
    ).toMatchObject([{ code: 'EXPANSION_LIMIT_EXCEEDED' }]);
  });

  it('bounds structural columns and cell text during model materialization', () => {
    expect(() =>
      buildSpreadsheetSheetModel('Wide', [
        Array.from(
          { length: MAX_SPREADSHEET_COLUMNS_PER_SHEET + 1 },
          () => 'value',
        ),
      ]),
    ).toThrow(/too many columns/u);
    expect(() =>
      buildSpreadsheetSheetModel('Long', [
        ['Prompt'],
        ['x'.repeat(MAX_SPREADSHEET_CELL_TEXT_CHARS + 1)],
      ]),
    ).toThrow(/cell exceeds the text limit/u);
  });
});
