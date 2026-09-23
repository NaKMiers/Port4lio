# TODOS

## Completed

### Local undo/redo on the canvas

**What:** A client-side undo stack (Cmd/Ctrl+Z, Shift+Cmd/Ctrl+Z, Ctrl+Y) on `/admin/whiteboard` for moves, edits, creates and deletes. The delete confirm came out with it: Delete now removes the selection at once and offers Undo on a toast.

**Why:** Hard delete plus ~600 ms autosave means a mis-drag or a wrong delete is saved almost at once. In v1 the only ways back were the delete confirm and "Restore from backup", which needs a backup downloaded earlier.

**How it went:** Deferred from the whiteboard eng review (D30). Not built on the save queue or `data.ts` as sketched, and not on the restore route either - `src/components/whiteboard/history.ts` diffs a board snapshot against the board and sends the difference through the queue's existing ops, so there is no second write path to keep in step. Delete-undo did need its own rule: R3-6 keeps a deleted id dead for the session, so the card comes back as a copy under a fresh id rather than being revived. Rule 8 holds - every field comes back, `includeInAi` included. See `docs/designs/whiteboard.md` > "Undo/redo".
