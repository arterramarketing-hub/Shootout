import { formatClock } from "../sim/match";
import type { Team } from "../sim/bots";

/**
 * One row of the live scoreboard.
 *
 * Deliberately the same shape whether it came off the wire or was assembled
 * from local bots: the board is the one screen where a solo match and an
 * online one should be indistinguishable, because the question it answers —
 * who is here and how is it going — is the same question either way.
 */
export interface BoardRow {
  id: string;
  name: string;
  team: Team;
  kills: number;
  deaths: number;
  /** Zero for bots and for the local player offline, where it means nothing. */
  pingMs: number;
  human: boolean;
  alive: boolean;
}

export interface BoardElements {
  root: HTMLElement;
  title: HTMLElement;
  clock: HTMLElement;
  rows: HTMLElement;
}

/**
 * Sort so the order carries information: most kills first, ties broken by
 * fewer deaths, then by name so the list does not shuffle under the reader
 * between one tick and the next.
 */
export const sortRows = (rows: readonly BoardRow[]): BoardRow[] =>
  [...rows].sort(
    (a, b) => b.kills - a.kills || a.deaths - b.deaths || a.name.localeCompare(b.name),
  );

export class LiveBoard {
  private open = false;
  /** Rebuilt only when the content changes, not on every frame it is open. */
  private lastSignature = "";

  constructor(private readonly elements: BoardElements) {}

  get isOpen(): boolean {
    return this.open;
  }

  setOpen(open: boolean): void {
    this.open = open;
    this.elements.root.classList.toggle("is-hidden", !open);
    // Force the next render to rebuild: the board may have changed while it
    // was closed, and a stale first frame is the one people screenshot.
    if (open) this.lastSignature = "";
  }

  toggle(): boolean {
    this.setOpen(!this.open);
    return this.open;
  }

  /**
   * Redraw from the current roster.
   *
   * Does nothing while closed, and nothing when the rows are unchanged, so an
   * open board costs one string comparison a frame rather than a full rebuild
   * of the table thirty times a second.
   */
  render(rows: readonly BoardRow[], selfId: string, secondsLeft: number, title: string): void {
    if (!this.open) return;

    const ordered = sortRows(rows);
    const signature = `${title}|${Math.ceil(secondsLeft)}|${ordered
      .map((r) => `${r.id}:${r.kills}:${r.deaths}:${r.pingMs}:${r.alive ? 1 : 0}`)
      .join(",")}`;
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;

    this.elements.title.textContent = title;
    this.elements.clock.textContent = formatClock(Math.max(0, secondsLeft));

    const html = ordered
      .map((row) => {
        const classes = [
          row.id === selfId ? "is-self" : "",
          row.human ? "" : "is-bot",
          row.alive ? "" : "is-dead",
        ]
          .filter(Boolean)
          .join(" ");
        // Ping is meaningless for a bot and for whoever is hosting, so those
        // read as a dash rather than as a suspiciously perfect zero.
        const ping = row.human && row.pingMs > 0 ? `${row.pingMs}` : "—";
        // Bots carry a tag rather than only a dimmer colour. The question this
        // board answers is who is actually here, and a shade of grey is not an
        // answer to it — especially on a phone in daylight.
        const tag = row.human ? "" : `<span class="board-tag">BOT</span>`;
        return (
          `<tr class="${classes}">` +
          `<td><span class="board-team team-${row.team}"></span>` +
          `${escapeHtml(row.name)}${tag}</td>` +
          `<td>${row.kills}</td><td>${row.deaths}</td><td>${ping}</td>` +
          `</tr>`
        );
      })
      .join("");
    this.elements.rows.innerHTML = html;
  }
}

/**
 * Names come from players, so they reach the table as text rather than markup.
 * The server already strips a name down to word characters, but the board must
 * not be the thing relying on that having happened.
 */
const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ??
      character,
  );
