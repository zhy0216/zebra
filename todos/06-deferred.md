# 06 · 推迟项（deferred）

设计来源：`docs/superpowers/specs/2026-05-16-zebra-v2-design.md` §10 Open Questions 与 §11 Out of Scope。

**全部条目标 `[deferred]`**：不做，保持现状。仅记录决策、防止重复讨论；除非未来单独拍板，不进入实现。

## D1 · `[deferred]` `@zebra/cli` 脚手架 {#d1}

- `zebra new` / `zebra add` 脚手架
- 设计文档明确推迟到 post-v1.0。不动。

## D2 · `[deferred]` Plugin 正式接口 {#d2}

- 带生命周期钩子 + DI 绑定的 `Plugin` 接口，替代「中间件是唯一扩展点」
- 推迟到生态包出现需求信号。不动。

## D3 · `[deferred]` `@zebra/session-redis` {#d3}

- Redis 会话存储适配器（消费 `01-session.md` C3 的 `SessionStore` 接口）
- 设计文档留到 v0.3 详细计划之后。不动。

## D4 · `[deferred]` Bun macro 构建期校验 {#d4}

- 把 DI 依赖图校验从运行时挪到构建期（Bun macro）
- 显著复杂度，设计文档说 revisit at v1.x。不动。

## Done criteria

- 无代码变更。若未来决策变化，先在本文档更新决策记录再动工。
