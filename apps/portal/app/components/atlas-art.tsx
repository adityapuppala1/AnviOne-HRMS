import { Fingerprint } from "@phosphor-icons/react/dist/csr/Fingerprint";
import { ArrowUpRight } from "@phosphor-icons/react/dist/csr/ArrowUpRight";
import { UsersThree } from "@phosphor-icons/react/dist/csr/UsersThree";
import { Avatar } from "@anvi/ui";
export function AtlasArt() {
  return (
    <div className="atlas-art" aria-hidden="true">
      <div className="atlas-floor" />
      <div className="atlas-ring ring-back" />
      <div className="atlas-ring ring-front" />
      <div className="atlas-person">
        <Avatar initials="MI" />
        <div>
          <strong>People. At the centre.</strong>
          <span>A space to do your best work.</span>
        </div>
        <ArrowUpRight size={18} />
      </div>
      <div className="atlas-stamp">
        <Fingerprint size={36} weight="duotone" />
        <span>Uniquely you.</span>
      </div>
      <div className="atlas-people">
        <UsersThree size={25} weight="duotone" />
        <span>
          Better
          <br />
          <strong>together.</strong>
        </span>
      </div>
      <div className="atlas-coordinate">ANVI / PEOPLE & POSSIBILITY</div>
    </div>
  );
}
