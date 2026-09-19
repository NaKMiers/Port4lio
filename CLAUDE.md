# Port4lio - project conventions

## UI: dropdowns use `SelectField`, not a native `<select>`

For any new single-choice dropdown, use `SelectField` (`src/components/settings/SelectField.tsx`)
instead of a bare `<select>`. It renders the same styled, keyboard-navigable listbox as the blog
editor's Kind/Series fields and the "Generate blog" dialog's select fields - see its own doc
comment for the keyboard contract and why the native element isn't just re-styled.

Exception: a long or dynamic option list (a country list, a year picker, dozens of entries) on a
public, mobile-heavy page. `SelectField` gives up the native mobile wheel/sheet picker and some
built-in keyboard behavior, which is a bad trade at that size - keep the native `<select>` there.
Nothing in the app currently fits that exception; check before assuming a new field does.
