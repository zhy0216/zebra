"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const app_1 = require("../lib/app");
app_1.z.addGet("/hello/{name}", (name) => `hello, ${name}`);
if (require.main === module) {
    app_1.z.run();
}
