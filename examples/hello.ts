import {z} from "../lib/app";

z.addGet("/hello/{name}", (name: string) => `hello, ${name}`);
z.run();