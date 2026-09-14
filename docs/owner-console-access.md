# Owner Console access

The Oblige Props owner console is intentionally private and undiscoverable in the customer product.

- There is no Owner Console item in customer or owner-facing product navigation.
- The direct route is `/owner`.
- `/owner`, `/owner.html`, `/owner.css`, and `/owner.js` return a normal 404 unless the current signed-in account has the `owner` role.
- Owner API mutations remain protected server-side and require CSRF validation.
- Search engines are instructed not to index the console.
- The console never exposes API keys, password hashes, payment secrets, Railway settings, or authentication secrets.

Bookmark the direct route rather than adding a visible product link.
