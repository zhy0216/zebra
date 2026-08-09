# DI / Container

DI is **mandatory, not bolted on**. Every app is built around a `Container`.
Routes and middleware declare their dependencies; the container validates the
full graph at boot.

## Named-object route DI

```ts
import { Zebra } from "zebra";

const z = new Zebra();
z.get(path, { svc: Service }, (req, { svc }) => { /* ... */ });
```

The `{ svc: Service }` spec is explicit and type-safe — no string-parsing
tricks. The container resolves `svc` and injects it into the handler.

## Four scopes

| Scope      | Lifetime                                             |
| ---------- | ---------------------------------------------------- |
| singleton  | One instance for the whole app                       |
| request    | One instance per request                             |
| session    | One instance per session (session-scoped DI)         |
| transient  | A new instance every time it is resolved             |

Scope-rank rules are enforced at boot: a scoped binding may only depend on
bindings of the same or wider scope (e.g. a request-scoped service cannot
depend on a session-scoped one).

## Registering bindings

On the `Zebra` instance (writes to the container it owns):

```ts
z.injectValue(Config, config);                    // value binding
z.injectSingleton(Service);                       // class binding
z.injectRequest(Service);
z.injectSession(Service);
z.injectTransient(Service);
```

Factory bindings — with an optional declared-deps form so the graph is still
validated at boot:

```ts
z.injectFactorySingleton(Service, () => new Service());
z.injectFactoryRequest(Service, { dep: Dep }, ({ dep }) => new Service(dep));
```

The `injectFactory*` family covers all four scopes.

## Container API

```ts
import { Container } from "zebra";

const container = new Container();
container.bind(IRepo).to(MockRepo); // token/interface binding
```

Tokens are created with `token()`. Classes annotated with `@injectable()`
declare their constructor deps via `@inject()` or decorator metadata.

| Export | Meaning |
| ------ | ------- |
| `Container` | The container: `bind(...).to(...)`, resolve, validation |
| `token` / `Token` | Typed identifiers for interface bindings |
| `injectable` / `inject` | Class decorators |
| `ScopeKind` | `singleton` \| `request` \| `session` \| `transient` |
| `Disposable` | Interface for cleanup; disposables are torn down on shutdown |
| `CircularDependencyError` | Thrown at boot when the graph has a cycle |
| `UnboundTokenError` | Thrown when a dependency is unregistered |
| `ScopeMismatchError` | Thrown when scope-rank rules are violated |

`validateGraph` is exported for explicit validation.

## Session-scoped DI

Session scope needs a session id: Zebra resolves it (via the session
middleware's `resolver`, see the [session guide](session.md)), applies an
idle TTL, supports explicit `z.disposeSession(id)`, and falls back to a
request-local anonymous session when no session cookie is present.
