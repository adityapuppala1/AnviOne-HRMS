# ADR 0002: Anvi Atlas experience

Date: 25 October 2026. Status: accepted for foundation F0.2.

The user requested a distinctive, interactive redesign of every available page, using their Dribbble references. This increment advances UX-01/UX-02 and the read-only people experience; it does not claim employee activation or attendance/payroll delivery.

## Direction and critique

Anvi Atlas is a people workspace for HR, managers and employees. Its first job is to find the right person and understand the user's permitted organization. Replace the oversized marketing greeting with a compact work summary. Keep real counts and useful destinations prominent. Avoid decorative trend charts, fictional tasks, performance ratings or attendance figures.

Palette: chalk canvas `#F4F5F3`, paper `#FFFFFF`, graphite navigation `#202626`, ink `#252C2C`, emerald action `#197052`, celadon accent `#D8EBC0`. Outfit supplies headings and identity; Public Sans supplies readable controls and data. Both fonts are self-hosted. Iris and Woodland remain supported alternate palettes, with explicit dark tokens.

```
Desktop: compact navigation | search / current context / display controls
                           | greeting + working date
                           | people summary | departments | locations
                           | recent colleagues      | department composition
                           | locations              | personal profile shortcut

Mobile: compact header -> content in reading order -> accessible navigation drawer
```

The signature is a connected-people motif: overlapping sculptural rings on login and an interactive segmented department circle in the workspace. The first sketch retained the previous large hero and equal card grid; that repeated the generic pattern the user rejected. The revised layout prioritizes real information and uses the motif only where it adds identity or helps navigation.

## Implementation choices

- Retain React Router, React Aria and the existing semantic CSS system. No framework migration.
- Use one Phosphor icon family, with restrained duotone accents. Supersedes the Lucide choice in ADR 0001.
- Pin Motion for short, interruptible interaction transitions. Respect both operating-system reduced motion and the personal setting; no continuous animation or hidden essential content.
- Adapt Magic UI's MIT Magic Card locally for the branding preview. Remove Next.js/theme dependencies, use Anvi tokens, ignore touch movement and disable spotlight motion under reduced motion. Preserve the license in the source tree.
- Add a scoped team explorer using the existing RLS-protected dashboard and directory APIs. Counts and destinations never use an unscoped dataset.
- Improve profile details, directory views, audit search/filter/details and display preferences. Only display preferences enter localStorage; people records remain in memory.
- No new database schema or employee provisioning in this visual increment. The activation slice remains next on the delivery backlog.

## Research

Reviewed the supplied Dribbble pages: [HRMS dashboard](https://dribbble.com/shots/25446008-HRMS-system-dashboard), [attendance tracker](https://dribbble.com/shots/26880968-HRMS-Dashboard-Attendance-Tracker-Timesheet), [AI HRMS](https://dribbble.com/shots/26088542-AI-HRMS-UX-UI-Design), [login](https://dribbble.com/shots/26899396-HRMS-Login-Page-UI), [leave tracker](https://dribbble.com/shots/22499257-HRMS-Dashboard-Leave-Tracker), [Buzz HR](https://dribbble.com/shots/26703744-Buzz-HR-Employee-Engagement-Dashboard), [Sage HR](https://dribbble.com/shots/26350031-Sage-HR-Admin-Web-App-Attendance-Management), and [GetHired](https://dribbble.com/shots/24507836-GetHired-HR-Recruitment-Dashboard). The GetHired image was inspected locally for compact navigation, data hierarchy and chart spacing. Other accessible pages supplied descriptions and palette metadata; their full-resolution artwork was unavailable. The HR Management Software, Employee Profile User Table and RecruitSmart links could not be retrieved. No Dribbble artwork or template is redistributed.

Technical references: [Motion React](https://motion.dev/docs/react), [Magic Card](https://magicui.design/docs/components/magic-card), [Magic UI repository/license](https://github.com/magicuidesign/magicui), [Phosphor React](https://github.com/phosphor-icons/react).
