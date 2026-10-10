/** Companion codec worker for Rust. Uses the same bounded portable encoders. */
import { encodeAnimation, encodeVideo } from './index.js';
let input = '';
for await (const chunk of process.stdin) {
  input += chunk;
  if (input.length > 96 * 1024 * 1024) {
    throw new RangeError('codec input exceeds 96 MiB');
  }
}
try {
  const { frames, options } = JSON.parse(input);
  const data = frames.map((frame) => Buffer.from(frame, 'base64'));
  const result = ['webm', 'mp4', 'mov'].includes(options.format)
    ? await encodeVideo(data, options)
    : await encodeAnimation(data, options);
  process.stdout.write(JSON.stringify({ data: result.toString('base64') }));
} catch (error) {
  process.stdout.write(
    JSON.stringify({ error: { code: error.code, message: error.message } })
  );
  process.exitCode = 1;
}
