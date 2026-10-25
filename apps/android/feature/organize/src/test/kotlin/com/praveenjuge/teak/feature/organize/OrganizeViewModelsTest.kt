package com.praveenjuge.teak.feature.organize

import com.praveenjuge.teak.core.data.convex.TeakException
import com.praveenjuge.teak.core.model.Folder
import com.praveenjuge.teak.core.model.FolderKind
import com.praveenjuge.teak.core.model.TagCount
import com.praveenjuge.teak.core.model.TagOperationKind
import com.praveenjuge.teak.core.model.TagOperationStatus
import com.praveenjuge.teak.core.model.TagSummary
import com.praveenjuge.teak.core.model.UiText
import com.praveenjuge.teak.core.testing.FakeFoldersRepository
import com.praveenjuge.teak.core.testing.FakeTagsRepository
import com.praveenjuge.teak.core.testing.MainDispatcherRule
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Rule
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class OrganizeViewModelsTest {
    @get:Rule val mainDispatcherRule = MainDispatcherRule()

    private val folders = FakeFoldersRepository()
    private val tags = FakeTagsRepository()

    @Test
    fun `a smart folder needs a search, and saves it`() = runTest {
        val viewModel = FoldersViewModel(folders)
        viewModel.open(FolderEditor.New(smart = true))
        viewModel.save("Design links", query = " ")
        assertEquals(UiText.of("errors.folders.EMPTY_QUERY"), viewModel.state.value.editorError)

        viewModel.save("Design links", query = "tag:design type:link")
        advanceUntilIdle()
        assertNull(viewModel.state.value.editor)
        assertEquals(listOf(FolderKind.Smart to "tag:design type:link"), folders.all.value.map { it.kind to it.query })
    }

    @Test
    fun `the server's reason shows in the folder dialog`() = runTest {
        folders.error = TeakException("CONFLICT", "A folder with this name already exists")
        val viewModel = FoldersViewModel(folders)
        viewModel.open(FolderEditor.New(smart = false))
        viewModel.save("Reading", query = null)
        advanceUntilIdle()
        assertEquals(UiText.verbatim("A folder with this name already exists"), viewModel.state.value.editorError)
    }

    @Test
    fun `deleting a folder can be undone`() = runTest {
        folders.all.value = listOf(Folder(id = "f1", name = "Reading"))
        val viewModel = FoldersViewModel(folders)
        viewModel.delete(folders.all.value.single())
        advanceUntilIdle()
        val note = viewModel.state.value.note!!
        assertEquals(UiText.of("native.folders.deletedName", "Reading"), note.text)

        viewModel.restore(note)
        advanceUntilIdle()
        assertEquals(listOf("Reading"), viewModel.state.value.folders.map { it.name })
        assertNull(viewModel.state.value.note)
    }

    @Test
    fun `tags list by use, and an empty summary is asked for once`() = runTest {
        val viewModel = TagsViewModel(tags)
        advanceUntilIdle()
        assertEquals(1, tags.summaryRequests)

        tags.summaryState.value = TagSummary(listOf(TagCount("ui", 2.0), TagCount("design", 5.0)))
        advanceUntilIdle()
        assertEquals(listOf("design", "ui"), viewModel.state.value.tags.map { it.name })
        viewModel.search("U")
        assertEquals(listOf("ui"), viewModel.state.value.visible.map { it.name })
    }

    @Test
    fun `renaming onto an existing tag offers a merge instead`() = runTest {
        tags.summaryState.value = TagSummary(listOf(TagCount("design", 5.0), TagCount("ui", 2.0)))
        val viewModel = TagsViewModel(tags)
        advanceUntilIdle()
        viewModel.open(TagOperationKind.Rename, TagCount("ui", 2.0))
        assertEquals(UiText.of("native.tags.exists", "design"), viewModel.renameError("Design"))
        assertEquals("design", viewModel.existingTag("Design"))

        viewModel.mergeInstead("design")
        advanceUntilIdle()
        assertEquals(listOf(Triple<TagOperationKind, String, String?>(TagOperationKind.Merge, "ui", "design")), tags.started)
    }

    @Test
    fun `a tag change is followed until it finishes`() = runTest {
        tags.summaryState.value = TagSummary(listOf(TagCount("old", 2.0)))
        val viewModel = TagsViewModel(tags)
        advanceUntilIdle()
        viewModel.open(TagOperationKind.Delete, TagCount("old", 2.0))
        assertEquals(UiText.of("native.tags.deleteMessage", "old", count = 2), viewModel.state.value.editor?.message)
        viewModel.submit()
        advanceUntilIdle()
        assertEquals(TagOperationStatus.Running, viewModel.state.value.operation?.status)
        assertEquals(TagOperationKind.Delete to "old", viewModel.state.value.operation?.let { it.kind to it.from })

        tags.finish("op1")
        advanceUntilIdle()
        assertEquals(TagOperationStatus.Completed, viewModel.state.value.operation?.status)
        assertEquals(2.0, viewModel.state.value.operation?.changed)
        assertEquals(emptyList(), viewModel.state.value.shown)
        assertEquals(1, tags.summaryRequests)
    }

    @Test
    fun `a rename shows in the list before the summary catches up`() = runTest {
        tags.summaryState.value = TagSummary(listOf(TagCount("ui", 2.0), TagCount("design", 5.0), TagCount("ux", 1.0)))
        val viewModel = TagsViewModel(tags)
        advanceUntilIdle()
        viewModel.open(TagOperationKind.Merge, TagCount("ux", 1.0))
        viewModel.submit("design")
        advanceUntilIdle()
        assertEquals(listOf("design" to 6, "ui" to 2), viewModel.state.value.shown.map { it.name to it.cards })
    }
}
