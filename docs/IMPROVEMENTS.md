# New improvements tracker

Public phone-friendly tracker: https://satish01-oss.github.io/Drive-Bridge/improvements.html

This plan covers only the next improvements. The existing Windows release is tracked separately in `project-status.json`.

Maintain `docs/improvements-status.json` as implementation proceeds in this chat. Each item has a planned method, acceptance criteria, status and completion evidence. Use `planned`, `in_progress`, `blocked` or `done`. Only set `done` after the stated outcome is verified; distinguish automated tests from physical-device tests. Update the date and describe actual methods, validation and remaining limits. Never publish secrets or private device information.

Run `node scripts/build-improvements.mjs` from the repository root. This validates the data and inline JavaScript, then generates the standalone `dist/improvements.html`. An optional output path exports an identical offline HTML file. Commit the status and generated page together. The Pages workflow also regenerates it on every publication so future app releases preserve the tracker.

Verified completion is assistant-maintained. Personal ticks live only in browser storage or an exported HTML copy; they do not change verified progress or sync between phones and computers. The refresh button reloads published status. Work happens during active chat sessions; there is no scheduled background agent updating this page.
