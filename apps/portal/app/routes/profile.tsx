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
  Button,
  ErrorState,
  LoadingState,
  StatusBadge,
  UTabs,
} from "@anvi/ui";
import { useEmployee } from "../lib/api";
import { profileCopy as text } from "../lib/copy/screens";

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
      setCopyState(text.emailCopied);
    } catch {
      setCopyState(text.copyUnavailable);
    }
  }
  return (
    <div className="profile-page page-enter">
      <div className="profile-page-top">
        <Link className="text-link back-link" to="/people">
          <ArrowLeft size={18} />
          {text.backToPeople}
        </Link>
        <span className="muted">{text.pageLabel}</span>
      </div>
      <section className="profile-cover">
        <div className="profile-banner">
          <span>{text.banner}</span>
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
              <StatusBadge
                color={data.status === "active" ? "success" : "warning"}
                size="md"
              >
                {data.status === "active"
                  ? text.status.activeEmployee
                  : text.status.notice}
              </StatusBadge>
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
            {text.copyEmail}
          </Button>
        </div>
        <p className="copy-feedback" role="status">
          {copyState}
        </p>
      </section>
      <div className="profile-body">
        <section className="panel profile-main">
          <UTabs defaultSelectedKey="about" keyboardActivation="automatic">
            <UTabs.List type="underline" aria-label={text.sectionsLabel}>
              <UTabs.Item id="about">
                <UserCircle size={18} />
                {text.tabs.overview}
              </UTabs.Item>
              <UTabs.Item id="employment">
                <Briefcase size={18} />
                {text.tabs.employment}
              </UTabs.Item>
            </UTabs.List>
            <UTabs.Panel id="about" className="tab-panel">
              <h2>{text.overview.title}</h2>
              <p className="section-description">{text.overview.description}</p>
              <dl className="profile-details">
                {[
                  {
                    label: text.overview.fullName,
                    value: data.name,
                    icon: UserCircle,
                  },
                  {
                    label: text.overview.workEmail,
                    value: data.email,
                    icon: EnvelopeSimple,
                  },
                  {
                    label: text.overview.department,
                    value: data.department,
                    icon: Buildings,
                  },
                  {
                    label: text.overview.workLocation,
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
            </UTabs.Panel>
            <UTabs.Panel id="employment" className="tab-panel">
              <h2>{text.employment.title}</h2>
              <p className="section-description">
                {text.employment.description}
              </p>
              <dl className="profile-details">
                {[
                  {
                    label: text.employment.code,
                    value: data.code,
                    icon: Fingerprint,
                  },
                  {
                    label: text.employment.designation,
                    value: data.title,
                    icon: Briefcase,
                  },
                  {
                    label: text.employment.joiningDate,
                    value: joined,
                    icon: CalendarBlank,
                  },
                  {
                    label: text.employment.status,
                    value:
                      data.status === "active"
                        ? text.status.active
                        : text.status.notice,
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
                  <strong>{text.employment.milestone}</strong>
                  <p>{joined}</p>
                </div>
                <span className="milestone-dot" />
              </div>
            </UTabs.Panel>
          </UTabs>
          <div className="profile-privacy">
            <LockKey size={19} />
            <p>{text.privacy}</p>
          </div>
        </section>
        <aside className="profile-aside">
          <section className="panel">
            <span className="aside-icon">
              <Buildings size={26} weight="duotone" />
            </span>
            <p className="eyebrow">{text.aside.eyebrow}</p>
            <h2>{data.department}</h2>
            <p>{text.aside.description}</p>
            <Link
              className="text-link"
              to={`/people?department=${encodeURIComponent(data.department)}`}
            >
              {text.aside.viewDepartment} <ArrowUpRight size={17} />
            </Link>
          </section>
          <section className="profile-joining">
            <CalendarBlank size={23} weight="duotone" />
            <span>
              {text.aside.since}
              <strong>{joined}</strong>
            </span>
          </section>
        </aside>
      </div>
    </div>
  );
}
