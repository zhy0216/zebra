---
layout: home

hero:
  name: Zebra
  text: Bun-first TypeScript web framework
  tagline: First-class dependency injection, contract-first APIs, and structured errors — built directly on Bun.
  actions:
    - theme: brand
      text: Get Started
      link: /01-getting-started
    - theme: alt
      text: Guide Index
      link: /02-routing
  image:
    src: /logo.svg
    alt: Zebra
features:
  - title: Bun-first
    details: Built directly on Bun.serve / Bun.file and Web Standard Request / Response. No Node compat layer.
  - title: DI is mandatory, not bolted on
    details: Every app is built around a Container. Routes and middleware declare their dependencies; the container validates the full graph at boot.
  - title: Named-object route DI
    details: "app.get(path, { svc: Service }, (req, { svc }) => ...) — explicit, type-safe, no string-parsing tricks."
  - title: Structured errors
    details: "Default error responses follow RFC 9457 (Problem+Json), with full type-safe error definitions."
  - title: Contract-first (oRPC style)
    details: "Define a contract once (zc.get(path).params(s).body(s)...), implement it with full type inference, and derive a type-safe client from the same contract."
  - title: Zero-dependency packages
    details: Contracts, clients, and Redis adapters ship with zero runtime dependencies. Types flow from contracts to clients.
---

<footer class="home-footer">

> 简体中文文档：[中文文档](/zh/)

</footer>
