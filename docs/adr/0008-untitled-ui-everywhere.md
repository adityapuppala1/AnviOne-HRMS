# ADR 0008: Untitled UI components everywhere

Date: 27 October 2026. Status: accepted. Extends [ADR 0007](0007-adaptive-component-kit.md).

The user asked for the free Untitled UI React components to be used on every screen.

## Licence rule

Only the open-source, MIT-licensed Untitled UI React components are used. They come from the public starter kit (`untitleduico/react`, MIT; its README states that PRO is separate). The licence text is kept at `packages/ui/src/untitled/LICENSE.md`. No PRO component, marketing block or unlicensed asset is copied. Imports stay relative, and tokens stay bridged to Anvi Loom in `untitled/untitled.css`. Nothing is re-drawn as a look-alike.

## Exported from `@anvi/ui`

`Input`, `UTextField`, `TextArea` (newly vendored from the MIT repo), `Label`, `HintText`, `Select` (with `Select.Item`, `Select.ComboBox`), `ComboBox`, `Checkbox`, `Toggle`, `RadioGroup`, `RadioButton`, `UAvatar` (Untitled's avatar; our own `Avatar` is kept), `AvatarOnlineIndicator`, `Dropdown`, `ButtonGroup`, `ButtonGroupItem`, `EmptyState`, `UButton` (Untitled's button; our `Button` is kept). `RangeInput` (in `patterns.tsx`) composes Untitled's `TextField`, `Label`, `InputBase` and `HintText` so dates and numbers can keep `min`, `max` and `step`, which `Input` does not forward.

## Loom adjustments (all in `untitled.css` unless noted)

- The portal's unlayered `input`/`select` rules would stack on the kit's utilities, so the kit's inputs hand those properties back with `revert-layer`.
- Checkbox, radio and toggle inputs are stretched invisibly over their own row: the whole row is the target, 44 px on coarse pointers.
- Visible focus for kit buttons, menu items and options in light and dark; 44 px minimum height for inputs, select triggers and menu items on coarse pointers.
- One edit to a vendored file: `input/label.tsx` renders the required asterisk only when it can show, so label text stays exact for assistive tech and tests.

## Adopted in this slice

- Policies, Exit, Expenses, Assets: all text, date and number fields use `Input`/`RangeInput`/`TextArea` with label, hint and error state; selects and filters use `Select`; switches and checkboxes use `Toggle`/`Checkbox`; search boxes use `Input` with an icon. The exit employee picker keeps its search-then-pick list (results are fetched from the server) and shows `UAvatar` initials. Empty states already use Untitled `EmptyState` through `EmptyBlock`.
- Playwright specs changed minimally: choosing from a `Select` is now click-then-option (expenses "Category", assets "Condition on return").

## Also adopted

- `application/tabs` was copied from the MIT starter kit and is exported as `UTabs`; the My details screen uses it for its views. The "My details" screen is built on the kit from the start.

## Not done yet

`Dropdown` row-action menus, `ComboBox` for the exit picker, `ButtonGroup`, and the extra free components available in the starter kit but not yet vendored (`tags`, `slider`, `progress-indicators`, `file-upload`, `modals`, `slideout-menus`, `date-picker`, `loading-indicator`, `charts`).

## Screens not yet migrated to the form kit

Hand-rolled inputs, selects or switches remain on every other route under `apps/portal/app/routes`: activity, approvals, assigned-tasks, attendance, calendar, candidates, documents, help, home, insights, leave, login, not-found, organization, people, preferences, profile, settings, teams, workspace (shell and command bar). Later slices should migrate each, keeping accessible names, and tick them off here.
