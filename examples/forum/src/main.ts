import "reflect-metadata";
import { buildForumApp } from "./app.ts";

const PORT = Number(process.env.PORT ?? 3002);

const app = buildForumApp();
await app.listen({ port: PORT });
console.log(`forum example on http://localhost:${PORT}`);
