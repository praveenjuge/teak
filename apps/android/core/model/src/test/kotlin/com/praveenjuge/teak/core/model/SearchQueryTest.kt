package com.praveenjuge.teak.core.model

import org.junit.Test
import java.util.Locale
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** Mirrors `packages/convex/__tests__/shared/search/qualifiers.test.ts` and `semantic.test.ts`. */
class SearchQueryTest {
    private fun parse(input: String) = SearchQuery.parse(input)

    @Test
    fun `reads every qualifier, phrases and words`() {
        val parsed = parse("tag:design type:link site:github.com \"design system\" notes")
        assertEquals(listOf("design"), parsed.tags)
        assertEquals(listOf(CardType.Link), parsed.types)
        assertEquals(listOf("github.com"), parsed.sites)
        assertEquals(listOf("design system"), parsed.phrases)
        assertEquals(listOf("notes"), parsed.terms)
        assertEquals("notes design system", parsed.text)
        assertEquals(false, parsed.favorite)
        assertEquals(false, parsed.archived)
        assertEquals("tag:design type:link site:github.com \"design system\" notes", parsed.canonical)
    }

    @Test
    fun `reads each field the way the backend does`() {
        val cases: List<Triple<String, (ParsedSearchQuery) -> Any?, Any?>> = listOf(
            Triple("#Design", { it.tags }, listOf("design")),
            Triple("TAG:Design", { it.tags }, listOf("design")),
            Triple("tag:\"Design Systems\"", { it.tags }, listOf("design systems")),
            Triple("#fff", { it.tags }, emptyList<String>()),
            Triple("#fff", { it.terms }, listOf("#fff")),
            Triple("#3B82F6,", { it.terms }, listOf("#3B82F6,")),
            Triple("#bad", { it.terms }, listOf("#bad")),
            Triple("tag:bad", { it.tags }, listOf("bad")),
            Triple("#design-ops", { it.tags }, listOf("design-ops")),
            Triple("#", { it.terms }, emptyList<String>()),
            Triple("type:links", { it.types }, listOf(CardType.Link)),
            Triple("Type:IMAGE", { it.types }, listOf(CardType.Image)),
            Triple("type:banana", { it.terms }, listOf("type:banana")),
            Triple("type:", { it.terms }, emptyList<String>()),
            Triple("is:fav", { it.favorite }, true),
            Triple("is:favourites", { it.favorite }, true),
            Triple("is:starred", { it.favorite }, true),
            Triple("is:archived", { it.archived }, true),
            Triple("is:done", { it.done }, true),
            Triple("is:Completed", { it.done }, true),
            Triple("is:finished", { it.done }, true),
            Triple("is:todo", { it.todo }, true),
            Triple("is:to-do", { it.todo }, true),
            Triple("is:nope", { it.terms }, listOf("is:nope")),
            Triple("site:www.Example.com", { it.sites }, listOf("example.com")),
            Triple("site:https://example.com/path:8080", { it.sites }, listOf("example.com")),
            Triple("site:example.com:8080", { it.sites }, listOf("example.com")),
            Triple("site:例え.jp", { it.sites }, listOf("xn--r8jz45g.jp")),
            Triple("site:mailto:x@y.z", { it.terms }, listOf("site:mailto:x@y.z")),
            Triple("site:[::1]", { it.sites }, listOf("[::1]")),
            Triple("site:[2001:db8::1],", { it.sites }, listOf("[2001:db8::1]")),
            Triple("site:http://[::1]:8080/x", { it.sites }, listOf("[::1]")),
            Triple("folder:\"Reading list\"", { it.folders }, listOf("reading list")),
            Triple("folder:Inbox,", { it.folders }, listOf("inbox")),
            Triple("foo:bar", { it.terms }, listOf("foo:bar")),
            Triple("https://github.com", { it.terms }, listOf("https://github.com")),
            Triple("\"unbalanced phrase", { it.phrases }, listOf("unbalanced phrase")),
            Triple("“smart quotes”", { it.phrases }, listOf("smart quotes")),
            Triple("\"\"", { it.phrases }, emptyList<String>()),
            Triple("tag:a tag:A #a", { it.tags }, listOf("a")),
            Triple("site:a.com site:b.com", { it.sites }, listOf("a.com", "b.com")),
            Triple("🎨 #🎨", { it.tags }, listOf("🎨")),
            Triple("text:4411", { it.ocrTexts }, listOf("4411")),
            Triple("TEXT:\"Total  Due\"", { it.ocrTexts }, listOf("Total Due")),
            Triple("text:Total text:total", { it.ocrTexts }, listOf("Total")),
            Triple("text:a text:b", { it.ocrTexts }, listOf("a", "b")),
            Triple("text:", { it.terms }, emptyList<String>()),
            Triple("text:\"  \"", { it.ocrTexts }, emptyList<String>()),
            Triple("text:4411", { it.text }, ""),
            Triple("text:東京駅", { it.ocrTexts }, listOf("東京駅")),
        )
        for ((input, field, expected) in cases) assertEquals(expected, field(parse(input)), input)
    }

