import { createClient } from "@zebra-web/client";
import { blogContract } from "./contract.ts";

// The client depends only on the contract — no server code.
const api = createClient(blogContract, { baseUrl: "http://localhost:3001" });

const created = await api.create({
  body: { title: "contract-first", content: "hello from the typed client" },
});
console.log("created:", JSON.stringify(created));

const list = await api.list({ query: { page: 1 } });
console.log("list:", JSON.stringify(list));

const got = await api.get({ params: { id: created.id } });
console.log("get:", JSON.stringify(got));

try {
  await api.get({ params: { id: 999 } });
} catch (err) {
  console.log(
    "404 handled as ClientError:",
    (err as { status: number; problem: { title: string } }).problem.title,
  );
}
