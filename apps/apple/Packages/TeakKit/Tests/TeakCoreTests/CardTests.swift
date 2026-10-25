import Foundation
import Testing
@testable import TeakCore

private func card(_ type: CardType, content: String = "", url: String? = nil, notes: String? = nil,
                  tags: [String]? = nil, aiTags: [String]? = nil, colors: [CardColor]? = nil,
                  file: FileMetadata? = nil, fileUrl: String? = nil, thumbnailUrl: String? = nil,
                  detailUrl: String? = nil, metadataTitle: String? = nil, description: String? = nil) -> Card {
    Card(id: "card1", creationTime: 1_782_000_000_000, type: type, content: content, url: url, notes: notes,
         tags: tags, aiTags: aiTags, metadataTitle: metadataTitle, metadataDescription: description,
         colors: colors, fileMetadata: file, fileUrl: fileUrl, detailUrl: detailUrl, thumbnailUrl: thumbnailUrl)
}

@Suite(.english) struct CardSheetTests {
    @Test func formatsByteCounts() {
        #expect([0, 512, 2048, 1_572_864, 2_147_483_648].map { CardSheet.formatFileSize($0) }
            == ["0 B", "512 B", "2 KB", "1.5 MB", "2 GB"])
    }

    @Test func labelsTheTypeAndWebsite() {
        let rows = CardSheet.detailRows(card(.link, url: "https://www.example.com/some/path?query=1"))
        #expect(rows.contains(DetailRow("Type", "Link")))
        #expect(rows.contains(DetailRow("Website", "example.com")))
    }

    @Test func includesFileFactsDimensionsAndDuration() {
        let document = CardSheet.detailRows(card(.document, file: FileMetadata(fileSize: 2048, fileName: "deck.pdf",
                                                                            mimeType: "application/pdf")))
        #expect(document.contains(DetailRow("File", "deck.pdf")))
        #expect(document.contains(DetailRow("Format", "application/pdf")))
        #expect(document.contains(DetailRow("Size", "2 KB")))
        let video = CardSheet.detailRows(card(.video, file: FileMetadata(duration: 65, width: 1920, height: 1080)))
        #expect(video.contains(DetailRow("Dimensions", "1920 × 1080")))
        #expect(video.contains(DetailRow("Duration", "1:05")))
    }

    @Test func omitsEmptyRowsAndFactsThatRepeatTheType() {
        #expect(CardSheet.detailRows(card(.text)) == [DetailRow("Type", "Text")])
        let image = CardSheet.detailRows(card(.image, file: FileMetadata(fileName: "photo.jpg", kind: "image")))
        #expect(!image.contains { $0.label == "Details" })
        #expect(CardSheet.detailRows(card(.link, url: "https://example.com", description: "A great read."))
            .contains(DetailRow("Description", "A great read.")))
    }

    @Test func showsCompactFactsForArchivesOfficeAndSource() {
        let archive = card(.document, file: FileMetadata(fileName: "bundle.zip", kind: "archive",
                                                         preview: FilePreviewFacts(archiveFileCount: 4, archiveDirectoryCount: 2)))
        #expect(CardSheet.fileFacts(archive) == ["archive", "4 files", "2 folders"])
        let deck = card(.document, file: FileMetadata(fileName: "deck.pptx", kind: "office",
                                                      preview: FilePreviewFacts(slideCount: 3)))
        #expect(CardSheet.fileFacts(deck) == ["office", "3 slides"])
        let source = card(.document, file: FileMetadata(fileName: "component.tsx", kind: "source", language: "tsx"))
        #expect(CardSheet.fileFacts(source) == ["tsx", "source"])
        #expect(CardSheet.documentSummary(card(.document, file: FileMetadata(fileSize: 4_823_449, fileName: "a.pdf",
                                                                            mimeType: "application/pdf")))
            == "PDF · 4.6 MB")
    }

    @Test func copiesWhatEachTypeMeans() {
        #expect(CardSheet.copyText(card(.text, content: "hello")) == "hello")
        #expect(CardSheet.copyText(card(.quote, content: "to be")) == "to be")
        #expect(CardSheet.copyText(card(.link, url: "https://example.com")) == "https://example.com")
        #expect(CardSheet.copyText(card(.palette, colors: [CardColor(hex: "#ff0000"), CardColor(hex: "#00ff00")]))
            == "#ff0000, #00ff00")
        #expect(CardSheet.copyText(card(.image)) == nil)
        #expect(CardSheet.copyText(card(.text, content: "   ")) == nil)
        #expect(CardSheet.copyText(card(.link, content: "note")) == "note")
    }

    @Test func knowsAPDFByItsTypeOrItsName() {
        #expect(CardSheet.isPDF(card(.document, file: FileMetadata(mimeType: "application/pdf"))))
        #expect(CardSheet.isPDF(card(.document, file: FileMetadata(fileName: "Deck.PDF"))))
        #expect(!CardSheet.isPDF(card(.document, file: FileMetadata(fileName: "notes.md", mimeType: "text/markdown"))))
        #expect(!CardSheet.isPDF(card(.document)))
    }

    @Test func namesDownloadsSafely() {
        #expect(CardSheet.downloadFileName(url: "https://files.example/a", savedName: "photo.jpg") == "photo.jpg")
        #expect(CardSheet.downloadFileName(url: "https://files.example/uploads/report.pdf") == "report.pdf")
        #expect(CardSheet.downloadFileName(
            url: "https://files.example/files/image/grid/users%2Fabc%2Ffile%2Fuuid-photo.heic?exp=1&sig=2")
            == "uuid-photo.heic")
        #expect(CardSheet.downloadFileName(url: nil).wholeMatch(of: /download-\d+/) != nil)
        #expect(CardSheet.downloadFileName(url: "not a url").wholeMatch(of: /download-\d+/) != nil)
        #expect(CardSheet.downloadFileName(url: nil, savedName: "../../etc/passwd") == ".._.._etc_passwd")
        #expect(CardSheet.downloadFileName(url: nil, savedName: "..").wholeMatch(of: /download-\d+/) != nil)
        #expect(CardSheet.downloadFileName(url: nil, mimeType: "image/jpeg").wholeMatch(of: /download-\d+\.jpg/) != nil)
        #expect(CardSheet.downloadFileName(url: nil, mimeType: "unknown/type").wholeMatch(of: /download-\d+/) != nil)
    }

    @Test func sharesTextLinksAndOriginalFiles() {
        #expect(CardSheet.shareTarget(card(.link, url: "https://example.com")) == .text("https://example.com", subject: nil))
        #expect(CardSheet.shareTarget(card(.link, url: "https://example.com", metadataTitle: "Example"))
            == .text("https://example.com", subject: "Example"))
        #expect(CardSheet.shareTarget(card(.text, content: "hi")) == .text("hi", subject: nil))
        #expect(CardSheet.shareTarget(card(.palette, colors: [CardColor(hex: "#ff0000")])) == .text("#ff0000", subject: nil))
        #expect(CardSheet.shareTarget(card(.image)) == ShareTarget.none)
        #expect(CardSheet.shareTarget(card(.image, file: FileMetadata(fileName: "photo.jpg"),
                                           fileUrl: "https://files.example/photo.jpg"))
            == .file(url: URL(string: "https://files.example/photo.jpg")!, fileName: "photo.jpg", mimeType: nil))
        #expect(CardSheet.shareTarget(card(.image, file: FileMetadata(fileName: "photo.heic"),
                                           thumbnailUrl: "https://files.example/thumb.jpg"))
            == .file(url: URL(string: "https://files.example/thumb.jpg")!, fileName: "thumb.jpg", mimeType: nil))
        #expect(CardSheet.shareTarget(card(.video, file: FileMetadata(fileName: "clip.mp4"),
                                           thumbnailUrl: "https://files.example/thumb.jpg")) == ShareTarget.none)
    }

    @Test func routesHEICAndSVGThroughRenditions() {
        for name in ["vector.svg", "photo.heic"] {
            let urls = CardSheet.imageURLs(card(.image, file: FileMetadata(fileName: name),
                                                fileUrl: "https://files.example/original",
                                                thumbnailUrl: "https://files.example/thumbnail.jpg"))
            #expect(urls == [URL(string: "https://files.example/thumbnail.jpg")!])
        }
        #expect(CardSheet.imageURLs(card(.image, file: FileMetadata(fileName: "photo.heic"),
                                         fileUrl: "https://files.example/original")).isEmpty)
        #expect(CardSheet.imageURLs(card(.image, file: FileMetadata(fileName: "photo.heic"),
                                         fileUrl: "https://files.example/original",
                                         detailUrl: "https://files.example/detail.webp")).first
            == URL(string: "https://files.example/detail.webp"))
        #expect(CardSheet.isAnimatedGIF(card(.image, file: FileMetadata(fileName: "motion.gif"))))
    }

    @Test func titlesNotesAndQuotesByType() {
        #expect(CardSheet.title(card(.text, metadataTitle: "x")) == "Note")
        #expect(CardSheet.title(card(.quote)) == "Quote")
        #expect(CardSheet.title(card(.document, file: FileMetadata(fileName: "deck.pdf"))) == "deck.pdf")
        #expect(CardSheet.title(card(.image), fallback: "Cached") == "Cached")
        #expect(CardSheet.title(card(.palette)) == "Palette")
    }

    @Test func refusesUnsafeLinks() {
        #expect(SafeURL.sanitize("javascript:alert(1)") == nil)
        #expect(SafeURL.sanitize("file:///etc/passwd") == nil)
        #expect(SafeURL.sanitize(" https://example.com/a ") == URL(string: "https://example.com/a"))
    }
}

