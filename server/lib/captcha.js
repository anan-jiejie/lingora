/* ==========================================================================
   captcha.js —— 图形验证码（零依赖，只用 node:crypto + node:zlib）
   ==========================================================================
   为什么不用 SVG：
     SVG 里的 <text> 会明文写出答案，任何人正则一下就能提取，等于没防护。
     所以这里手写一个最小 PNG 编码器，把字符"画"成像素位图 ——
     答案只存在于服务端内存，客户端拿到的是纯像素。

   图像质量：
     内部按 4 倍分辨率绘制（超采样），最后做 box-filter 降采样，
     边缘柔顺不锯齿。字符本身保留 5×7 点阵的骨架，人眼友好。

   安全设计：
     · 服务端生成 / 服务端保存 / 服务端校验，答案永不下发
     · 波形扭曲 + 随机旋转偏移 + 干扰线 + 噪点，提高 OCR 成本
     · 一次性：校验通过即作废；错满 5 次也作废
     · TTL 5 分钟
   ========================================================================== */
'use strict';

const crypto = require('node:crypto');
const zlib = require('node:zlib');

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; /* 剔除 0 O 1 I L */
const LENGTH = 4;
const TTL_MS = 5 * 60 * 1000;
const MAX_TRIES = 5;

const W = 168;
const H = 56;
const SS = 4; /* 超采样倍数 */

/* ---------- 5×7 点阵字模 ---------- */
const GLYPHS = {
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  '3': ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  '6': ['.###.', '#....', '#....', '####.', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '..#..', '..#..', '..#..', '..#..'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '....#', '.###.'],
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.###.'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####']
};

/* ---------- 位图 ---------- */

function bitmap(w, h) {
  const px = new Uint8Array(w * h * 3);
  return {
    w: w,
    h: h,
    px: px,
    fill(r, g, b) {
      for (let i = 0; i < px.length; i += 3) { px[i] = r; px[i + 1] = g; px[i + 2] = b; }
    },
    set(x, y, r, g, b, a) {
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      const i = (y * w + x) * 3;
      const al = a == null ? 1 : a;
      px[i] = Math.round(px[i] * (1 - al) + r * al);
      px[i + 1] = Math.round(px[i + 1] * (1 - al) + g * al);
      px[i + 2] = Math.round(px[i + 2] * (1 - al) + b * al);
    }
  };
}

const rnd = (min, max) => crypto.randomInt(min, max + 1);
const pick = (arr) => arr[crypto.randomInt(0, arr.length)];

/* 画一个点阵字符，带波形水平扭曲 + 逐列垂直起伏 */
function drawGlyph(bm, glyph, ox, oy, scale, color, wave) {
  for (let row = 0; row < 7; row += 1) {
    const line = glyph[row];
    const dx = Math.round(wave * Math.sin((row + 1) * 0.85));
    for (let col = 0; col < 5; col += 1) {
      if (line[col] !== '#') continue;
      const dy = Math.round(wave * 0.35 * Math.sin(col * 1.15));
      const x0 = ox + col * scale + dx;
      const y0 = oy + row * scale + dy;
      for (let sy = 0; sy < scale; sy += 1) {
        for (let sx = 0; sx < scale; sx += 1) {
          bm.set(x0 + sx, y0 + sy, color[0], color[1], color[2], 1);
        }
      }
    }
  }
}

function drawPolyline(bm, color, alpha, width) {
  const pts = [];
  let x = rnd(-10, 20);
  let y = rnd(6, H * SS - 6);
  const steps = rnd(3, 5);
  for (let i = 0; i <= steps; i += 1) {
    pts.push([x, y]);
    x += (W * SS + 20) / steps;
    y = rnd(4, H * SS - 4);
  }
  for (let i = 0; i < pts.length - 1; i += 1) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[i + 1];
    const dist = Math.max(1, Math.round(Math.hypot(x2 - x1, y2 - y1)));
    for (let t = 0; t <= dist; t += 1) {
      const px = Math.round(x1 + (x2 - x1) * (t / dist));
      const py = Math.round(y1 + (y2 - y1) * (t / dist));
      for (let k = 0; k < width; k += 1) {
        bm.set(px, py + k, color[0], color[1], color[2], alpha);
        bm.set(px + k, py, color[0], color[1], color[2], alpha);
      }
    }
  }
}

