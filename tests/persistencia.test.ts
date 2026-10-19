import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Workspace } from "@/lib/supabase/workspace";
import { buildSeed } from "@/lib/seed-data";
import { DEFAULT_SETTINGS } from "@/lib/constants";
import { todayISO } from "@/lib/formatting";
vi.mock("@/lib/supabase/client",()=>({createClient:()=>({})}));
const remote=vi.hoisted(()=>({commitChange:vi.fn(),syncStock:vi.fn(),syncOperators:vi.fn(),syncRequests:vi.fn(),loadWorkspace:vi.fn()}));
vi.mock("@/lib/supabase/workspace",async importOriginal=>({...await importOriginal<object>(),...remote}));
const {useAppStore}=await import("@/store/use-app-store");
let ws:Workspace;
beforeEach(()=>{
 vi.clearAllMocks();const seed=buildSeed(new Date());
 ws={...useAppStore.getState(),...seed,organizationId:"test-org",userId:"owner",userEmail:"owner@test",userName:"Owner",organizationName:"Test",role:"owner",isDemo:false,demoSeeded:true,stockMigrated:false,settings:DEFAULT_SETTINGS,requests:[],resolvedAlertIds:[],assignments:[{id:"test-asg",projectId:"p-1042",itemId:"itm-mostrador",rubro:"carpinteria_madera",operatorId:"op-juan",date:todayISO(),plannedHours:9,createdBy:"Owner",createdAt:""}]};
 useAppStore.getState().loadWorkspace(ws);remote.loadWorkspace.mockResolvedValue(ws);
});
describe("H: confirmación de escritura y recuperación",()=>{
 it("no confirma antes del servidor y rechaza el segundo clic durante el guardado",async()=>{
  let release!:()=>void;remote.commitChange.mockImplementation(()=>new Promise<void>(r=>{release=r;}));
  let finished=false;
  const first=useAppStore.getState().confirmOperation(()=>useAppStore.getState().logHours("p-1042",{assignmentId:"test-asg",hours:9,confirmHighHours:true})).then(r=>{finished=true;return r;});
  await Promise.resolve();await Promise.resolve();expect(finished).toBe(false);
  const second=await useAppStore.getState().confirmOperation(()=>useAppStore.getState().logHours("p-1042",{assignmentId:"test-asg",hours:9,confirmHighHours:true}));
  expect(second.ok).toBe(false);release();expect((await first).ok).toBe(true);expect(remote.commitChange).toHaveBeenCalledTimes(1);
 });
 it("escritura rechazada devuelve error y recupera la versión persistida",async()=>{
  remote.commitChange.mockRejectedValueOnce(new Error("Escritura rechazada por RLS"));
  const result=await useAppStore.getState().confirmOperation(()=>useAppStore.getState().logHours("p-1042",{assignmentId:"test-asg",hours:1}));
  expect(result.ok).toBe(false);expect(useAppStore.getState().projects).toEqual(ws.projects);expect(remote.loadWorkspace).toHaveBeenCalled();
 });
 it("si el servidor confirmó pero falla la recarga, evita reintentar lo ya guardado y bloquea nuevas escrituras",async()=>{
  remote.commitChange.mockResolvedValue(undefined);remote.loadWorkspace.mockRejectedValueOnce(new Error("Sin conexión"));
  const result=await useAppStore.getState().confirmOperation(()=>useAppStore.getState().logHours("p-1042",{assignmentId:"test-asg",hours:1}));
  expect(result.ok).toBe(true);expect(useAppStore.getState().syncStatus).toBe("error");
  expect((await useAppStore.getState().confirmOperation(()=>({ok:true,value:undefined}))).ok).toBe(false);
 });
 it("mantiene el bloqueo mientras se actualizan las vistas tras guardar",async()=>{
  remote.commitChange.mockResolvedValue(undefined);
  let release!:()=>void;
  remote.loadWorkspace.mockImplementationOnce(()=>new Promise<Workspace>(r=>{release=()=>r(ws);}));
  const first=useAppStore.getState().confirmOperation(()=>useAppStore.getState().logHours("p-1042",{assignmentId:"test-asg",hours:1}));
  await vi.waitFor(()=>expect(remote.loadWorkspace).toHaveBeenCalled());
  const second=await useAppStore.getState().confirmOperation(()=>({ok:true,value:undefined}));
  expect(second.ok).toBe(false);release();expect((await first).ok).toBe(true);
 });

});
