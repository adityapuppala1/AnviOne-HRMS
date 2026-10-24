import { Link, useParams } from "react-router";
import {
  ArrowLeft,
  Building2,
  MapPin,
  Calendar,
  Mail,
  Fingerprint,
  ShieldCheck,
} from "lucide-react";
import { Avatar, Badge, ErrorState, LoadingState } from "@anvi/ui";
import { useEmployee } from "../lib/api";
import { copy } from "../lib/copy";
export default function Profile() {
  const { id = "" } = useParams();
  const { data, error, refetch } = useEmployee(id);
  if (error)
    return (
      <ErrorState message={error.message} onRetry={() => void refetch()} />
    );
  if (!data) return <LoadingState />;
  return (
    <div className="profile-page page-enter">
      <Link className="text-link back-link" to="/people">
        <ArrowLeft size={17} />
        Back to people
      </Link>
      <div className="profile-banner">
        <div className="profile-banner-art" aria-hidden="true">
          a.
        </div>
      </div>
      <section className="profile-card">
        <div className="profile-identity">
          <Avatar initials={data.initials} size="large" />
          <Badge tone="green">
            {data.status === "active" ? "Active employee" : "Notice period"}
          </Badge>
        </div>
        <h1>{data.name}</h1>
        <p className="profile-title">{data.title}</p>
        <div className="profile-details">
          {[
            { label: "Department", value: data.department, icon: Building2 },
            { label: "Location", value: data.location, icon: MapPin },
            { label: "Employee code", value: data.code, icon: Fingerprint },
            {
              label: "Joined",
              value: new Intl.DateTimeFormat("en-IN", {
                dateStyle: "long",
                timeZone: "UTC",
              }).format(new Date(`${data.joinedOn}T00:00:00Z`)),
              icon: Calendar,
            },
            { label: "Work email", value: data.email, icon: Mail },
          ].map(({ label, value, icon: Icon }) => (
            <div key={label}>
              <Icon size={20} />
              <span>
                <small>{label}</small>
                <strong>{value}</strong>
              </span>
            </div>
          ))}
        </div>
        <div className="profile-privacy">
          <ShieldCheck size={20} />
          <p>{copy.profileNotice}</p>
        </div>
      </section>
    </div>
  );
}
