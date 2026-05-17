import "reflect-metadata";
import { Zebra } from "zebra";

const z = new Zebra();

z.get("/hello/:name", async (req) => `hello, ${req.params.name}`);

await z.listen({ port: 3000 });
console.log("hello example listening on http://localhost:3000");
