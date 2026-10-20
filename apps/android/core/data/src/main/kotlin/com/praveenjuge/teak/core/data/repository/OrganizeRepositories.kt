package com.praveenjuge.teak.core.data.repository

import com.praveenjuge.teak.core.data.convex.ConvexApi
import com.praveenjuge.teak.core.data.convex.ConvexFunctions
import com.praveenjuge.teak.core.data.convex.mutation
import com.praveenjuge.teak.core.data.convex.subscribe
import com.praveenjuge.teak.core.model.Folder
import com.praveenjuge.teak.core.model.FolderKind
import com.praveenjuge.teak.core.model.TagOperation
import com.praveenjuge.teak.core.model.TagOperationKind
import com.praveenjuge.teak.core.model.TagSummary
import kotlinx.coroutines.flow.Flow
import javax.inject.Inject
import javax.inject.Singleton

interface FoldersRepository {
    val folders: Flow<Result<List<Folder>>>

    fun folder(id: String): Flow<Result<Folder?>>

    /** A manual folder, or a smart one when [query] is set: a saved search. */
    suspend fun create(name: String, query: String? = null): Folder
    suspend fun update(id: String, name: String, query: String? = null): Folder

    /** Deletes the folder; its cards stay in the library. [restore] brings it back for a short while. */
    suspend fun delete(id: String)
    suspend fun restore(id: String): Folder

    suspend fun setCardFolders(cardId: String, folderIds: List<String>)
}

interface TagsRepository {
    /** Every tag with its card count; null until the summary is first computed. */
    val summary: Flow<Result<TagSummary?>>

    suspend fun requestSummary()

    suspend fun start(kind: TagOperationKind, from: String, to: String? = null): TagOperation

    fun operation(id: String): Flow<Result<TagOperation?>>
}

@Singleton
class ConvexFoldersRepository @Inject constructor(private val convex: ConvexApi) : FoldersRepository {
    override val folders: Flow<Result<List<Folder>>> = convex.subscribe(ConvexFunctions.listFolders)

    override fun folder(id: String): Flow<Result<Folder?>> = convex.subscribe(ConvexFunctions.getFolder, mapOf("folderId" to id))

    override suspend fun create(name: String, query: String?): Folder =
        convex.mutation(
            ConvexFunctions.createFolder,
            buildMap {
                put("name", name.trim())
                if (query != null) {
                    put("kind", "smart")
                    put("query", query.trim())
                } else {
                    put("kind", FolderKind.Manual.name.lowercase())
                }
            },
        )

    override suspend fun update(id: String, name: String, query: String?): Folder =
        convex.mutation(
            ConvexFunctions.updateFolder,
            buildMap {
                put("folderId", id)
                put("name", name.trim())
                if (query != null) put("query", query.trim())
            },
        )

    override suspend fun delete(id: String) {
        convex.mutation(ConvexFunctions.deleteFolder, mapOf("folderId" to id))
    }

    override suspend fun restore(id: String): Folder = convex.mutation(ConvexFunctions.restoreFolder, mapOf("folderId" to id))

    override suspend fun setCardFolders(cardId: String, folderIds: List<String>) {
        convex.mutation(ConvexFunctions.setCardFolders, mapOf("cardId" to cardId, "folderIds" to folderIds))
    }
}

@Singleton
class ConvexTagsRepository @Inject constructor(private val convex: ConvexApi) : TagsRepository {
    override val summary: Flow<Result<TagSummary?>> = convex.subscribe(ConvexFunctions.listTagSummary)

    override suspend fun requestSummary() {
        convex.mutation(ConvexFunctions.requestTagSummary)
    }

    override suspend fun start(kind: TagOperationKind, from: String, to: String?): TagOperation =
        convex.mutation(
            ConvexFunctions.startTagOperation,
            buildMap {
                put("kind", kind.wireName)
                put("from", from)
                if (to != null) put("to", to.trim())
            },
        )

    override fun operation(id: String): Flow<Result<TagOperation?>> =
        convex.subscribe(ConvexFunctions.getTagOperation, mapOf("operationId" to id))
}
