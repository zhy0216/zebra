import { IncomingMessage } from "http";

import { z } from "../lib/app";
import { jwtDecode } from "../lib/utils";


interface User {
    name: string;
}

// Authorization: Bearer <token>
z.inject(async function user(req: IncomingMessage) {
    try {
        const authHeader = req.headers.authorization;
        if (authHeader === undefined) {
            throw Error("require login");
        }
        const token = authHeader.toString().split(" ")[1];
        return await jwtDecode(token, "9876");
    } catch (e) {
        throw e;
    }
});

z.addGet("/hello/", (user: User) => `hello, ${user.name}`);

if (require.main === module) {
    z.run();
}
