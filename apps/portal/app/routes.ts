import {
  index,
  route,
  layout,
  type RouteConfig,
} from "@react-router/dev/routes";
export default [
  route("login", "routes/login.tsx"),
  layout("routes/workspace.tsx", [
    index("routes/home.tsx"),
    route("people", "routes/people.tsx"),
    route("people/:id", "routes/profile.tsx"),
    route("teams", "routes/teams.tsx"),
    route("preferences", "routes/preferences.tsx"),
    route("settings", "routes/settings.tsx"),
    route("activity", "routes/activity.tsx"),
  ]),
  route("*", "routes/not-found.tsx"),
] satisfies RouteConfig;
