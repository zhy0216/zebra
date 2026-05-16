import "reflect-metadata";
import { Container, Zebra } from "zebra";

const app = new Zebra({ container: new Container() });

app.get("/hello/:name", async (req) => `hello, ${req.params.name}`);

await app.listen({ port: 3000 });
console.log("hello example listening on http://localhost:3000");
