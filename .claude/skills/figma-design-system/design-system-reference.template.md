# Design System Reference — [System / Product name]

The living reference for working on **[product]** in Figma. The skill holds the *method*; this file holds what's been discovered about *this* system. Keep it lean — capture intent, gotchas, and decision criteria; let Figma stay the source of truth for live values. Update as you learn.

## Sources & access

- **Design system library / file:** [URL]
- **Other reference files:** [feature designs, patterns — URL + 1-line each]
- **Writable workspace:** [URL] — the only file safe to modify
- _(All writes still require user confirmation per SKILL.md.)_

## Foundations

> Fill in only what exists. Note the tier (primitive / semantic / component) and reach-for-first names.

### Color — Variables · collection: [name] · modes: [light / dark / …]
- Semantic roles to reach for first: [e.g. `background/*`, `content/*`, `border/*`, `accent/*`]
- Raw palette location (avoid for new work): [e.g. `palette/*`]
- Notes / deprecated / gotchas: [...]

### Spacing · sizing · radius · border — Variables · collection: [name]
- Spacing scale: [...]   Radius: [...]   Control heights / icon sizes: [...]
- Naming quirks: [...]

### Typography — Text styles
- Naming convention: [e.g. `<device>/<category>/<size>`]
- Families / weights: [...]
- How to apply: discover via search → import by key → `setTextStyleIdAsync`

### Elevation / shadow — Effect styles
- [names + when used]

### Grid / breakpoints — Grid styles
- [...]

### Icons
- Library: [name / URL] · naming: [convention] · sizes/styles: [...]
- How they slot into components: [...]

### Token binding pattern
[the working discover → import → apply snippet for this system; note any opacity/scoping caveats]

## Components

> One entry per **family**. Naming axes + key properties + non-introspectable notes only. Introspect for live property details.

### [Family name]
- **Naming axes:** [size / role / icon-only / …]
- **Properties:** [key props + 1-line on what each does]
- **Key · updatedAt:** [componentKey] · [updatedAt from search_design_system] (re-check on reuse; re-introspect if it moved)
- **Notes:** [design intent, when to use which variant, gotchas]

## Framework & surfaces

- **App shell / page template:** [component + how to instantiate/configure]
- **Where new features go:** [the surface(s) — panel slot, content area, modal — and how]
- **Recipes:** [e.g. "new tool → shell mode X + Toolbar item + panel"]

## Confirmed patterns

- [rules the user has explicitly verified — these override generic instincts]

## Gotchas

- [system-specific things that look like bugs but aren't, or that cost time once]
