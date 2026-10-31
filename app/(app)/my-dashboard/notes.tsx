"use client";

import { useState, useTransition } from "react";
import { CheckIcon, PinIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { createNote, deleteNote, setNoteItems, setNotePinned, updateNote } from "@/features/core/notes/actions";
import { NOTE_COLOURS, type NoteColour, type NoteItem } from "@/features/core/notes/schemas";

export interface NoteRow {
  id: string;
  title: string;
  body: string;
  items: NoteItem[];
  colour: NoteColour;
  pinned: boolean;
}

/**
 * The colours a note can be. Each is a pale card that still reads in dark mode
 * — a sticky note's whole job is to be findable at a glance, which a tinted
 * border alone does not do.
 */
const COLOUR_CLASS: Record<NoteColour, string> = {
  yellow: "bg-amber-100 border-amber-300 dark:bg-amber-950/50 dark:border-amber-800",
  blue: "bg-sky-100 border-sky-300 dark:bg-sky-950/50 dark:border-sky-800",
  green: "bg-emerald-100 border-emerald-300 dark:bg-emerald-950/50 dark:border-emerald-800",
  pink: "bg-rose-100 border-rose-300 dark:bg-rose-950/50 dark:border-rose-800",
  purple: "bg-violet-100 border-violet-300 dark:bg-violet-950/50 dark:border-violet-800",
  slate: "bg-slate-100 border-slate-300 dark:bg-slate-900/60 dark:border-slate-700",
};

const SWATCH_CLASS: Record<NoteColour, string> = {
  yellow: "bg-amber-400",
  blue: "bg-sky-400",
  green: "bg-emerald-400",
  pink: "bg-rose-400",
  purple: "bg-violet-400",
  slate: "bg-slate-400",
};

const textareaClass =
  "w-full resize-y rounded-md border border-input bg-card/70 px-3 py-2 text-sm shadow-xs outline-none transition-colors placeholder:text-muted-foreground/70 hover:border-ring/40 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25";

export function NotesBoard({ notes, unavailable }: { notes: NoteRow[]; unavailable: string | null }) {
  const [composing, setComposing] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  if (unavailable) {
    return (
      <p className="rounded-lg border border-dashed bg-card p-4 text-sm text-muted-foreground">{unavailable}</p>
    );
  }

  return (
    <div className="space-y-3">
      {!composing && (
        <Button size="sm" variant="outline" onClick={() => setComposing(true)}>
          <PlusIcon /> Add a note
        </Button>
      )}
      {composing && <NoteEditor onDone={() => setComposing(false)} />}

      {notes.length === 0 && !composing ? (
        <p className="text-sm text-muted-foreground">
          Nothing pinned up yet. A note can be a line of text, a checklist, or both.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {notes.map((note) =>
            editing === note.id ? (
              <NoteEditor key={note.id} note={note} onDone={() => setEditing(null)} />
            ) : (
              <NoteCard key={note.id} note={note} onEdit={() => setEditing(note.id)} />
            ),
          )}
        </div>
      )}
    </div>
  );
}

/** A note as it sits on the board: readable, tickable, without opening it. */
function NoteCard({ note, onEdit }: { note: NoteRow; onEdit: () => void }) {
  const [isPending, startTransition] = useTransition();

  function toggleItem(index: number) {
    const items = note.items.map((it, i) => (i === index ? { ...it, done: !it.done } : it));
    startTransition(async () => {
      const result = await setNoteItems(note.id, items);
      if (result?.error) toast.error(result.error);
    });
  }

  function togglePinned() {
    startTransition(async () => {
      const result = await setNotePinned(note.id, !note.pinned);
      if (result?.error) toast.error(result.error);
    });
  }

  function remove() {
    startTransition(async () => {
      const result = await deleteNote(note.id);
      if (result?.error) toast.error(result.error);
      else toast.success("Note deleted");
    });
  }

  const ticked = note.items.filter((i) => i.done).length;

  return (
    <div
      className={cn(
        "group flex flex-col gap-2 rounded-lg border p-3 shadow-xs transition-opacity",
        COLOUR_CLASS[note.colour],
        isPending && "opacity-60",
      )}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={onEdit}
          className="min-w-0 flex-1 text-left text-sm font-semibold break-words text-foreground"
          title="Edit this note"
        >
          {note.title || <span className="text-muted-foreground">Untitled</span>}
        </button>
        <button
          type="button"
          onClick={togglePinned}
          aria-label={note.pinned ? "Unpin" : "Pin to the top"}
          title={note.pinned ? "Unpin" : "Pin to the top"}
          className={cn(
            "shrink-0 rounded p-1 text-muted-foreground hover:text-foreground",
            note.pinned && "text-foreground",
          )}
        >
          <PinIcon className={cn("size-3.5", note.pinned && "fill-current")} />
        </button>
        <button
          type="button"
          onClick={remove}
          aria-label="Delete this note"
          title="Delete this note"
          className="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive"
        >
          <Trash2Icon className="size-3.5" />
        </button>
      </div>

      {note.body && (
        <button type="button" onClick={onEdit} className="text-left text-sm whitespace-pre-wrap break-words">
          {note.body}
        </button>
      )}

      {note.items.length > 0 && (
        <div className="space-y-1.5">
          {note.items.map((item, index) => (
            <label key={index} className="flex items-start gap-2 text-sm">
              <Checkbox
                checked={item.done}
                onCheckedChange={() => toggleItem(index)}
                className="mt-0.5 bg-card/80"
              />
              <span className={cn("min-w-0 break-words", item.done && "text-muted-foreground line-through")}>
                {item.text}
              </span>
            </label>
          ))}
          <p className="text-xs text-muted-foreground">
            {ticked} of {note.items.length} done
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Writing or changing a note.
 *
 * One editor for both: a new note is the same shape as an old one, and two
 * forms would drift apart the first time a field is added.
 */
function NoteEditor({ note, onDone }: { note?: NoteRow; onDone: () => void }) {
  const [title, setTitle] = useState(note?.title ?? "");
  const [body, setBody] = useState(note?.body ?? "");
  const [items, setItems] = useState<NoteItem[]>(note?.items ?? []);
  const [itemDraft, setItemDraft] = useState("");
  const [colour, setColour] = useState<NoteColour>(note?.colour ?? "yellow");
  const [isPending, startTransition] = useTransition();

  function addItem() {
    const text = itemDraft.trim();
    if (!text) return;
    setItems((prev) => [...prev, { text, done: false }]);
    setItemDraft("");
  }

  function save() {
    // Whatever is sitting in the checklist box counts as a line; losing it
    // because Save was pressed before Enter is the obvious way to annoy someone.
    const pending = itemDraft.trim();
    const allItems = pending ? [...items, { text: pending, done: false }] : items;
    const input = {
      title: title.trim(),
      body: body.trim(),
      items: allItems,
      colour,
      pinned: note?.pinned ?? false,
    };
    startTransition(async () => {
      const result = note ? await updateNote(note.id, input) : await createNote(input);
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      onDone();
    });
  }

  return (
    <div className={cn("space-y-2 rounded-lg border p-3 shadow-xs", COLOUR_CLASS[colour])}>
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title"
        className="bg-card/70 font-semibold"
        autoFocus
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Write the note…"
        rows={3}
        className={textareaClass}
      />

      {items.length > 0 && (
        <div className="space-y-1.5">
          {items.map((item, index) => (
            <div key={index} className="flex items-start gap-2 text-sm">
              <Checkbox
                checked={item.done}
                onCheckedChange={(checked) =>
                  setItems((prev) => prev.map((it, i) => (i === index ? { ...it, done: checked === true } : it)))
                }
                className="mt-0.5 bg-card/80"
              />
              <span className={cn("min-w-0 flex-1 break-words", item.done && "text-muted-foreground line-through")}>
                {item.text}
              </span>
              <button
                type="button"
                onClick={() => setItems((prev) => prev.filter((_, i) => i !== index))}
                aria-label="Remove this line"
                className="rounded p-0.5 text-muted-foreground hover:text-destructive"
              >
                <XIcon className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <Input
          value={itemDraft}
          onChange={(e) => setItemDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addItem();
            }
          }}
          placeholder="Add a checklist line, then Enter"
          className="bg-card/70"
        />
        <Button type="button" size="icon" variant="outline" onClick={addItem} aria-label="Add this line">
          <PlusIcon />
        </Button>
      </div>

      <div className="flex items-center justify-between gap-2 pt-1">
        <div className="flex gap-1.5">
          {NOTE_COLOURS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColour(c)}
              aria-label={c}
              title={c}
              className={cn(
                "size-5 rounded-full border border-black/10",
                SWATCH_CLASS[c],
                colour === c && "ring-2 ring-ring ring-offset-1",
              )}
            >
              {colour === c && <CheckIcon className="size-3 text-white" />}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={onDone} disabled={isPending}>
            Cancel
          </Button>
          <Button type="button" size="sm" onClick={save} disabled={isPending}>
            {isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}
