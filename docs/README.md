# Zebra

## Quick tutorial

1. Install zebra-web: `yarn install zebra-web`
2. Create a file called `main.ts` with the following code:

```javascript
import { z } from "zebra";

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


## Injection
The idea of injection is more like C#'s dependency injection(DI), but DI is based on type, which maybe not suitable for a dynamic language.
So instead of injecting by type, we infer the variable by name. The idea is actually come from [pytest's fixture](https://docs.pytest.org/en/2.8.7/fixture.html).

### Immediate Injection
You can bind a parameter name with a variable for all the handles. [an example is here](TODO:)

### Lazy Injection
Instead of binding with a variable, we can even bind with a function then the behavior will like call-by-need.


## Routing
Zebra comes with a basic router that supports request parameters.

To specify a parameter, surround it with parentheses like so: {PARAM}. Request parameters will be passed to the route handler functions as keyword arguments.

```
z.addGet('/tag/{tag}', (tag: str) => `Tag - ${tag}`)
```
Notice the type after `tag` in handle function, which will be always string for routing parameters.
So when it is an integer, you have to convert it manually. (maybe can be automatically in a class view with ES7 decorator?)

## Request Data
When an endpoint receives a HTTP request, the route function will inject all the request data.
The following variables are accessible by function parameters:

* req - IncomingMessage
* res - ServerResponse (most time you should not access this object)
* body (Any) - JSON body
* you can also inject parameters here by using [injection](#injection)

## Response


## Error handling
explain the handle sequence, especially when multi inheritance involve.


## Why Zebra has no X features
### Cookies
Cookie is not secure. All the modern browsers support local storage, just save [jwt](https://jwt.io/) token and send back.
### Post Form
Just send json data.
### ORM
You can integral any one you want, that is actually the good part of framework.
### Template
Similar like ORM.
### Validation Schema
Maybe I will add one.

See [examples](https://github.com/zhy0216/zebra/tree/master/examples) and [tests](https://github.com/zhy0216/zebra/tree/master/test).

Inspired by flask, koajs, hug, sanic and pytest;
