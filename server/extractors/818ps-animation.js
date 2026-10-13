const sharp = require("sharp");
const { createHash } = require("crypto");

// Parse GIF blocks, including every image data sub-block and the end trailer.
// Header inspection/Sharp's first-page mode alone cannot validate an animation.
function parseGif(buffer) {
  if (buffer.length < 14 || !/^GIF8[79]a$/.test(buffer.toString("ascii", 0, 6))) throw new Error("invalid_gif_header");
  let offset = 13;
  let frames = 0;
  let pendingDelay = null;
  let loopCount = null;
  const delays = [];
  const take = size => {
    if (offset + size > buffer.length) throw new Error("truncated_gif");
    const bytes = buffer.subarray(offset, offset + size);
    offset += size;
    return bytes;
  };
  const subBlocks = () => {
    const blocks = [];
    while (true) {
      const length = take(1)[0];
      if (!length) break;
      blocks.push(take(length));
    }
    return blocks;
  };
  if (buffer[10] & 128) take(3 * (2 ** ((buffer[10] & 7) + 1)));
  while (offset < buffer.length) {
    const tag = take(1)[0];
    if (tag === 0x3b) {
      if (!frames) throw new Error("gif_has_no_frames");
      return { frameCount: frames, durationMs: delays.every(delay => delay !== null) ? delays.reduce((sum, delay) => sum + delay, 0) : null, frameDelays: delays, loopCount };
    }
    if (tag === 0x2c) {
      const descriptor = take(9);
      if (!descriptor.readUInt16LE(4) || !descriptor.readUInt16LE(6)) throw new Error("invalid_gif_frame_dimensions");
      if (descriptor[8] & 128) take(3 * (2 ** ((descriptor[8] & 7) + 1)));
      const codeSize = take(1)[0];
      if (codeSize < 2 || codeSize > 8) throw new Error("invalid_gif_lzw_code_size");
      if (!subBlocks().length) throw new Error("empty_gif_frame_data");
      frames++;
      if (frames > 1000) throw new Error("animation_frame_limit");
      delays.push(pendingDelay);
      pendingDelay = null;
      continue;
    }
    if (tag === 0x21) {
      const label = take(1)[0];
      const blocks = subBlocks();
      if (label === 0xf9) {
        if (blocks.length !== 1 || blocks[0].length !== 4) throw new Error("invalid_gif_graphic_control");
        pendingDelay = blocks[0].readUInt16LE(1) * 10;
      }
      if (label === 0xff && blocks[0]?.toString("ascii") === "NETSCAPE2.0" && blocks[1]?.length >= 3) loopCount = blocks[1].readUInt16LE(1);
      continue;
    }
    throw new Error("invalid_gif_block");
  }
  throw new Error("missing_gif_trailer");
}

async function inspectMedia(buffer) {
  const gif = /^GIF8[79]a/.test(buffer.toString("ascii", 0, 6));
  const gifData = gif ? parseGif(buffer) : null;
  const metadata = await sharp(buffer, { animated: true, limitInputPixels: 80000000, failOn: "error" }).metadata();
  const frameCount = gifData?.frameCount ?? metadata.pages ?? 1;
  if (frameCount > 1000 || (metadata.width || 0) * (metadata.height || 0) > 80000000) throw new Error("animation_pixel_limit");
  if (gifData && metadata.pages && metadata.pages !== gifData.frameCount) throw new Error("gif_frame_count_mismatch");
  // Force decoding too: well-formed blocks can still contain corrupt LZW/frame data.
  if (gif || frameCount > 1) await sharp(buffer, { animated: true, limitInputPixels: 80000000, failOn: "error" }).stats();
  const durationMs = gifData ? gifData.durationMs : Array.isArray(metadata.delay) ? metadata.delay.reduce((sum, delay) => sum + delay, 0) : null;
  const detectedFormat = metadata.format || "unknown";
  return { detectedFormat, mediaType: `image/${detectedFormat === "jpg" ? "jpeg" : detectedFormat}`, width: metadata.width || null, height: metadata.pageHeight || metadata.height || null, frameCount, isAnimated: frameCount > 1, durationMs, loopCount: gifData?.loopCount ?? metadata.loop ?? null, fileSize: buffer.length, contentHash: createHash("sha256").update(buffer).digest("hex"), animationValidation: frameCount > 1 ? "verified_animated" : "verified_static" };
}

module.exports = { parseGif, inspectMedia };
