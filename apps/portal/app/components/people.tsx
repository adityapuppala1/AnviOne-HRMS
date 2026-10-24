import { Link } from "react-router";
import { ArrowUpRight, MapPin } from "lucide-react";
import { Avatar, Badge } from "@anvi/ui";
import type { Employee } from "@anvi/contracts";
export function PersonRow({ person }: { person: Employee }) {
  return (
    <Link className="person-row" to={`/people/${person.id}`}>
      <Avatar initials={person.initials} />
      <span className="person-info">
        <strong>{person.name}</strong>
        <span>{person.title}</span>
      </span>
      <span className="person-department">{person.department}</span>
      <ArrowUpRight size={17} className="row-arrow" />
    </Link>
  );
}
export function PersonCard({ person }: { person: Employee }) {
  return (
    <Link className="person-card" to={`/people/${person.id}`}>
      <div className="person-card-top">
        <Avatar initials={person.initials} />
        <ArrowUpRight size={18} />
      </div>
      <h2>{person.name}</h2>
      <p>{person.title}</p>
      <Badge>{person.department}</Badge>
      <div className="person-card-footer">
        <span>
          <MapPin size={14} />
          {person.location}
        </span>
        <Badge tone="green">
          {person.status === "active" ? "Active" : "Notice period"}
        </Badge>
      </div>
    </Link>
  );
}
