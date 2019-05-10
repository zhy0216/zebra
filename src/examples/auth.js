"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const app_1 = require("../lib/app");
const utils_1 = require("../lib/utils");
// Authorization: Bearer <token>
app_1.z.inject(async function user(req) {
    try {
        const authHeader = req.headers.authorization;
        if (authHeader === undefined) {
            throw Error("require login");
        }
        const token = authHeader.toString().split(" ")[1];
        return await utils_1.jwtDecode(token, "9876");
    }
    catch (e) {
        throw e;
    }
});
app_1.z.addGet("/hello/", (user) => `hello, ${user.name}`);
if (require.main === module) {
    app_1.z.run();
}
