import { injectable } from "zebra";

export interface Blog { id: number; title: string; content: string; }

@injectable()
export class BlogRepo {
  private items: Blog[] = [];
  private nextId = 1;
  list(): Blog[] { return [...this.items]; }
  find(id: number): Blog | undefined { return this.items.find((b) => b.id === id); }
  create(title: string, content: string): Blog {
    const b: Blog = { id: this.nextId++, title, content };
    this.items.push(b);
    return b;
  }
  remove(id: number): boolean {
    const i = this.items.findIndex((b) => b.id === id);
    if (i === -1) return false;
    this.items.splice(i, 1);
    return true;
  }
}

@injectable()
export class BlogService {
  constructor(private repo: BlogRepo) {}
  async list() { return this.repo.list(); }
  async find(id: number) { return this.repo.find(id); }
  async create(title: string, content: string) { return this.repo.create(title, content); }
  async remove(id: number) { return this.repo.remove(id); }
}
