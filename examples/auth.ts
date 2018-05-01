import {z} from "../lib/app";

interface User{
    name: string;
}

z.inject(function user(req){
    return {
        "name": 'test'
    }
});

z.addGet("/hello/", (user: User) => `hello, ${user.name}`);




if (require.main === module) {
    z.run();
}
