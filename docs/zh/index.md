---
layout: home

hero:
  name: Zebra
  text: Bun-first 的 TypeScript Web 框架
  tagline: 一等公民的依赖注入、契约优先 API 与结构化错误 —— 直接构建在 Bun 之上。
  actions:
    - theme: brand
      text: 快速开始
      link: /zh/01-getting-started
    - theme: alt
      text: 篇章索引
      link: /zh/02-routing
  image:
    src: /logo.svg
    alt: Zebra
features:
  - title: Bun-first
    details: 直接构建在 Bun.serve / Bun.file 与 Web Standard Request / Response 之上，没有 Node 兼容层。
  - title: DI 是强制的，不是外挂
    details: 每个应用都围绕一个 Container 构建；路由与中间件声明自己的依赖，容器在启动时校验整张依赖图。
  - title: 命名对象路由 DI
    details: "app.get(path, { svc: Service }, (req, { svc }) => ...) —— 显式、类型安全、零字符串解析。"
  - title: 结构化错误
    details: "默认错误响应遵循 RFC 9457（Problem+Json），并支持类型安全的错误定义。"
  - title: 契约优先（oRPC 风格）
    details: "契约定义一次（zc.get(path).params(s).body(s)...），服务端以完整类型推断实现，并从同一契约派生类型安全客户端。"
  - title: 零依赖包
    details: 契约、客户端与 Redis 适配器零运行时依赖；类型从契约一路流向客户端。
---

<footer class="home-footer">

> English docs: [English](/)

</footer>
