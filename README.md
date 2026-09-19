<div align="center">

# ⚡ Zeaplay V2 ⚡
### Enterprise-ready productivity platform monorepo

<p>
  <a href="#-overview">Overview</a> •
  <a href="#-why-this-project">Why</a> •
  <a href="#-architecture">Architecture</a> •
  <a href="#-apps">Apps</a> •
  <a href="#-packages">Packages</a> •
  <a href="#-infrastructure">Infrastructure</a> •
  <a href="#-development-workflow">Workflow</a> •
  <a href="#-testing-strategy">Testing</a> •
  <a href="#-security--compliance">Security</a> •
  <a href="#-observability">Observability</a> •
  <a href="#-roadmap">Roadmap</a>
</p>

<img src="https://readme-typing-svg.herokuapp.com?font=Fira+Code&size=24&pause=800&color=00E7FF&center=true&vCenter=true&width=1100&lines=Zeaplay+V2+Monorepo;Next.js+Frontend+%2B+NestJS+API+%2B+Worker;Prisma+Data+Layer+%7C+Redis+Caching+%7C+Postgres;Shared+Packages+for+Scale%2C+Safety%2C+Speed;Build+once.+Reuse+everywhere." alt="Typing Animation" />

<br />

<img src="https://img.shields.io/badge/Status-Active-00c853?style=for-the-badge&logo=github" />
<img src="https://img.shields.io/badge/Monorepo-Turborepo-ff6d00?style=for-the-badge&logo=turborepo" />
<img src="https://img.shields.io/badge/API-NestJS-e0234e?style=for-the-badge&logo=nestjs" />
<img src="https://img.shields.io/badge/Web-Next.js-111111?style=for-the-badge&logo=nextdotjs" />
<img src="https://img.shields.io/badge/ORM-Prisma-2D3748?style=for-the-badge&logo=prisma" />
<img src="https://img.shields.io/badge/Cache-Redis-DC382D?style=for-the-badge&logo=redis" />
<img src="https://img.shields.io/badge/DB-PostgreSQL-4169E1?style=for-the-badge&logo=postgresql" />
<img src="https://img.shields.io/badge/Package_Manager-pnpm-F69220?style=for-the-badge&logo=pnpm" />

</div>

---

## 📌 Overview

Zeaplay V2 is a production-oriented, multi-application monorepo designed for high-velocity product teams.  
It combines a modern web experience, a modular API, and asynchronous worker services with shared internal packages that enforce consistency, type safety, and engineering standards.

This repository is optimized for:

- Fast local iteration
- Clean boundaries between domain modules
- Reusable cross-app libraries
- Reliable CI/CD and testability
- Infrastructure parity between local and deployment environments

---

## 🎯 Why This Project

Most teams lose velocity when frontend, backend, and infrastructure drift apart. Zeaplay V2 solves that with one workspace and one engineering language across all surfaces.

### Design Goals

- **Single source of truth:** Shared packages for contracts, types, auth, config, logging, and validation
- **Composable architecture:** Clear app boundaries with module-based internals
- **Operational readiness:** Dockerized dependencies and monitoring primitives
- **Scale from day one:** Domain-centric API modules and worker offloading pattern
- **Developer ergonomics:** Predictable scripts, docs, and consistent project conventions

---

## 🧠 Architecture

```mermaid
flowchart TD
  U[Users] --> W[Web App - Next.js]
  W --> A[API - NestJS]
  A --> P[(PostgreSQL)]
  A --> R[(Redis)]
  A --> M[MinIO / Object Storage]
  WK[Worker - NestJS] --> R
  WK --> A
  WK --> P
  A --> SP[Shared Packages]
  W --> SP
  WK --> SP
