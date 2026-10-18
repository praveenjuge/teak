package com.praveenjuge.teak.core.data.convex

import com.praveenjuge.teak.core.model.AuthMode
import com.praveenjuge.teak.core.model.Card
import com.praveenjuge.teak.core.model.CardSummaryPage
import com.praveenjuge.teak.core.model.CurrentUser
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.KSerializer
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
    val permanentDeleteCard = ConvexFunction("cards:permanentDeleteCard", JsonElement.serializer())
    val uploadAndCreateCard = ConvexFunction("cards:uploadAndCreateCard", JsonObject.serializer())
    val finalizeUploadedCard = ConvexFunction("cards:finalizeUploadedCard", JsonObject.serializer())
    val getCurrentUser = ConvexFunction("auth:getCurrentUser", CurrentUser.serializer().nullable)
    val getAuthMode = ConvexFunction("auth:getAuthMode", AuthMode.serializer())
    val ensureUser = ConvexFunction("workosBootstrap:ensureUser", JsonObject.serializer())
    val revokeAuthkitSession = ConvexFunction("securitySessions:revokeAuthkitSession", JsonElement.serializer())
    val deleteMyAccount = ConvexFunction("accountDeletion:deleteMyAccount", JsonElement.serializer())
}

fun <T> ConvexApi.subscribe(function: ConvexFunction<T>, args: Map<String, Any?> = emptyMap()): Flow<Result<T>> =
    subscribe(function.name, args).map { result ->
        result.mapCatching { teakJson.decodeFromJsonElement(function.result, it) }
    }

suspend fun <T> ConvexApi.mutation(function: ConvexFunction<T>, args: Map<String, Any?> = emptyMap()): T =
    teakJson.decodeFromJsonElement(function.result, mutation(function.name, args))

suspend fun <T> ConvexApi.action(function: ConvexFunction<T>, args: Map<String, Any?> = emptyMap()): T =
    teakJson.decodeFromJsonElement(function.result, action(function.name, args))
