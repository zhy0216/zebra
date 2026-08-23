import { HttpError, injectable } from "@zebra-web/zebra";

// ---------------------------------------------------------------------------
// Domain types + in-memory persistence. Services are plain @injectable classes;
// the container resolves the constructor graph (AuthService -> ForumStore) at
// boot time and validates it for cycles / scope violations.
//
// Failures surface as HttpError — the error middleware serializes them as
// RFC 9457 Problem+Json, and the typed client maps them onto the error codes
// declared in the contract.
// ---------------------------------------------------------------------------

export interface User {
  id: number;
  username: string;
}

export interface StoredUser extends User {
  passwordHash: string;
}

export interface Board {
  id: number;
  name: string;
  description: string;
}

export interface Topic {
  id: number;
  boardId: number;
  title: string;
  authorId: number;
  author: string;
  postCount: number;
  createdAt: number;
}

export interface Post {
  id: number;
  topicId: number;
  authorId: number;
  author: string;
  content: string;
  createdAt: number;
}

@injectable()
export class ForumStore {
  private users: StoredUser[] = [];
  private topics: Topic[] = [];
  private posts: Post[] = [];
  private nextUserId = 1;
  private nextTopicId = 1;
  private nextPostId = 1;
  private readonly boards: Board[];

  constructor() {
    // Boards are static fixtures; topics/posts are created through the API.
    this.boards = [
      { id: 1, name: "Announcements", description: "Framework news and releases" },
      { id: 2, name: "General", description: "Anything and everything" },
      { id: 3, name: "Show & Tell", description: "What did you build?" },
    ];
  }

  listBoards(): Board[] {
    return this.boards.map((b) => ({ ...b }));
  }

  findBoard(id: number): Board | undefined {
    return this.boards.find((b) => b.id === id);
  }

  findUserById(id: number): User | undefined {
    const u = this.users.find((u) => u.id === id);
    return u === undefined ? undefined : { id: u.id, username: u.username };
  }

  findUserByName(username: string): StoredUser | undefined {
    return this.users.find((u) => u.username === username);
  }

  createUser(username: string, passwordHash: string): StoredUser {
    const user: StoredUser = { id: this.nextUserId++, username, passwordHash };
    this.users.push(user);
    return user;
  }

  listTopics(boardId: number, page: number, pageSize: number): { items: Topic[]; total: number } {
    const all = this.topics.filter((t) => t.boardId === boardId);
    const start = (page - 1) * pageSize;
    return {
      items: all.slice(start, start + pageSize).map((t) => ({ ...t })),
      total: all.length,
    };
  }

  findTopic(id: number): Topic | undefined {
    const t = this.topics.find((t) => t.id === id);
    return t === undefined ? undefined : { ...t };
  }

  createTopic(boardId: number, title: string, author: User): Topic {
    const topic: Topic = {
      id: this.nextTopicId++,
      boardId,
      title,
      authorId: author.id,
      author: author.username,
      postCount: 0,
      createdAt: Date.now(),
    };
    this.topics.push(topic);
    return { ...topic };
  }

  listPosts(topicId: number): Post[] {
    return this.posts.filter((p) => p.topicId === topicId).map((p) => ({ ...p }));
  }

  createPost(topicId: number, content: string, author: User): Post {
    const post: Post = {
      id: this.nextPostId++,
      topicId,
      authorId: author.id,
      author: author.username,
      content,
      createdAt: Date.now(),
    };
    this.posts.push(post);
    const topic = this.topics.find((t) => t.id === topicId);
    if (topic !== undefined) topic.postCount++;
    return { ...post };
  }
}

@injectable()
export class ForumService {
  constructor(private readonly store: ForumStore) {}

  listBoards(): Board[] {
    return this.store.listBoards();
  }

  findBoard(id: number): Board | undefined {
    return this.store.findBoard(id);
  }

  listTopics(boardId: number, page: number, pageSize: number) {
    return this.store.listTopics(boardId, page, pageSize);
  }

  findTopic(id: number): Topic | undefined {
    return this.store.findTopic(id);
  }

  createTopic(boardId: number, title: string, author: User): Topic {
    return this.store.createTopic(boardId, title, author);
  }

  listPosts(topicId: number): Post[] {
    return this.store.listPosts(topicId);
  }

  createPost(topicId: number, content: string, author: User): Post {
    return this.store.createPost(topicId, content, author);
  }
}

@injectable()
export class AuthService {
  constructor(private readonly store: ForumStore) {}

  /** Registers a user; throws 409 when the username is already taken. */
  async register(username: string, password: string): Promise<User> {
    if (this.store.findUserByName(username) !== undefined) {
      throw new HttpError(409, "username_taken", "Username already taken");
    }
    const passwordHash = await Bun.password.hash(password);
    const stored = this.store.createUser(username, passwordHash);
    return { id: stored.id, username: stored.username };
  }

  /** Verifies credentials; throws 401 on mismatch. */
  async login(username: string, password: string): Promise<User> {
    const stored = this.store.findUserByName(username);
    if (stored === undefined || !(await Bun.password.verify(password, stored.passwordHash))) {
      throw new HttpError(401, "invalid_credentials", "Invalid username or password");
    }
    return { id: stored.id, username: stored.username };
  }

  userById(id: number): User | undefined {
    return this.store.findUserById(id);
  }
}
