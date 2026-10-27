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

## Organization and chart

`organization` was rebuilt on the kit with the ORG-02 features (tabs for five kinds, effective dates, merge dialog, row menus) and the new `chart` screen is built on it too.

## Not done yet

`Dropdown` row-action menus, `ComboBox` for the exit picker, `ButtonGroup`, and the extra free components available in the starter kit but not yet vendored (`tags`, `slider`, `progress-indicators`, `file-upload`, `modals`, `slideout-menus`, `date-picker`, `loading-indicator`, `charts`).

## Migrated in the second slice (form controls on the older routes)

- Leave, Attendance, Calendar, Documents, Approvals, Assigned tasks, Candidates, Activity, People, Help, Settings and the command bar: text, date, time and search fields use `Input`/`RangeInput`; reason and note boxes use `TextArea`; selects and filters use `Select` (with `Select.Item`, `disabledKeys` for the task status); the holiday "Observed this year" box uses `Checkbox`.
- Tabs on Leave, Attendance, Documents, Profile and Team explorer use `UTabs` (underline). 44 px tab targets on coarse pointers are in `styles.css`.
- Empty states on all of these already render through Untitled `EmptyState` (via `EmptyBlock`).
- Playwright specs changed minimally: native `selectOption` became click-button-then-option for leave type, document category, activity type (atlas and organization specs), the onboarding intake pickers and the assigned-task status.

## Deliberately not migrated yet (honest list)

- `home`, `not-found`, `login` (no form fields; its one control is a link-styled button) and `workspace` (shell: no form fields besides the command bar, which is done).
- Preferences and Settings theme/density/mode pickers: these are card-style radios with illustrations and swatches, not plain radio rows, and the kit `RadioGroup` cannot draw them without re-drawing the cards. The Preferences "Reduce motion" switch keeps the portal's own `.switch` (animated thumb, verified by `atlas.spec.ts`) so the kit's checkbox/radio CSS cannot disturb it.
- Documents file picker stays a native `input type="file"` (the kit file-upload component is not vendored yet).
- `components/onboarding-checklist.tsx` and `components/local-readiness-review.tsx`: large, heavily specified native selects/textareas (`onboarding.spec.ts` drives them with `selectOption`); to be migrated with the onboarding slice.
- Our own `Avatar` (Loom colours, used on nearly every screen) is kept; `UAvatar` is used where a screen adopts it (Exit). Row-action `Dropdown` menus and `ButtonGroup` are not introduced: the existing rows use one or two visible buttons, which is clearer than a menu.
- Still not vendored from the starter kit: `tags`, `slider`, `progress-indicators`, `file-upload`, `modals`, `slideout-menus`, `date-picker`, `loading-indicator`, `charts`.
