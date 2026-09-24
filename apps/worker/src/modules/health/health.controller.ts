import { Controller, Get, Req, Res } from '@nestjs/common';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  healthCheck(@Req() request: HeaderRequest, @Res({ passthrough: true }) response: TypedResponse) {
    const health = this.health.basic();
    if (wantsJson(request)) return health;

    response.type('html');
    return renderWorkerHealthPage(health);
  }

  @Get('live')
  live() {
    return this.health.live();
  }

  @Get('ready')
  ready() {
    return this.health.ready();
  }
}

type WorkerHealth = ReturnType<HealthService['basic']>;
type HeaderRequest = { header(name: string): string | undefined };
type TypedResponse = { type(value: string): void };

function wantsJson(request: HeaderRequest) {
  const accept = request.header('accept') ?? '';
  return accept.includes('application/json') && !accept.includes('text/html');
}

function renderWorkerHealthPage(health: WorkerHealth) {
  const timestamp = escapeHtml(health.timestamp);
  const service = escapeHtml(health.service);
  const status = escapeHtml(health.status);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Zea Play Worker Health</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #0c111d;
        --panel: rgba(17, 24, 39, 0.82);
        --panel-strong: rgba(31, 41, 55, 0.9);
        --text: #f8fafc;
        --muted: #a7b0c2;
        --line: rgba(148, 163, 184, 0.22);
        --ok: #37f5a5;
        --ok-dark: #0f8f63;
        --blue: #69b7ff;
        --amber: #ffd166;
      }

      * {
        box-sizing: border-box;
      }

      body {
        min-height: 100vh;
        margin: 0;
        display: grid;
        place-items: center;
        overflow: hidden;
        background:
          radial-gradient(circle at 20% 20%, rgba(105, 183, 255, 0.22), transparent 28rem),
          radial-gradient(circle at 84% 12%, rgba(55, 245, 165, 0.2), transparent 24rem),
          linear-gradient(135deg, #080b13 0%, var(--bg) 52%, #111827 100%);
        color: var(--text);
        font-family:
          Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      .shell {
        width: min(92vw, 860px);
        position: relative;
        padding: 1px;
        border-radius: 24px;
        background: linear-gradient(135deg, rgba(105, 183, 255, 0.55), rgba(55, 245, 165, 0.65));
        box-shadow: 0 28px 90px rgba(0, 0, 0, 0.46);
        animation: rise 700ms ease-out both;
      }

      .card {
        position: relative;
        overflow: hidden;
        border-radius: 23px;
        border: 1px solid var(--line);
        background: var(--panel);
        backdrop-filter: blur(22px);
      }

      .scan {
        position: absolute;
        inset: 0;
        pointer-events: none;
        background: linear-gradient(
          90deg,
          transparent,
          rgba(255, 255, 255, 0.08),
          transparent
        );
        transform: translateX(-110%);
        animation: scan 3.8s ease-in-out infinite;
      }

      .hero {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 28px;
        padding: clamp(28px, 5vw, 56px);
        align-items: center;
      }

      .eyebrow {
        color: var(--blue);
        font-size: 0.82rem;
        font-weight: 800;
        letter-spacing: 0.14em;
        text-transform: uppercase;
      }

      h1 {
        margin: 12px 0 14px;
        font-size: clamp(2.1rem, 6vw, 5rem);
        line-height: 0.95;
        letter-spacing: 0;
      }

      .message {
        max-width: 570px;
        margin: 0;
        color: var(--muted);
        font-size: clamp(1rem, 2vw, 1.2rem);
        line-height: 1.65;
      }

      .status-orbit {
        width: clamp(150px, 23vw, 220px);
        aspect-ratio: 1;
        display: grid;
        place-items: center;
        border-radius: 50%;
        border: 1px solid rgba(55, 245, 165, 0.35);
        background:
          radial-gradient(circle, rgba(55, 245, 165, 0.2) 0 34%, transparent 35%),
          conic-gradient(from 120deg, transparent, rgba(55, 245, 165, 0.9), transparent 68%);
        animation: spin 7s linear infinite;
      }

      .status-core {
        width: 62%;
        aspect-ratio: 1;
        display: grid;
        place-items: center;
        border-radius: 50%;
        background: #09111b;
        box-shadow:
          inset 0 0 24px rgba(55, 245, 165, 0.24),
          0 0 36px rgba(55, 245, 165, 0.28);
        animation: pulse 1.8s ease-in-out infinite;
      }

      .status-core span {
        color: var(--ok);
        font-size: clamp(1.4rem, 3vw, 2.2rem);
        font-weight: 900;
        text-transform: uppercase;
      }

      .grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        border-top: 1px solid var(--line);
        background: rgba(8, 13, 23, 0.45);
      }

      .metric {
        min-width: 0;
        padding: 22px 24px;
        border-right: 1px solid var(--line);
      }

      .metric:last-child {
        border-right: 0;
      }

      .label {
        display: block;
        margin-bottom: 8px;
        color: var(--muted);
        font-size: 0.78rem;
        font-weight: 800;
        text-transform: uppercase;
      }

      .value {
        overflow-wrap: anywhere;
        font-size: 1rem;
        font-weight: 800;
      }

      .connected {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        color: var(--ok);
      }

      .dot {
        width: 11px;
        height: 11px;
        border-radius: 50%;
        background: var(--ok);
        box-shadow: 0 0 0 0 rgba(55, 245, 165, 0.7);
        animation: dot 1.4s ease-out infinite;
      }

      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        padding: 22px 24px 26px;
        border-top: 1px solid var(--line);
      }

      a {
        color: var(--text);
        text-decoration: none;
      }

      .button {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        min-height: 42px;
        padding: 0 16px;
        border-radius: 999px;
        border: 1px solid var(--line);
        background: var(--panel-strong);
        font-weight: 800;
        transition:
          transform 160ms ease,
          border-color 160ms ease,
          background 160ms ease;
      }

      .button:hover {
        transform: translateY(-2px);
        border-color: rgba(55, 245, 165, 0.65);
        background: rgba(15, 23, 42, 0.95);
      }

      @keyframes rise {
        from {
          opacity: 0;
          transform: translateY(18px) scale(0.98);
        }
        to {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
      }

      @keyframes scan {
        0%,
        35% {
          transform: translateX(-110%);
        }
        68%,
        100% {
          transform: translateX(110%);
        }
      }

      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }

      @keyframes pulse {
        50% {
          transform: scale(1.05);
        }
      }

      @keyframes dot {
        70% {
          box-shadow: 0 0 0 12px rgba(55, 245, 165, 0);
        }
        100% {
          box-shadow: 0 0 0 0 rgba(55, 245, 165, 0);
        }
      }

      @media (max-width: 700px) {
        body {
          overflow: auto;
          padding: 24px 0;
        }

        .hero,
        .grid {
          grid-template-columns: 1fr;
        }

        .status-orbit {
          justify-self: start;
        }

        .metric {
          border-right: 0;
          border-bottom: 1px solid var(--line);
        }

        .metric:last-child {
          border-bottom: 0;
        }
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <section class="card" aria-label="Zea Play worker health status">
        <div class="scan"></div>
        <div class="hero">
          <div>
            <div class="eyebrow">Zea Play Worker</div>
            <h1>Connected and working</h1>
            <p class="message">
              The background worker is online, reachable, and ready to process queued work.
              This page is live, so a refresh should update the health timestamp.
            </p>
          </div>
          <div class="status-orbit" aria-label="Worker status ${status}">
            <div class="status-core"><span>${status}</span></div>
          </div>
        </div>
        <div class="grid">
          <div class="metric">
            <span class="label">Connection</span>
            <span class="value connected"><span class="dot"></span>Live service link</span>
          </div>
          <div class="metric">
            <span class="label">Service</span>
            <span class="value">${service}</span>
          </div>
          <div class="metric">
            <span class="label">Last heartbeat</span>
            <span class="value" id="heartbeat">${timestamp}</span>
          </div>
        </div>
        <nav class="actions" aria-label="Health endpoints">
          <a class="button" href="/health/live">Live check</a>
          <a class="button" href="/health/ready">Ready check</a>
          <a class="button" href="/health" data-json>Raw JSON</a>
        </nav>
      </section>
    </main>
    <script>
      document.querySelector('[data-json]')?.addEventListener('click', async (event) => {
        event.preventDefault();
        const response = await fetch('/health', { headers: { accept: 'application/json' } });
        const data = await response.json();
        const heartbeat = document.querySelector('#heartbeat');
        if (heartbeat) heartbeat.textContent = data.timestamp;
        alert(JSON.stringify(data, null, 2));
      });
    </script>
  </body>
</html>`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
