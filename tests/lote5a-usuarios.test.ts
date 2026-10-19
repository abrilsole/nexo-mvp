// Lote 5A — usuarios: reglas de rol y baja, y el formulario de alta (Zod).
import { describe, expect, it } from "vitest";
import { deactivateError, membersFromJson, newUserSchema, roleChangeError, type Member } from "@/lib/users";

const m = (userId: string, role: Member["role"], extra: Partial<Member> = {}): Member => ({
  userId,
  displayName: userId,
  email: `${userId}@x.com`,
  role,
  createdAt: "2026-01-01",
  isSelf: false,
  ...extra,
});

describe("cambiar de rol y dar de baja", () => {
  const laura = m("laura", "owner", { isSelf: true });
  const sofia = m("sofia", "member");
  const martin = m("martin", "compras");

  it("un administrador no puede quitarse a sí mismo el rol ni darse de baja", () => {
    expect(roleChangeError([laura, sofia], laura, "compras")).toMatch(/propio rol/);
    expect(deactivateError([laura, sofia], laura)).toMatch(/a vos mismo/);
  });
  it("no se puede dejar a la empresa sin Administrativo activo", () => {
    const solo = m("sofia", "member");
    const others = [m("laura", "owner", { deactivatedAt: "2026-02-01" }), solo, martin];
    expect(roleChangeError(others, solo, "compras")).toMatch(/al menos un usuario Administrativo/);
    expect(deactivateError(others, solo)).toMatch(/último usuario Administrativo/);
  });
  it("con otro Administrativo activo, se puede", () => {
    expect(roleChangeError([laura, sofia, martin], sofia, "jefe_planta")).toBeNull();
    expect(deactivateError([laura, sofia, martin], sofia)).toBeNull();
    expect(deactivateError([laura, sofia, martin], martin)).toBeNull();
  });
  it("owner y member son el mismo rol (Administrativo): no es un cambio", () => {
    expect(roleChangeError([laura, sofia], sofia, "admin")).toBeNull();
  });
});

describe("alta de usuario", () => {
  it("pide nombre, mail válido y rol; el mail se guarda en minúsculas", () => {
    const ok = newUserSchema.safeParse({ displayName: "Martín Ruiz", email: " Martin@Demo.com ", role: "compras" });
    expect(ok.success && ok.data.email).toBe("martin@demo.com");
    const bad = newUserSchema.safeParse({ displayName: "M", email: "no", role: "x" });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues.map((i) => i.path[0])).toEqual(["displayName", "email", "role"]);
  });
  it("un Operario se vincula a una persona de Operarios", () => {
    expect(newUserSchema.safeParse({ displayName: "Juan", email: "juan@x.com", role: "operario" }).error?.issues[0].message).toMatch(/qué operario/);
    expect(newUserSchema.safeParse({ displayName: "Juan", email: "juan@x.com", role: "operario", operatorId: "op-juan" }).success).toBe(true);
  });
});

describe("lectura de admin_members()", () => {
  it("traduce usuarios e invitaciones", () => {
    const r = membersFromJson({
      members: [{ user_id: "u1", display_name: "Laura", email: "l@x.com", role: "owner", deactivated_at: null, created_at: "2026-01-01", operator_id: null, is_self: true }],
      invitations: [{ id: "i1", email: "m@x.com", display_name: "Martín", role: "compras", operator_id: null, created_at: "2026-02-01" }],
    });
    expect(r.members[0]).toEqual({ canViewCommercial: false, userId: "u1", displayName: "Laura", email: "l@x.com", role: "owner", deactivatedAt: undefined, createdAt: "2026-01-01", operatorId: undefined, isSelf: true });
    expect(r.invitations[0]).toMatchObject({ id: "i1", role: "compras", displayName: "Martín" });
  });
});
