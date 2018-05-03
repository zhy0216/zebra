# Zebra

## Quick tutorial

1. Install zebra-web: `npm install zebra-web`
2. Create a file called `main.ts` with the following code:

```javascript
import {z} from "zebra";

z.addGet("/hello/{name}", (name: string) => `hello, ${name}`);
z.run();
```

3. Compile the typescript file to javascript file. `tsc main.ts`, this will generate `main.js`.
If you had not not learnt typescript, check the official website [tutorial](https://www.typescriptlang.org/docs/handbook/typescript-in-5-minutes.html).
3. Run the server: `node main.js`
4. Open the address `http://0.0.0.0:8888/hello/there` in your web browser. You should see the message *hello, there*.


*By default*, Zebra treats all the incoming data and response data with `Content-Type: application/json; charset=utf-8`.

`z` is the singleton instance of `Zebra`. The reason to choose `z` instead of (`zebra`, `zapp`, `zebraApp`) is because that `z` is shortest among the candidates.
Typing less a few characters really matters.


## Routing

### Request parameters

## Request Data

## Response

## Injection

## Exceptions

## Why Zebra has no X features
### Cookies (talk about jwt)
### Post Form
### ORM
### Template


inspired by flask, koajs, hug, sanic and pytest;