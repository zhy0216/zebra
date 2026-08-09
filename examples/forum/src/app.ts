import { HttpError, Zebra, cors, getSession, rateLimit, sessionMiddleware } from "zebra";
import { attachUser, getCurrentUser, requireAuth } from "./auth.ts";
import { forumContract } from "./contract.ts";
import { LiveFeed } from "./feed.ts";
import { AuthService, ForumService, ForumStore } from "./services.ts";

// ---------------------------------------------------------------------------
// Composition root. buildForumApp() wires everything Zebra has to offer:
//   1. DI container  — @injectable singletons, injectValue, named-object deps
//   2. Sessions      — HMAC-signed sid cookie + session-scoped DI + ws session
//   3. Middleware    — dep-aware middleware() + per-route guards
//   4. Rate limiting — per-user fixed window on write routes
//   5. Contract-first — one contract, validated on input AND output
//   6. WebSocket     — DI-resolved upgrade decision + HTTP→WS broadcast
//   7. Static files  — public/ frontend
//   8. Lifecycle     — ready/shutdown hooks
//
// Tests call buildForumApp() and drive requests in-process via app.dispatch()
// (no sockets), so tests exercise the exact same composition as the server.
// ---------------------------------------------------------------------------

export interface ForumAppOptions {
  sessionSecret?: string;
}

export function buildForumApp(opts: ForumAppOptions = {}): Zebra {
  // --- cookie sessions (HMAC-SHA256 signed `sid`, pluggable store) ---------
  // The resolver is wired into Zebra so session-scoped DI works; wsSession
  // attaches a live RequestSession to every WebSocket connection.
  const session = sessionMiddleware({
    secret: opts.sessionSecret ?? "forum-demo-secret",
    cookie: { httpOnly: true, sameSite: "lax", maxAge: 7 * 24 * 60 * 60, path: "/" },
  });

  const app = new Zebra({
    session: { resolver: session.resolver, wsSession: session.wsSession, ttl: 30 * 60 * 1000 },
  });

  // --- DI registrations -----------------------------------------------------
  app.injectSingleton(ForumStore);
  app.injectSingleton(AuthService);
  app.injectSingleton(ForumService);
  const liveFeed = new LiveFeed();
  app.injectValue(LiveFeed, liveFeed); // same instance as the ws handler below

  // --- global middleware chain ---------------------------------------------
  app.use(cors({ origin: ["http://localhost:3002"], credentials: true }));
  app.use(session);
  app.use(attachUser);

  // --- per-user write rate limit (keyed by the logged-in session) ----------
  const writeLimit = rateLimit({
    windowMs: 60_000,
    max: 30,
    keyBy: async (req) => {
      const s = getSession(req);
      const userId = s === undefined ? undefined : await s.get("userId");
      return typeof userId === "number" ? `user:${userId}` : "anonymous";
    },
  });

  // --- contract-first API ---------------------------------------------------
  app.implement(
    forumContract,
    { auth: AuthService, forum: ForumService, feed: LiveFeed },
    {
      auth: {
        register: async (req, { auth }) => {
          const { username, password } = await req.body();
          const user = await auth.register(username, password);
          await getSession(req)!.set("userId", user.id);
          return user;
        },
        login: async (req, { auth }) => {
          const { username, password } = await req.body();
          const user = await auth.login(username, password);
          await getSession(req)!.set("userId", user.id);
          return user;
        },
        logout: async (req) => {
          await getSession(req)!.destroy();
        },
        me: async (req) => getCurrentUser(req) ?? null,
      },
      boards: {
        list: async (_req, { forum }) => forum.listBoards(),
      },
      topics: {
        list: async (req, { forum }) => {
          const board = await forum.findBoard(req.params.boardId);
          if (board === undefined) throw new HttpError(404, "board_not_found", "No such board");
          return forum.listTopics(req.params.boardId, req.query.page, req.query.pageSize);
        },
        get: async (req, { forum }) => {
          const topic = await forum.findTopic(req.params.id);
          if (topic === undefined) throw new HttpError(404, "topic_not_found", "No such topic");
          return topic;
        },
        create: {
          middlewares: [requireAuth(), writeLimit],
          handler: async (req, { forum }) => {
            const board = await forum.findBoard(req.params.boardId);
            if (board === undefined) throw new HttpError(404, "board_not_found", "No such board");
            const { title } = await req.body();
            const user = getCurrentUser(req)!;
            return forum.createTopic(req.params.boardId, title, user);
          },
        },
      },
      posts: {
        list: async (req, { forum }) => {
          const topic = await forum.findTopic(req.params.topicId);
          if (topic === undefined) throw new HttpError(404, "topic_not_found", "No such topic");
          return forum.listPosts(req.params.topicId);
        },
        create: {
          middlewares: [requireAuth(), writeLimit],
          handler: async (req, { forum, feed }) => {
            const topic = await forum.findTopic(req.params.topicId);
            if (topic === undefined) throw new HttpError(404, "topic_not_found", "No such topic");
            const { content } = await req.body();
            const user = getCurrentUser(req)!;
            const post = await forum.createPost(req.params.topicId, content, user);
            feed.publish(req.params.topicId, { type: "post_created", topicId: topic.id, post });
            return post;
          },
        },
      },
    },
  );

  // --- real-time topic feed -------------------------------------------------
  // The upgrade hook is DI-resolved (ForumService) and can inspect path
  // params — rejected topics answer 401 instead of opening a socket.
  // data.session carries the signed-cookie session when logged in.
  app.ws("/topics/:topicId/live", {
    onUpgrade: { forum: ForumService },
    async upgrade(_req, { forum }, params) {
      const topic = await forum.findTopic(Number(params.topicId));
      return topic === undefined ? false : { topicId: topic.id };
    },
    open(ws, data) {
      liveFeed.subscribe(data.topicId, ws);
      void (async () => {
        const session = data.session as { get: (k: string) => Promise<unknown> } | undefined;
        const userId = session === undefined ? undefined : await session.get("userId");
        ws.send(JSON.stringify({ type: "joined", topicId: data.topicId, userId }));
      })();
    },
    close(ws, data) {
      liveFeed.unsubscribe(data.topicId, ws);
    },
  });

  // --- static frontend -------------------------------------------------------
  app.static("/", new URL("../public", import.meta.url).pathname);

  // --- lifecycle -------------------------------------------------------------
  app.on("ready", () => {
    console.log("forum example ready — public frontend and API on /");
  });
  app.on("shutdown", () => {
    liveFeed.dispose();
  });

  return app;
}
