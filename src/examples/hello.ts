import { z } from "../lib/app";

z.get("/hello/{name}", (name: string) => `hello, ${name}`);

if (require.main === module) {
    z.run();
}
