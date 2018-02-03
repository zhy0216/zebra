# zebra
a typescript web framework

in process...

an easy example will be
```javascript
import {z} from "zebra";

z.addGet("/hello/{name}", (name: string) => `hello, ${name}`);
z.run();
```





inspired by flask, koajs, hug, sanic;