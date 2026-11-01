# Demo personas

Demo mode only (`AUTH_MODE=demo`, never production). Gives one synthetic sign-in per role so every screen can be tried as that role, without switching roles inside one identity.

## Set up

```bash
pnpm db:seed          # seeds the demo employees, then runs demo:personas
pnpm demo:personas    # on its own: idempotent, safe to rerun
```

The script runs with `MIGRATION_DATABASE_URL`, refuses unless `AUTH_MODE=demo` and `NODE_ENV` is not `production`, and only binds employees the seed already created. It never invents people. On a rerun it reactivates each persona and resets its roles. Maya's seeded binding is checked but never changed.

| Key        | Employee                        | Roles                                                |
| ---------- | ------------------------------- | ---------------------------------------------------- |
| `maya`     | Maya Iyer                       | hr_admin, employee, manager, platform_admin, auditor |
| `employee` | Aarav Shah                      | employee                                             |
| `manager`  | Neel Rao (manages eight people) | manager                                              |
| `hr`       | Kabir Sethi                     | hr_admin (a second HR admin for two-person rules)    |
| `auditor`  | Diya Kapoor                     | auditor                                              |
| `platform` | Ishaan Roy                      | platform_admin                                       |

All bindings use the issuer `urn:anvione:local-demo`, the same as Maya's, with the subject `<firstname>-demo`. The registry lives in `apps/api/src/demo-personas.ts`.

## Sign in

- In the portal: the login screen lists "Sign in as …" under **Explore demo workspace**. That button still signs in as Maya.
- In the API: `POST /api/v1/auth/demo` with `{"persona":"manager"}`. No body means Maya. An unknown persona returns 400. The origin check, the loopback-only rule and the auth rate limit (20 per minute) still apply.
- `GET /api/v1/auth/demo/personas` lists `key, name, title, roles, summary`, using names and roles from the live bindings. It returns 404 outside demo mode.
- In Playwright: `loginAs(page, "auditor")` from `tests/e2e/support/personas.ts`.

## Limits

- Personas exist only in the demo database. A fresh database needs `pnpm db:seed` before they appear. Until then the login list leaves them out.
- The rest of the integration suite binds Arjun, Zara and Rohan, so those three are kept free.
- The OpenAPI document (`docs/api/openapi.json`) does not describe the persona body or the list endpoint yet.
