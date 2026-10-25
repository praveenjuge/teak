package com.praveenjuge.teak.core.data.convex

import com.praveenjuge.teak.core.model.AccountPreferences
import com.praveenjuge.teak.core.model.AuthMode
import com.praveenjuge.teak.core.model.BulkResult
import com.praveenjuge.teak.core.model.Card
import com.praveenjuge.teak.core.model.CardBacklinks
import com.praveenjuge.teak.core.model.CardLinkTarget
import com.praveenjuge.teak.core.model.LinkedCard
import com.praveenjuge.teak.core.model.CardSummaryPage
import com.praveenjuge.teak.core.model.CurrentUser
import com.praveenjuge.teak.core.model.Folder
import com.praveenjuge.teak.core.model.SimilarAnchor
import com.praveenjuge.teak.core.model.TagOperation
import com.praveenjuge.teak.core.model.TagSummary
import com.praveenjuge.teak.core.model.TrashCount
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.KSerializer
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.nullable
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

class ConvexFunction<T>(val name: String, val result: KSerializer<T>)

object ConvexFunctions {
    val searchCardSummaries = ConvexFunction("cards:searchMobileCardSummariesPaginated", CardSummaryPage.serializer())
    val getCard = ConvexFunction("cards:getCard", Card.serializer().nullable)
    val createCard = ConvexFunction("cards:createCard", String.serializer())
    val updateCardField = ConvexFunction("cards:updateCardField", JsonElement.serializer())
    val bulkUpdateCards = ConvexFunction("cards:bulkUpdateCards", BulkResult.serializer())
    val reprocessCard = ConvexFunction("cards:reprocessCard", JsonObject.serializer())
    val getCardLinkTargets = ConvexFunction("cards:getCardLinkTargets", ListSerializer(CardLinkTarget.serializer()))
    val getCardBacklinks = ConvexFunction("cards:getCardBacklinks", CardBacklinks.serializer())
    val searchCardLinkSuggestions = ConvexFunction("cards:searchCardLinkSuggestions", ListSerializer(LinkedCard.serializer()))
    val similarAnchorSummary = ConvexFunction("cards:similarAnchorSummary", SimilarAnchor.serializer())
    val viewHasHiddenCards = ConvexFunction("cards:viewHasHiddenCards", Boolean.serializer())
    val requestSemanticResults = ConvexFunction("search/semanticActions:requestSemanticResults", JsonObject.serializer())
    val permanentDeleteCard = ConvexFunction("cards:permanentDeleteCard", JsonElement.serializer())
    val emptyTrash = ConvexFunction("cards:emptyTrash", TrashCount.serializer())
    val trashCount = ConvexFunction("cards:trashCount", TrashCount.serializer())
    val uploadAndCreateCard = ConvexFunction("cards:uploadAndCreateCard", JsonObject.serializer())
    val finalizeUploadedCard = ConvexFunction("cards:finalizeUploadedCard", JsonObject.serializer())
    val listFolders = ConvexFunction("folders:listFolders", ListSerializer(Folder.serializer()))
    val getFolder = ConvexFunction("folders:getFolder", Folder.serializer().nullable)
    val createFolder = ConvexFunction("folders:createFolder", Folder.serializer())
    val updateFolder = ConvexFunction("folders:updateFolder", Folder.serializer())
    val deleteFolder = ConvexFunction("folders:deleteFolder", String.serializer())
    val restoreFolder = ConvexFunction("folders:restoreFolder", Folder.serializer())
    val setCardFolders = ConvexFunction("folders:setCardFolders", ListSerializer(String.serializer()))
    val listTagSummary = ConvexFunction("tags:listTagSummary", TagSummary.serializer().nullable)
    val requestTagSummary = ConvexFunction("tags:requestTagSummary", JsonElement.serializer())
    val startTagOperation = ConvexFunction("tags:startTagOperation", TagOperation.serializer())
    val getTagOperation = ConvexFunction("tags:getTagOperation", TagOperation.serializer().nullable)
    val getCurrentUser = ConvexFunction("auth:getCurrentUser", CurrentUser.serializer().nullable)
    val getAuthMode = ConvexFunction("auth:getAuthMode", AuthMode.serializer())
    val ensureUser = ConvexFunction("workosBootstrap:ensureUser", JsonObject.serializer())
    val revokeAuthkitSession = ConvexFunction("securitySessions:revokeAuthkitSession", JsonElement.serializer())
    val deleteMyAccount = ConvexFunction("accountDeletion:deleteMyAccount", JsonElement.serializer())
    val getPreferences = ConvexFunction("settings/preferences:getPreferences", AccountPreferences.serializer().nullable)
    val setLocale = ConvexFunction("settings/preferences:setLocale", AccountPreferences.serializer())
}

fun <T> ConvexApi.subscribe(function: ConvexFunction<T>, args: Map<String, Any?> = emptyMap()): Flow<Result<T>> =
    subscribe(function.name, args).map { result ->
        result.mapCatching { teakJson.decodeFromJsonElement(function.result, it) }
    }

suspend fun <T> ConvexApi.mutation(function: ConvexFunction<T>, args: Map<String, Any?> = emptyMap()): T =
    teakJson.decodeFromJsonElement(function.result, mutation(function.name, args))

suspend fun <T> ConvexApi.action(function: ConvexFunction<T>, args: Map<String, Any?> = emptyMap()): T =
    teakJson.decodeFromJsonElement(function.result, action(function.name, args))
