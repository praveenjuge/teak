import {
  Button,
  ContentUnavailableView,
  Form,
  Host,
  HStack,
  Image,
  ProgressView,
  Section,
  Spacer,
  Text,
  TextField,
  type TextFieldRef,
  useNativeState,
} from "@expo/ui/swift-ui";
import {
  autocorrectionDisabled,
  font,
  labelStyle,
  lineLimit,
  onSubmit,
  scrollDismissesKeyboard,
  submitLabel,
  textInputAutocapitalization,
} from "@expo/ui/swift-ui/modifiers";
import { api } from "@teak/convex";
import type { Id } from "@teak/convex/_generated/dataModel";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import { buildCardEdit, normalizeTag } from "@/lib/card-edit";
import {
  triggerSuccessHaptic,
  triggerValidationErrorHaptic,
} from "@/lib/haptics";

const rounded = font({ design: "rounded" });
const removeLabel = labelStyle("iconOnly");

/**
 * Edit a card the way the web does: rewrite text and quote cards, change
 * notes and tags, and remove tags Teak added.
 */
export default function EditCardScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const card = useQuery(api.cards.getCard, { id: id as Id<"cards"> });
  const updateCardField = useMutation(api.cards.updateCardField);

  const [content, setContent] = useState<string | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const [tags, setTags] = useState<string[] | null>(null);
  const [aiTags, setAiTags] = useState<string[] | null>(null);
  const [newTag, setNewTag] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const contentState = useNativeState("");
  const notesState = useNativeState("");
  const newTagState = useNativeState("");
  const newTagRef = useRef<TextFieldRef>(null);

  // Seed the fields once, from the card as it was when the screen opened.
  useEffect(() => {
    if (card && tags === null) {
      setContent(card.content ?? "");
      setNotes(card.notes ?? "");
      setTags(card.tags ?? []);
      setAiTags(card.aiTags ?? []);
      contentState.value = card.content ?? "";
      notesState.value = card.notes ?? "";
    }
  }, [card, contentState, notesState, tags]);

  if (card === undefined || (card && tags === null)) {
    return (
      <Host style={{ flex: 1 }}>
        <ProgressView />
      </Host>
    );
  }
  if (!card) {
    return (
      <Host style={{ flex: 1 }}>
        <ContentUnavailableView
          description="It may have been deleted."
          systemImage="exclamationmark.triangle"
          title="Card unavailable"
        />
      </Host>
    );
  }

  const canEditContent = card.type === "text" || card.type === "quote";
  const edit = buildCardEdit(card, {
    aiTags: aiTags ?? [],
    content: canEditContent ? (content ?? "") : undefined,
    notes: notes ?? "",
    tags: tags ?? [],
  });

  const addTag = () => {
    const tag = normalizeTag(newTag);
    if (!tag || tags?.includes(tag)) {
      return;
    }
    setTags([...(tags ?? []), tag]);
    setNewTag("");
    void newTagRef.current?.setText("");
  };

  const save = async () => {
    if (isSaving) {
      return;
    }
    if (canEditContent && card.type === "quote" && !content?.trim()) {
      Alert.alert("Quote is empty", "Write the quote before saving.");
      return;
    }
    setIsSaving(true);
    try {
      for (const change of edit.changes) {
        await updateCardField({ cardId: card._id, ...change });
      }
      void triggerSuccessHaptic();
      router.back();
    } catch (error) {
      void triggerValidationErrorHaptic();
      Alert.alert(
        "Couldn't save changes",
        error instanceof Error ? error.message : "Please try again."
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      {/* Unsaved edits block swipe-to-dismiss, so they're never lost by accident. */}
      <Stack.Screen
        options={{ gestureEnabled: !edit.hasChanges, title: "Edit Card" }}
      />
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button onPress={() => router.back()}>
          Cancel
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button
          disabled={!edit.hasChanges || isSaving}
          onPress={() => void save()}
          variant="done"
        >
          {isSaving ? "Saving…" : "Save"}
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
      <Host style={{ flex: 1 }}>
        <Form modifiers={[scrollDismissesKeyboard("interactively")]}>
          {canEditContent ? (
            <Section title={card.type === "quote" ? "Quote" : "Note"}>
              <TextField
                axis="vertical"
                modifiers={[rounded, lineLimit({ min: 4, max: 30 })]}
                onTextChange={setContent}
                placeholder={
                  card.type === "quote" ? "Write the quote" : "Write a note"
                }
                text={contentState}
              />
            </Section>
          ) : null}
          <Section title="Notes">
            <TextField
              axis="vertical"
              modifiers={[rounded, lineLimit({ min: 2, max: 12 })]}
              onTextChange={setNotes}
              placeholder="Add notes"
              text={notesState}
            />
          </Section>
          <Section title="Tags">
            {(tags ?? []).map((tag) => (
              <HStack key={tag}>
                <Text modifiers={[rounded]}>{tag}</Text>
                <Spacer />
                {/* biome-ignore lint/a11y/useValidAriaRole: expo-ui Button role maps to SwiftUI, not DOM ARIA */}
                <Button
                  label={`Remove ${tag}`}
                  modifiers={[removeLabel]}
                  onPress={() =>
                    setTags((current) =>
                      (current ?? []).filter((value) => value !== tag)
                    )
                  }
                  role="destructive"
                  systemImage="minus.circle.fill"
                />
              </HStack>
            ))}
            <HStack>
              <TextField
                modifiers={[
                  rounded,
                  textInputAutocapitalization("never"),
                  autocorrectionDisabled(true),
                  submitLabel("done"),
                  onSubmit(addTag),
                ]}
                onTextChange={setNewTag}
                placeholder="Add a tag"
                ref={newTagRef}
                text={newTagState}
              />
              <Button label="Add" onPress={addTag} />
            </HStack>
          </Section>
          {(card.aiTags ?? []).length > 0 ? (
            <Section
              footer={
                <Text modifiers={[rounded]}>
                  Remove any tags that don't fit this card.
                </Text>
              }
              title="Tags by Teak"
            >
              {(aiTags ?? []).map((tag) => (
                <HStack key={tag}>
                  <Image color="secondary" size={13} systemName="sparkles" />
                  <Text modifiers={[rounded]}>{tag}</Text>
                  <Spacer />
                  {/* biome-ignore lint/a11y/useValidAriaRole: expo-ui Button role maps to SwiftUI, not DOM ARIA */}
                  <Button
                    label={`Remove ${tag}`}
                    modifiers={[removeLabel]}
                    onPress={() =>
                      setAiTags((current) =>
                        (current ?? []).filter((value) => value !== tag)
                      )
                    }
                    role="destructive"
                    systemImage="minus.circle.fill"
                  />
                </HStack>
              ))}
            </Section>
          ) : null}
        </Form>
      </Host>
    </>
  );
}
