import { inflateRawSync } from 'node:zlib';

/** One file in a zip archive. */
export interface ZipEntry {
  name: string;
  data: Buffer;
}

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_FILE_HEADER = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;

/**
 * Reads every file of a zip archive, as `wxt zip` writes it (stored or
 * deflated, no zip64, no encryption), through its central directory. Enough
 * to check a release package without a dependency (scripts/verify-release.ts).
 */
export function readZip(archive: Buffer): ZipEntry[] {
  const end = findEndOfCentralDirectory(archive);
  const count = archive.readUInt16LE(end + 10);
  let offset = archive.readUInt32LE(end + 16);
  const entries: ZipEntry[] = [];

  for (let index = 0; index < count; index += 1) {
    if (archive.readUInt32LE(offset) !== CENTRAL_FILE_HEADER) {
      throw new Error(`zip 的中央目录在第 ${index} 项处损坏`);
    }
    const method = archive.readUInt16LE(offset + 10);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const localOffset = archive.readUInt32LE(offset + 42);
    const name = archive.toString('utf8', offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;

    if (archive.readUInt32LE(localOffset) !== LOCAL_FILE_HEADER) {
      throw new Error(`zip 里 ${name} 的文件头损坏`);
    }
    const start =
      localOffset +
      30 +
      archive.readUInt16LE(localOffset + 26) +
      archive.readUInt16LE(localOffset + 28);
    const raw = archive.subarray(start, start + compressedSize);
    if (name.endsWith('/')) continue;
    if (method === 0) entries.push({ name, data: Buffer.from(raw) });
    else if (method === 8) entries.push({ name, data: inflateRawSync(raw) });
    else throw new Error(`zip 里 ${name} 用了不支持的压缩方式 ${method}`);
  }
  return entries;
}

function findEndOfCentralDirectory(archive: Buffer): number {
  // The record is 22 bytes plus a comment of at most 65535.
  const lowest = Math.max(0, archive.length - 22 - 0xffff);
  for (let offset = archive.length - 22; offset >= lowest; offset -= 1) {
    if (archive.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY) return offset;
  }
  throw new Error('不是 zip 文件：找不到中央目录');
}
