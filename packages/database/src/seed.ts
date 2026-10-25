import pg from "pg";
import { randomUUID } from "node:crypto";
if (process.env.NODE_ENV !== "development" || process.env.AUTH_MODE !== "demo")
  throw new Error("Synthetic seed is development/demo only");
const client = new pg.Client({
  connectionString: process.env.MIGRATION_DATABASE_URL,
});
await client.connect();
const tenant = "10000000-0000-4000-8000-000000000001";
const entity = "20000000-0000-4000-8000-000000000001";
const otherEntity = "20000000-0000-4000-8000-000000000002";
const employeeId = (n: number) =>
  `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const fixtures = [
  [
    "Maya Iyer",
    "People experience lead",
    "People & culture",
    "Hyderabad",
    "MI",
  ],
  ["Arjun Mehta", "Senior product designer", "Design", "Hyderabad", "AM"],
  ["Zara Khan", "Frontend engineer", "Engineering", "Bengaluru", "ZK"],
  ["Neel Rao", "Engineering manager", "Engineering", "Hyderabad", "NR"],
  ["Ananya Sen", "Brand designer", "Design", "Bengaluru", "AS"],
  ["Rohan Das", "People partner", "People & culture", "Hyderabad", "RD"],
  ["Meera Nair", "Product manager", "Product", "Hyderabad", "MN"],
  ["Ishaan Roy", "Platform engineer", "Engineering", "Bengaluru", "IR"],
  ["Diya Kapoor", "Finance analyst", "Finance", "Hyderabad", "DK"],
  [
    "Aarav Shah",
    "Customer success lead",
    "Customer experience",
    "Bengaluru",
    "AS",
  ],
  ["Tara Bose", "Quality engineer", "Engineering", "Hyderabad", "TB"],
  [
    "Kabir Sethi",
    "Workplace coordinator",
    "People & culture",
    "Hyderabad",
    "KS",
  ],
];
async function master(
  entityId: string,
  kind: "department" | "location",
  code: string,
  name: string,
) {
  const existing = await client.query<{ id: string }>(
    "SELECT id FROM org_unit WHERE tenant_id=$1 AND entity_id=$2 AND kind=$3 AND (code=$4 OR lower(name)=lower($5)) ORDER BY (code=$4) DESC LIMIT 1",
    [tenant, entityId, kind, code, name],
  );
  if (existing.rows[0]) return existing.rows[0].id;
  const id = randomUUID();
  await client.query(
    "INSERT INTO org_unit(id,tenant_id,entity_id,kind,code,name) VALUES ($1,$2,$3,$4,$5,$6)",
    [id, tenant, entityId, kind, code, name],
  );
  return id;
}
const departmentCodes: Record<string, string> = {
  "People & culture": "DEPT-PEOPLE",
  Design: "DEPT-DESIGN",
  Engineering: "DEPT-ENGINEERING",
  Product: "DEPT-PRODUCT",
  Finance: "DEPT-FINANCE",
  "Customer experience": "DEPT-CUSTOMER",
  Testing: "DEPT-TESTING",
};
async function employment(input: {
  id: string;
  entityId: string;
  code: string;
  name: string;
  title: string;
  department: string;
  location: string;
  email: string;
  joinedOn: string;
  managerId: string | null;
  initials: string;
}) {
  // Reruns do not rename edited masters, resurrect erased employments or reissue codes.
  if (
    (
      await client.query(
        "SELECT 1 FROM employee_code_allocation WHERE tenant_id=$1 AND employee_id=$2",
        [tenant, input.id],
      )
    ).rowCount
  )
    return;
  await client.query(
    "INSERT INTO person(id,tenant_id,name,initials) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING",
    [input.id, tenant, input.name, input.initials],
  );
  const departmentId = await master(
    input.entityId,
    "department",
    departmentCodes[input.department]!,
    input.department,
  );
  const locationId = await master(
    input.entityId,
    "location",
    input.location === "Hyderabad"
      ? "LOC-HYDERABAD"
      : input.location === "Bengaluru"
        ? "LOC-BENGALURU"
        : "LOC-TEST",
    input.location,
  );
  await client.query(
    `INSERT INTO employee_code_allocation(tenant_id,entity_id,employee_id,code,allocation_sequence)
    VALUES ($1,$2,$3,$4,$5)`,
    [
      tenant,
      input.entityId,
      input.id,
      input.code,
      input.code.startsWith("ANV-") ? input.code.slice(4) : null,
    ],
  );
  await client.query(
    `INSERT INTO employee(id,tenant_id,entity_id,person_id,code,title,department_id,location_id,email,joined_on,status,manager_id)
    VALUES ($1,$2,$3,$1,$4,$5,$6,$7,$8,$9,'active',$10)`,
    [
      input.id,
      tenant,
      input.entityId,
      input.code,
      input.title,
      departmentId,
      locationId,
      input.email,
      input.joinedOn,
      input.managerId,
    ],
  );
}
try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(804211)");
  await client.query(
    "INSERT INTO tenant VALUES ($1,$2) ON CONFLICT DO NOTHING",
    [tenant, "Anvi demo group"],
  );
  for (const [id, name] of [
    [entity, "Anvi demo workspace"],
    [otherEntity, "Isolated test entity"],
  ]) {
    await client.query(
      "INSERT INTO legal_entity(id,tenant_id,name) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
      [id, tenant, name],
    );
    await client.query(
      "INSERT INTO branding(tenant_id,entity_id,platform_name,employee_name,organization_name,theme) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING",
      [tenant, id, "AnviOne", "MyAnvi", name, "ocean"],
    );
  }
  for (const [index, row] of fixtures.entries()) {
    const [name, title, department, location, initials] = row;
    await employment({
      id: employeeId(index + 1),
      entityId: entity,
      code: `ANV-${String(index + 1).padStart(6, "0")}`,
      name: name!,
      title: title!,
      department: department!,
      location: location!,
      email: `demo${index + 1}@anvi.example`,
      joinedOn: `2026-${index > 7 ? "10" : "09"}-${String(index + 1).padStart(2, "0")}`,
      managerId: index === 0 ? null : employeeId(index < 4 ? 1 : 4),
      initials: initials!,
    });
  }
  await employment({
    id: employeeId(99),
    entityId: otherEntity,
    code: "ISOLATED-1",
    name: "Isolation fixture",
    title: "Test record",
    department: "Testing",
    location: "Test location",
    email: "isolation@anvi.example",
    joinedOn: "2026-01-01",
    managerId: null,
    initials: "IF",
  });
  for (const name of [
    "HR",
    "IT",
    "Management",
    "Marketing",
    "Hardware",
    "Administration",
  ]) {
    await master(entity, "department", `DEPT-${name.toUpperCase()}`, name);
  }
  // Do not reset a sequence to the greatest committed row: rolled-back allocations
  // also reserve gaps. Reconcile upward only, under the allocator's lock.
  await client.query(
    `SELECT setval('employee_code_sequence',greatest(
      (SELECT last_value FROM employee_code_sequence),
      coalesce((SELECT max(allocation_sequence) FROM employee_code_allocation),1)
    ),true)`,
  );
  await client.query(
    `INSERT INTO identity_binding(id,tenant_id,entity_id,employee_id,issuer,subject,active,roles)
    VALUES ('40000000-0000-4000-8000-000000000001',$1,$2,$3,'urn:anvione:local-demo','maya-demo',true,ARRAY['hr_admin','employee','manager','platform_admin','auditor']) ON CONFLICT DO NOTHING`,
    [tenant, entity, employeeId(1)],
  );
  // Leave for Maya's direct reports so the manager queue has real work. The
  // database guards run as each requester; dates follow the entity's calendar.
  const leave = [
    [2, "CL", 8, 10, "Sister's wedding in Pune", false],
    [3, "SL", 15, 15, "Planned minor procedure", true],
    [4, "EL", 22, 26, "Family trip to Coorg", false],
  ] as const;
  const context = (employee: string, scope: string) =>
    client.query(
      `SELECT set_config('app.tenant_id',$1,true), set_config('app.entity_id',$2,true),
        set_config('app.employee_id',$3,true), set_config('app.leave_scope',$4,true),
        set_config('app.actor_id',$5,true), set_config('app.actor_label','Maya Iyer',true)`,
      [tenant, entity, employee, scope, randomUUID()],
    );
  for (const [n, code, from, to, reason, approve] of leave) {
    const requester = employeeId(n);
    if (
      (
        await client.query(
          "SELECT 1 FROM leave_request WHERE tenant_id=$1 AND employee_id=$2",
          [tenant, requester],
        )
      ).rowCount
    )
      continue;
    await context(requester, "self");
    const id = randomUUID();
    await client.query(
      `INSERT INTO leave_request(id,tenant_id,entity_id,employee_id,leave_type_id,start_date,end_date,reason,days,state,approver,version,requested_by_actor)
       SELECT $1,$2,$3,$4,t.id,
         date_trunc('week',leave_entity_today())::date+$6::int,
         date_trunc('week',leave_entity_today())::date+$7::int,
         $8,1,'pending','hr',1,gen_random_uuid()
       FROM leave_type t WHERE t.tenant_id=$2 AND t.entity_id=$3 AND t.code=$5`,
      [id, tenant, entity, requester, code, from, to, reason],
    );
    if (approve) {
      await context(employeeId(1), "team");
      await client.query(
        "UPDATE leave_request SET state='approved', version=version+1 WHERE id=$1",
        [id],
      );
    }
  }
  await client.query("COMMIT");
  console.log(
    "Synthetic people, employment and organization fixtures are initialized; existing records are preserved.",
  );
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
