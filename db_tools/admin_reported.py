"""
Outil de nettoyage des covers signalées
========================================
pip install rich python-dotenv supabase
"""

import os
from dotenv import load_dotenv
from supabase import create_client
from rich.console import Console
from rich.table import Table
from rich.prompt import Prompt, Confirm
from rich import box
from rich.panel import Panel

load_dotenv()

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

console = Console()

EDITABLE_FIELDS = {
    "1": ("artist",    "Artiste"),
    "2": ("album",     "Album"),
    "3": ("genre",     "Genre (FR / US)"),
    "4": ("cover_url", "URL de la cover"),
}


# ── Supabase ──────────────────────────────────────────────────────────────────

def get_reported(sb):
    res = (
        sb.table("albums")
        .select("id,artist,album,genre,cover_url,issue")
        .not_.is_("issue", "null")
        .execute()
    )
    return res.data


def save_album(sb, album_id, updates):
    sb.table("albums").update(updates).eq("id", album_id).execute()


def clear_issue(sb, album_id):
    sb.table("albums").update({"issue": None}).eq("id", album_id).execute()


def delete_album(sb, album_id):
    sb.table("albums").delete().eq("id", album_id).execute()


# ── Affichage ─────────────────────────────────────────────────────────────────

def show_table(albums):
    t = Table(box=box.ROUNDED, show_header=True, header_style="bold cyan", expand=False)
    t.add_column("#",        style="dim",    width=3,  justify="right")
    t.add_column("ID",       style="dim",    width=5)
    t.add_column("Artiste",               width=22)
    t.add_column("Album",                 width=32)
    t.add_column("Genre",                 width=6,  justify="center")
    t.add_column("Issue",    style="yellow", width=16)

    for i, a in enumerate(albums, 1):
        t.add_row(
            str(i),
            str(a["id"]),
            a["artist"],
            a["album"],
            a["genre"],
            a.get("issue") or "",
        )
    console.print(t)


def show_album_detail(a):
    console.print(Panel(
        f"[bold]{a['artist']} — {a['album']}[/bold]\n"
        f"Genre    : [cyan]{a['genre']}[/cyan]\n"
        f"Cover URL: [dim]{a['cover_url']}[/dim]\n"
        f"Issue    : [yellow]{a.get('issue') or '—'}[/yellow]",
        title=f"[bold]Album #{a['id']}[/bold]",
        expand=False,
    ))


# ── Actions ───────────────────────────────────────────────────────────────────

def action_edit(sb, album):
    show_album_detail(album)
    console.print("\n[bold]Champs modifiables :[/bold]")
    for k, (_, label) in EDITABLE_FIELDS.items():
        console.print(f"  [cyan]{k}[/cyan]. {label}")
    console.print("  [dim]0. Annuler[/dim]")

    updates = {}
    while True:
        choice = Prompt.ask("\nChamp à modifier").strip()
        if choice == "0":
            break
        if choice not in EDITABLE_FIELDS:
            console.print("[red]Choix invalide[/red]")
            continue

        field, label = EDITABLE_FIELDS[choice]
        current = album.get(field, "")
        new_val = Prompt.ask(f"{label}", default=current).strip()
        if new_val != current:
            updates[field] = new_val
            album[field] = new_val  # mise à jour locale pour affichage
            console.print(f"[green]↳ {label} modifié[/green]")

        if not Confirm.ask("Modifier un autre champ ?", default=False):
            break

    if updates:
        save_album(sb, album["id"], updates)
        console.print(f"\n[bold green]✓ {len(updates)} champ(s) sauvegardé(s) en base[/bold green]")
    else:
        console.print("[dim]Aucune modification[/dim]")


def action_clear(sb, album):
    if Confirm.ask(f"Effacer le signalement de [bold]{album['artist']} — {album['album']}[/bold] ?"):
        clear_issue(sb, album["id"])
        console.print("[green]✓ Signalement effacé[/green]")


def action_delete(sb, album):
    if Confirm.ask(
        f"[red]Supprimer définitivement[/red] [bold]{album['artist']} — {album['album']}[/bold] ?",
        default=False,
    ):
        delete_album(sb, album["id"])
        console.print("[red]✗ Album supprimé de la base[/red]")
        return True
    return False


# ── Boucle principale ─────────────────────────────────────────────────────────

def run():
    sb = create_client(SUPABASE_URL, SUPABASE_KEY)

    while True:
        console.rule("[bold cyan]COVERS SIGNALÉES[/bold cyan]")
        albums = get_reported(sb)

        if not albums:
            console.print("\n[bold green]✓ Aucun album signalé — base propre.[/bold green]\n")
            break

        console.print(f"[dim]{len(albums)} album(s) signalé(s)[/dim]\n")
        show_table(albums)

        console.print("\n[dim]Numéro de l'album à traiter, ou [bold]q[/bold] pour quitter[/dim]")
        choice = Prompt.ask(">").strip()

        if choice.lower() == "q":
            break

        try:
            idx = int(choice) - 1
            assert 0 <= idx < len(albums)
        except (ValueError, AssertionError):
            console.print("[red]Numéro invalide[/red]")
            continue

        album = albums[idx]

        console.print(f"\n[bold]{album['artist']} — {album['album']}[/bold]")
        console.print("  [cyan]1[/cyan]. Modifier les données")
        console.print("  [cyan]2[/cyan]. Effacer le signalement (issue → null)")
        console.print("  [cyan]3[/cyan]. Supprimer l'album")
        console.print("  [dim]0. Retour[/dim]")

        action = Prompt.ask(">").strip()

        if action == "1":
            action_edit(sb, album)
        elif action == "2":
            action_clear(sb, album)
        elif action == "3":
            action_delete(sb, album)
        elif action == "0":
            continue
        else:
            console.print("[red]Action invalide[/red]")

        console.print()


if __name__ == "__main__":
    run()
