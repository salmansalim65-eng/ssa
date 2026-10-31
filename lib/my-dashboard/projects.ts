/**
 * The other systems this person works in, as tiles on My Dashboard.
 *
 * One list, edited here: a tile is two lines of data, and a settings screen for
 * four links nobody changes twice a year would cost more than it saves.
 *
 * A project with no `href` yet still gets its tile, shown plainly as not linked
 * rather than left out — a missing link is a thing to fill in, not a project
 * that does not exist. Add the URL here and it becomes a link.
 */
export interface ProjectTile {
  /** The letters on the tile. */
  short: string;
  /** The name underneath it. */
  label: string;
  /** Where it opens. null until the URL is known. */
  href: string | null;
  /** Tailwind background for the tile. */
  colour: string;
}

export const PROJECT_TILES: ProjectTile[] = [
  { short: "MBL", label: "MBL", href: "https://mbl-erp.vercel.app", colour: "bg-blue-600" },
  // RMI has no deployment of its own yet; put its URL here when it does.
  { short: "RMI", label: "RMI", href: null, colour: "bg-emerald-600" },
  // SSA is this app, so its tile stays inside it rather than reloading the site.
  { short: "SSA", label: "SSA", href: "/dashboard", colour: "bg-orange-600" },
  { short: "VI", label: "VISTA", href: "https://erp.vista-group.co", colour: "bg-purple-600" },
];
