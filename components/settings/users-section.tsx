"use client";
import { useConfirmedAction } from "@/store/confirmed-action";
// Configuración → Usuarios (solo Administrativo). Usuario = cuenta para entrar; persona = operario con su
// costo por hora (Operarios). Un operario puede existir sin usuario.
import { setCommercialAccess } from "@/lib/supabase/users";
import { useCallback, useEffect, useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { UserCheck, UserMinus, UserPlus } from "lucide-react";
import type { Operator } from "@/types";
import { formatDate } from "@/lib/formatting";
import { activeOperators } from "@/lib/operators";
import { ROLE_KEYS, ROLE_LABELS, roleKeyOf, type RoleKey } from "@/lib/permissions";
import { deactivateError, newUserSchema, roleChangeError, type Invitation, type Member, type NewUser } from "@/lib/users";
import { createClient } from "@/lib/supabase/client";
import { loadMembers, revokeInvitation, setMemberActive, setMemberRole } from "@/lib/supabase/users";
import { inviteUser } from "@/app/(gestion)/settings/actions";
import { useAppStore } from "@/store/use-app-store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { HelpTip } from "@/components/ui/help-tip";
import { Input, Select } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { DeactivatePanel } from "@/components/operators/deactivate-panel";

type Status = { ok: boolean; text: string } | null;

const errorText = (e: unknown) => (e instanceof Error ? e.message : "Ocurrió un error inesperado.");

/** Operarios activos que todavía no tienen usuario (para invitarlos o pasar una cuenta a Operario). */
function freeOperators(operators: Operator[], members: Member[], invitations: Invitation[]): Operator[] {
  const taken = new Set([...members.map((m) => m.operatorId), ...invitations.map((i) => i.operatorId)].filter(Boolean));
  return activeOperators(operators).filter((o) => !taken.has(o.id) && !o.userId);
}

export function UsersSection() {
  const operators = useAppStore((s) => s.operators);
  const [data, setData] = useState<{ members: Member[]; invitations: Invitation[] } | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const [loadError, setLoadError] = useState("");

  const load = useCallback(async () => {
    try {
      setData(await loadMembers(createClient()));
      setLoadError("");
    } catch (e) {
      setLoadError(errorText(e));
    }
  }, []);

  useEffect(() => {
    // Carga desde la base: el setState ocurre después del await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const run = async (fn: () => Promise<void>, ok: string) => {
    try {
      await fn();
      setStatus({ ok: true, text: ok });
      await load();
    } catch (e) {
      setStatus({ ok: false, text: errorText(e) });
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1">
            Usuarios
            <HelpTip label="Usuarios y operarios">
              <span className="block">Un usuario es una cuenta para entrar a Blerp, con un rol: Administrativo, Compras, Jefe de planta u Operario.</span>
              <span className="block">
                Un operario (en Operarios) es la persona con su costo por hora: puede existir sin usuario. Para que entre, invitalo acá como Operario y elegí
                quién es.
              </span>
              <span className="block">Operarios sin mail: todavía no tienen forma de entrar. Está como pregunta abierta para el cliente (acceso con PIN).</span>
            </HelpTip>
          </CardTitle>
          <CardDescription>Cada rol ve solo lo suyo. El titular habilita el acceso comercial. Administración sin ese permiso utiliza las vistas de Planta; cotizaciones y configuración requieren acceso comercial en esta versión. Nadie puede cambiarse el rol ni darse de baja a sí mismo, y siempre queda al menos un Administrativo.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loadError && <p role="alert" className="text-sm text-red-600">No se pudieron cargar los usuarios: {loadError}</p>}
          {status && (
            <p role={status.ok ? "status" : "alert"} className={status.ok ? "text-sm text-emerald-700" : "text-sm text-red-600"}>
              {status.text}
            </p>
          )}
          {!data && !loadError && <p className="text-sm text-slate-500">Cargando usuarios…</p>}
          {data && <MembersTable data={data} operators={operators} run={run} />}
          {data && data.invitations.length > 0 && (
            <section aria-label="Invitaciones pendientes">
              <h3 className="mb-2 text-sm font-semibold text-slate-900">Invitaciones pendientes</h3>
              <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
                {data.invitations.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                    <span className="min-w-0 break-words">
                      <strong>{i.displayName}</strong> · {i.email} · {ROLE_LABELS[roleKeyOf(i.role)]}
                      <span className="block text-xs text-slate-500">Invitado el {formatDate(i.createdAt)}. Entra cuando use ese mail.</span>
                    </span>
                    <Button size="sm" variant="ghost" onClick={() => run(() => revokeInvitation(createClient(), i.id), "Invitación cancelada.")}>
                      Cancelar invitación
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </CardContent>
      </Card>
      {data && <NewUserCard free={freeOperators(operators, data.members, data.invitations)} onDone={load} />}
    </div>
  );
}

function MembersTable({ data, operators, run }: { data: { members: Member[]; invitations: Invitation[] }; operators: Operator[]; run: (fn: () => Promise<void>, ok: string) => Promise<void> }) {
  const reactivateOperator = useConfirmedAction("reactivateOperator");
  const [deactivating, setDeactivating] = useState<Member | null>(null);
  const [toOperator, setToOperator] = useState<{ member: Member; operatorId: string } | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const free = freeOperators(operators, data.members, data.invitations);
  const operatorOf = (m: Member) => operators.find((o) => o.id === m.operatorId);

  const changeRole = (m: Member, to: RoleKey) => {
    const err = roleChangeError(data.members, m, to);
    if (err) return setRowError({ ...rowError, [m.userId]: err });
    setRowError({ ...rowError, [m.userId]: "" });
    if (to === "operario") return setToOperator({ member: m, operatorId: "" });
    void run(() => setMemberRole(createClient(), m.userId, to), `${m.displayName} ahora es ${ROLE_LABELS[to]}.`);
  };

  const deactivate = (m: Member) => {
    const err = deactivateError(data.members, m);
    if (err) return setRowError({ ...rowError, [m.userId]: err });
    // Un Operario se da de baja con el mismo flujo de Operarios (reasignando sus proyectos).
    if (operatorOf(m)) return setDeactivating(m);
    void run(() => setMemberActive(createClient(), m.userId, false), `${m.displayName} quedó dado de baja.`);
  };

  const reactivate = async (m: Member) => {
    const op = operatorOf(m);
    if (op && !op.active) await reactivateOperator(op.id);
    void run(() => setMemberActive(createClient(), m.userId, true), `${m.displayName} quedó reactivado.`);
  };

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <Table>
          <THead>
            <TR>
              <TH>Nombre</TH>
              <TH>Mail</TH>
              <TH>Rol</TH>
              <TH>Acceso comercial</TH>
              <TH>Estado</TH>
              <TH className="text-right">Acciones</TH>
            </TR>
          </THead>
          <TBody>
            {data.members.map((m) => (
              <TR key={m.userId} className="align-top">
                <TD className="font-medium text-slate-900">
                  {m.displayName}
                  {m.isSelf && <span className="ml-1 text-xs font-normal text-slate-500">(vos)</span>}
                  {operatorOf(m) && <span className="block text-xs font-normal text-slate-500">Operario: {operatorOf(m)?.name}</span>}
                  {rowError[m.userId] && <span role="alert" className="block text-xs font-normal text-red-600">{rowError[m.userId]}</span>}
                </TD>
                <TD className="break-all text-slate-600">{m.email}</TD>
                <TD>
                  <label className="sr-only" htmlFor={`role-${m.userId}`}>Rol de {m.displayName}</label>
                  <Select
                    id={`role-${m.userId}`}
                    value={roleKeyOf(m.role)}
                    disabled={m.isSelf || !!m.deactivatedAt}
                    onChange={(e) => changeRole(m, e.target.value as RoleKey)}
                    className="h-8 w-auto text-sm"
                  >
                    {ROLE_KEYS.map((k) => (
                      <option key={k} value={k}>{ROLE_LABELS[k]}</option>
                    ))}
                  </Select>
                </TD>
                <TD>{m.role === "owner" ? "Sí (titular)" : m.role === "member" ? <label className="text-xs"><input type="checkbox" aria-label={`Acceso comercial de ${m.displayName}`} checked={!!m.canViewCommercial} disabled={!data.members.some(x=>x.isSelf && x.role === "owner")} onChange={e=>void run(()=>setCommercialAccess(createClient(),m.userId,e.target.checked), "Permiso comercial actualizado.")} /> Puede ver costos y rentabilidad</label> : "No"}</TD>
                <TD>{m.deactivatedAt ? <Badge tone="gray">De baja desde {formatDate(m.deactivatedAt)}</Badge> : <Badge tone="green">Activo</Badge>}</TD>
                <TD className="text-right">
                  {m.isSelf ? null : m.deactivatedAt ? (
                    <Button size="sm" variant="outline" onClick={() => reactivate(m)}>
                      <UserCheck /> Reactivar
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => deactivate(m)}>
                      <UserMinus /> Dar de baja
                    </Button>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>

      {toOperator && (
        <div className="space-y-2 rounded-lg border border-slate-200 p-3 text-sm">
          <p>
            ¿Qué operario es <strong>{toOperator.member.displayName}</strong>? Su cuenta queda vinculada a esa persona (y a su costo por hora).
          </p>
          {free.length === 0 ? (
            <p className="text-amber-800">No hay operarios activos sin usuario. Cargalo primero en Operarios.</p>
          ) : (
            <Field label="Operario" htmlFor="to-operator">
              <Select id="to-operator" value={toOperator.operatorId} onChange={(e) => setToOperator({ ...toOperator, operatorId: e.target.value })}>
                <option value="">Elegí un operario…</option>
                {free.map((o) => (
                  <option key={o.id} value={o.id}>{o.name} · {o.role}</option>
                ))}
              </Select>
            </Field>
          )}
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setToOperator(null)}>Cancelar</Button>
            <Button
              size="sm"
              disabled={!toOperator.operatorId}
              onClick={() => {
                const { member, operatorId } = toOperator;
                setToOperator(null);
                void run(() => setMemberRole(createClient(), member.userId, "operario", operatorId), `${member.displayName} ahora es Operario.`);
              }}
            >
              Pasar a Operario
            </Button>
          </div>
        </div>
      )}

      {deactivating && operatorOf(deactivating) && (
        <div className="rounded-lg border border-slate-200 p-3">
          <p className="mb-2 text-sm text-slate-700">
            Dar de baja a <strong>{deactivating.displayName}</strong>: también se da de baja como operario. Elegí qué pasa con sus proyectos.
          </p>
          <DeactivatePanel
            operator={operatorOf(deactivating)!}
            onCancel={() => setDeactivating(null)}
            onDone={() => {
              const m = deactivating;
              setDeactivating(null);
              void run(() => setMemberActive(createClient(), m.userId, false), `${m.displayName} quedó dado de baja.`);
            }}
          />
        </div>
      )}
    </div>
  );
}

function NewUserCard({ free, onDone }: { free: Operator[]; onDone: () => Promise<void> }) {
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<Status>(null);
  const { register, handleSubmit, reset, control, formState } = useForm<NewUser>({
    resolver: zodResolver(newUserSchema),
    defaultValues: { displayName: "", email: "", role: "admin", operatorId: "" },
  });
  const role = useWatch({ control, name: "role" });
  const errors = formState.errors;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Nuevo usuario</CardTitle>
        <CardDescription>Le llega un mail de invitación. También puede entrar con Google usando ese mismo mail.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          noValidate
          className="space-y-4"
          onSubmit={handleSubmit((v) =>
            startTransition(async () => {
              const res = await inviteUser(v);
              setStatus({ ok: res.ok, text: res.message });
              if (res.ok) {
                reset();
                await onDone();
              }
            }),
          )}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nombre" htmlFor="nu-name" error={errors.displayName?.message}>
              <Input id="nu-name" autoComplete="off" aria-invalid={!!errors.displayName} {...register("displayName")} />
            </Field>
            <Field label="Mail de invitación" htmlFor="nu-email" error={errors.email?.message}>
              <Input id="nu-email" type="email" autoComplete="off" aria-invalid={!!errors.email} {...register("email")} />
            </Field>
            <Field label="Rol" htmlFor="nu-role" error={errors.role?.message}>
              <Select id="nu-role" {...register("role")}>
                {ROLE_KEYS.map((k) => (
                  <option key={k} value={k}>{ROLE_LABELS[k]}</option>
                ))}
              </Select>
            </Field>
            {role === "operario" && (
              <Field label="¿Qué operario es?" htmlFor="nu-operator" error={errors.operatorId?.message} hint="Solo operarios activos que todavía no tienen usuario.">
                <Select id="nu-operator" aria-invalid={!!errors.operatorId} {...register("operatorId")}>
                  <option value="">Elegí un operario…</option>
                  {free.map((o) => (
                    <option key={o.id} value={o.id}>{o.name} · {o.role}</option>
                  ))}
                </Select>
              </Field>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
            <Button type="submit" disabled={pending}>
              <UserPlus /> {pending ? "Invitando…" : "Invitar"}
            </Button>
            {status && (
              <p role={status.ok ? "status" : "alert"} className={status.ok ? "text-sm text-emerald-700" : "text-sm text-red-600"}>
                {status.text}
              </p>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
