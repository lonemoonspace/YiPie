import { previewImport, type ImportPreview } from '@/domain/config-transfer';

export type ImportReading =
  { kind: 'read'; preview: ImportPreview } | { kind: 'failed'; error: unknown };

export interface ImportReaderDeps<F> {
  /** Reads the chosen file's text (`File.text`). */
  read: (file: F) => Promise<string>;
  /** What came of reading the newest choice. */
  show: (reading: ImportReading) => void;
}

export interface ImportReader<F> {
  /** Reads `file`, replacing any choice still being read. */
  choose(file: F): void;
  /** Forgets the choice being read, if any: its result is never shown. */
  cancel(): void;
}

/**
 * Reads import files as the user picks them, and shows only the newest
 * pick's result. Reading is asynchronous, so a file picked earlier can
 * finish after one picked later; without this, its preview would replace
 * the later one's, and confirming would import the wrong file.
 */
export function createImportReader<F>(deps: ImportReaderDeps<F>): ImportReader<F> {
  let newest = 0;
  return {
    choose(file) {
      const ticket = ++newest;
      deps.read(file).then(
        (text) => {
          if (ticket === newest) deps.show({ kind: 'read', preview: previewImport(text) });
        },
        (error: unknown) => {
          if (ticket === newest) deps.show({ kind: 'failed', error });
        },
      );
    },
    cancel() {
      newest++;
    },
  };
}
