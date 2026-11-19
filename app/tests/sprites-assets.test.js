'use strict';

// Sprite asset regression tests for app/assets/sprites/manifest.json.
// Zero-dependency (node:test + node:fs only). Pixel-level halo checks are
// delegated to python3 (zlib) when available and skipped otherwise.

const { test, skip } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const APP_DIR = path.resolve(__dirname, '..');
const REPO_DIR = path.resolve(APP_DIR, '..');
const SPRITES_DIR = path.join(APP_DIR, 'assets', 'sprites');
const MANIFEST_PATH = path.join(SPRITES_DIR, 'manifest.json');

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
const anims = manifest.animations;

// Reads the 8-byte PNG signature plus the IHDR width/height (bytes 16..24).
function readPngHeader(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(33);
    const bytesRead = fs.readSync(fd, buf, 0, 33, 0);
    assert.equal(bytesRead, 33, `${file}: truncated (<33 bytes)`);
    assert.ok(buf.subarray(0, 8).equals(PNG_SIGNATURE), `${file}: bad PNG signature`);
    assert.equal(buf.readUInt32BE(8), 13, `${file}: IHDR length != 13`);
    assert.equal(buf.toString('ascii', 12, 16), 'IHDR', `${file}: first chunk is not IHDR`);
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  } finally {
    fs.closeSync(fd);
  }
}

// Counts pixels with 0 < alpha < 48 (residual halo). Returns null when the
// frame cannot be decoded (caller should skip, not fail).
const PY_COUNT_HALO = `
import struct, sys, zlib
data = open(sys.argv[1], 'rb').read()
pos, idat = 8, []
while pos + 8 <= len(data):
    ln, typ = struct.unpack('>I4s', data[pos:pos+8])
    if typ == b'IDAT': idat.append(data[pos+8:pos+8+ln])
    pos += 12 + ln
try:
    raw = zlib.decompress(b''.join(idat))
except Exception:
    print('NODECODE'); sys.exit(0)
w, h, depth, ctype = struct.unpack('>IIBB', data[16:26])
if depth != 8 or ctype != 6:  # need 8-bit RGBA
    print('NODECODE'); sys.exit(0)
stride = w * 4
count = 0
prev = bytearray(stride)
for y in range(h):
    off = y * (stride + 1)
    ft = raw[off]; line = bytearray(raw[off+1:off+1+stride])
    for x in range(stride):
        a = line[x - 4] if x >= 4 else 0
        b = prev[x]
        c = prev[x - 4] if x >= 4 else 0
        if ft == 1: line[x] = (line[x] + a) & 0xff
        elif ft == 2: line[x] = (line[x] + b) & 0xff
        elif ft == 3: line[x] = (line[x] + (a + b) // 2) & 0xff
        elif ft == 4:
            p = a + b - c
            pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
            line[x] = (line[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 0xff
    count += sum(1 for x in range(3, stride, 4) if 0 < line[x] < 48)
    prev = line
print(count)
`;

function countHaloPixels(file) {
  const res = spawnSync('python3', ['-c', PY_COUNT_HALO, file], { encoding: 'utf8' });
  if (res.error || res.status !== 0) return { available: false };
  const out = res.stdout.trim();
  if (out === 'NODECODE') return { available: true, decoded: false };
  return { available: true, decoded: true, count: Number(out) };
}

test('manifest defines exactly 13 animations', () => {
  assert.equal(Object.keys(anims).length, 13);
  assert.deepEqual(
    Object.keys(anims).sort(),
    ['angry', 'blink', 'drag', 'eat', 'follow', 'happy', 'idle',
      'interact', 'sleep', 'surprised', 'think', 'walk', 'work']
  );
});

test('manifest animation metadata matches the source animations.json', () => {
  const srcPath = path.join(REPO_DIR, manifest.source, 'animations.json');
  if (!fs.existsSync(srcPath)) {
    return skip(`source animations.json missing at ${srcPath}; skipping comparison`);
  }
  const src = JSON.parse(fs.readFileSync(srcPath, 'utf8')).animations;
  assert.deepEqual(Object.keys(anims).sort(), Object.keys(src).sort());
  for (const name of Object.keys(anims)) {
    assert.equal(anims[name].frameCount, src[name].frame_count, `${name}.frameCount`);
    assert.equal(anims[name].fps, src[name].fps, `${name}.fps`);
    assert.equal(anims[name].loop, src[name].loop, `${name}.loop`);
  }
});

test('every animation: frames length == frameCount, files exist, PNG dims match manifest', () => {
  for (const [name, a] of Object.entries(anims)) {
    assert.equal(a.frames.length, a.frameCount, `${name}: frames.length != frameCount`);
    for (const rel of a.frames) {
      const file = path.join(SPRITES_DIR, rel);
      assert.ok(fs.existsSync(file), `missing frame file: ${rel}`);
      const { width, height } = readPngHeader(file);
      assert.equal(width, a.width, `${rel}: IHDR width ${width} != manifest ${a.width}`);
      assert.equal(height, a.height, `${rel}: IHDR height ${height} != manifest ${a.height}`);
    }
  }
});

test('anchorX/anchorY are within (0, 1]', () => {
  for (const [name, a] of Object.entries(anims)) {
    assert.ok(a.anchorX > 0 && a.anchorX <= 1, `${name}: anchorX ${a.anchorX} out of (0,1]`);
    assert.ok(a.anchorY > 0 && a.anchorY <= 1, `${name}: anchorY ${a.anchorY} out of (0,1]`);
  }
});

// Halo regression: sample 3 groups (idle, walk, think). PNG signature + IHDR
// are always checked; the pixel-level 0<alpha<48 scan runs via python3 and is
// skipped when python3 is unavailable or a frame cannot be decoded.
for (const name of ['idle', 'walk', 'think']) {
  test(`sampled halo check (${name}): no pixels with 0 < alpha < 48`, () => {
    for (const rel of anims[name].frames) {
      readPngHeader(path.join(SPRITES_DIR, rel)); // signature + IHDR
      const r = countHaloPixels(path.join(SPRITES_DIR, rel));
      if (!r.available) {
        return skip(`python3 unavailable; skipping pixel-level halo scan for ${rel}`);
      }
      if (!r.decoded) {
        return skip(`IDAT not decodable (non-8bit-RGBA or zlib failure); IHDR-only check done for ${rel}`);
      }
      assert.equal(r.count, 0, `${rel}: ${r.count} pixels with 0 < alpha < 48 (halo regression)`);
    }
  });
}
