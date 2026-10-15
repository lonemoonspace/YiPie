import { describe, expect, it, vi } from 'vitest';
import { createImportReader, type ImportReading } from '@/features/settings/import-reader';

/** A file whose reading finishes when the test says so. */
function deferred() {
  let resolve: (text: string) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<string>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const file = (name: string, models: string[]) =>
  JSON.stringify({
    format: 'yipie-config',
    version: 1,
    models: models.map((model) => ({ name, baseURL: 'https://gw.example/v1', model })),
  });

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup() {
  const reads = new Map<string, ReturnType<typeof deferred>>();
  const shown: ImportReading[] = [];
  const reader = createImportReader<string>({
    read: (name) => {
      const read = deferred();
      reads.set(name, read);
      return read.promise;
    },
    show: vi.fn((reading: ImportReading) => shown.push(reading)),
  });
  return { reader, reads, shown };
}

const modelsOf = (reading: ImportReading | undefined) =>
  reading?.kind === 'read' && reading.preview.kind === 'ready'
    ? reading.preview.models.map((model) => model.model)
    : null;

describe('import reader', () => {
  it('shows what the chosen file would import', async () => {
    const { reader, reads, shown } = setup();

    reader.choose('a');
    reads.get('a')?.resolve(file('A', ['m-a']));
    await settle();

    expect(shown).toHaveLength(1);
    expect(modelsOf(shown[0])).toEqual(['m-a']);
  });

  it('ignores an earlier pick that finishes reading after a later one', async () => {
    const { reader, reads, shown } = setup();

    reader.choose('a');
    reader.choose('b');
    reads.get('b')?.resolve(file('B', ['m-b']));
    await settle();
    reads.get('a')?.resolve(file('A', ['m-a']));
    await settle();

    expect(shown).toHaveLength(1);
    expect(modelsOf(shown[0])).toEqual(['m-b']);
  });

  it('ignores an earlier pick that fails after a later one', async () => {
    const { reader, reads, shown } = setup();

    reader.choose('a');
    reader.choose('b');
    reads.get('a')?.reject(new Error('gone'));
    reads.get('b')?.resolve(file('B', ['m-b']));
    await settle();

    expect(shown).toHaveLength(1);
    expect(modelsOf(shown[0])).toEqual(['m-b']);
  });

  it('reports a failed reading of the newest pick', async () => {
    const { reader, reads, shown } = setup();

    reader.choose('a');
    reads.get('a')?.reject(new Error('gone'));
    await settle();

    expect(shown).toEqual([{ kind: 'failed', error: new Error('gone') }]);
  });

  it('shows nothing for a pick cancelled while it was read', async () => {
    const { reader, reads, shown } = setup();

    reader.choose('a');
    reader.cancel();
    reads.get('a')?.resolve(file('A', ['m-a']));
    await settle();

    expect(shown).toEqual([]);
  });
});
