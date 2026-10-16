import { describe, expect, it } from 'vitest';
import { readZip } from '../../scripts/lib/zip';
import { writeZip } from '../helpers/zip-writer';

describe('readZip', () => {
  const files = [
    { name: 'manifest.json', data: '{"version":"1.2.3"}' },
    { name: 'chunks/panel.js', data: 'console.log("一瞥");'.repeat(50) },
  ];

  it('reads every file, deflated or stored', () => {
    for (const store of [false, true]) {
      expect(
        readZip(writeZip(files, store)).map((entry) => ({
          name: entry.name,
          data: entry.data.toString('utf8'),
        })),
      ).toEqual(files);
    }
  });

  it('refuses what is not a zip', () => {
    expect(() => readZip(Buffer.from('not a zip at all, just text'))).toThrow('不是 zip 文件');
  });
});
