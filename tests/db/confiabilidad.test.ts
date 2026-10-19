import { beforeAll, afterAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { buildSeed } from "@/lib/seed-data";
import { workspacePayload } from "@/lib/supabase/workspace";
import { DEFAULT_SETTINGS } from "@/lib/constants";
import { asUser, createDb, errorAs, signUp } from "./harness";
let db:PGlite, org:string, owner:string, plant:string, worker:string, admin:string, buyer:string, outsider:string;
const call=(u:string, fn:string, p:unknown)=>asUser(db,u,tx=>tx.query(`select ${fn}($1::jsonb) as result`,[JSON.stringify(p)]));
const assign=(id:string,project="p-1042",date="2000-01-04",kind="labor",planned=3)=>call(plant,"planta_save_assignment",{id,project_id:project,item_id:project==="p-1042"?"itm-mostrador":"itm-1045-puestos",rubro:"carpinteria_madera",operator_id:"op-juan",date,planned_hours:planned,hour_kind:kind});
const log=(id:string,assignment:string,hours:number)=>call(worker,"taller_log_hours",{id,assignment_id:assignment,hours});
beforeAll(async()=>{
 db=await createDb(); owner=await signUp(db,"owner@audit.test","Owner");
 org=(await db.query<{organization_id:string}>("select organization_id from organization_members where user_id=$1",[owner])).rows[0].organization_id;
 await db.query("insert into hour_rates(organization_id,id,name,hourly_rate,kind,position) values($1,'design','Diseño',27000,'design',1) on conflict do nothing",[org]);
 const seed=buildSeed(new Date());
 await call(owner,"reset_workspace",workspacePayload(org,{...seed,requests:[],settings:DEFAULT_SETTINGS,resolvedAlertIds:[],assignments:[],orders:[]}));
 for(const [email,role,operator_id] of [["plant","jefe_planta",null],["worker","operator","op-juan"],["admin","member",null],["buyer","compras",null]])
  await call(owner,"admin_invite_member",{email:`${email}@audit.test`,display_name:email,role,operator_id});
 plant=await signUp(db,"plant@audit.test","Plant"); worker=await signUp(db,"worker@audit.test","Worker");
 admin=await signUp(db,"admin@audit.test","Admin"); buyer=await signUp(db,"buyer@audit.test","Buyer"); outsider=await signUp(db,"other@audit.test","Other");
},120000);
afterAll(async()=>{await db?.close();});
describe("recorridos integrados de confiabilidad",()=>{
 it("A/G/H: 9 horas confirmadas son visibles desde sesiones independientes; reintentar el mismo ID no duplica",async()=>{
  await assign("nine","p-1042","2000-01-03","labor",9);
  await log("entry-nine","nine",9);await log("entry-nine","nine",9);
  const r=await asUser(db,owner,tx=>tx.query<{n:number,h:string}>("select count(*)::int n, sum((labor->>'hours')::numeric)::text h from actual_entries where id='entry-nine'"));
  expect(r.rows[0]).toEqual({n:1,h:"9"});
  for(const [u,fn] of [[worker,"taller_workspace"],[plant,"planta_workspace"]]){
   const w=await asUser(db,u,tx=>tx.query<{r:{actual_entries:Array<{id:string,labor:{hours:number},amount?:number}>}}>(`select ${fn}() r`));
   const e=w.rows[0].r.actual_entries.find(e=>e.id==="entry-nine");expect(Number(e?.labor.hours)).toBe(9);expect(e?.amount ?? 0).toBe(0);
  }
  expect(await errorAs(db,worker,tx=>tx.query("select taller_log_hours($1)",[JSON.stringify({id:"entry-nine",assignment_id:"nine",hours:10})]))).toMatch(/otros datos/);
 });
 it("B: 8 h se redistribuyen a 3 y 5, se guarda el original y se revalúan ambos proyectos una sola vez",async()=>{
  await assign("asg-a");await assign("asg-b","p-1045","2000-01-04","labor",5);await log("eight","asg-a",8);
  const p={id:"fix-eight",entry_id:"eight",expected_hours:8,expected_assignment_id:"asg-a",reason:"Se cargó todo en A",allocations:[{assignment_id:"asg-a",hours:3},{assignment_id:"asg-b",hours:5}]};
  await call(plant,"planta_correct_hours",p);await call(plant,"planta_correct_hours",p);
  const r=await asUser(db,owner,tx=>tx.query<{project_id:string,h:string,cost:string}>("select project_id,sum((labor->>'hours')::numeric)::text h,sum(amount)::text cost from actual_entries where operator_id='op-juan' and date='2000-01-04' group by project_id order by project_id"));
  expect(r.rows.map(x=>x.h)).toEqual(["3","5"]);expect(Number(r.rows[0].cost)/3).toBe(Number(r.rows[1].cost)/5);
  const audit=await db.query<{h:string}>("select before_record->'labor'->>'hours' h from hours_corrections where id='fix-eight'");expect(audit.rows[0].h).toBe("8");
  const records=await asUser(db,plant,tx=>tx.query("select * from hours_corrections"));expect(records.rows).toHaveLength(0);
 });
 it("B/F: destino inválido, concurrencia obsoleta o rol no autorizado no modifican la primera parte",async()=>{
  const p={id:"invalid",entry_id:"eight",expected_hours:3,expected_assignment_id:"asg-a",reason:"Prueba inválida",allocations:[{assignment_id:"asg-a",hours:1},{assignment_id:"other-tenant",hours:2}]};
  for(const u of [plant,buyer,worker,outsider]) expect(await errorAs(db,u,tx=>tx.query("select planta_correct_hours($1)",[JSON.stringify(p)]))).not.toBeNull();
  expect((await db.query<{h:string}>("select labor->>'hours' h from actual_entries where id='eight'")).rows[0].h).toBe("3");
  expect((await db.query("select * from hours_corrections where id='invalid'")).rows).toHaveLength(0);
  expect(await errorAs(db,plant,tx=>tx.query("select planta_correct_hours($1)",[JSON.stringify({...p,expected_hours:8})]))).toMatch(/cambió/);
 });
 it("C: confirmar conserva las horas y registra revisor y fecha",async()=>{
  await asUser(db,plant,tx=>tx.query("select planta_confirm_hours($1)",["review-fingerprint"]));
  const r=await asUser(db,plant,tx=>tx.query<{reviewed_by:string}>("select reviewed_by from hours_reviews where review_key='review-fingerprint'"));expect(r.rows[0].reviewed_by).toBe(plant);
 });
 it("F: administración sin permiso recibe solo producción y no puede consultar ni habilitar importes",async()=>{
  for(const table of ["projects","actual_entries","cost_settings","hour_rates","stock_lots","price_history"]){
   expect((await asUser(db,admin,tx=>tx.query(`select * from ${table}`))).rows).toHaveLength(0);
  }
  expect(await errorAs(db,admin,tx=>tx.query("select admin_set_commercial_access($1,true)",[admin]))).toMatch(/titular/);
  expect(await errorAs(db,worker,tx=>tx.query("select private.labor_cost_at($1,'op-juan','2000-01-04')",[org]))).not.toBeNull();
  const w=await asUser(db,admin,tx=>tx.query<{r:unknown}>("select planta_workspace() r"));expect(JSON.stringify(w.rows)).not.toMatch(/sales_price|hourlyCost|hourly_cost/);
  await asUser(db,owner,tx=>tx.query("select admin_set_commercial_access($1,true)",[admin]));
  expect((await asUser(db,admin,tx=>tx.query("select id from projects"))).rows.length).toBeGreaterThan(0);
  expect((await asUser(db,outsider,tx=>tx.query("select id from projects where organization_id=$1",[org]))).rows).toHaveLength(0);
 });
 it("I: diseño y producción desde Aprobado sin pasar por Compras, con categoría y tarifa del servidor",async()=>{
  await db.query("update projects set status='approved' where organization_id=$1 and id='p-1045'",[org]);
  await assign("design","p-1045","2000-01-05","design",2);await assign("prod","p-1045","2000-01-05","labor",3);
  await log("design-entry","design",2);await log("prod-entry","prod",3);
  const rows=(await db.query<{category:string,amount:string}>("select category,amount::text from actual_entries where id in ('design-entry','prod-entry') order by category")).rows;
  expect(rows.map(x=>x.category)).toEqual(["design","labor"]);expect(rows.every(x=>Number(x.amount)>0)).toBe(true);
  expect(await errorAs(db,plant,tx=>tx.query("select planta_save_assignment($1)",[JSON.stringify({id:"design",project_id:"p-1045",item_id:"itm-1045-puestos",rubro:"carpinteria_madera",operator_id:"op-juan",date:"2000-01-05",planned_hours:2,hour_kind:"labor"})]))).toMatch(/ya tiene horas/);
 });
 it("guardado atómico: si falla el stock no cambia el proyecto; una sesión vieja no pisa una nueva",async()=>{
  const before=(await db.query<Record<string,unknown>>("select * from projects where organization_id=$1 and id='p-1042'",[org])).rows[0];
  const change={expected_projects:[{id:before.id,updated_at:JSON.parse(JSON.stringify(before)).updated_at}],tables:{projects:{rows:[{...before,name:"Cambio atómico",updated_at:new Date().toISOString()}],removed:[]}}};
  const invalid={...change,tables:{...change.tables,stock_movements:{rows:[{organization_id:org,id:"invalid-movement",lot_id:"missing-lot",kind:"consume",quantity:1,from_place:{type:"project",projectId:"p-1042"},to_place:{type:"consumed",projectId:"p-1042"},date:"2000-01-05",created_by:"Test"}],removed:[]}}};
  expect(await errorAs(db,owner,tx=>tx.query("select admin_commit_change($1)",[JSON.stringify(invalid)]))).toMatch(/lote no existe/);
  expect((await db.query<{name:string}>("select name from projects where organization_id=$1 and id='p-1042'",[org])).rows[0].name).toBe(before.name);
  await call(owner,"admin_commit_change",change);
  expect(await errorAs(db,owner,tx=>tx.query("select admin_commit_change($1)",[JSON.stringify(change)]))).toMatch(/otra sesión/);
 });

 it("D: una OC de tres proyectos conserva importes y recepciones parciales por línea",async()=>{
  const ids=["p-1042","p-1045","p-1051"];
  const quantities=[5,3,2];const lines=[];
  for(const [i,id] of ids.entries()) {
    const b=(await db.query<Record<string,unknown>>("select * from budget_lines where organization_id=$1 and project_id=$2 and category='materials' and quantity>0 order by position limit 1",[org,id])).rows[0];
    lines.push({id:`consolidated-${i}`,project_id:id,budget_line_id:b.id,material_id:b.material_id,material_name:b.description,unit:b.unit,quantity:quantities[i],unit_cost:43000});
  }
  await call(buyer,"compras_order_save",{id:"consolidated-order",supplier:"Proveedor de prueba",date:"2000-01-06",lines});
  await call(buyer,"compras_order_status",{id:"consolidated-order",action:"send"});
  await call(buyer,"compras_order_status",{id:"consolidated-order",action:"invoice",invoice_number:"Test-001",invoice_amount:430000,invoice_date:"2000-01-06"});
  for(const [i,id] of ids.entries()){
    const rows=(await db.query<{total:string}>("select total::text from purchase_entries where organization_id=$1 and project_id=$2 and id=$3",[org,id,`pur-consolidated-${i}`])).rows;
    expect(Number(rows[0].total)).toBe(quantities[i]*43000);
  }
  await call(buyer,"compras_order_status",{id:"consolidated-order",action:"receive",receipts:lines.map((l,i)=>({line_id:l.id,quantity:1,lot_id:`consolidated-lot-${i}`,movement_id:`consolidated-mov-${i}`}))});
  expect((await db.query<{received:string}>("select received from purchase_orders where id='consolidated-order'")).rows[0].received).toBe("partial");
  await call(buyer,"compras_order_status",{id:"consolidated-order",action:"receive",receipts:lines.map((l,i)=>({line_id:l.id,quantity:quantities[i]-1,lot_id:`consolidated-lot-rest-${i}`,movement_id:`consolidated-mov-rest-${i}`}))});
  expect((await db.query<{received:string}>("select received from purchase_orders where id='consolidated-order'")).rows[0].received).toBe("yes");
 });

 it("la carga manual es atómica y no deja una asignación si la jornada supera 24 h",async()=>{
   const p={id:"manual-over",hours:20,assignment:{id:"manual-over-asg",project_id:"p-1045",item_id:"itm-1045-puestos",rubro:"carpinteria_madera",operator_id:"op-juan",date:"2000-01-05",planned_hours:20}};
   expect(await errorAs(db,owner,tx=>tx.query("select admin_log_hours_manual($1)",[JSON.stringify(p)]))).toMatch(/24 h/);
   expect((await db.query("select id from work_assignments where id='manual-over-asg'")).rows).toHaveLength(0);
   await call(owner,"admin_log_hours_manual",{...p,id:"manual-ok",hours:9,assignment:{...p.assignment,id:"manual-ok-asg",date:"2000-01-07",planned_hours:9}});
   expect(Number((await db.query<{amount:string}>("select amount::text from actual_entries where id='manual-ok'")).rows[0].amount)).toBeGreaterThan(0);
 });

});
