# Markdown editor

Web uses the published editorcn block editor and Tiptap's Markdown
extension. The public component still accepts and emits Markdown strings. Mobile,
extensions, storage, APIs, and previews keep their existing contracts.

`@editorcn/block-editor` is pinned to **0.2.0**: the inspected 0.3.x npm tarballs
declare `dist` exports but omit those files. Tiptap packages are pinned together
to **3.31.4**. Keep the compatibility corpus and browser journeys green when
upgrading the beta Markdown extension. References:
[editorcn documentation](https://www.rtecn.space/docs),
[Tiptap Markdown documentation](https://tiptap.dev/docs/editor/markdown).

## Preservation

Opening or selecting a note never rewrites its string. Supported documents use
rich blocks after schema validation and an independent Markdown semantic comparison.
Actual rich edits may normalize syntax. Frontmatter, reference definitions, image
references, tables, raw HTML, unsafe links, and unsupported syntax stay editable as literal
text in the same block editor. Literal edits serialize verbatim. There is no source
mode or mode switch. Images are never loaded by the editor.

Pastes use plain text. Supported Markdown becomes blocks; unsupported pasted
content becomes literal text. Links permit only safe HTTP/HTTPS URLs. Transactions
reject content over 512 KiB in UTF-8. Table insertion and table controls are excluded.

Slash commands, standard formatting shortcuts, and Cmd/Ctrl K for links work
alongside contextual formatting. There are no block movement controls or shortcuts.
Cmd/Ctrl Enter saves; Cmd/Ctrl E opens fullscreen creation where supplied.
Existing card save-on-close behavior is preserved. Composer fullscreen close
returns to the unsaved compact draft.

## Verification

Use the repository's local, authenticated development stack. Tests create their
own accounts and cards and remove them afterward. Never use production credentials.

```sh
bun test packages/ui/src/components/text-editor/__tests__
PLAYWRIGHT_SKIP_WEBSERVER=1 bun run --cwd apps/web test:e2e markdown-editor.e2e.ts --reporter=list,html
```

Reports live in `apps/web/playwright-report`; traces and representative screenshots
live in `apps/web/test-results`. Shipping is blocked by silent loss, unexpected writes,
unsafe execution, or a failed required journey.