@Suite(.english) struct CardEditTests {
    private let original = card(.text, content: "Original", notes: "Old notes", tags: ["keep"], aiTags: ["Design", "Color"])

    @Test func anUntouchedFormSavesNothing() {
        #expect(CardEdit.changes(from: original, to: CardEdit.draft(for: original)).isEmpty)
    }

    @Test func turnsEachEditIntoTheFieldUpdateTheWebMakes() {
        let draft = CardEditDraft(editableContent: "Rewritten", notes: "  ", tags: ["keep", "new"], aiTags: ["Design"])
        #expect(CardEdit.changes(from: original, to: draft)
            == [.content("Rewritten"), .notes(nil), .tags(["keep", "new"]), .removeAiTag("Color")])
        #expect(CardFieldChange.notes(nil).args(cardId: "c") == ["cardId": "c", "field": "notes", "value": nil])
        #expect(CardFieldChange.removeAiTag("Color").args(cardId: "c")
            == ["cardId": "c", "field": "removeAiTag", "tagToRemove": "Color"])
    }

    @Test func leavesContentAloneForTypesThatCantBeRewritten() {
        let link = card(.link, content: "x", notes: "Old notes", tags: ["keep"], aiTags: ["Design", "Color"])
        #expect(CardEdit.draft(for: link).editableContent == nil)
        #expect(CardEdit.changes(from: link, to: CardEdit.draft(for: link)).isEmpty)
    }

    @Test func tagsAreTrimmedLowercaseAndUnique() {
        #expect(CardEdit.normalizeTag("  Inspiration ") == "inspiration")
        #expect(CardEdit.adding("Moodboard, keep ,", to: ["keep"]) == ["keep", "moodboard"])
    }

    @Test func rejectsAnEmptyQuote() {
        let quote = card(.quote, content: "To be")
        var draft = CardEdit.draft(for: quote)
        draft.editableContent = "  "
        #expect(CardEdit.validationError(for: quote, draft: draft) != nil)
    }

    @Test func keepingASuggestedTagWritesTheTagsPlusIt() {
        let keep = CardEdit.keeping("macro", tags: ["flowers"])
        #expect(keep == .tags(["flowers", "macro"]))
        #expect(keep?.args(cardId: "c") == ["cardId": "c", "field": "tags", "value": ["flowers", "macro"]])
        #expect(CardEdit.keeping("Macro", tags: ["macro"]) == nil)
        #expect(CardFieldChange.removeAiTag("macro").args(cardId: "c")
            == ["cardId": "c", "field": "removeAiTag", "tagToRemove": "macro"])
    }

    @Test func suggestsTeakTagsTheCardDoesNotHave() {
        let tagged = card(.image, tags: ["design"], aiTags: ["Design", "Color", " "])
        #expect(CardEdit.suggestedTags(tagged) == ["Color"])
        #expect(CardEdit.suggestedTags(card(.image)).isEmpty)
    }

    @Test func undoAfterTrashRestoresTheCard() {
        #expect(CardFieldChange.moveToTrash.args(cardId: "c") == ["cardId": "c", "field": "delete"])
        #expect(CardFieldChange.restore.args(cardId: "c") == ["cardId": "c", "field": "restore"])
    }

    @Test func savesATypedLinkTitleUnlessBlankOrUnchanged() {
        let change = CardEdit.titleChange("  Field notes ", current: "Example")
        #expect(change == .metadataTitle("Field notes"))
        #expect(change?.args(cardId: "c") == ["cardId": "c", "field": "metadataTitle", "value": "Field notes"])
        #expect(CardEdit.titleChange("   ", current: "Example") == nil)
        #expect(CardEdit.titleChange("Example ", current: "Example") == nil)
    }

    @Test func showsATypedLinkTitleBeforeThePagesOwn() {
        var link = card(.link, url: "https://example.com", metadataTitle: "Typed")
        link.metadata = CardMetadata(linkPreview: LinkPreview(status: "success", title: "From the page"))
        #expect(CardSheet.linkTitle(link) == "From the page")
        link.metadataTitleEdited = true
        #expect(CardSheet.linkTitle(link) == "Typed")
    }
}

