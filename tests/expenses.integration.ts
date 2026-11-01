import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApp } from "../apps/api/src/app";
import { readConfig } from "../apps/api/src/config";
import { ExpenseStore } from "../apps/api/src/expense.store";
import {
  makePool,
  scoped,
  setContext,
  transaction,
} from "../packages/database/src/index";
import type {
  ExpenseCategory,
  ExpenseCategoryList,
  ExpenseClaim,
  ExpenseList,
  MyExpenses,
  Role,
} from "../packages/contracts/src/index";

if (
  process.env.NODE_ENV !== "development" ||
  process.env.AUTH_MODE !== "demo"
) {
  throw new Error(
    "Integration tests require the synthetic development/demo database",
  );
}
for (const name of ["DATABASE_URL", "MIGRATION_DATABASE_URL"]) {
  const url = new URL(process.env[name] ?? "");
  if (
    url.hostname !== "127.0.0.1" ||
    url.port !== "55432" ||
    url.pathname !== "/anvione"
  )
    throw new Error("Integration tests require the local Compose database");
}

const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000)
    .toISOString()
    .slice(0, 10);
// Arjun reports to Maya (the demo identity); Rohan reports to someone else.
const arjun = "30000000-0000-4000-8000-000000000002";
const rohan = "30000000-0000-4000-8000-000000000006";

