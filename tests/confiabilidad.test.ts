import { describe, expect, it } from "vitest";
import { dailyHoursReviews } from "@/lib/hours-review";
import { myDay } from "@/lib/my-day";
import { materialActualCost, usageLeftoverValue, projectedFinalCost, projectEconomics } from "@/lib/calculations";
import { materialCosts, invoiceEntries } from "@/lib/purchasing";
import { checkHours } from "@/lib/project-rules";
import { project, line, usage } from "./helpers";
import type { WorkAssignment, ActualEntry, PurchaseOrder } from "@/types";
const date="2026-10-15";
const assignments:WorkAssignment[]=[{id:"asg-a",projectId:"a",operatorId:"juan",date,rubro:"carpinteria_madera",plannedHours:3,createdAt:"",createdBy:""},{id:"asg-b",projectId:"b",operatorId:"juan",date,rubro:"carpinteria_madera",plannedHours:5,createdAt:"",createdBy:""}];
const entry=(id:string,p:string,h:number):ActualEntry=>({id,projectId:p,assignmentId:`asg-${p}`,operatorId:"juan",date,type:"labor",category:"labor",description:"",amount:h*100,createdBy:"Juan",createdAt:"",labor:{hours:h,workerName:"Juan",hourlyCost:100,role:"Producción"}});
const threshold={pct:20,hours:2};
describe("recorridos de horas y materiales",()=>{
 it("B/C: detecta 8 en A y 0 en B; una confirmación es estable hasta que cambian los datos; 3/5 resuelve",()=>{
  const projects=[project({id:"a",actualEntries:[entry("entry-a","a",8)]}),project({id:"b"})];
  const review=dailyHoursReviews(projects,assignments,[],date,threshold);
  expect(review).toHaveLength(1);expect(review[0].reason).toBe("distribution");
  expect(dailyHoursReviews(projects,assignments,[],"2026-10-16",threshold)[0].key).toBe(review[0].key);
  const corrected=[project({id:"a",actualEntries:[entry("entry-a","a",3)]}),project({id:"b",actualEntries:[entry("entry-b","b",5)]})];
  expect(dailyHoursReviews(corrected,assignments,[],"2026-10-16",threshold)).toHaveLength(0);
  expect(myDay(corrected,assignments,"juan",date).total).toBe(8);
 });
 it("A: una carga parcial permite continuar y el límite de 24 h suma todos los proyectos",()=>{
  const projects=[project({id:"a",actualEntries:[entry("part","a",1)]}),project({id:"b",actualEntries:[entry("other","b",20)]})];
  expect(myDay(projects,assignments,"juan",date).items[0].done).toBe(false);
  expect(checkHours(projects.flatMap(p=>p.actualEntries),"juan",date,4,date).level).toBe("block");
  expect(checkHours([],"juan",date,Infinity,date).level).toBe("block");
 });
 it("faltantes solo vencidos, no durante la jornada de hoy",()=>{
  const projects=[project({id:"a"}),project({id:"b"})];
  expect(dailyHoursReviews(projects,assignments,[],date,threshold)).toHaveLength(0);
  expect(dailyHoursReviews(projects,assignments,[],"2026-10-16",threshold)[0].reason).toBe("missing");
 });
 it("D: compra consolidada para tres proyectos; mismo material en dos líneas no duplica importes",()=>{
  const budget=[line("materials",5,40000,{id:"one",materialId:"mel",description:"Melamina"}),line("materials",3,40000,{id:"two",materialId:"mel",description:"Melamina"})];
  const order:PurchaseOrder={id:"oc",number:"OC-001",supplier:"Test",date,status:"sent",paid:false,received:"no",createdBy:"",createdAt:"",lines:[
   {id:"l-a",projectId:"a",budgetLineId:"one",materialId:"mel",materialName:"Melamina",quantity:5,unitCost:43000,unit:"placa",receivedQuantity:0},
   {id:"l-b",projectId:"b",budgetLineId:"one",materialId:"mel",materialName:"Melamina",quantity:3,unitCost:43000,unit:"placa",receivedQuantity:0},
   {id:"l-c",projectId:"c",budgetLineId:"one",materialId:"mel",materialName:"Melamina",quantity:2,unitCost:43000,unit:"placa",receivedQuantity:0}]};
  const entries=invoiceEntries(order,{invoiceNumber:"F1",invoiceDate:date,invoiceAmount:430000},"Buyer",date);
  for(const [id,expected] of [["a",215000],["b",129000],["c",86000]] as const){
   const p=project({id,budgetLines:budget,purchaseEntries:entries.filter(e=>e.projectId===id)});
   const report=materialCosts(p,[order]);expect(report.real).toBe(expected);expect(report.rows[1].real).toBe(0);
  }
 });
 it("E: comprar 12 no es consumir 12; 9 consumidas + 1 perdida = 500000 y quedan 100000",()=>{
  const u=usage({quantityConsumed:9,wasteQuantity:1,reusableLeftoverQuantity:2,unitCost:50000});
  expect(materialActualCost([u])).toBe(500000);expect(usageLeftoverValue(u)).toBe(100000);
 });
 it("el proyectado suma las cantidades pendientes a los costos reales sin compensar sobrecostos",()=>{
  const p=project({budgetLines:[line("materials",10,100,{materialId:"mel",unit:"placa"})],materialUsages:[usage({materialId:"mel",unit:"placa",quantityConsumed:2,unitCost:200})]});
  expect(projectedFinalCost(p)).toBe(1200); // 400 ya consumidos + 8 × 100 pendientes.
  expect(projectEconomics(p).categories.find(r=>r.category === "materials")?.projected).toBe(1200);
 });

});
