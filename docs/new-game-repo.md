# Creating a New Game Repo

Use this project as the source template, then create a fresh repo per game.

## Files to copy

Server (shared infrastructure):
- `server/roomManager.js`
- `server/wsRouter.js`
- `server/schema.js`

Server (game-specific adapter):
- `server/rummikubAdapter.js` as a reference
- Or start from `templates/blank-game/server/adapter.js`

Client (shared UI + socket):
- `client/src/socket.js`
- `client/src/chat.js`
- `client/src/ui/roomShell.js`
- `client/src/ui/theme.css`

Client (game-specific):
- Your game render module (ex: `client/src/render.js`)
- Your game logic modules (ex: `client/src/draft.js`)
- Your game styles (ex: `client/src/style.css`), which should only contain game-specific rules.

## Recommended layout in a new repo

```
server/
  index.js
  roomManager.js
  wsRouter.js
  schema.js
  gameAdapter.js
  roomState.js
client/
  src/
    socket.js
    chat.js
    ui/
      roomShell.js
    render.js
    main.js
```

## Steps

1. Copy the shared server modules listed above.
2. Create your `gameAdapter.js` (use `docs/adapter-interface.md`).
3. Copy `client/src/socket.js`, `client/src/chat.js`, and `client/src/ui/roomShell.js`.
4. Update `client/src/main.js` to call your new render module.
5. Update titles and branding inside your render module or shell if needed.
6. Import `client/src/ui/theme.css` at the top of your game stylesheet.
7. Initialize a new git repo and push.

## Notes

- Keep each game in its own repo so deployments are isolated.
- Import `client/src/ui/theme.css` in your game stylesheet to keep the same look in every game.
- If you want, you can keep a private “template” repo and copy from it.
