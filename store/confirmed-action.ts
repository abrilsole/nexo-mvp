"use client";
import { useAppStore, type Result } from "./use-app-store";
type State = ReturnType<typeof useAppStore.getState>;
type ActionName = { [K in keyof State]: State[K] extends (...args: never[]) => Result<unknown> ? K : never }[keyof State];
export function useConfirmedAction<K extends ActionName>(name: K) {
  const action = useAppStore((s) => s[name]);
  return (...args: Parameters<State[K]>): Promise<ReturnType<State[K]>> =>
    useAppStore.getState().confirmOperation(() => (action as (...a: Parameters<State[K]>) => Result<unknown>)(...args)) as Promise<ReturnType<State[K]>>;
}
