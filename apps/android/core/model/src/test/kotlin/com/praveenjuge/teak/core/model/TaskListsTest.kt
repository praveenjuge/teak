package com.praveenjuge.teak.core.model

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

// The rows mirror TeakCore's TaskListTests and apps/web/src/components/text-editor/__tests__/taskListSort.test.ts.
// Keep them in step.

/** The task on [line] ticked or unticked through the item the renderer shows. */
private fun toggled(markdown: String, line: Int): String? {
    val item = MarkdownBlocks.parse(markdown)
        .flatMap { (it as? MarkdownBlock.ListBlock)?.items.orEmpty() }
        .firstOrNull { it.line == line } ?: return null
    return TaskLists.toggle(markdown, item)
}

private data class ToggleCase(val name: String, val before: String, val line: Int, val after: String)

class TaskListsTest {
    @Test
    fun `ticking and unticking reorders the list`() {
        listOf(
            ToggleCase("ticking the first of three moves it to the end", "- [ ] A\n- [ ] B\n- [ ] C", 0, "- [ ] B\n- [ ] C\n- [x] A"),
            ToggleCase("ticking the last open item below a done one moves it first", "- [x] A\n- [ ] B", 1, "- [x] B\n- [x] A"),
            ToggleCase(
                "ticking leads the done items, which keep their order",
                "- [ ] A\n- [ ] B\n- [x] C\n- [x] D", 0, "- [ ] B\n- [x] A\n- [x] C\n- [x] D",
            ),
            ToggleCase("unticking moves it to the end of the open items", "- [ ] A\n- [x] B\n- [x] C", 2, "- [ ] A\n- [ ] C\n- [x] B"),
            ToggleCase("unticking when every item is done moves it first", "- [x] A\n- [x] B", 1, "- [ ] B\n- [x] A"),
            ToggleCase(
                "a nested child moves only within its own sublist",
                "- [ ] P\n  - [ ] c1\n  - [ ] c2\n- [ ] Q", 1, "- [ ] P\n  - [ ] c2\n  - [x] c1\n- [ ] Q",
            ),
            ToggleCase(
                "a parent moves with its children",
                "- [ ] P\n  - [ ] c1\n  - [x] c2\n- [ ] Q", 0, "- [ ] Q\n- [x] P\n  - [ ] c1\n  - [x] c2",
            ),
            ToggleCase(
                "a task list next to a bullet list leaves the bullets alone",
                "- one\n- two\n\nThen\n\n- [ ] A\n- [ ] B", 5, "- one\n- two\n\nThen\n\n- [ ] B\n- [x] A",
            ),
            ToggleCase(
                "a loose list keeps its blank lines where they were",
                "- [ ] A\n\n- [ ] B\n- [ ] C", 0, "- [ ] B\n\n- [ ] C\n- [x] A",
            ),
            ToggleCase(
                "odd spacing, as the checklists seed writes it",
                "-  [ ] Two spaces\n\n- [ ] Blank line above\n* [ ] Star bullet", 0,
                "- [ ] Blank line above\n\n-  [x] Two spaces\n* [ ] Star bullet",
            ),
            ToggleCase(
                "text indented under the last item stays with it",
                "- [ ] A\n- [ ] B\n  B's note", 0, "- [ ] B\n  B's note\n- [x] A",
            ),
            ToggleCase(
                "a paragraph indented under an item moves with it",
                "- [ ] A\n\n  More about A\n\n- [ ] B", 0, "- [ ] B\n\n- [x] A\n\n  More about A",
            ),
            ToggleCase("a heading right after the list ends it", "- [ ] A\n- [ ] B\n## Next", 0, "- [ ] B\n- [x] A\n## Next"),
            ToggleCase(
                "a code fence right after the list ends it",
                "- [ ] A\n- [ ] B\n```\ncode\n```", 0, "- [ ] B\n- [x] A\n```\ncode\n```",
            ),
        ).forEach { assertEquals(it.after, toggled(it.before, it.line), it.name) }
    }

    @Test
    fun `nothing moves`() {
        listOf(
            ToggleCase("ticking the last open item already above the done ones", "- [ ] A\n- [x] B", 0, "- [x] A\n- [x] B"),
            ToggleCase("unticking an item already at the end of the open ones", "- [ ] A\n- [x] B\n- [x] C", 1, "- [ ] A\n- [ ] B\n- [x] C"),
            ToggleCase("a list with one item", "- [ ] A", 0, "- [x] A"),
            ToggleCase("a list mixing tasks and plain items", "- [ ] A\n- plain\n- [ ] B", 0, "- [x] A\n- plain\n- [ ] B"),
            ToggleCase("another bullet starts another list", "- [ ] A\n* [ ] B", 0, "- [x] A\n* [ ] B"),
            ToggleCase(
                "unindented text running on from the last item",
                "- [ ] A\n- [ ] B\nmore of B", 0, "- [x] A\n- [ ] B\nmore of B",
            ),
        ).forEach { assertEquals(it.after, toggled(it.before, it.line), it.name) }
    }

    @Test
    fun `flips exactly the tapped one of two same lines`() {
        val note = "- [ ] A\n- [ ] B\n- [ ] A"
        assertEquals("- [ ] A\n- [ ] B\n- [x] A", toggled(note, 2))
        assertEquals("- [ ] B\n- [ ] A\n- [x] A", toggled(note, 0))
    }

    @Test
    fun `leaves every other line as written`() {
        assertEquals("# List\n* [x] A **bold**\n* [X] B\n\nEnd  ", toggled("# List\n* [ ] A **bold**\n* [X] B\n\nEnd  ", 1))
        assertEquals("- [ ] B\r\n- [x] A", toggled("- [ ] A\r\n- [ ] B", 0))
    }

    @Test
    fun `refuses a line that changed underneath`() {
        val item = MarkdownListItem(0, "•", "A", checked = false, line = 0)
        assertNull(TaskLists.toggle("- [x] A", item))
        assertNull(TaskLists.toggle("- A", item))
        assertNull(TaskLists.toggle("", item))
        assertNull(TaskLists.toggle("- [ ] A", MarkdownListItem(0, "•", "A", line = 0)))
    }

    @Test
    fun `sorts as the web does`() {
        listOf(
            Triple(listOf(false, false, false), 0, listOf(1, 2, 0)),
            Triple(listOf(true, false), 1, listOf(1, 0)),
            Triple(listOf(false, true), 0, listOf(0, 1)),
            Triple(listOf(true, true), 1, listOf(1, 0)),
            Triple(listOf(false, true, true), 2, listOf(0, 2, 1)),
        ).forEach { (checked, index, order) -> assertEquals(order, TaskLists.sortedOrder(checked, index)) }
    }
}