    @Test
    fun `quoted values keep escaped quotes and round-trip`() {
        val parsed = parse("folder:\"Say \\\"hi\\\" now\" tag:x")
        assertEquals(listOf(SearchQualifier.Folder("Say \"hi\" now"), SearchQualifier.Tag("x")), parsed.qualifiers)
        assertEquals("folder:\"Say \\\"hi\\\" now\" tag:x", parsed.canonical)
        assertEquals(parsed.qualifiers, parse(parsed.canonical).qualifiers)
    }

    @Test
    fun `folder names and tags round-trip through their chips`() {
        for (name in listOf("A\\B", "Say \"hi\"", "<b>Not bold</b> & “quoted”", "trailing\\", "Ideas!", "[Inbox]", "(notes)")) {
            val chip = SearchQuery.format(SearchQualifier.Folder(name))
            assertEquals(listOf(SearchQualifier.Folder(name)), parse(chip).qualifiers, name)
        }
        for (tag in listOf(".net", "c++,", "ok?")) {
            assertEquals(listOf(tag), parse(SearchQuery.format(SearchQualifier.Tag(tag))).tags, tag)
        }
    }

    @Test
    fun `plain values stay unquoted`() {
        assertEquals("tag:design", SearchQuery.format(SearchQualifier.Tag("design")))
        assertEquals("folder:c++", SearchQuery.format(SearchQualifier.Folder("c++")))
    }

    @Test
    fun `a phrase with quotes round-trips through the canonical form`() {
        val parsed = parse("\"say \\\"hi\\\" there\"")
        assertEquals(listOf("say \"hi\" there"), parsed.phrases)
        assertEquals(listOf("say \"hi\" there"), parse(parsed.canonical).phrases)
    }

    @Test
    fun `the canonical form puts qualifiers first and shows Unicode hosts`() {
        assertEquals("is:fav site:例え.jp tag:design \"a b\" notes", parse("notes \"a b\" IS:FAV site:WWW.例え.jp #Design").canonical)
    }

    @Test
    fun `reads price bounds`() {
        val cases = listOf(
            Triple("price:<100", listOf(PriceBound(PriceComparison.Less, 100.0)), "price:<100"),
            Triple("PRICE:>20", listOf(PriceBound(PriceComparison.Greater, 20.0)), "price:>20"),
            Triple("price:<=9.99", listOf(PriceBound(PriceComparison.AtMost, 9.99)), "price:<=9.99"),
            Triple("price:>=010.50", listOf(PriceBound(PriceComparison.AtLeast, 10.5)), "price:>=10.5"),
            Triple("price:=0", listOf(PriceBound(PriceComparison.Equal, 0.0)), "price:=0"),
            Triple("price:\"<50\"", listOf(PriceBound(PriceComparison.Less, 50.0)), "price:<50"),
            Triple("price:<50,", listOf(PriceBound(PriceComparison.Less, 50.0)), "price:<50"),
            Triple(
                "price:>20 price:<100 price:>20",
                listOf(PriceBound(PriceComparison.Greater, 20.0), PriceBound(PriceComparison.Less, 100.0)),
                "price:>20 price:<100",
            ),
        )
        for ((input, prices, canonical) in cases) {
            val parsed = parse(input)
            assertEquals(prices, parsed.prices, input)
            assertEquals(emptyList(), parsed.terms, input)
            assertEquals(canonical, parsed.canonical, input)
            assertEquals(parsed.prices, parse(parsed.canonical).prices, input)
        }
    }

