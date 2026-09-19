<div align="center">

# ⚡ Zeaplay V2 ⚡  
### The next-gen productivity platform with real-time power

<p>
  <a href="#-features">Features</a> •
  <a href="#-tech-stack">Tech Stack</a> •
  <a href="#-quick-start">Quick Start</a> •
  <a href="#-project-structure">Structure</a> •
  <a href="#-scripts">Scripts</a> •
  <a href="#-roadmap">Roadmap</a>
</p>

<img src="https://readme-typing-svg.herokuapp.com?font=Fira+Code&size=24&pause=900&color=00E7FF&center=true&vCenter=true&width=900&lines=Monorepo+powered+by+Turbo;NestJS+API+%7C+Next.js+Web+%7C+Worker+Services;Type-safe+packages+shared+across+apps;Build+fast.+Ship+faster." alt="Typing Animation" />

<br/>

<img src="https://img.shields.io/badge/Status-Active-00c853?style=for-the-badge&logo=github" />
<img src="https://img.shields.io/badge/Monorepo-Turborepo-ff6d00?style=for-the-badge&logo=turborepo" />
<img src="https://img.shields.io/badge/API-NestJS-e0234e?style=for-the-badge&logo=nestjs" />
<img src="https://img.shields.io/badge/Web-Next.js-111111?style=for-the-badge&logo=nextdotjs" />
<img src="https://img.shields.io/badge/Package_Manager-pnpm-f69220?style=for-the-badge&logo=pnpm" />

</div>

---

## ✨ Features

- 🚀 **Turbo monorepo architecture** for blazing-fast builds
- 🧠 **Scalable backend** with modular NestJS structure
- 🎨 **Modern web frontend** built with Next.js + Tailwind
- 🔁 **Background worker services** for async processing
- 📦 **Shared internal packages** for types, auth, config, ui, events
- 🧪 **Integration + E2E testing setup** with Jest and Playwright
- 🐳 **Docker-first local infrastructure** (Postgres, Redis, monitoring, nginx)

---

## 🛠 Tech Stack

```mermaid
flowchart LR
  A[Web App\nNext.js] --> B[API\nNestJS]
  C[Worker\nNestJS] --> B
  B --> D[(PostgreSQL)]
  B --> E[(Redis)]
  C --> E
  B --> F[Shared Packages]
  A --> F
