# TODOS

## Whiteboard

### Local undo/redo on the canvas

**What:** A client-side undo stack (Ctrl+Z / Ctrl+Shift+Z) on `/admin/whiteboard` for moves, edits, creates and deletes.

**Why:** Hard delete plus ~600 ms autosave means a mis-drag or a wrong delete is saved almost at once. In v1 the only ways back are the delete confirm and "Restore from backup", which needs a backup downloaded earlier.

**Context:** Deferred from the whiteboard eng review (D30, `docs/designs/whiteboard.md`). The pieces to extend are the save queue (`useSaveQueue`) and the delete sequence in `src/lib/whiteboard/data.ts`. Start with moves and edits, which are plain PATCHes of the previous values. Undoing a delete is the hard part: R3-6 says the client never re-sends a create after its delete, so delete-undo needs its own rule. Reuse the restore upsert path (D20/D21: upsert by `_id`, links after items) instead of a second recreate path. Mind the privacy rules too: an undone delete of a hidden frame's child must come back hidden (rule 8).

**Effort:** M
**Priority:** P3
**Depends on:** v1 save queue and restore route shipped and covered by tests.

## Completed
