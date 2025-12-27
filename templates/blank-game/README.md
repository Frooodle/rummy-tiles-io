# Blank IO Game Template

This folder is a minimal scaffold for building a new IO game with room IDs and chat.

## What to copy

- `server/adapter.js`
- `server/index.js`
- `server/roomState.js`

Then copy `server/roomManager.js` and `server/wsRouter.js` from the main project.

## Next steps

1. Define your room state shape in `server/roomState.js`.
2. Implement the adapter functions in `server/adapter.js`.
3. Wire the server in `server/index.js`.

See `docs/adapter-interface.md` for the adapter contract.
