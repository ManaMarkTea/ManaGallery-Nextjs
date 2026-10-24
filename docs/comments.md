# Comment history and moderation

The archived gallery's comments are imported separately from new comments. Their
original numeric IDs, artwork references, author names and UTC dates survive.
Headlines are included above the comment text. Old HTML is converted to plain
text, and React escapes the displayed body. IP addresses are not exported.
Legacy guest and deleted-member comments do not create login accounts. A verified
linked legacy account owns its historical comments; names alone never establish
ownership. Guest comments can only be removed by an administrator.

For a fresh private archive import:

```sh
python scripts/import-comments.py /private/gallery.sql --export storage/legacy-comments.json
python scripts/import-comments.py storage/legacy-comments.json --database storage/gallery.sqlite
```

The JSON is user content and must remain outside Git/public assets. For the VPS,
place the private export at `~/rendergallery-stage/legacy-comments.json`; the
GitHub deployment helper carries it into staging and imports it during promotion.
Reimports insert only missing original IDs. They do not overwrite new comments,
recreate deleted history, or undo prior admin approval. Historic deletions retain
a private tombstone so a later import cannot silently resurrect them. SQLite
backups include both original comments and moderation decisions.

## Filtering

New comments get the shared rules in `lib/comment-rules.json`: common profanity,
advertising phrases, excessive links and long character repetitions are held for
review. Links from members without auto-approval also need review. Trusted members
and admins may post ordinary links; profanity/advertising checks still apply.
Exact duplicate comments by the same member within one day are rejected. Limits
are three submissions per minute and twenty per hour. These are basic rules,
not a promise to recognize every spam message or obfuscated word.

Historic comments use the same profanity/advertising rules but only hold link
spam with three or more link markers; an old reference link alone is preserved.
Nothing flagged is permanently discarded. The import reports how many comments
need review. Detection applies once to newly imported IDs; approved or deleted
comments stay reviewed on reimport. Later rule edits do not rescan old comments.

Go to **Admin → Comments → Needs review** to read, approve or delete flagged
comments. The admin search includes original guests and members who have not yet
signed in on the new site. Public artwork pages show only published comments.
Member profiles count published local and archived contributions. The admin
overview includes all undeleted comments, including those awaiting review.

Gallery comments are restored by this importer. Forum topics, private messages,
and forum posts are separate legacy systems and are not imported.
