import { z } from "zod";

/**
 * A note on My Dashboard: a scratchpad, not a document.
 *
 * Title, free text, and a checklist — any of which may be empty, as long as
 * something is. The validation is deliberately loose: a note people have to
 * fill in correctly is a form, and nobody writes "ring the plumber" on a form.
 */
export const NOTE_COLOURS = ["yellow", "blue", "green", "pink", "purple", "slate"] as const;
export type NoteColour = (typeof NOTE_COLOURS)[number];

export const noteItemSchema = z.object({
  text: z.string().trim().min(1).max(200, "Keep a checklist line under 200 characters"),
  done: z.boolean(),
});

export const noteSchema = z
  .object({
    title: z.string().trim().max(80, "Keep the title under 80 characters"),
    body: z.string().trim().max(2000, "Keep a note under 2000 characters"),
    items: z.array(noteItemSchema).max(50, "A checklist holds up to 50 lines"),
    colour: z.enum(NOTE_COLOURS),
    pinned: z.boolean(),
  })
  // An empty note is not a note; it would just sit there as a blank card.
  .refine((n) => n.title !== "" || n.body !== "" || n.items.length > 0, {
    message: "Write something first — a title, a note, or a checklist line",
  });

export type NoteInput = z.output<typeof noteSchema>;
export type NoteItem = z.output<typeof noteItemSchema>;
