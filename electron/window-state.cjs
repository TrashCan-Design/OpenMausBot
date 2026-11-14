const { deflateSync } = require("zlib");

const DEFAULT_BOUNDS = Object.freeze({ width: 1040, height: 760 });
const MIN_BOUNDS = Object.freeze({ width: 840, height: 620 });

const integer = (value) => Number.isFinite(value) && Number.isInteger(value);
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

function parseWindowState(raw) {
  let value;
  try {
    value = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || !value.bounds || typeof value.bounds !== "object") return null;
  const { x, y, width, height } = value.bounds;
  if (![x, y, width, height].every(integer) || width <= 0 || height <= 0) return null;
  return {
    bounds: { x, y, width, height },
    maximized: value.maximized === true,
  };
}

function intersectionArea(a, b) {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return width * height;
}

function validWorkAreas(workAreas) {
  return workAreas.filter(
    (area) =>
      area &&
      [area.x, area.y, area.width, area.height].every(integer) &&
      area.width > 0 &&
      area.height > 0,
  );
}

/** workAreas must put the primary display first. */
function resolveWindowState(state, workAreas, defaults = DEFAULT_BOUNDS) {
  const areas = validWorkAreas(workAreas);
  const primary = areas[0];
  const defaultBounds = {
    width: primary ? Math.min(defaults.width, primary.width) : defaults.width,
    height: primary ? Math.min(defaults.height, primary.height) : defaults.height,
  };
  const parsed = parseWindowState(state);
  if (!parsed || !primary) return { bounds: defaultBounds, maximized: false };

  let target = primary;
  let bestArea = 0;
  for (const area of areas) {
    const overlap = intersectionArea(parsed.bounds, area);
    if (overlap > bestArea) {
      bestArea = overlap;
      target = area;
    }
  }

  const minWidth = Math.min(MIN_BOUNDS.width, target.width);
  const minHeight = Math.min(MIN_BOUNDS.height, target.height);
  const width = clamp(parsed.bounds.width, minWidth, target.width);
  const height = clamp(parsed.bounds.height, minHeight, target.height);
  if (bestArea === 0) {
    return {
      bounds: {
        x: target.x + Math.round((target.width - width) / 2),
        y: target.y + Math.round((target.height - height) / 2),
        width,
        height,
      },
      maximized: parsed.maximized,
    };
  }
  return {
    bounds: {
      x: clamp(parsed.bounds.x, target.x, target.x + target.width - width),
      y: clamp(parsed.bounds.y, target.y, target.y + target.height - height),
      width,
      height,
    },
    maximized: parsed.maximized,
  };
}

function crc32(bytes) {
  let crc = ~0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type);
  const body = Buffer.concat([name, data]);
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
}

/** A blue dot with a white ring, so it stays visible on a blue taskbar and at 200% scaling. */
function unreadOverlayPng(size = 16) {
  const pixels = size === 32 ? 32 : 16;
  const raw = Buffer.alloc(pixels * (1 + pixels * 4));
  const center = (pixels - 1) / 2;
  const outer = pixels / 2 - 0.5;
  const inner = outer - Math.max(1, pixels / 16);
  for (let y = 0; y < pixels; y += 1) {
    const row = y * (1 + pixels * 4);
    for (let x = 0; x < pixels; x += 1) {
      const distance = Math.hypot(x - center, y - center);
      const color = distance <= inner ? [37, 99, 235, 255] : distance <= outer ? [255, 255, 255, 255] : [0, 0, 0, 0];
      const at = row + 1 + x * 4;
      raw[at] = color[0];
      raw[at + 1] = color[1];
      raw[at + 2] = color[2];
      raw[at + 3] = color[3];
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(pixels, 0);
  header.writeUInt32BE(pixels, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function normalizeUnreadCount(value) {
  if (!Number.isFinite(value)) return 0;
  return clamp(Math.trunc(value), 0, 999);
}

module.exports = {
  DEFAULT_BOUNDS,
  MIN_BOUNDS,
  normalizeUnreadCount,
  unreadOverlayPng,
  parseWindowState,
  resolveWindowState,
};
