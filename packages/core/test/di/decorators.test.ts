import "reflect-metadata";
import { test, expect } from "bun:test";
import { Container } from "../../src/di/container.ts";
import { injectable, inject } from "../../src/di/decorators.ts";
import { token } from "../../src/di/token.ts";

class Logger {
  log(msg: string) { return `[log] ${msg}`; }
}

@injectable()
class BlogService {
  constructor(public logger: Logger) {}
  greet() { return this.logger.log("hello"); }
}

test("class deps from constructor types are auto-resolved", () => {
  const c = new Container();
  c.bind(Logger).toSelf();
  c.bind(BlogService).toSelf();
  expect(c.resolve(BlogService).greet()).toBe("[log] hello");
});

interface IRepo { find(): string; }
const Repo = token<IRepo>("Repo");

@injectable()
class WithExplicit {
  constructor(@inject(Repo) public repo: IRepo) {}
}

test("@inject(TOKEN) overrides type-based resolution", () => {
  const c = new Container();
  c.bind(Repo).toValue({ find: () => "found" });
  c.bind(WithExplicit).toSelf();
  expect(c.resolve(WithExplicit).repo.find()).toBe("found");
});
