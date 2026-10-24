import pg from "pg";
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
try {
  await client.query("BEGIN");
  await client.query(
    "INSERT INTO tenant VALUES ($1,$2) ON CONFLICT DO NOTHING",
    [tenant, "Anvi demo group"],
  );
  for (const [id, name] of [
    [entity, "Anvi demo workspace"],
    [otherEntity, "Isolated test entity"],
  ]) {
    await client.query(
      "INSERT INTO legal_entity VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
      [id, tenant, name],
    );
    await client.query(
      "INSERT INTO branding(tenant_id,entity_id,platform_name,employee_name,organization_name,theme) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING",
      [tenant, id, "AnviOne", "MyAnvi", name, "ocean"],
    );
  }
  for (const [index, row] of fixtures.entries()) {
    const [name, title, department, location, initials] = row;
    await client.query(
      `INSERT INTO employee(id,tenant_id,entity_id,code,name,title,department,location,email,joined_on,status,manager_id,initials)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active',$11,$12) ON CONFLICT DO NOTHING`,
      [
        employeeId(index + 1),
        tenant,
        entity,
        `ANV-${String(index + 1).padStart(6, "0")}`,
        name,
        title,
        department,
        location,
        `demo${index + 1}@anvi.example`,
        `2026-${index > 7 ? "10" : "09"}-${String(index + 1).padStart(2, "0")}`,
        index === 0 ? null : employeeId(index < 4 ? 1 : 4),
        initials,
      ],
    );
  }
  await client.query(
    `INSERT INTO employee(id,tenant_id,entity_id,code,name,title,department,location,email,joined_on,status,initials)
    VALUES ($1,$2,$3,'ISOLATED-1','Isolation fixture','Test record','Testing','Test location','isolation@anvi.example','2026-01-01','active','IF') ON CONFLICT DO NOTHING`,
    [employeeId(99), tenant, otherEntity],
  );
  await client.query(
    `INSERT INTO identity_binding(id,tenant_id,entity_id,employee_id,issuer,subject,active,roles)
    VALUES ('40000000-0000-4000-8000-000000000001',$1,$2,$3,'urn:anvione:local-demo','maya-demo',true,ARRAY['hr_admin','employee','manager','platform_admin','auditor']) ON CONFLICT DO NOTHING`,
    [tenant, entity, employeeId(1)],
  );
  await client.query("COMMIT");
  console.log(
    "Synthetic demo ready: 12 directory records and one isolated test record.",
  );
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
