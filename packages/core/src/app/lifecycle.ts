export type LifecycleEvent = "boot" | "ready" | "shutdown";
export type LifecycleHandler = () => void | Promise<void>;
