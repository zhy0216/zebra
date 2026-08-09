import { zc } from "@zebra/contract";
import { z } from "zod";

// ---------------------------------------------------------------------------
// The contract is the single source of truth. It is implemented by the server
// (app.implement), consumed by the typed client (createClient), and exercised
// by tests (createTestClient) — with the same validation on every path.
// ---------------------------------------------------------------------------

export const User = z.object({ id: z.number(), username: z.string() });

export const Board = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string(),
});

export const Topic = z.object({
  id: z.number(),
  boardId: z.number(),
  title: z.string(),
  authorId: z.number(),
  author: z.string(),
  postCount: z.number(),
  createdAt: z.number(),
});

export const Post = z.object({
  id: z.number(),
  topicId: z.number(),
  authorId: z.number(),
  author: z.string(),
  content: z.string(),
  createdAt: z.number(),
});

export const forumContract = {
  auth: {
    register: zc
      .post("/auth/register")
      .body(z.object({ username: z.string().min(2), password: z.string().min(4) }))
      .output(User)
      .status(201)
      .errors({ username_taken: { status: 409 } }),
    login: zc
      .post("/auth/login")
      .body(z.object({ username: z.string(), password: z.string() }))
      .output(User)
      .errors({ invalid_credentials: { status: 401 } }),
    logout: zc.post("/auth/logout").status(204),
    me: zc.get("/auth/me").output(User.nullable()),
  },
  boards: {
    list: zc.get("/boards").output(z.array(Board)),
  },
  topics: {
    list: zc
      .get("/boards/:boardId/topics")
      .params(z.object({ boardId: z.coerce.number().int() }))
      .query(
        z.object({
          page: z.coerce.number().int().min(1).default(1),
          pageSize: z.coerce.number().int().min(1).max(50).default(10),
        }),
      )
      .output(z.object({ items: z.array(Topic), total: z.number() }))
      .errors({ board_not_found: { status: 404 } }),
    get: zc
      .get("/topics/:id")
      .params(z.object({ id: z.coerce.number().int() }))
      .output(Topic)
      .errors({ topic_not_found: { status: 404 } }),
    create: zc
      .post("/boards/:boardId/topics")
      .params(z.object({ boardId: z.coerce.number().int() }))
      .body(z.object({ title: z.string().min(1).max(200) }))
      .output(Topic)
      .status(201)
      .errors({ board_not_found: { status: 404 }, unauthorized: { status: 401 } }),
  },
  posts: {
    list: zc
      .get("/topics/:topicId/posts")
      .params(z.object({ topicId: z.coerce.number().int() }))
      .output(z.array(Post))
      .errors({ topic_not_found: { status: 404 } }),
    create: zc
      .post("/topics/:topicId/posts")
      .params(z.object({ topicId: z.coerce.number().int() }))
      .body(z.object({ content: z.string().min(1).max(5000) }))
      .output(Post)
      .status(201)
      .errors({ topic_not_found: { status: 404 }, unauthorized: { status: 401 } }),
  },
};

export type ForumContract = typeof forumContract;
