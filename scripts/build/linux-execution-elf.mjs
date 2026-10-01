import assert from 'node:assert/strict';

export function readLinuxExecutionRequirements(bytes, arch) {
  assert(['x64', 'arm64'].includes(arch), 'Unsupported Linux candidate architecture');
  assert(bytes.length >= 64 && bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))
    && bytes[4] === 2 && bytes[5] === 1 && bytes.readUInt16LE(16) === 3
    && bytes.readUInt16LE(18) === (arch === 'arm64' ? 183 : 62),
  'Candidate binary must declare matching ELF64 little-endian shared-object format');
  const number64 = offset => {
    const value = bytes.readBigUInt64LE(offset);
    assert(value <= BigInt(Number.MAX_SAFE_INTEGER), 'ELF offset exceeds the supported file size');
    return Number(value);
  };
  const range = (offset, length) => {
    assert(Number.isSafeInteger(offset) && Number.isSafeInteger(length) && offset >= 0 && length >= 0
      && offset <= bytes.length && length <= bytes.length - offset, 'ELF section is out of bounds');
  };
  const table = number64(40);
  const stride = bytes.readUInt16LE(58);
  const count = bytes.readUInt16LE(60);
  assert(stride === 64 && count > 0, 'ELF section table is required');
  range(table, stride * count);
  const section = index => {
    assert(Number.isInteger(index) && index >= 0 && index < count, 'ELF section link is out of bounds');
    const offset = table + index * stride;
    return { type: bytes.readUInt32LE(offset + 4), offset: number64(offset + 24),
      size: number64(offset + 32), link: bytes.readUInt32LE(offset + 40), count: bytes.readUInt32LE(offset + 44) };
  };
  const requirements = { glibcMinimum: undefined, glibcxxMinimum: undefined, cxxabiMinimum: undefined };
  const families = { GLIBC: 'glibcMinimum', GLIBCXX: 'glibcxxMinimum', CXXABI: 'cxxabiMinimum' };
  const newer = (left, right) => {
    const a = left.split('.').map(Number);
    const b = right.split('.').map(Number);
    for (let index = 0; index < Math.max(a.length, b.length); index++) {
      if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) > (b[index] ?? 0);
    }
    return false;
  };
  let found = false;
  for (let index = 0; index < count; index++) {
    const need = section(index);
    if (need.type !== 0x6ffffffe) continue;
    assert(!found, 'ELF has multiple version dependency sections');
    found = true;
    range(need.offset, need.size);
    const strings = section(need.link);
    assert(strings.type === 3, 'ELF version dependency strings are missing');
    range(strings.offset, strings.size);
    const nameAt = relative => {
      assert(relative < strings.size, 'ELF version string is out of bounds');
      const start = strings.offset + relative;
      const end = bytes.indexOf(0, start);
      assert(end >= start && end < strings.offset + strings.size, 'ELF version string is not terminated');
      return bytes.toString('utf8', start, end);
    };
    const inside = (offset, size) => {
      assert(offset >= need.offset && size <= need.offset + need.size - offset,
        'ELF version dependency record is out of bounds');
    };
    let offset = need.offset;
    assert(need.count > 0 && need.count <= Math.floor(need.size / 16), 'ELF version dependency count is invalid');
    for (let record = 0; record < need.count; record++) {
      inside(offset, 16);
      assert(bytes.readUInt16LE(offset) === 1, 'Unsupported ELF version dependency format');
      nameAt(bytes.readUInt32LE(offset + 4));
      const auxiliaryCount = bytes.readUInt16LE(offset + 2);
      assert(auxiliaryCount > 0 && auxiliaryCount <= Math.floor(need.size / 16), 'ELF version count is invalid');
      const auxiliaryDelta = bytes.readUInt32LE(offset + 8);
      assert(auxiliaryDelta >= 16, 'ELF version auxiliary offset is invalid');
      let auxiliary = offset + auxiliaryDelta;
      for (let item = 0; item < auxiliaryCount; item++) {
        inside(auxiliary, 16);
        const name = nameAt(bytes.readUInt32LE(auxiliary + 8));
        const match = /^(GLIBC|GLIBCXX|CXXABI)_(\d+\.\d+(?:\.\d+)?)$/.exec(name);
        if (match) {
          const key = families[match[1]];
          if (!requirements[key] || newer(match[2], requirements[key])) requirements[key] = match[2];
        } else {
          assert(!/^(GLIBC|GLIBCXX|CXXABI)_/.test(name), 'Unsupported ELF library version requirement');
        }
        const next = bytes.readUInt32LE(auxiliary + 12);
        assert(item + 1 === auxiliaryCount ? next === 0 : next >= 16, 'ELF version auxiliary chain is invalid');
        auxiliary += next;
      }
      const next = bytes.readUInt32LE(offset + 12);
      assert(record + 1 === need.count ? next === 0 : next >= 16, 'ELF version dependency chain is invalid');
      offset += next;
    }
  }
  assert(found && Object.values(requirements).every(value => typeof value === 'string'),
    'Candidate ELF must declare GLIBC, GLIBCXX and CXXABI version dependencies');
  return { napi: 8, linux: { libc: 'glibc', ...requirements } };
}