    @Test
    fun `malformed prices stay plain words`() {
        for (input in listOf("price:abc", "price:<", "price:<1e9", "price:<-5", "price:100", "price:<\$50", "price:<1,000", "price:=<5")) {
            val parsed = parse(input)
            assertEquals(emptyList(), parsed.prices, input)
            assertEquals(emptyList(), parsed.qualifiers, input)
            assertEquals(listOf(input), parsed.terms, input)
        }
    }

    @Test
    fun `a price bound is a filter, not words to search by meaning`() {
        val parsed = parse("desk lamp price:<50")
        assertEquals("desk lamp", parsed.text)
        assertEquals("desk lamp", SearchQuery.semanticText(parsed))
        assertEquals("", SearchQuery.semanticText(parse("price:<50")))
    }

    @Test
    fun `an empty search parses to nothing`() {
        val parsed = parse("   ")
        assertEquals(emptyList(), parsed.qualifiers)
        assertEquals(emptyList(), parsed.terms)
        assertEquals("", parsed.canonical)
    }

    @Test
    fun `text keeps its case and quotes, and is a filter`() {
        assertEquals("text:\"Total due\" text:4411 receipt", parse("receipt text:\"Total due\" text:4411").canonical)
        assertEquals("text:\"say \\\"hi\\\"\"", SearchQuery.format(SearchQualifier.Text("say \"hi\"")))
        assertEquals("", SearchQuery.semanticText(parse("text:invoice")))
    }

    @Test
    fun `combines a smart folder's search with typed words`() {
        val cases = listOf(
            Triple("tag:design", "tag:ui notes", "tag:design tag:ui notes"),
            Triple("folder:reading \"deep work\"", "is:fav", "folder:reading is:fav \"deep work\""),
            Triple("", "tag:x", "tag:x"),
            Triple("tag:x", "", "tag:x"),
            Triple("type:link type:image", "type:link", "type:link"),
            Triple("type:link", "type:link type:image", "type:link"),
            Triple("site:a.com site:b.com", "site:B.com", "site:b.com"),
            Triple("type:link", "site:a.com", "type:link site:a.com"),
            Triple("tag:x tag:x", "#X", "tag:x"),
            Triple("price:<100", "price:>20", "price:<100 price:>20"),
            Triple("price:<100", "price:<100 lamp", "price:<100 lamp"),
            Triple("type:link price:<100", "", "price:<100 type:link"),
            Triple("text:invoice", "text:4411 acme", "text:invoice text:4411 acme"),
            Triple("is:todo folder:\"Reading list\"", "is:done", "is:todo folder:\"Reading list\" is:done"),
        )
        for ((scope, typed, combined) in cases) assertEquals(combined, SearchQuery.combine(scope, typed), "$scope + $typed")
        assertNull(SearchQuery.combine("type:link", "type:image"))
        assertNull(SearchQuery.combine("site:a.com", "site:b.com"))
    }

    @Test
    fun `describes price bounds`() {
        val cases = listOf(
            "price:<100" to UiText.of("native.filters.price.under", "100"),
            "price:>1500" to UiText.of("native.filters.price.over", "1,500"),
            "price:<=9.99" to UiText.of("native.filters.price.atMost", "9.99"),
            "price:>=10" to UiText.of("native.filters.price.atLeast", "10"),
            "price:=0" to UiText.of("native.filters.price.exactly", "0"),
        )
        for ((query, label) in cases) {
            assertEquals(label, SearchQuery.describePriceBoundText(parse(query).prices.single(), Locale.US), query)
        }
        assertEquals(
            UiText.of("native.filters.price.over", "1.500"),
            SearchQuery.describePriceBoundText(parse("price:>1500").prices.single(), Locale.GERMANY),
        )
    }

