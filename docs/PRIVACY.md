# Privacy

## Short version

The studio is a static page. It has no account, no analytics, no cookies, no tracking pixels and no backend. Your game and preferences stay in the browser you are using.

## What is stored

`localStorage['full3dChessAcademy.v1']` holds:

- the current game as a starting FEN plus a list of UCI moves;
- language, sound, tips, blunder-guard, coordinates and idle-motion preferences;
- puzzle progress: solved ids, current streak and best streak.

No names, no email addresses, no device identifiers, no location. There are no timestamps of individual moves.

## Clearing it

- Use “New game” to reset the board, which also rewrites the saved game.
- Clear site data for the origin in your browser to remove everything.
- Export PGN/JSON first if you want to keep a record.

## Network

On load, the module fetches Three.js and its three addons from `cdn.jsdelivr.net`. That request reveals your IP address to the CDN in the ordinary way, as any external script would. Nothing else leaves the page. There are no runtime API calls, no fonts, no images and no audio downloads.

If the CDN is blocked, the app shows an explanatory overlay; it does not fall back to another host or retry silently.

## Exports

PGN and JSON files are generated in the page with `Blob` and a temporary object URL. They are handed to your browser's download flow. The site never receives a copy.

## Hosting

GitHub Pages hosts the static files and may log requests as a web host normally does. That is outside the control of the application. The repository itself contains no personal data and no secrets.

## Contact

Open an issue on the repository for a privacy question or a correction. Do not include personal data in the issue.
