package com.praveenjuge.teak.core.testing

import com.praveenjuge.teak.core.data.repository.FoldersRepository
import com.praveenjuge.teak.core.data.repository.TagsRepository
import com.praveenjuge.teak.core.model.Folder
import com.praveenjuge.teak.core.model.FolderKind
import com.praveenjuge.teak.core.model.TagOperation
import com.praveenjuge.teak.core.model.TagOperationKind
import com.praveenjuge.teak.core.model.TagOperationStatus
import com.praveenjuge.teak.core.model.TagSummary
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.map

class FakeFoldersRepository : FoldersRepository {
    val all = MutableStateFlow<List<Folder>>(emptyList())
    val cardFolders = mutableMapOf<String, List<String>>()
    val deleted = mutableListOf<Folder>()
    var error: Exception? = null
    /** Set to fail the folder list each time it's subscribed to. */
    var loadError: Exception? = null

    override val folders: Flow<Result<List<Folder>>> = all.map { list -> loadError?.let { Result.failure(it) } ?: Result.success(list) }

    override fun folder(id: String): Flow<Result<Folder?>> = all.map { list -> Result.success(list.firstOrNull { it.id == id }) }

    override suspend fun create(name: String, query: String?): Folder {
        error?.let { throw it }
        val folder = Folder(
            id = "f${all.value.size + 1}",
            name = name.trim(),
            kind = if (query != null) FolderKind.Smart else FolderKind.Manual,
            query = query,
        )
        all.value = all.value + folder
        return folder
    }

    override suspend fun update(id: String, name: String, query: String?): Folder {
        error?.let { throw it }
        val updated = all.value.first { it.id == id }.let { it.copy(name = name.trim(), query = query ?: it.query) }
        all.value = all.value.map { if (it.id == id) updated else it }
        return updated
    }

    override suspend fun delete(id: String) {
        error?.let { throw it }
        all.value.firstOrNull { it.id == id }?.let { deleted += it }
        all.value = all.value.filterNot { it.id == id }
    }

    override suspend fun restore(id: String): Folder {
        val folder = deleted.first { it.id == id }
        deleted -= folder
        all.value = all.value + folder
        return folder
    }

    override suspend fun setCardFolders(cardId: String, folderIds: List<String>) {
        error?.let { throw it }
        cardFolders[cardId] = folderIds
    }
}

class FakeTagsRepository : TagsRepository {
    val summaryState = MutableStateFlow<TagSummary?>(null)
    val operations = MutableStateFlow<Map<String, TagOperation>>(emptyMap())
    val started = mutableListOf<Triple<TagOperationKind, String, String?>>()
    var summaryRequests = 0
    var startError: Exception? = null
    /** Set to fail the summary each time it's subscribed to. */
    var summaryError: Exception? = null
    var requestSummaryError: Exception? = null
    /** Set to hold [start] until it completes, as a slow network would. */
    var startGate: CompletableDeferred<Unit>? = null

    override val summary: Flow<Result<TagSummary?>> = summaryState.map { summary -> summaryError?.let { Result.failure(it) } ?: Result.success(summary) }

    override suspend fun requestSummary() {
        summaryRequests += 1
        requestSummaryError?.let { throw it }
    }

    override suspend fun start(kind: TagOperationKind, from: String, to: String?): TagOperation {
        startGate?.await()
        startError?.let { throw it }
        started += Triple(kind, from, to)
        val operation = TagOperation(id = "op${started.size}", kind = kind, from = from, to = to, status = TagOperationStatus.Running, total = 2.0)
        operations.value = operations.value + (operation.id to operation)
        return operation
    }

    override fun operation(id: String): Flow<Result<TagOperation?>> = operations.map { Result.success(it[id]) }

    fun finish(id: String, status: TagOperationStatus = TagOperationStatus.Completed) {
        val operation = operations.value.getValue(id)
        operations.value = operations.value + (id to operation.copy(status = status, processed = operation.total, changed = operation.total))
    }
}