@Suite(.english) struct LinkEditTests {
    private let invalid = "Use an http or https link."

    @Test(arguments: ["https://example.com", "  http://teak.dev/a?b=1#c  ", "HTTPS://Example.com",
                      "https://me@example.com:8080/x", "https://bücher.de"])
    func acceptsHttpAndHttpsLinks(_ input: String) {
        #expect(LinkEdit.validationError(input) == nil)
    }

    @Test(arguments: ["", "example.com", "ftp://example.com", "javascript:alert(1)", "https://",
                      "https://exa mple.com", "https://:80"])
    func refusesAnythingElseWithTheServersMessage(_ input: String) {
        #expect(LinkEdit.validationError(input) == invalid)
        #expect(LinkEdit.change(input, current: "https://example.com") == nil)
    }

    @Test func savesANewAddressTrimmed() {
        let change = LinkEdit.change("  https://example.org/new ", current: "https://example.com")
        #expect(change == .url("https://example.org/new"))
        #expect(change?.args(cardId: "c") == ["cardId": "c", "field": "url", "value": "https://example.org/new"])
        #expect(LinkEdit.change("https://example.com", current: "https://example.com") == nil)
    }
}

@Suite(.english) struct EmptyTrashTests {
    @Test func confirmationCountsTheCards() {
        #expect(EmptyTrash.message(count: 1, more: false) == "This permanently deletes 1 card and their files. This can’t be undone.")
        #expect(EmptyTrash.message(count: 3, more: false) == "This permanently deletes 3 cards and their files. This can’t be undone.")
        // The count stops early on large notes and says so.
        #expect(EmptyTrash.message(count: 40, more: true)
            == "This permanently deletes 40 or more cards and their files. This can’t be undone.")
    }

    @Test func saysWhatTheServerWillDelete() {
        #expect(EmptyTrash.done(TrashCount(count: 5, more: false)) == "Deleting 5 cards forever")
        #expect(EmptyTrash.done(TrashCount(count: 40, more: true)) == "Deleting at least 40 cards forever")
        #expect(EmptyTrash.done(TrashCount(count: 0, more: false)) == "Trash is already empty")
    }

    @Test func wordsTheServersLimitInTheAppsLanguage() {
        let limited = TeakError(code: "RATE_LIMITED", message: "Trash was emptied a few times just now. Try again in a minute.")
        #expect(EmptyTrash.failure(limited) == "Trash was emptied a few times just now. Try again in a minute.")
        #expect(EmptyTrash.failure(TeakError(code: nil, message: "Offline")) == "Offline")
        #expect(EmptyTrash.failure(CancellationError()) == "Couldn’t empty Trash. Try again.")
    }
}

