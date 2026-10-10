import Foundation
import Testing
@testable import TeakCore

// Ported from apps/mobile/__tests__/lib/{card-sheet,card-edit,markdown-blocks,
// save-link,createCardFromText,files}.test.ts.

private func card(_ type: CardType, content: String = "", url: String? = nil, notes: String? = nil,
                  tags: [String]? = nil, aiTags: [String]? = nil, colors: [CardColor]? = nil,
                  file: FileMetadata? = nil, fileUrl: String? = nil, thumbnailUrl: String? = nil,
                  detailUrl: String? = nil, metadataTitle: String? = nil, description: String? = nil) -> Card {
    Card(id: "card1", creationTime: 1_782_000_000_000, type: type, content: content, url: url, notes: notes,
         tags: tags, aiTags: aiTags, metadataTitle: metadataTitle, metadataDescription: description,
         colors: colors, fileMetadata: file, fileUrl: fileUrl, detailUrl: detailUrl, thumbnailUrl: thumbnailUrl)
}

@Suite struct CardSheetTests {
    @Test func formatsByteCounts() {
        #expect([0, 512, 2048, 1_572_864, 2_147_483_648].map(CardSheet.formatFileSize)
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

    @Test func namesDownloadsSafely() {
        #expect(CardSheet.downloadFileName(url: "https://files.example/a", fallback: "photo.jpg") == "photo.jpg")
        #expect(CardSheet.downloadFileName(url: "https://files.example/uploads/report.pdf") == "report.pdf")
        #expect(CardSheet.downloadFileName(
            url: "https://files.example/files/image/grid/users%2Fabc%2Ffile%2Fuuid-photo.heic?exp=1&sig=2")
            == "uuid-photo.heic")
        #expect(CardSheet.downloadFileName(url: nil).wholeMatch(of: /download-\d+/) != nil)
        #expect(CardSheet.downloadFileName(url: "not a url").wholeMatch(of: /download-\d+/) != nil)
        #expect(CardSheet.downloadFileName(url: nil, fallback: "../../etc/passwd") == ".._.._etc_passwd")
        #expect(CardSheet.downloadFileName(url: nil, fallback: "..").wholeMatch(of: /download-\d+/) != nil)
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

@Suite struct CardEditTests {
    private let original = card(.text, content: "Original", notes: "Old notes", tags: ["keep"], aiTags: ["Design", "Color"])

    @Test func anUntouchedFormSavesNothing() {
        #expect(CardEdit.changes(from: original, to: CardEdit.draft(for: original)).isEmpty)
    }

    @Test func turnsEachEditIntoTheFieldUpdateTheWebMakes() {
        let draft = CardEditDraft(content: "Rewritten", notes: "  ", tags: ["keep", "new"], aiTags: ["Design"])
        #expect(CardEdit.changes(from: original, to: draft)
            == [.content("Rewritten"), .notes(nil), .tags(["keep", "new"]), .removeAiTag("Color")])
        #expect(CardFieldChange.notes(nil).args(cardId: "c") == ["cardId": "c", "field": "notes", "value": nil])
        #expect(CardFieldChange.removeAiTag("Color").args(cardId: "c")
            == ["cardId": "c", "field": "removeAiTag", "tagToRemove": "Color"])
    }

    @Test func leavesContentAloneForTypesThatCantBeRewritten() {
        let link = card(.link, content: "x", notes: "Old notes", tags: ["keep"], aiTags: ["Design", "Color"])
        #expect(CardEdit.draft(for: link).content == nil)
        #expect(CardEdit.changes(from: link, to: CardEdit.draft(for: link)).isEmpty)
    }

    @Test func tagsAreTrimmedLowercaseAndUnique() {
        #expect(CardEdit.normalizeTag("  Inspiration ") == "inspiration")
        #expect(CardEdit.adding("Moodboard, keep ,", to: ["keep"]) == ["keep", "moodboard"])
    }

    @Test func rejectsAnEmptyQuote() {
        let quote = card(.quote, content: "To be")
        var draft = CardEdit.draft(for: quote)
        draft.content = "  "
        #expect(CardEdit.validationError(for: quote, draft: draft) != nil)
    }
}

@Suite struct MarkdownBlockTests {
    @Test func splitsANoteIntoTheBlocksTheWebShows() {
        let note = ["# Trip plan", "", "- Book **train** tickets", "  - Window seat", "1. Pack", "",
                    "> Leave early.", "> Really.", "", "---", "", "```", "# not a heading", "```",
                    "Plain line one", "line two #travel"].joined(separator: "\n")
        #expect(MarkdownBlocks.parse(note) == [
            .heading(level: 1, text: "Trip plan"),
            .list([MarkdownListItem(depth: 0, marker: "•", text: "Book **train** tickets"),
                   MarkdownListItem(depth: 1, marker: "•", text: "Window seat"),
                   MarkdownListItem(depth: 0, marker: "1.", text: "Pack")]),
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

@Suite struct TextInputTests {
    @Test func keepsRawMarkdownForNotes() {
        let content = "\u{FEFF}  # Mobile\r\n\r\n- [ ] task  \n"
        let resolved = LinkDetection.resolve(content)
        #expect(resolved == TextCardInput(content: content, type: .text, url: nil))
        #expect(resolved.createArgs == ["content": .string(content)])
    }

    @Test func savesAURLAsALinkCard() {
        let resolved = LinkDetection.resolve("https://example.com")
        #expect(resolved.createArgs == ["content": "https://example.com", "type": "link", "url": "https://example.com"])
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

@Suite struct FileFormatTests {
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
