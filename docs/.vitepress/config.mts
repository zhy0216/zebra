import { defineConfig } from "vitepress";

const enNav = [
  { text: "Home", link: "/" },
  { text: "Guides", link: "/01-getting-started" },
  { text: "API Freeze", link: "/api-freeze" },
  { text: "GitHub", link: "https://github.com/zhy0216/zebra" },
];

const zhNav = [
  { text: "首页", link: "/zh/" },
  { text: "指南", link: "/zh/01-getting-started" },
  { text: "API 冻结", link: "/zh/api-freeze" },
  { text: "GitHub", link: "https://github.com/zhy0216/zebra" },
];

const enSidebar = [
  {
    text: "Getting Started",
    items: [{ text: "Getting Started", link: "/01-getting-started" }],
  },
  {
    text: "Core",
    items: [
      { text: "Routing", link: "/02-routing" },
      { text: "Dependency Injection", link: "/03-di" },
      { text: "Middleware", link: "/04-middleware" },
      { text: "HTTP", link: "/05-http" },
      { text: "Lifecycle", link: "/06-lifecycle" },
      { text: "WebSockets", link: "/10-websockets" },
    ],
  },
  {
    text: "Contract-first",
    items: [{ text: "Contract-first APIs", link: "/11-contract-first" }],
  },
  {
    text: "Middleware Packages",
    items: [
      { text: "Sessions", link: "/07-sessions" },
      { text: "CORS", link: "/08-cors" },
      { text: "Rate Limiting", link: "/09-rate-limiting" },
      { text: "Observability", link: "/13-observability" },
      { text: "Redis", link: "/14-redis" },
    ],
  },
  {
    text: "Testing & Release",
    items: [
      { text: "Testing", link: "/12-testing" },
      { text: "Production", link: "/15-production" },
      { text: "API Freeze & Versioning", link: "/api-freeze" },
    ],
  },
];

const zhSidebar = [
  {
    text: "入门",
    items: [{ text: "快速开始", link: "/zh/01-getting-started" }],
  },
  {
    text: "核心",
    items: [
      { text: "路由", link: "/zh/02-routing" },
      { text: "依赖注入", link: "/zh/03-di" },
      { text: "中间件", link: "/zh/04-middleware" },
      { text: "HTTP", link: "/zh/05-http" },
      { text: "生命周期", link: "/zh/06-lifecycle" },
      { text: "WebSocket", link: "/zh/10-websockets" },
    ],
  },
  {
    text: "契约优先",
    items: [{ text: "契约优先 API", link: "/zh/11-contract-first" }],
  },
  {
    text: "中间件包",
    items: [
      { text: "会话", link: "/zh/07-sessions" },
      { text: "CORS", link: "/zh/08-cors" },
      { text: "限流", link: "/zh/09-rate-limiting" },
      { text: "可观测性", link: "/zh/13-observability" },
      { text: "Redis", link: "/zh/14-redis" },
    ],
  },
  {
    text: "测试与发布",
    items: [
      { text: "测试", link: "/zh/12-testing" },
      { text: "生产部署", link: "/zh/15-production" },
      { text: "API 冻结与版本", link: "/zh/api-freeze" },
    ],
  },
];

export default defineConfig({
  lang: "en",
  title: "Zebra",
  description:
    "Zebra is a Bun-first TypeScript web framework with first-class dependency injection.",
  base: process.env.DOCS_BASE || "/",
  cleanUrls: true,
  lastUpdated: true,
  ignoreDeadLinks: true,

  head: [
    ["link", { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" }],
    [
      "meta",
      { name: "theme-color", content: "#4f46e5" },
    ],
  ],

  themeConfig: {
    logo: "/logo.svg",
    search: {
      provider: "local",
    },
    socialLinks: [
      { icon: "github", link: "https://github.com/zhy0216/zebra" },
    ],
    editLink: {
      pattern: "https://github.com/zhy0216/zebra/edit/master/docs/:path",
      text: "Edit this page on GitHub",
    },
    footer: {
      message: "Built with VitePress · MIT Licensed",
      copyright: "Copyright © Zebra",
    },
  },

  locales: {
    root: {
      label: "English",
      lang: "en",
      link: "/",
      themeConfig: {
        nav: enNav,
        sidebar: enSidebar,
      },
    },
    zh: {
      label: "简体中文",
      lang: "zh-CN",
      link: "/zh/",
      themeConfig: {
        nav: zhNav,
        sidebar: zhSidebar,
      },
    },
  },
});
