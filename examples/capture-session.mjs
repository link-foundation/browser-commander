/** Run: CHROME_PATH=/path/to/chrome node examples/capture-session.mjs output.gif */
import { launchBrowser, makeBrowserCommander } from '../js/src/index.js';

const session = await launchBrowser({
  headless: true,
  ...(process.env.CHROME_PATH
    ? { executablePath: process.env.CHROME_PATH }
    : {}),
  ...(process.env.CHROME_NO_SANDBOX === 'true'
    ? { args: ['--no-sandbox'] }
    : {}),
});
const commander = makeBrowserCommander({ page: session.page });
try {
  await commander.goto({
    url: 'data:text/html,<title>Capture example</title><h1 id="status">Starting</h1>',
  });
  const recording = await commander.startRecording({
    format: 'gif',
    output: process.argv[2] ?? 'capture.gif',
    fps: 5,
    maxFrames: 5,
    maxDurationMs: 1000,
    size: { width: 320, height: 200 },
  });
  await commander.evaluate({
    fn: () => {
      document.getElementById('status').textContent = 'Finished';
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 250));
  const result = await recording.stop();
  console.log(
    JSON.stringify({ path: result.path, frames: result.frames.length })
  );
} finally {
  await commander.destroy();
  await session.close();
}