    @Test
    fun `like and mood read one anchor`() {
        val id = "j979t50bv7gjxz2mazwwf5tes18gbvnt"
        val other = "j97a1vaafgzkxkzag6rb6wt0gs8gbq0x"
        val like = parse("like:$id type:link")
        assertEquals(SearchSimilarity.Like(id), like.similarity)
        assertEquals(emptyList(), like.terms)
        assertEquals("like:$id type:link", like.canonical)
        val mood = parse("MOOD:\"moody   brutalist\" #design")
        assertEquals(SearchSimilarity.Mood("moody brutalist"), mood.similarity)
        assertEquals("mood:\"moody brutalist\" tag:design", mood.canonical)

        val malformed = parse("like:not-a-card")
        assertNull(malformed.similarity)
        assertEquals(listOf("like:not-a-card"), malformed.terms)

        val two = parse("like:$id like:$other")
        assertEquals(SearchSimilarity.Like(id), two.similarity)
        assertEquals(listOf("like:$other"), two.terms)
        assertEquals(listOf("mood:calm"), parse("like:$id mood:calm").terms)
        assertEquals(emptyList(), parse("like:$id like:$id").terms)

        assertNull(SearchQuery.combine("like:$id", "like:$other"))
        assertNull(SearchQuery.combine("like:$id", "mood:calm"))
        assertEquals("like:$id chair", SearchQuery.combine("like:$id", "chair"))
        assertEquals("like:$id type:link", SearchQuery.combine("type:link", "like:$id"))
        assertEquals("mood:\"Calm Blue\"", SearchQuery.combine("mood:\"Calm  Blue\"", "mood:\"calm blue\""))
        assertEquals(emptyList(), parse("mood:Calm mood:calm").terms)
    }

    @Test
    fun `done and todo write the one canonical way`() {
        assertEquals("is:done is:todo lamp", parse("IS:Finished is:TO-DO lamp").canonical)
    }

    @Test
    fun `semantic text keeps free words and phrases, lowercased`() {
        fun text(query: String) = SearchQuery.semanticText(parse(query))
        assertEquals("cozy reading window seat", text("Cozy   Reading \"Window Seat\" tag:home"))
        assertEquals("", text("tag:design type:link is:fav site:github.com"))
        assertEquals("", text("folder:\"Reading list\" #ui"))
        assertEquals("", text("#ff0000 #fff"))
        assertEquals("", text("a"))
        assertEquals("", text(""))
        assertEquals("red poster", text("red #ff0000 poster"))
        assertEquals("bed cafe", text("bed cafe"))
        assertEquals(499, text("word ".repeat(400)).length)
    }

    @Test
    fun `asks for meaning only for free words or an anchor`() {
        val id = "j979t50bv7gjxz2mazwwf5tes18gbvnt"
        assertEquals(SemanticRequest.Like(id), SearchQuery.semanticRequest(parse("like:$id")))
        assertEquals(SemanticRequest.Mood("calm blue"), SearchQuery.semanticRequest(parse("mood:\"Calm  Blue\"")))
        assertEquals(SemanticRequest.Text("cozy chair"), SearchQuery.semanticRequest(parse("Cozy chair is:fav")))
        assertNull(SearchQuery.semanticRequest(parse("is:archived tag:x")))
    }

