import { Link } from "react-router";
import { ArrowUpRight } from "@phosphor-icons/react/dist/csr/ArrowUpRight";
import { MapPin } from "@phosphor-icons/react/dist/csr/MapPin";
import { Avatar, Badge, StatusBadge } from "@anvi/ui";
import { profileCopy } from "../lib/copy/screens";
import type { Employee } from "@anvi/contracts";
export function PersonRow({ person }: { person: Employee }) {
  return (
    <Link className="person-row" to={`/people/${person.id}`}>
      <Avatar initials={person.initials} />
      <span className="person-info">
        <strong>{person.name}</strong>
        <span>{person.title}</span>
      </span>
      <span className="person-department">
        <Badge>{person.department}</Badge>
      </span>
      <ArrowUpRight size={17} className="row-arrow" />
    </Link>
  );
}
export function PersonCard({ person }: { person: Employee }) {
  return (
    <Link className="person-card" to={`/people/${person.id}`}>
      <div className="person-cover" aria-hidden="true">
        <i />
        <i />
      </div>
      <div className="person-card-top">
        <Avatar initials={person.initials} size="large" />
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
        <StatusBadge
          color={person.status === "active" ? "success" : "warning"}
          size="sm"
        >
          {person.status === "active"
            ? profileCopy.status.active
            : profileCopy.status.notice}
        </StatusBadge>
      </div>
    </Link>
  );
}
