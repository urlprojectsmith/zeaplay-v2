import { Controller, Get, Header, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { HealthService } from './health.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  healthCheck(@Req() request: Request, @Res() response: Response) {
    const data = this.health.basic();
    const accept = request.headers.accept ?? '';
    const wantsHtml = accept.includes('text/html');

    if (!wantsHtml) {
      return response.json(data);
    }

    return response.type('text/html').send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>ZEA PLAY API Health</title>
    <style>
      :root {
        --bg-1: #05070f;
        --bg-2: #0a1330;
        --panel: rgba(8, 16, 36, 0.7);
        --text: #d6f3ff;
        --muted: #86a6be;
        --ok: #3dff9d;
        --cyan: #32e7ff;
        --line: rgba(95, 225, 255, 0.35);
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        color: var(--text);
        font-family: "Space Grotesk", "Segoe UI", sans-serif;
        background:
          radial-gradient(circle at 15% 15%, rgba(36, 179, 255, 0.2), transparent 45%),
          radial-gradient(circle at 85% 80%, rgba(61, 255, 157, 0.18), transparent 40%),
          linear-gradient(135deg, var(--bg-1), var(--bg-2));
        overflow: hidden;
      }

      .grid {
        position: fixed;
        inset: 0;
        pointer-events: none;
        background-image:
          linear-gradient(rgba(100, 220, 255, 0.08) 1px, transparent 1px),
          linear-gradient(90deg, rgba(100, 220, 255, 0.08) 1px, transparent 1px);
        background-size: 48px 48px;
        mask-image: linear-gradient(to bottom, transparent 0%, black 40%, black 100%);
      }

      .card {
        width: min(92vw, 760px);
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 20px;
        padding: 28px;
        box-shadow:
          0 0 40px rgba(50, 231, 255, 0.2),
          inset 0 0 30px rgba(50, 231, 255, 0.06);
        backdrop-filter: blur(8px);
        animation: rise 500ms ease-out;
      }

      .top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
      }

      .badge {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        border-radius: 999px;
        border: 1px solid rgba(61, 255, 157, 0.5);
        color: var(--ok);
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }

      .dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: var(--ok);
        box-shadow: 0 0 12px var(--ok);
        animation: pulse 1300ms infinite;
      }

      h1 {
        margin: 18px 0 6px;
        font-size: clamp(1.5rem, 4vw, 2.3rem);
        letter-spacing: 0.02em;
      }

      p {
        margin: 0;
        color: var(--muted);
      }

      .actions {
        margin-top: 18px;
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
      }

      .btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 10px 14px;
        border-radius: 10px;
        border: 1px solid rgba(50, 231, 255, 0.45);
        color: #d6f3ff;
        text-decoration: none;
        font-weight: 700;
        letter-spacing: 0.02em;
        background: rgba(9, 22, 44, 0.72);
        transition: transform 140ms ease, box-shadow 140ms ease, border-color 140ms ease;
      }

      .btn:hover {
        transform: translateY(-1px);
        border-color: rgba(61, 255, 157, 0.7);
        box-shadow: 0 6px 18px rgba(50, 231, 255, 0.2);
      }

      .meta {
        margin-top: 22px;
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 12px;
      }

      .item {
        border: 1px solid rgba(95, 225, 255, 0.25);
        border-radius: 12px;
        padding: 12px;
        background: rgba(3, 9, 24, 0.5);
      }

      .label {
        font-size: 0.74rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted);
      }

      .value {
        margin-top: 6px;
        font-weight: 600;
      }

      @keyframes pulse {
        0% { transform: scale(1); opacity: 1; }
        50% { transform: scale(1.25); opacity: 0.7; }
        100% { transform: scale(1); opacity: 1; }
      }

      @keyframes rise {
        from { transform: translateY(10px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
    </style>
  </head>
  <body>
    <div class="grid"></div>
    <main class="card" role="main" aria-live="polite">
      <div class="top">
        <span class="badge"><span class="dot"></span>online</span>
      </div>
      <h1>Backend Health: Running</h1>
      <p>Futuristic endpoint pulse confirms your API is alive.</p>
      <section class="actions">
        <a class="btn" href="/api/v1/docs" target="_blank" rel="noopener noreferrer">Open API Docs</a>
      </section>
      <section class="meta">
        <article class="item">
          <div class="label">Service</div>
          <div class="value">${data.service}</div>
        </article>
        <article class="item">
          <div class="label">Status</div>
          <div class="value">${data.status.toUpperCase()}</div>
        </article>
        <article class="item">
          <div class="label">Timestamp</div>
          <div class="value">${data.timestamp}</div>
        </article>
      </section>
    </main>
  </body>
</html>`);
  }

  @Get('live')
  @Header('Cache-Control', 'no-store')
  liveness(@Req() request: Request, @Res() response: Response) {
    const data = this.health.live();
    const accept = request.headers.accept ?? '';
    const wantsHtml = accept.includes('text/html');

    if (!wantsHtml) {
      return response.json(data);
    }

    return response.type('text/html').send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>ZEA PLAY API Liveness</title>
    <style>
      :root {
        --bg-1: #06110f;
        --bg-2: #113330;
        --panel: rgba(6, 24, 22, 0.72);
        --text: #dcfff3;
        --muted: #87c8b8;
        --ok: #41ffb8;
        --line: rgba(101, 255, 201, 0.35);
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        color: var(--text);
        font-family: "Space Grotesk", "Segoe UI", sans-serif;
        background:
          radial-gradient(circle at 15% 15%, rgba(65, 255, 184, 0.2), transparent 42%),
          radial-gradient(circle at 85% 85%, rgba(63, 173, 255, 0.14), transparent 45%),
          linear-gradient(140deg, var(--bg-1), var(--bg-2));
        overflow: hidden;
      }
      .card {
        width: min(92vw, 760px);
        border-radius: 20px;
        padding: 28px;
        border: 1px solid var(--line);
        background: var(--panel);
        box-shadow: 0 0 36px rgba(65, 255, 184, 0.16), inset 0 0 28px rgba(65, 255, 184, 0.05);
        backdrop-filter: blur(10px);
      }
      .badge {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        border-radius: 999px;
        padding: 8px 12px;
        border: 1px solid rgba(65, 255, 184, 0.5);
        text-transform: uppercase;
        letter-spacing: 0.06em;
        font-weight: 700;
        color: var(--ok);
      }
      .dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: var(--ok);
        box-shadow: 0 0 14px var(--ok);
        animation: pulse 1.2s infinite;
      }
      h1 { margin: 16px 0 6px; font-size: clamp(1.5rem, 4vw, 2.2rem); }
      p { margin: 0; color: var(--muted); }
      .meta {
        margin-top: 22px;
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 12px;
      }
      .item {
        border: 1px solid rgba(101, 255, 201, 0.3);
        border-radius: 12px;
        padding: 12px;
        background: rgba(3, 18, 16, 0.55);
      }
      .label {
        font-size: 0.74rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted);
      }
      .value { margin-top: 6px; font-weight: 600; }
      @keyframes pulse {
        0% { transform: scale(1); opacity: 1; }
        50% { transform: scale(1.2); opacity: 0.7; }
        100% { transform: scale(1); opacity: 1; }
      }
    </style>
  </head>
  <body>
    <main class="card" role="main" aria-live="polite">
      <span class="badge"><span class="dot"></span>${data.status}</span>
      <h1>Liveness Probe: Healthy</h1>
      <p>Process heartbeat is active and responding.</p>
      <section class="meta">
        <article class="item">
          <div class="label">Endpoint</div>
          <div class="value">/health/live</div>
        </article>
        <article class="item">
          <div class="label">Status</div>
          <div class="value">${data.status.toUpperCase()}</div>
        </article>
        <article class="item">
          <div class="label">Timestamp</div>
          <div class="value">${data.timestamp}</div>
        </article>
      </section>
    </main>
  </body>
</html>`);
  }

  @Get('ready')
  @Header('Cache-Control', 'no-store')
  async readiness(@Req() request: Request, @Res() response: Response) {
    const data = await this.health.ready();
    const accept = request.headers.accept ?? '';
    const wantsHtml = accept.includes('text/html');

    if (!wantsHtml) {
      return response.json(data);
    }

    const statusClass =
      data.status === 'ready' ? 'is-ready' : data.status === 'degraded' ? 'is-warn' : 'is-down';

    const checksHtml = Object.entries(data.checks)
      .map(([name, check]) => {
        const state = check.status;
        const cardClass = state === 'ok' ? 'ok' : state === 'degraded' ? 'warn' : 'down';
        const mode = 'mode' in check ? `<div class="sub">mode: ${check.mode}</div>` : '';
        return `<article class="check ${cardClass}">
          <div class="name">${name}</div>
          <div class="state">${state.toUpperCase()}</div>
          ${mode}
        </article>`;
      })
      .join('');

    return response.type('text/html').send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>ZEA PLAY API Readiness</title>
    <style>
      :root {
        --bg-1: #0a0716;
        --bg-2: #1f1438;
        --panel: rgba(16, 10, 33, 0.72);
        --text: #efe8ff;
        --muted: #b9a9de;
        --line: rgba(187, 131, 255, 0.34);
        --ok: #52ffb1;
        --warn: #ffd15c;
        --down: #ff6f93;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        color: var(--text);
        font-family: "Space Grotesk", "Segoe UI", sans-serif;
        background:
          radial-gradient(circle at 12% 14%, rgba(176, 118, 255, 0.25), transparent 44%),
          radial-gradient(circle at 85% 83%, rgba(82, 255, 177, 0.14), transparent 46%),
          linear-gradient(145deg, var(--bg-1), var(--bg-2));
        padding: 20px;
      }
      .card {
        width: min(94vw, 860px);
        border-radius: 20px;
        padding: 26px;
        border: 1px solid var(--line);
        background: var(--panel);
        box-shadow: 0 0 36px rgba(187, 131, 255, 0.2), inset 0 0 30px rgba(187, 131, 255, 0.06);
        backdrop-filter: blur(10px);
      }
      .badge {
        display: inline-flex;
        align-items: center;
        border-radius: 999px;
        padding: 8px 12px;
        border: 1px solid var(--line);
        text-transform: uppercase;
        letter-spacing: 0.06em;
        font-weight: 700;
      }
      .badge.is-ready { color: var(--ok); border-color: rgba(82, 255, 177, 0.45); }
      .badge.is-warn { color: var(--warn); border-color: rgba(255, 209, 92, 0.45); }
      .badge.is-down { color: var(--down); border-color: rgba(255, 111, 147, 0.45); }
      h1 { margin: 16px 0 6px; font-size: clamp(1.5rem, 3.8vw, 2.2rem); }
      p { margin: 0; color: var(--muted); }
      .checks {
        margin-top: 18px;
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: 10px;
      }
      .check {
        border-radius: 12px;
        padding: 12px;
        border: 1px solid transparent;
        background: rgba(11, 8, 25, 0.6);
      }
      .check.ok { border-color: rgba(82, 255, 177, 0.5); }
      .check.warn { border-color: rgba(255, 209, 92, 0.5); }
      .check.down { border-color: rgba(255, 111, 147, 0.5); }
      .name { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.07em; color: var(--muted); }
      .state { margin-top: 7px; font-weight: 700; }
      .sub { margin-top: 6px; font-size: 0.82rem; color: var(--muted); }
      .meta {
        margin-top: 16px;
        border-top: 1px solid rgba(187, 131, 255, 0.25);
        padding-top: 12px;
        color: var(--muted);
        font-size: 0.92rem;
      }
    </style>
  </head>
  <body>
    <main class="card" role="main" aria-live="polite">
      <span class="badge ${statusClass}">${data.status}</span>
      <h1>Readiness Probe Dashboard</h1>
      <p>Dependency graph status for production traffic readiness.</p>
      <section class="checks">
        ${checksHtml}
      </section>
      <section class="meta">Timestamp: ${data.timestamp}</section>
    </main>
  </body>
</html>`);
  }
}
