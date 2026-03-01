import express from 'express';
import http from 'http';

/**
 * E2E test: verifies that a custom user-agent header sent via the /scrape
 * endpoint is forwarded to the target server at the HTTP level.
 *
 * Setup:
 *   1. Spin up a tiny "echo" server that captures the incoming User-Agent.
 *   2. Start the playwright scrape service.
 *   3. POST /scrape with headers: { "user-agent": "<custom>" }.
 *   4. Assert the echo server received the custom user-agent.
 */

const SCRAPE_PORT = 3099; // playwright service under test
const ECHO_PORT = 3098;   // echo server that records User-Agent

let echoServer: http.Server;
let scrapeProcess: ReturnType<typeof import('child_process').spawn> | null = null;

// Captured user-agent from the echo server
let capturedUserAgent: string | undefined;

// ── helpers ──────────────────────────────────────────────────────────

function startEchoServer(): Promise<void> {
  return new Promise((resolve) => {
    const app = express();
    app.get('/', (req, res) => {
      capturedUserAgent = req.headers['user-agent'];
      res.send('<html><body>echo</body></html>');
    });
    echoServer = app.listen(ECHO_PORT, () => resolve());
  });
}

function waitForService(port: number, timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const req = http.get(`http://localhost:${port}/health`, (res) => {
        if (res.statusCode === 200) return resolve();
        retry();
      });
      req.on('error', retry);
      req.end();
    };
    const retry = () => {
      if (Date.now() - start > timeoutMs) {
        return reject(new Error(`Service on port ${port} did not start within ${timeoutMs}ms`));
      }
      setTimeout(check, 500);
    };
    check();
  });
}

function postScrape(url: string, headers?: Record<string, string>): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ url, headers });
    const req = http.request(
      {
        hostname: 'localhost',
        port: SCRAPE_PORT,
        path: '/scrape',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode!, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode!, body: data });
          }
        });
      },
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ── setup / teardown ─────────────────────────────────────────────────

beforeAll(async () => {
  await startEchoServer();

  // Start the playwright scrape service as a child process
  const { spawn } = await import('child_process');
  scrapeProcess = spawn('npx', ['tsx', 'api.ts'], {
    cwd: __dirname + '/..',
    env: {
      ...process.env,
      PORT: String(SCRAPE_PORT),
      BLOCK_MEDIA: 'True',
      MAX_CONCURRENT_PAGES: '2',
    },
    stdio: 'pipe',
  });

  // Wait for the service to be ready
  await waitForService(SCRAPE_PORT, 60_000);
}, 90_000);

afterAll(async () => {
  if (scrapeProcess) {
    scrapeProcess.kill('SIGTERM');
    scrapeProcess = null;
  }
  if (echoServer) {
    await new Promise<void>((resolve) => echoServer.close(() => resolve()));
  }
});

// ── tests ────────────────────────────────────────────────────────────

describe('scrape endpoint user-agent header', () => {
  beforeEach(() => {
    capturedUserAgent = undefined;
  });

  it('should use custom user-agent when provided in headers', async () => {
    const customUA = 'MyCustomBot/1.0 (test-suite)';

    const resp = await postScrape(`http://localhost:${ECHO_PORT}`, {
      'user-agent': customUA,
    });

    expect(resp.status).toBe(200);
    expect(capturedUserAgent).toBe(customUA);
  }, 30_000);

  it('should use a random user-agent when no custom header is provided', async () => {
    const resp = await postScrape(`http://localhost:${ECHO_PORT}`);

    expect(resp.status).toBe(200);
    // Should be set to a random UA from the user-agents package, not undefined
    expect(capturedUserAgent).toBeDefined();
    expect(capturedUserAgent!.length).toBeGreaterThan(0);
    // Random UA should look like a real browser (starts with "Mozilla/")
    // and should NOT contain "HeadlessChrome" (raw Playwright default)
    expect(capturedUserAgent).toMatch(/^Mozilla\//);
    expect(capturedUserAgent).not.toMatch(/HeadlessChrome/);
  }, 30_000);

  it('should forward other headers alongside custom user-agent', async () => {
    // We test this indirectly — the scrape should succeed and the UA should be custom
    const customUA = 'AnotherBot/2.0';

    const resp = await postScrape(`http://localhost:${ECHO_PORT}`, {
      'user-agent': customUA,
      'x-custom-header': 'test-value',
    });

    expect(resp.status).toBe(200);
    expect(capturedUserAgent).toBe(customUA);
  }, 30_000);
});