/* ---------- PNG 编码 ---------- */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(bm) {
  const stride = bm.w * 3 + 1;
  const raw = Buffer.alloc(stride * bm.h);
  for (let y = 0; y < bm.h; y += 1) {
    raw[y * stride] = 0; /* filter type: None */
    Buffer.from(bm.px.buffer, bm.px.byteOffset + y * bm.w * 3, bm.w * 3)
      .copy(raw, y * stride + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(bm.w, 0);
  ihdr.writeUInt32BE(bm.h, 4);
  ihdr[8] = 8;  /* bit depth */
  ihdr[9] = 2;  /* color type: truecolor */
  ihdr[10] = 0; /* deflate */
  ihdr[11] = 0; /* adaptive filtering */
  ihdr[12] = 0; /* no interlace */

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---------- 绘制一张验证码 ---------- */

function renderPng(text) {
  const bw = W * SS;
  const bh = H * SS;
  const big = bitmap(bw, bh);
  big.fill(251, 249, 244); /* #FBF9F4 —— 与表单底色同一家族 */

  /* 干扰线：品牌绿 + 珊瑚色，压在字符下面 */
  const nLines = rnd(2, 3);
  for (let i = 0; i < nLines; i += 1) {
    drawPolyline(
      big,
      i % 2 === 0 ? [14, 156, 122] : [224, 96, 63],
      rnd(28, 46) / 100,
      rnd(2, 3)
    );
  }

  /* 字符 */
  const baseScale = 5 * SS;
  const glyphW = 5 * baseScale;
  const gap = rnd(7, 10) * SS;
  const totalW = LENGTH * glyphW + (LENGTH - 1) * gap;
  let x = Math.round((bw - totalW) / 2);
  const palette = [[8, 13, 24], [11, 58, 74], [38, 26, 12], [13, 43, 36]];

  for (let i = 0; i < text.length; i += 1) {
    const glyph = GLYPHS[text[i]];
    if (!glyph) continue;
    const yOff = rnd(-4, 4) * SS;
    drawGlyph(big, glyph, x, Math.round((bh - 7 * baseScale) / 2) + yOff, baseScale, pick(palette), rnd(1, 2) * SS);
    x += glyphW + gap;
  }

  /* 噪点：随机小色块，压住字符细节但不影响人眼辨认 */
  for (let i = 0; i < 240; i += 1) {
    const size = Math.max(SS, Math.round(rnd(6, 16) / 10) * SS);
    const cx = rnd(2, bw - size - 2);
    const cy = rnd(2, bh - size - 2);
    const isMint = rnd(0, 3) === 0;
    const cr = isMint ? 14 : 8;
    const cg = isMint ? 156 : 13;
    const cb = isMint ? 122 : 24;
    const alpha = rnd(8, 26) / 100;
    for (let dy = 0; dy < size; dy += 1) {
      for (let dx = 0; dx < size; dx += 1) {
        big.set(cx + dx, cy + dy, cr, cg, cb, alpha);
      }
    }
  }

  /* 降采样 → 抗锯齿 */
  const out = bitmap(W, H);
  const n = SS * SS;
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const i = ((y * SS + sy) * bw + (x * SS + sx)) * 3;
          r += big.px[i];
          g += big.px[i + 1];
          b += big.px[i + 2];
        }
      }
      const o = (y * W + x) * 3;
      out.px[o] = Math.round(r / n);
      out.px[o + 1] = Math.round(g / n);
      out.px[o + 2] = Math.round(b / n);
    }
  }

  return encodePng(out);
}

/* ---------- 存储池 ---------- */

/* id -> { text, png, expireAt, triesLeft } */
const pool = new Map();

const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [id, rec] of pool) {
    if (rec.expireAt <= now) pool.delete(id);
  }
}, 60 * 1000);
if (typeof sweeper.unref === 'function') sweeper.unref();

/* 新建验证码，返回 { id, expiresIn } —— 答案不出服务端 */
function create() {
  let text = '';
  for (let i = 0; i < LENGTH; i += 1) text += ALPHABET[crypto.randomInt(0, ALPHABET.length)];
  const id = crypto.randomBytes(16).toString('hex');
  pool.set(id, { text: text, png: null, expireAt: Date.now() + TTL_MS, triesLeft: MAX_TRIES });
  return { id: id, expiresIn: Math.floor(TTL_MS / 1000) };
}

/* 取 PNG 图；id 无效或已过期返回 null */
function image(id) {
  const key = String(id || '');
  const rec = pool.get(key);
  if (!rec) return null;
  if (rec.expireAt <= Date.now()) {
    pool.delete(key);
    return null;
  }
  if (!rec.png) rec.png = renderPng(rec.text);
  return rec.png;
}

/* 校验。返回 { ok } 或 { ok:false, reason } */
function verify(id, input) {
  const key = String(id || '');
  const rec = pool.get(key);

  if (!rec || rec.expireAt <= Date.now()) {
    pool.delete(key);
    return { ok: false, reason: 'BAD_ID' };
  }

  const got = String(input || '').trim().toUpperCase();
  const want = rec.text;

  /* 定长比较，避免长度差异造成的时序差异 */
  const a = Buffer.from(got.padEnd(Math.max(got.length, want.length), '\u0000'));
  const b = Buffer.from(want.padEnd(Math.max(got.length, want.length), '\u0000'));
  const same = a.length === b.length && crypto.timingSafeEqual(a, b);

  if (same) {
    pool.delete(key); /* 一次性 */
    return { ok: true, reason: 'OK' };
  }

  rec.triesLeft -= 1;
  if (rec.triesLeft <= 0) {
    pool.delete(key);
    return { ok: false, reason: 'LOCKED' };
  }
  return { ok: false, reason: 'MISMATCH' };
}

/* 仅供本地自动化测试使用：把答案取出（不对外暴露任何接口） */
function _peekForTest(id) {
  const rec = pool.get(String(id || ''));
  return rec ? rec.text : null;
}

module.exports = {
  create: create,
  image: image,
  verify: verify,
  _peekForTest: _peekForTest,
  LENGTH: LENGTH,
  TTL_MS: TTL_MS
};
