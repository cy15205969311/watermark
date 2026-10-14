const sharp = require('../../server/node_modules/sharp');
const { parseGif } = require('../../server/extractors/818ps-animation');
async function animatedGif() {
  const buffer = await sharp(Buffer.from([255, 0, 0, 0, 255, 0]), { raw: { width: 1, height: 2, channels: 3, pageHeight: 1 } }).gif({ delay: [100, 200], loop: 0 }).toBuffer();
  if (parseGif(buffer).frameCount !== 2) throw new Error('Invalid animation fixture');
  return { buffer, dataUrl: `data:image/gif;base64,${buffer.toString('base64')}` };
}
module.exports = { animatedGif };
