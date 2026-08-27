# Animal Bank V3 Content Factory

Start from the repository root:

```bash
/usr/bin/python3 v3/server.py
```

Open `http://127.0.0.1:4175/app/content-factory/`. Do not open `index.html` with `file://`; browser security prevents ES modules from reading the real JSON data files.

## Prototype visual reuse

The shell standardizes the existing prototype design language without reusing its Teacher Flow or product information architecture:

- warm background gradient and paper surfaces
- `#ff775f` primary action color
- rounded cards and controls
- soft card shadows and outlined secondary buttons
- segmented tabs, status pills, upload/form patterns
- DOG avatar only in the brand area and selected empty-state guidance
- existing Score Review numbered notation and editing interaction

Curriculum and Teaching Asset pages are read-only consumers of their frozen JSON sources. Unimplemented engines render explicit empty states.
