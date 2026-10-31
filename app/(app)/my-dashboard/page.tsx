import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/session";
import { getCurrentCompanyId } from "@/lib/vouchers/engine";
import { PROJECT_TILES } from "@/lib/my-dashboard/projects";
import { cn } from "@/lib/utils";
import { isMissingTable, NOTES_MIGRATION } from "@/lib/my-dashboard/notes-availability";
import type { NoteColour, NoteItem } from "@/features/core/notes/schemas";
import { Greeting, GreetingClock } from "./greeting-clock";
import { NotesBoard, type NoteRow } from "./notes";
import { MyDashboardReports } from "./reports";

/**
 * My Dashboard: the page a day starts on.
 *
 * Not a second copy of the Dashboard. That one answers questions about the
 * business; this one is about the person in front of it — where they are going
 * next, and the handful of figures worth knowing before they get there.
 */
export default async function MyDashboardPage() {
  const user = await requireUser();
  const supabase = await createClient();
  const [companyId, { data: profile }, notesResult] = await Promise.all([
    getCurrentCompanyId(),
    supabase.schema("core").from("user_profiles").select("full_name").eq("id", user.id).maybeSingle(),
    // Pinned first, then newest. The row policy already limits this to the
    // signed-in user's own notes; the filters say so in the query too.
    supabase
      .schema("core")
      .from("notes")
      .select("id, title, body, items, colour, pinned")
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .order("pinned", { ascending: false })
      .order("created_at", { ascending: false }),
  ]);
  // The first name only: "Good morning, Salman Salim" reads like a summons.
  const firstName = ((profile?.full_name as string | null) ?? "").trim().split(/\s+/)[0] ?? "";

  // Notes arrive with migration 0142. Before it runs the table is not there,
  // and a failed select must not take the rest of the page with it.
  const notesUnavailable = isMissingTable(notesResult.error)
    ? `Notes are ready in the code but need migration ${NOTES_MIGRATION} to be run on the database first.`
    : (notesResult.error?.message ?? null);
  const notes: NoteRow[] = (notesResult.data ?? []).map((n) => ({
    id: n.id as string,
    title: (n.title as string | null) ?? "",
    body: (n.body as string | null) ?? "",
    items: ((n.items as NoteItem[] | null) ?? []).filter((i) => typeof i?.text === "string"),
    colour: (n.colour as NoteColour | null) ?? "yellow",
    pinned: Boolean(n.pinned),
  }));

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <Greeting name={firstName} />
        <GreetingClock />
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">My Projects</h2>
        <div className="flex flex-wrap gap-5">
          {PROJECT_TILES.map((p) => (
            <ProjectTile key={p.label} {...p} />
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Reports</h2>
        <MyDashboardReports companyId={companyId} />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Notes</h2>
        <NotesBoard notes={notes} unavailable={notesUnavailable} />
      </section>
    </div>
  );
}

/**
 * One launcher tile. A project with no URL yet is still drawn — dimmed, and
 * saying so — because a missing link is something to fill in, not a reason to
 * pretend the project is not there.
 */
function ProjectTile({
  short,
  label,
  href,
  colour,
}: {
  short: string;
  label: string;
  href: string | null;
  colour: string;
}) {
  const tile = (
    <span
      className={cn(
        "flex size-16 items-center justify-center rounded-2xl text-sm font-bold text-white shadow-sm",
        colour,
        href ? "transition-transform group-hover:-translate-y-0.5 group-hover:shadow-md" : "opacity-40",
      )}
    >
      {short}
    </span>
  );

  if (!href) {
    return (
      <div className="flex w-20 flex-col items-center gap-2" title="Link not set yet">
        {tile}
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
    );
  }

  const external = href.startsWith("http");
  return (
    <Link
      href={href}
      // An outside system opens in its own tab; SSA's own tile stays in the app
      // — and `_top` because this page may itself be inside a workspace tab.
      target={external ? "_blank" : "_top"}
      rel={external ? "noreferrer" : undefined}
      className="group flex w-20 flex-col items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      {tile}
      <span className="text-xs font-medium text-foreground">{label}</span>
    </Link>
  );
}