    @Test
    fun `chips name each filter like the web`() {
        val id = "j979t50bv7gjxz2mazwwf5tes18gbvnt"
        val chips = QualifierChips.of("is:archived is:done is:todo like:$id text:4411 price:<50 lamp", anchorTitle = "Desk")
        val show = UiText.of("native.filters.chips.is")
        assertEquals(
            listOf(
                show to UiText.of("native.filters.is.archived"),
                show to UiText.of("native.filters.is.done"),
                show to UiText.of("native.filters.is.todo"),
                UiText.of("native.filters.chips.like") to UiText.verbatim("Desk"),
                UiText.of("native.filters.chips.text") to UiText.verbatim("4411"),
                UiText.of("native.filters.chips.price") to SearchQuery.describePriceBoundText(PriceBound(PriceComparison.Less, 50.0)),
            ),
            chips.map { it.titleText to it.labelText },
        )
        assertEquals(
            listOf(UiText.of("native.filters.chips.mood") to UiText.of("native.filters.chips.moodValue", "calm")),
            QualifierChips.of("mood:calm").map { it.titleText to it.labelText },
        )
        assertEquals(UiText.of("native.filters.chips.anyCard"), QualifierChips.of("like:$id").single().labelText)
        assertEquals(UiText.of("native.filters.removeChip.is", UiText.of("native.filters.is.archived")), chips.first().removeText)
        assertEquals("is:todo lamp", QualifierChips.remove("is:done is:todo lamp", SearchQualifier.Is(SearchIsValue.Done)))
        assertEquals("is:done lamp", QualifierChips.add("lamp", SearchQualifier.Is(SearchIsValue.Done)))
        assertEquals("is:done lamp", QualifierChips.add("is:done lamp", SearchQualifier.Is(SearchIsValue.Done)))
    }

    /** The same cases as Apple's `findsOperators`. */
    @Test
    fun `finds search operators outside quotes`() {
        val cases = listOf(
            "design -figma" to true, "tag:fonts OR tag:type" to true, "(a b)" to true, "-\"a b\"" to true, "x OR" to true,
            "to-do 2024-06-05" to false, "a - b" to false, "tag:fonts or tag:type" to false, "\"a OR (b)\"" to false,
            "site:github.com" to false, "ORANGE" to false,
        )
        for ((text, expected) in cases) assertEquals(expected, SearchQuery.hasOperators(text), text)
    }

    @Test
    fun `search text with operators keeps its chips and grouping as typed`() {
        val done = SearchQualifier.Is(SearchIsValue.Done)
        for (text in listOf("design -figma", "tag:fonts OR tag:type", "(site:github.com OR site:gitlab.com) -is:archived")) {
            assertEquals(emptyList(), QualifierChips.of(text), text)
        }
        assertEquals("is:done (tag:fonts OR tag:type)", QualifierChips.add("tag:fonts OR tag:type", done))
        assertEquals("is:done design -figma", QualifierChips.add("design -figma", done))
        assertEquals("design -figma", QualifierChips.remove("is:done design -figma", done))
        assertEquals("-is:done a", QualifierChips.remove("-is:done a", done))
        assertEquals("type:link (a OR b)", LibraryFilters(types = listOf(CardType.Link)).smartFolderQuery("a OR b"))
        assertEquals("a OR b", SearchQuery.join(listOf("a OR b")))
    }

    @Test
    fun `a date beside words keeps the words`() {
        val zone = java.time.ZoneId.of("America/New_York")
        val now = java.time.ZonedDateTime.of(2026, 2, 3, 12, 0, 0, 0, zone)
        val split = SearchQuery.splitDate("figma last week", now, Locale.US)!!
        assertEquals("figma", split.rest)
        assertEquals(TimeSearch.parse("last week", now, Locale.US)!!.range, split.filter.range)
        assertEquals("tag:x \"a b\"", SearchQuery.splitDate("tag:x yesterday \"a b\"", now, Locale.US)!!.rest)
        assertEquals("", SearchQuery.splitDate("last week", now, Locale.US)!!.rest)
        assertNull(SearchQuery.splitDate("iphone 2024", now, Locale.US))
        assertNull(SearchQuery.splitDate("-figma last week", now, Locale.US))
        assertNull(SearchQuery.splitDate("figma", now, Locale.US))
    }
}
