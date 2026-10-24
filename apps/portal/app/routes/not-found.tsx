import { Link } from "react-router";
export default function NotFound() {
  return (
    <main className="standalone">
      <p className="eyebrow">404 · PAGE NOT FOUND</p>
      <h1>Let’s get you back to your workspace.</h1>
      <p>This page may have moved, or the address may be incomplete.</p>
      <Link className="button button-primary" to="/">
        Return home
      </Link>
    </main>
  );
}
