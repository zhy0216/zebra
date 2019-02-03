import { z } from "../lib/app";


z.addGet("/hello/{name}", (name: string) => `hello, ${name}`);

if (require.main === module) {
    z.run();
}
