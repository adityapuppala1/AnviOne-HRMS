import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { ArrowLeft } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import { ArrowUpRight } from "@phosphor-icons/react/dist/csr/ArrowUpRight";
import { Buildings } from "@phosphor-icons/react/dist/csr/Buildings";
import { MapPin } from "@phosphor-icons/react/dist/csr/MapPin";
import { CalendarBlank } from "@phosphor-icons/react/dist/csr/CalendarBlank";
import { EnvelopeSimple } from "@phosphor-icons/react/dist/csr/EnvelopeSimple";
import { Fingerprint } from "@phosphor-icons/react/dist/csr/Fingerprint";
import { LockKey } from "@phosphor-icons/react/dist/csr/LockKey";
import { Copy } from "@phosphor-icons/react/dist/csr/Copy";
import { Check } from "@phosphor-icons/react/dist/csr/Check";
import { UserCircle } from "@phosphor-icons/react/dist/csr/UserCircle";
import { Briefcase } from "@phosphor-icons/react/dist/csr/Briefcase";
import { ClockCounterClockwise } from "@phosphor-icons/react/dist/csr/ClockCounterClockwise";
import {
  Avatar,
  Badge,
  Button,
  ErrorState,
  LoadingState,
  Tabs,
  TabList,
  Tab,
  TabPanel,
} from "@anvi/ui";
import { useEmployee } from "../lib/api";

export default function Profile() {
  const { id = "" } = useParams();
  const { data, error, refetch } = useEmployee(id);
  const [copyState, setCopyState] = useState("");
  useEffect(() => setCopyState(""), [id]);
  if (error)
    return (
      <ErrorState message={error.message} onRetry={() => void refetch()} />
    );
  if (!data) return <LoadingState />;
  const joined = new Intl.DateTimeFormat("en-IN", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(`${data.joinedOn}T00:00:00Z`));
  async function copyEmail() {
    try {
      await navigator.clipboard.writeText(data!.email);
      setCopyState("Email copied");
    } catch {
      setCopyState("Copy unavailable. Select and copy the email below.");
    }
  }
  return (
    <div className="profile-page page-enter">
      <div className="profile-page-top">
        <Link className="text-link back-link" to="/people">
          <ArrowLeft size={18} />
          Back to people
        </Link>
        <span className="muted">Employee profile</span>
      </div>
      <section className="profile-cover">
        <div className="profile-banner">
          <span>Every person brings a perspective.</span>
          <div className="profile-banner-art" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
        </div>
        <div className="profile-overview">
          <Avatar initials={data.initials} size="large" />
          <div className="profile-title-block">
            <div>
              <h1>{data.name}</h1>
              <Badge tone={data.status === "active" ? "green" : "amber"}>
                {data.status === "active" ? "Active employee" : "Notice period"}
              </Badge>
            </div>
            <p>{data.title}</p>
            <div className="profile-meta">
              <span>
                <Buildings size={16} />
                {data.department}
              </span>
              <span>
                <MapPin size={16} />
                {data.location}
              </span>
            </div>
          </div>
          <Button variant="secondary" onPress={() => void copyEmail()}>
            <Copy size={17} />
            Copy work email
          </Button>
        </div>
        <p className="copy-feedback" role="status">
          {copyState}
        </p>
      </section>
      <div className="profile-body">
        <section className="panel profile-main">
          <Tabs defaultSelectedKey="about">
            <TabList aria-label="Profile sections" className="tabs-list">
              <Tab id="about" className="tab">
                <UserCircle size={18} />
                Overview
              </Tab>
              <Tab id="employment" className="tab">
                <Briefcase size={18} />
                Employment
              </Tab>
            </TabList>
            <TabPanel id="about" className="tab-panel">
              <h2>The essentials</h2>
              <p className="section-description">
                Work details to help you connect.
              </p>
              <dl className="profile-details">
                {[
                  { label: "Full name", value: data.name, icon: UserCircle },
                  {
                    label: "Work email",
                    value: data.email,
                    icon: EnvelopeSimple,
                  },
                  {
                    label: "Department",
                    value: data.department,
                    icon: Buildings,
                  },
                  {
                    label: "Work location",
                    value: data.location,
                    icon: MapPin,
                  },
                ].map(({ label, value, icon: Icon }) => (
                  <div key={label}>
                    <dt>
                      <Icon size={21} weight="duotone" />
                      {label}
                    </dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </TabPanel>
            <TabPanel id="employment" className="tab-panel">
              <h2>Employment record</h2>
              <p className="section-description">
                Current work assignment and joining details.
              </p>
              <dl className="profile-details">
                {[
                  {
                    label: "Employee code",
                    value: data.code,
                    icon: Fingerprint,
                  },
                  { label: "Designation", value: data.title, icon: Briefcase },
                  { label: "Joining date", value: joined, icon: CalendarBlank },
                  {
                    label: "Employment status",
                    value:
                      data.status === "active" ? "Active" : "Notice period",
                    icon: Check,
                  },
                ].map(({ label, value, icon: Icon }) => (
                  <div key={label}>
                    <dt>
                      <Icon size={21} weight="duotone" />
                      {label}
                    </dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
              <div className="employment-milestone">
                <ClockCounterClockwise size={22} />
                <div>
                  <strong>Joined the organization</strong>
                  <p>{joined}</p>
                </div>
                <span className="milestone-dot" />
              </div>
            </TabPanel>
          </Tabs>
          <div className="profile-privacy">
            <LockKey size={19} />
            <p>
              This profile contains work details. Personal and confidential
              records are not part of the directory.
            </p>
          </div>
        </section>
        <aside className="profile-aside">
          <section className="panel">
            <span className="aside-icon">
              <Buildings size={26} weight="duotone" />
            </span>
            <p className="eyebrow">Part of the team</p>
            <h2>{data.department}</h2>
            <p>Explore colleagues visible in your workspace.</p>
            <Link
              className="text-link"
              to={`/people?department=${encodeURIComponent(data.department)}`}
            >
              View department <ArrowUpRight size={17} />
            </Link>
          </section>
          <section className="profile-joining">
            <CalendarBlank size={23} weight="duotone" />
            <span>
              With the organization since<strong>{joined}</strong>
            </span>
          </section>
        </aside>
      </div>
    </div>
  );
}
