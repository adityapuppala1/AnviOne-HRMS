import { Link } from "react-router";
import { notFoundCopy as text } from "../lib/copy/screens";
export default function NotFound() {
  return (
    <main className="standalone">
      <p className="eyebrow">{text.eyebrow}</p>
      <h1>{text.title}</h1>
      <p>{text.body}</p>
      <Link className="button button-primary" to="/">
        {text.home}
      </Link>
    </main>
  );
}
