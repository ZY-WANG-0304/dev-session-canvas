// Structural ELF fixture only; these bytes contain no executable code.
export function linuxExecutionElf(arch = 'x64', versions = ['GLIBC_2.17', 'GLIBC_2.28', 'GLIBCXX_3.4.22', 'CXXABI_1.3.9']) {
  const binary = Buffer.alloc(1024);
  binary.set([0x7f, 0x45, 0x4c, 0x46, 2, 1]);
  binary.writeUInt16LE(3, 16);
  binary.writeUInt16LE(arch === 'arm64' ? 183 : 62, 18);
  binary.writeBigUInt64LE(64n, 40);
  binary.writeUInt16LE(64, 58);
  binary.writeUInt16LE(3, 60);
  const names = ['libc.so.6', ...versions];
  let size = 1;
  const offsets = names.map(name => {
    const offset = size;
    size += binary.write(name, 320 + size) + 1;
    return offset;
  });
  binary.writeUInt32LE(3, 128 + 4);
  binary.writeBigUInt64LE(320n, 128 + 24);
  binary.writeBigUInt64LE(BigInt(size), 128 + 32);
  binary.writeUInt32LE(0x6ffffffe, 192 + 4);
  binary.writeBigUInt64LE(512n, 192 + 24);
  binary.writeBigUInt64LE(BigInt(16 + versions.length * 16), 192 + 32);
  binary.writeUInt32LE(1, 192 + 40);
  binary.writeUInt32LE(1, 192 + 44);
  binary.writeUInt16LE(1, 512);
  binary.writeUInt16LE(versions.length, 514);
  binary.writeUInt32LE(offsets[0], 516);
  binary.writeUInt32LE(16, 520);
  for (let index = 0; index < versions.length; index++) {
    binary.writeUInt32LE(offsets[index + 1], 528 + index * 16 + 8);
    binary.writeUInt32LE(index + 1 < versions.length ? 16 : 0, 528 + index * 16 + 12);
  }
  return binary;
}