await test("Expenses: claims, limits, team approval, payment and the guards underneath", async (t) => {
  const config = readConfig({ ...process.env, API_PORT: "4495" });
  const { app, store } = await createApp(config);
  await app.listen(4495, "127.0.0.1");
  const admin = makePool(process.env.MIGRATION_DATABASE_URL!);
  const expenses = new ExpenseStore(store);
  const actor = await store.resolveIdentity(
    "urn:anvione:local-demo",
    "maya-demo",
  );
  let token = await store.createSession(actor, randomUUID());
  let session = await store.session(token);
  const run = randomUUID().slice(0, 6).toUpperCase();
  const claims: string[] = [];
  const categories: string[] = [];
  const arjunStatus = (
    await admin.query<{ status: string }>(
      "SELECT status FROM employee WHERE id=$1",
      [arjun],
    )
  ).rows[0]!.status;
  const request = (path: string, init: RequestInit = {}) =>
    fetch(`http://127.0.0.1:4495/api/v1${path}`, {
      ...init,
      headers: {
        Cookie: `anvi_dev_session=${token}`,
        Origin: config.APP_ORIGIN,
        "X-CSRF-Token": session.csrfToken,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
  const send = (path: string, method: string, body: unknown) =>
    request(path, { method, body: JSON.stringify(body) });
  async function changeRole(role: Role) {
    const response = await send("/session/role-context", "POST", { role });
    assert.equal(response.status, 201);
    token = response.headers.get("set-cookie")!.split(";")[0]!.split("=")[1]!;
    session = await store.session(token);
  }
  // Another employee acting through the same store and runtime role.
  const as = (employeeId: string, name: string) => ({
    ...actor,
    employeeId,
    role: "employee" as const,
    name,
  });
  const today = (
    await admin.query<{ today: string }>(
      `SELECT to_char((now() AT TIME ZONE timezone)::date,'YYYY-MM-DD') AS today FROM legal_entity WHERE id=$1`,
      [actor.entityId],
    )
  ).rows[0]!.today;
  let category: ExpenseCategory;
  const claim = (body: Record<string, unknown> = {}) => ({
    kind: "expense",
    title: `Synthetic expense ${run}`,
    categoryId: category.id,
    amountMinor: 70000,
    expenseDate: today,
    receiptReference: "BILL-1",
    ...body,
  });
  const submitMine = async (body: Record<string, unknown> = {}) => {
    const response = await send("/expenses/mine", "POST", claim(body));
    assert.equal(response.status, 201, await response.clone().text());
    const mine = (await response.json()) as MyExpenses;
    // Items are ordered by expense date, so the new claim is the one not yet tracked.
    const added = mine.items.filter((item) => !claims.includes(item.id));
    assert.equal(added.length, 1);
    claims.push(added[0]!.id);
    return added[0]!;
  };
  const submitAs = async (
    employeeId: string,
    name: string,
    body: Record<string, unknown> = {},
  ) => {
    const mine = await expenses.submit(
      as(employeeId, name),
      claim(body) as never,
      randomUUID(),
    );
    const added = mine.items.filter((item) => !claims.includes(item.id));
    assert.equal(added.length, 1);
    claims.push(added[0]!.id);
    return added[0]!.id;
  };
  const detail = async (id: string) => {
    const response = await request(`/expenses/${id}`);
    assert.equal(response.status, 200, await response.clone().text());
    return (await response.json()) as ExpenseClaim;
  };

  try {
    await t.test("access follows the expense permissions", async () => {
      for (const role of ["auditor", "platform_admin"] as const) {
        await changeRole(role);
        for (const path of [
          "/expenses",
          "/expenses/mine",
          "/expenses/categories",
        ])
          assert.equal((await request(path)).status, 403, `${role} ${path}`);
      }
      await changeRole("employee");
      assert.equal((await request("/expenses/mine")).status, 200);
      assert.equal((await request("/expenses/categories")).status, 200);
      assert.equal((await request("/expenses")).status, 403);
      await changeRole("manager");
      assert.equal((await request("/expenses")).status, 200);
      assert.equal((await request("/expenses/mine")).status, 200);
      for (const role of ["employee", "manager"] as const) {
        await changeRole(role);
        const create = await send("/expenses/categories", "POST", {
          code: `N${run}`,
          name: "Not allowed",
          perClaimLimitMinor: null,
          requiresReceiptOverMinor: null,
          active: true,
        });
        assert.equal(create.status, 403, role);
      }
      await changeRole("hr_admin");
      assert.equal((await request("/expenses")).status, 200);
      assert.equal(
        (await request("/expenses/mine")).status,
        403,
        "HR claims as an employee",
      );
    });

    await t.test("HR manages categories; others see active ones", async () => {
      await changeRole("hr_admin");
      const bad = await send("/expenses/categories", "POST", {
        code: "lower",
        name: "Bad code",
        perClaimLimitMinor: 100,
        requiresReceiptOverMinor: null,
        active: true,
      });
      assert.equal(bad.status, 400);
      const created = await send("/expenses/categories", "POST", {
        code: `X${run}`,
        name: `Synthetic ${run}`,
        perClaimLimitMinor: 100000,
        requiresReceiptOverMinor: 50000,
        active: true,
      });
      assert.equal(created.status, 201, await created.clone().text());
      category = (await created.json()) as ExpenseCategory;
      categories.push(category.id);
      assert.equal(category.version, 1);
      const twice = await send("/expenses/categories", "POST", {
        code: `X${run}`,
        name: "Duplicate",
        perClaimLimitMinor: null,
        requiresReceiptOverMinor: null,
        active: true,
      });
      assert.equal(twice.status, 409);
      const retired = await send("/expenses/categories", "POST", {
        code: `R${run}`,
        name: `Retired ${run}`,
        perClaimLimitMinor: null,
        requiresReceiptOverMinor: null,
        active: false,
      });
      assert.equal(retired.status, 201);
      categories.push(((await retired.json()) as ExpenseCategory).id);
      const hrList = (await (
        await request("/expenses/categories")
      ).json()) as ExpenseCategoryList;
      assert.ok(hrList.items.some((c) => c.code === `R${run}`));
      assert.ok(
        hrList.items.some((c) => c.code === "TRAVEL"),
        "seeded",
      );
      await changeRole("employee");
      const list = (await (
        await request("/expenses/categories")
      ).json()) as ExpenseCategoryList;
      assert.ok(list.items.some((c) => c.code === `X${run}`));
      assert.ok(!list.items.some((c) => c.code === `R${run}`));
      const inactive = await send(
        "/expenses/mine",
        "POST",
        claim({ categoryId: categories[1] }),
      );
      assert.equal(inactive.status, 400);
      assert.match(
        ((await inactive.json()) as { title: string }).title,
        /category is unavailable/,
      );
    });

    await t.test("limits, receipts, dates and shape are enforced", async () => {
      await changeRole("employee");
      const over = await send(
        "/expenses/mine",
        "POST",
        claim({ amountMinor: 100001 }),
      );
      assert.equal(over.status, 400);
      assert.match(
        ((await over.json()) as { title: string }).title,
        new RegExp(`Synthetic ${run} category allows up to INR 1000.00`),
      );
      const noReceipt = await send(
        "/expenses/mine",
        "POST",
        claim({ amountMinor: 60000, receiptReference: null }),
      );
      assert.equal(noReceipt.status, 400);
      assert.match(
        ((await noReceipt.json()) as { title: string }).title,
        /receipt reference is required .* over INR 500.00/,
      );
      for (const body of [
        { expenseDate: addDays(today, 1) },
        { expenseDate: addDays(today, -91) },
        { kind: "travel" },
        { tripDestination: "Pune" },
        { amountMinor: 0 },
        { amountMinor: 12.5 },
        { amountMinor: 1_000_000_001 },
        { employeeId: arjun },
        { status: "paid" },
        { currency: "USD" },
      ]) {
        const response = await send("/expenses/mine", "POST", claim(body));
        assert.equal(response.status, 400, JSON.stringify(body));
      }
      // Small claims need no receipt; advances may be dated ahead of the trip.
      const small = await submitMine({
        amountMinor: 40000,
        receiptReference: null,
      });
      assert.equal(small.receiptReference, null);
      const advance = await submitMine({
        kind: "advance",
        title: `Synthetic advance ${run}`,
        tripDestination: "Mumbai",
        expenseDate: addDays(today, 10),
      });
      assert.equal(advance.kind, "advance");
      assert.equal(advance.currency, "INR");
    });

    await t.test(
      "the claimant's manager or HR decides; nobody decides their own",
      async () => {
        await changeRole("employee");
        const own = await submitMine({ title: `Own claim ${run}` });
        assert.equal(own.canCancel, true);
        await changeRole("manager");
        const list = (await (await request("/expenses")).json()) as ExpenseList;
        assert.ok(
          !list.items.some((c) => c.id === own.id),
          "own claims are not in the approval list",
        );
        const managerOwn = await send(`/expenses/${own.id}/approve`, "POST", {
          version: 1,
        });
        assert.equal(managerOwn.status, 403);
        await changeRole("hr_admin");
        const hrOwn = await send(`/expenses/${own.id}/approve`, "POST", {
          version: 1,
        });
        assert.equal(hrOwn.status, 403, "HR cannot decide their own claim");

        // A report's claim reaches the manager.
        const report = await submitAs(arjun, "Arjun (synthetic)");
        const other = await submitAs(rohan, "Rohan (synthetic)");
        await changeRole("manager");
        const team = (await (
          await request(`/expenses?q=${run}`)
        ).json()) as ExpenseList;
        const seen = team.items.find((c) => c.id === report);
        assert.ok(seen, "manager sees the report's claim");
        assert.equal(seen.canDecide, true);
        assert.equal(seen.canPay, false);
        assert.ok(!team.items.some((c) => c.id === other), "not their report");
        assert.equal((await request(`/expenses/${other}`)).status, 404);
        assert.equal(
          (await send(`/expenses/${other}/approve`, "POST", { version: 1 }))
            .status,
          404,
        );
        const stale = await send(`/expenses/${report}/approve`, "POST", {
          version: 9,
        });
        assert.equal(stale.status, 409);
        const approved = await send(`/expenses/${report}/approve`, "POST", {
          version: 1,
          note: "Looks right",
        });
        assert.equal(approved.status, 201, await approved.clone().text());
        const after = (await approved.json()) as ExpenseClaim;
        assert.equal(after.status, "approved");
        assert.equal(after.decidedBy, actor.name);
        const managerPay = await send(`/expenses/${report}/pay`, "POST", {
          version: 2,
          paidOn: today,
          paymentReference: "UTR123",
        });
        assert.equal(managerPay.status, 403, "only HR pays");

        // HR pays with a valid reference and date only.
        await changeRole("hr_admin");
        const hrSeen = await detail(report);
        assert.equal(hrSeen.canPay, true);
        for (const body of [
          { version: 2, paidOn: addDays(today, 1), paymentReference: "UTR1" },
          { version: 2, paidOn: addDays(today, -1), paymentReference: "UTR1" },
          { version: 2, paidOn: today },
          { version: 2, paidOn: today, paymentReference: " " },
        ]) {
          const response = await send(`/expenses/${report}/pay`, "POST", body);
          assert.equal(response.status, 400, JSON.stringify(body));
        }
        const paid = await send(`/expenses/${report}/pay`, "POST", {
          version: 2,
          paidOn: today,
          paymentReference: `UTR-${run}`,
        });
        assert.equal(paid.status, 201, await paid.clone().text());
        const done = (await paid.json()) as ExpenseClaim;
        assert.equal(done.status, "paid");
        assert.equal(done.paymentReference, `UTR-${run}`);
        assert.equal(done.decisionNote, "Looks right");
        const again = await send(`/expenses/${report}/pay`, "POST", {
          version: 3,
          paidOn: today,
          paymentReference: "UTR-again",
        });
        assert.equal(again.status, 409, "a paid claim is final");

        // HR rejects the other team's claim, with a reason.
        const short = await send(`/expenses/${other}/reject`, "POST", {
          version: 1,
          note: "no",
        });
        assert.equal(short.status, 400);
        const rejected = await send(`/expenses/${other}/reject`, "POST", {
          version: 1,
          note: "Personal expense",
        });
        assert.equal(rejected.status, 201, await rejected.clone().text());
        assert.equal(
          ((await rejected.json()) as ExpenseClaim).status,
          "rejected",
        );
        const payRejected = await send(`/expenses/${other}/pay`, "POST", {
          version: 2,
          paidOn: today,
          paymentReference: "UTR-x",
        });
        assert.equal(payRejected.status, 409);

        // The claimant's own page carries totals for the stat cards.
        const arjunPage = await expenses.mine(as(arjun, "Arjun (synthetic)"));
        assert.ok(arjunPage.summary.paid.amountMinor >= 70000);
        assert.equal(arjunPage.months.length, 12);
        assert.equal(arjunPage.months.at(-1)!.month, today.slice(0, 7));
        assert.ok(arjunPage.months.at(-1)!.amountMinor >= 70000);
        const hrList = (await (
          await request(`/expenses?q=${run}&status=paid`)
        ).json()) as ExpenseList;
        assert.ok(hrList.items.every((c) => c.status === "paid"));
        assert.ok(hrList.items.some((c) => c.id === report));
        assert.ok(hrList.counts.paid >= 1);
      },
    );

    await t.test(
      "only a submitted claim can be cancelled, by its claimant",
      async () => {
        await changeRole("employee");
        const mine = await submitMine({ title: `Cancel me ${run}` });
        const stale = await send(`/expenses/mine/${mine.id}/cancel`, "POST", {
          version: 9,
        });
        assert.equal(stale.status, 409);
        const cancelled = await send(
          `/expenses/mine/${mine.id}/cancel`,
          "POST",
          { version: 1 },
        );
        assert.equal(cancelled.status, 201);
        const page = (await cancelled.json()) as MyExpenses;
        const row = page.items.find((c) => c.id === mine.id)!;
        assert.equal(row.status, "cancelled");
        assert.equal(row.canCancel, false);
        assert.ok(page.summary.cancelled.count >= 1);
        assert.equal(
          (
            await send(`/expenses/mine/${mine.id}/cancel`, "POST", {
              version: 2,
            })
          ).status,
          409,
          "a cancelled claim is final",
        );
        // Someone else's claim cannot be cancelled through "mine".
        const report = await submitAs(arjun, "Arjun (synthetic)", {
          title: `Approve then cancel ${run}`,
        });
        await changeRole("manager");
        assert.equal(
          (
            await send(`/expenses/mine/${report}/cancel`, "POST", {
              version: 1,
            })
          ).status,
          404,
        );
        assert.equal(
          (await send(`/expenses/${report}/approve`, "POST", { version: 1 }))
            .status,
          201,
        );
        await assert.rejects(
          expenses.cancelMine(
            as(arjun, "Arjun (synthetic)"),
            report,
            { version: 2 },
            randomUUID(),
          ),
          /expense step is not allowed/,
        );
      },
    );

    await t.test(
      "a category change never rewrites earlier claims",
      async () => {
        await changeRole("hr_admin");
        const before = await detail(claims[0]!);
        const stale = await send(`/expenses/categories/${category.id}`, "PUT", {
          version: 9,
          name: "Renamed",
          perClaimLimitMinor: 10000,
          requiresReceiptOverMinor: null,
          active: true,
        });
        assert.equal(stale.status, 409);
        const updated = await send(
          `/expenses/categories/${category.id}`,
          "PUT",
          {
            version: 1,
            name: `Renamed ${run}`,
            perClaimLimitMinor: 10000,
            requiresReceiptOverMinor: null,
            active: true,
          },
        );
        assert.equal(updated.status, 200, await updated.clone().text());
        category = (await updated.json()) as ExpenseCategory;
        assert.equal(category.version, 2);
        const after = await detail(claims[0]!);
        assert.equal(after.categoryName, before.categoryName);
        assert.equal(after.amountMinor, before.amountMinor);
        assert.equal(after.version, before.version);
        await changeRole("employee");
        const over = await send("/expenses/mine", "POST", claim());
        assert.equal(over.status, 400, "the new limit applies to new claims");
        assert.match(
          ((await over.json()) as { title: string }).title,
          /INR 100.00/,
        );
      },
    );

    await t.test(
      "a manager follows the current reporting line, not the one at submission",
      async () => {
        const newManager = "30000000-0000-4000-8000-000000000004";
        const managerAs = (employeeId: string) => ({
          ...actor,
          employeeId,
          role: "manager" as const,
          name: "Manager (synthetic)",
        });
        const moved = await submitAs(arjun, "Arjun (synthetic)", {
          title: `Moved report ${run}`,
          amountMinor: 5000,
        });
        const joined = await submitAs(rohan, "Rohan (synthetic)", {
          title: `Joined report ${run}`,
          amountMinor: 5000,
        });
        const before = (
          await admin.query<{ id: string; manager_id: string }>(
            "SELECT id, manager_id FROM employee WHERE id=ANY($1::uuid[])",
            [[arjun, rohan]],
          )
        ).rows;
        await admin.query("UPDATE employee SET manager_id=$2 WHERE id=$1", [
          arjun,
          newManager,
        ]);
        await admin.query("UPDATE employee SET manager_id=$2 WHERE id=$1", [
          rohan,
          actor.employeeId,
        ]);
        try {
          await changeRole("manager");
          const list = (await (
            await request(`/expenses?q=${run}`)
          ).json()) as ExpenseList;
          assert.ok(!list.items.some((c) => c.id === moved), "old manager");
          assert.equal((await request(`/expenses/${moved}`)).status, 404);
          assert.equal(
            (await send(`/expenses/${moved}/approve`, "POST", { version: 1 }))
              .status,
            404,
          );
          const gained = list.items.find((c) => c.id === joined);
          assert.ok(gained, "the new manager sees the report's pending claim");
          assert.equal(gained.canDecide, true);
          const approved = await send(`/expenses/${joined}/approve`, "POST", {
            version: 1,
          });
          assert.equal(approved.status, 201, await approved.clone().text());
          const decided = await expenses.approve(
            managerAs(newManager),
            moved,
            { version: 1 },
            randomUUID(),
          );
          assert.equal(decided.status, "approved");
        } finally {
          for (const row of before)
            await admin.query("UPDATE employee SET manager_id=$2 WHERE id=$1", [
              row.id,
              row.manager_id,
            ]);
        }
      },
    );

    await t.test(
      "an advance is paid no earlier than its request and approval day in the entity's time zone",
      async () => {
        const advance = await submitAs(arjun, "Arjun (synthetic)", {
          kind: "advance",
          title: `Early advance ${run}`,
          tripDestination: "Chennai",
          expenseDate: addDays(today, 5),
          amountMinor: 5000,
        });
        await changeRole("hr_admin");
        assert.equal(
          (await send(`/expenses/${advance}/approve`, "POST", { version: 1 }))
            .status,
          201,
        );
        const early = await send(`/expenses/${advance}/pay`, "POST", {
          version: 2,
          paidOn: addDays(today, -1),
          paymentReference: "UTR-early",
        });
        assert.equal(early.status, 400);
        assert.match(
          ((await early.json()) as { title: string }).title,
          /before the advance was requested|before the claim was approved/,
        );
        const paid = await send(`/expenses/${advance}/pay`, "POST", {
          version: 2,
          paidOn: today,
          paymentReference: "UTR-advance",
        });
        assert.equal(paid.status, 201, await paid.clone().text());
      },
    );

    await t.test(
      "a category update racing submissions never fails with a server error",
      async () => {
        const hr = { ...actor, role: "hr_admin" as const };
        for (let round = 0; round < 5; round++) {
          const current = (
            await admin.query<{ version: number }>(
              "SELECT version FROM expense_category WHERE id=$1",
              [category.id],
            )
          ).rows[0]!.version;
          const results = await Promise.allSettled([
            expenses.updateCategory(
              hr,
              category.id,
              {
                version: current,
                name: `Renamed ${run}`,
                perClaimLimitMinor: 10000 + round,
                requiresReceiptOverMinor: null,
                active: true,
              },
              randomUUID(),
            ),
            expenses.submit(
              as(arjun, "Arjun (synthetic)"),
              claim({
                amountMinor: 1000,
                title: `Race ${round} ${run}`,
              }) as never,
              randomUUID(),
            ),
            expenses.submit(
              as(rohan, "Rohan (synthetic)"),
              claim({
                amountMinor: 1000,
                title: `Race ${round} ${run}`,
              }) as never,
              randomUUID(),
            ),
          ]);
          for (const result of results)
            if (result.status === "rejected") {
              const status = (
                result.reason as { getStatus?: () => number }
              ).getStatus?.();
              assert.ok(
                status !== undefined && status < 500,
                String(result.reason),
              );
            }
        }
        const raced = await admin.query<{ id: string }>(
          "SELECT id FROM expense_claim WHERE category_id=$1 AND NOT (id=ANY($2::uuid[]))",
          [category.id, claims],
        );
        claims.push(...raced.rows.map((r) => r.id));
      },
    );

    await t.test("an employee who has left cannot claim", async () => {
      await admin.query("UPDATE employee SET status='inactive' WHERE id=$1", [
        arjun,
      ]);
      try {
        await assert.rejects(
          expenses.submit(
            as(arjun, "Arjun (synthetic)"),
            claim({ amountMinor: 1000 }) as never,
            randomUUID(),
          ),
          /Only current employees can claim expenses/,
        );
      } finally {
        await admin.query("UPDATE employee SET status=$2 WHERE id=$1", [
          arjun,
          arjunStatus,
        ]);
      }
    });

    await t.test(
      "every action leaves an audit record and an outbox event",
      async () => {
        const audit = await admin.query<{ action: string }>(
          "SELECT action FROM audit_event WHERE target=ANY($1::text[])",
          [
            [
              ...claims.map((id) => `expense:${id}`),
              ...categories.map((id) => `expense-category:${id}`),
            ],
          ],
        );
        const actions = new Set(audit.rows.map((r) => r.action));
        const expected = [
          "submitted",
          "approved",
          "rejected",
          "paid",
          "cancelled",
          "category_created",
          "category_updated",
        ];
        for (const action of expected)
          assert.ok(actions.has(`expense.${action}`), action);
        const events = await admin.query<{ event_type: string }>(
          "SELECT event_type FROM outbox_event WHERE aggregate_id=ANY($1::uuid[])",
          [[...claims, ...categories]],
        );
        const types = new Set(events.rows.map((r) => r.event_type));
        for (const action of expected)
          assert.ok(types.has(`expense.${action}.v1`), action);
      },
    );

    await t.test(
      "the database refuses what the API would never send",
      async () => {
        const pool = makePool(process.env.DATABASE_URL!);
        try {
          const employee = { ...actor, role: "employee" as const };
          const manager = { ...actor, role: "manager" as const };
          const hr = { ...actor, role: "hr_admin" as const };
          const auditor = { ...actor, role: "auditor" as const };
          const insert = `INSERT INTO expense_claim(id,tenant_id,entity_id,employee_id,kind,title,category_id,amount_minor,expense_date)
            VALUES ($1,$2,$3,$4,'expense','Direct claim',$5,1000,leave_entity_today())`;
          const values = (employeeId: string) => [
            randomUUID(),
            actor.tenantId,
            actor.entityId,
            employeeId,
            category.id,
          ];
          // Claims only for yourself, and only through the granted columns.
          await assert.rejects(
            scoped(pool, employee, (client) =>
              client.query(insert, values(arjun)),
            ),
          );
          await assert.rejects(
            scoped(pool, employee, (client) =>
              client.query(
                `INSERT INTO expense_claim(id,tenant_id,entity_id,employee_id,kind,title,category_id,amount_minor,expense_date,status)
                 VALUES ($1,$2,$3,$4,'expense','Direct claim',$5,1000,leave_entity_today(),'paid')`,
                values(actor.employeeId),
              ),
            ),
            /permission denied/,
          );
          await assert.rejects(
            scoped(pool, hr, (client) =>
              client.query(insert, values(actor.employeeId)),
            ),
            /yourself|row-level security/,
          );
          // A submitted claim cannot be edited, or decided by its own claimant.
          const open = claims[0]!;
          for (const sql of [
            "UPDATE expense_claim SET amount_minor=1 WHERE id=$1",
            "UPDATE expense_claim SET title='Edited later' WHERE id=$1",
            "UPDATE expense_claim SET decided_by_label='Me' WHERE id=$1",
          ])
            await assert.rejects(
              scoped(pool, employee, (client) => client.query(sql, [open])),
              /permission denied/,
            );
          await assert.rejects(
            scoped(pool, employee, (client) =>
              client.query(
                "UPDATE expense_claim SET status='approved', version=version+1 WHERE id=$1",
                [open],
              ),
            ),
            /decide or pay your own claim/,
          );
          await assert.rejects(
            scoped(pool, employee, (client) =>
              client.query(
                "UPDATE expense_claim SET status='submitted', version=version+1 WHERE id=$1",
                [open],
              ),
            ),
            /expense step is not allowed/,
          );
          // No skipping from submitted straight to paid, even for HR.
          await assert.rejects(
            transaction(pool, async (client) => {
              await setContext(client, as(arjun, "Arjun (synthetic)"));
              const row = values(arjun);
              const id = row[0];
              await client.query(insert, row);
              await setContext(client, hr);
              await client.query(
                "UPDATE expense_claim SET status='paid', paid_on=leave_entity_today(), payment_reference='UTR', version=version+1 WHERE id=$1",
                [id],
              );
            }),
            /expense step is not allowed/,
          );
          // A manager cannot reach claims outside their team; an auditor sees nothing.
          const otherTeam = await scoped(pool, manager, (client) =>
            client.query(
              "UPDATE expense_claim SET status='approved', version=version+1 WHERE employee_id=$1 AND id=ANY($2::uuid[])",
              [rohan, claims],
            ),
          );
          assert.equal(otherTeam.rowCount, 0);
          const seen = await scoped(pool, auditor, (client) =>
            client.query("SELECT id FROM expense_claim WHERE id=$1", [open]),
          );
          assert.equal(seen.rowCount, 0);
          // Categories are HR's, and their code never changes.
          await assert.rejects(
            scoped(pool, employee, (client) =>
              client.query(
                "INSERT INTO expense_category(id,tenant_id,entity_id,code,name) VALUES ($1,$2,$3,'SNEAKY','Sneaky')",
                [randomUUID(), actor.tenantId, actor.entityId],
              ),
            ),
          );
          await assert.rejects(
            scoped(pool, hr, (client) =>
              client.query(
                "UPDATE expense_category SET code='CHANGED' WHERE id=$1",
                [category.id],
              ),
            ),
            /permission denied/,
          );
          // Nothing is ever deleted.
          for (const [table, id] of [
            ["expense_claim", open],
            ["expense_category", category.id],
          ] as const)
            await assert.rejects(
              scoped(pool, hr, (client) =>
                client.query(`DELETE FROM ${table} WHERE id=$1`, [id]),
              ),
              /permission denied|never deleted/,
            );
          await assert.rejects(
            admin.query("DELETE FROM expense_claim WHERE id=$1", [open]),
            /never deleted/,
          );
        } finally {
          await pool.end();
        }
      },
    );
  } finally {
    // Synthetic cleanup only: expense history is never deleted at runtime.
    await transaction(admin, async (client) => {
      await client.query("SET LOCAL session_replication_role = replica");
      const ids = [...claims, ...categories];
      await client.query(
        "DELETE FROM outbox_event WHERE aggregate_id=ANY($1::uuid[])",
        [ids],
      );
      await client.query(
        "DELETE FROM audit_event WHERE target=ANY($1::text[])",
        [
          [
            ...claims.map((id) => `expense:${id}`),
            ...categories.map((id) => `expense-category:${id}`),
          ],
        ],
      );
      await client.query(
        "DELETE FROM expense_claim WHERE id=ANY($1::uuid[]) OR category_id=ANY($2::uuid[])",
        [claims, categories],
      );
      await client.query(
        "DELETE FROM expense_category WHERE id=ANY($1::uuid[])",
        [categories],
      );
      await client.query("UPDATE employee SET status=$2 WHERE id=$1", [
        arjun,
        arjunStatus,
      ]);
    });
    await Promise.all([admin.end(), app.close()]);
    await store.pool.end();
  }
});