@Suite(.english) struct MarkdownBlockTests {
    @Test func splitsANoteIntoTheBlocksTheWebShows() {
        let note = ["# Trip plan", "", "- Book **train** tickets", "  - Window seat", "1. Pack", "",
                    "> Leave early.", "> Really.", "", "---", "", "```", "# not a heading", "```",
                    "Plain line one", "line two #travel"].joined(separator: "\n")
        #expect(MarkdownBlocks.parse(note) == [
            .heading(level: 1, text: "Trip plan"),
            .list([MarkdownListItem(depth: 0, marker: "•", text: "Book **train** tickets", line: 2),
                   MarkdownListItem(depth: 1, marker: "•", text: "Window seat", line: 3),
                   MarkdownListItem(depth: 0, marker: "1.", text: "Pack", line: 4)]),
            .quote("Leave early.\nReally."),
            .rule,
            .code("# not a heading"),
            .paragraph("Plain line one\nline two #travel"),
        ])
    }

    @Test func leavesHashtagsAsAParagraph() {
        #expect(MarkdownBlocks.parse("#tag is not a heading\r\nnext") == [.paragraph("#tag is not a heading\nnext")])
    }

    @Test func plainTextDropsMarkers() {
        #expect(MarkdownBlocks.plainText("## Hello **world**\n- [link](https://x.y)") == "Hello world\n• link")
    }
}

@Suite(.english) struct TextInputTests {
    @Test func keepsRawMarkdownForNotes() {
        let content = "\u{FEFF}  # Mobile\r\n\r\n- [ ] task  \n"
        let resolved = LinkDetection.resolve(content)
        #expect(resolved == TextCardInput(content: content, type: .text, url: nil))
        #expect(resolved.createArgs == ["content": .string(content), "source": "apple"])
    }

    @Test func savesAURLAsALinkCard() {
        let resolved = LinkDetection.resolve("https://example.com")
        #expect(resolved.createArgs == ["content": "https://example.com", "type": "link", "url": "https://example.com",
                                        "source": "apple"])
        #expect(LinkDetection.resolve("see https://example.com/a?b=1 later").url == "https://example.com/a?b=1")
        #expect(LinkDetection.resolve("ftp://example.com").type == .text)
    }

    @Test func readsSaveLinksFromTheRawURL() {
        let text = "# Trip plan\n\n- Salt & pepper = 100% #food + more?"
        let encoded = text.addingPercentEncoding(withAllowedCharacters: .alphanumerics)!
        #expect(SaveLink.text(from: "teak://save?text=\(encoded)") == text)
        #expect(SaveLink.text(from: "teak://save?from=shortcut&text=hello+world") == "hello world")
        #expect(SaveLink.text(from: nil) == "")
        #expect(SaveLink.text(from: "teak://save") == "")
        #expect(SaveLink.text(from: "teak://save?text=%20%20") == "")
        #expect(SaveLink.text(from: "teak://save?text=%E0%A4%A") == "")
    }
}

@Suite(.english) struct FileFormatTests {
    @Test func fillsInAMissingMimeTypeFromTheName() {
        #expect(FileFormats.uploadMimeType(fileName: "component.tsx", mimeType: "application/octet-stream") == "text/tsx")
        #expect(FileFormats.uploadMimeType(fileName: "voice.m4a", mimeType: nil) != nil)
    }

    @Test(arguments: ["readme.mdx", "archive.zip", "photo.heic", "vector.svg", "motion.gif", "deck.pptx", "design.fig"])
    func acceptsRepresentativeFormats(name: String) {
        #expect(FileFormats.infer(fileName: name) != nil)
    }

    @Test func rejectsUnsupportedFormatsAndMismatchedTypes() {
        #expect(FileFormats.infer(fileName: "animation.riv") == nil)
        #expect(FileFormats.infer(fileName: "photo.jpg", mimeType: "application/pdf") == nil)
        #expect(FileFormats.infer(fileName: "../x.png") == nil)
        #expect(FileFormats.infer(fileName: "clip", mimeType: "video/mp4")?.cardType == "video")
    }

    @Test func picksTheAudioOrVideoFlavorFromTheMimeType() {
        #expect(FileFormats.infer(fileName: "memo.mp4", mimeType: "audio/mp4")?.type == .audio)
        #expect(FileFormats.infer(fileName: "clip.mp4", mimeType: "video/mp4")?.type == .video)
    }
}

@Suite(.english) struct CardDecodingTests {
    @Test func decodesACardMarkedDoneInACategoryItDoesNotKnow() throws {
        let json = """
        {
          "_id": "card_1",
          "_creationTime": 1782000000000,
          "type": "link",
          "content": "https://example.com/game",
          "url": "https://example.com/game",
          "completedAt": 1782000500000,
          "metadata": {
            "linkCategory": {
              "category": "a-category-from-the-future",
              "fetchedAt": 1,
              "sourceUrl": "https://example.com/game"
            }
          }
        }
        """
        let card = try JSONDecoder().decode(Card.self, from: Data(json.utf8))
        #expect(card.id == "card_1")
        #expect(card.metadata?.linkCategory?.category == "a-category-from-the-future")
    }
}
