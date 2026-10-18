# CineJoy analysis (github.com/steveyout/cinejoy, inspected via `git clone`, 18 commits, main)

**Stack (actual):** Next.js 16 / React 18 / Tailwind 3 / Firebase 12 / `@google/genai`. The README says "Express SSR"; the code and `package.json` use Next.js (`app/`, `next dev`). No Express server exists.

| Question | Finding (file) |
|---|---|
| Metadata | TMDB v3 via `fetch` from the **browser** (`src/services/tmdb.ts`) with `api_key` in the query string; key from `VITE_TMDB_API_KEY` or user-entered in Settings. Also server-side in `src/server/ssrSeo.ts`, `app/api/seo/route.ts`. Key is therefore exposed to clients. |
| Trailers | TMDB `videos` -> `youtube-nocookie.com/embed/<key>` iframe (`DetailModal.tsx`, `VideoPlayer.tsx`). The YouTube IFrame **API script is not loaded**; `enablejsapi=1` is only a URL flag. No YouTube Data API usage at all. |
| Full-length playback | **Yes, but only as iframes to 11 third-party embed sites** (`src/config/providers.ts`: cinemaos.tech, vidking.net, vidlink.pro, vidsrc.to, vidnest.fun, vidfast.net, videasy.net, vsembed.ru, vidup.to, rivestream.org, vidcore.org), URL built from the TMDB id + season/episode. No licensing, auth, or rights check; these are unlicensed aggregators. The repo's own disclaimer says it "does not host" the video. |
| Native `<video>` / HLS | None found. |
| Firebase | Auth + Firestore for favorites/history/settings (`firebase.ts`, `firestoreSync.ts`, `firestore.rules`). Needs Firebase config. |
| Other | Google Analytics, ad banner, Gemini SDK (unused for playback), poster-palette ambient lighting, PWA. |
| Credentials needed | TMDB key (required); Firebase (optional). |

## Decision
* **Reused conceptually:** TMDB endpoints/data shapes, shelf/detail/season UX, trailer-via-YouTube-embed, favorites/watch-later model.
* **Not reused:** the provider list and iframe playback. Those sites serve content with no evidence of rights or authorization, so wiring them into a TV appliance would be facilitating unlicensed streaming. Per the project brief ("do not show a Play button when no compatible source exists"), Streaming mode shows a disabled Play button and an explanation. To add a legitimate source later, implement a `PlaybackSource` returning an official embed URL or a stream you are authorized to use.
* **Also not reused:** client-side TMDB key, analytics, ads, Next.js (heavier than needed for a 4 GB Pi).


## Pi Media Center source availability update

Pi Media Center's Streaming detail view now includes a **Where to watch** section backed by TMDB's official `/{movie|tv}/{id}/watch/providers` metadata endpoint. It groups US availability into subscription, free, ad-supported, rent, and buy categories and links to the official provider viewing page supplied by TMDB. This is provider availability discovery, not a promise that the service includes the title in every plan or region. Full playback remains with the official service; trailers still use YouTube and local files use My Media. The backend allowlist was extended only for the TMDB watch-provider metadata route.

## Authorized direct-stream playback implementation

Pi Media Center now accepts a user-supplied HTTPS direct media URL in Streaming details and passes it to the existing shared player through a `remote` source type. The player uses the browser's native `<video>` element, so MP4/WebM and browser-supported HLS sources can play with the normal controls. The app validates that the URL is HTTPS (localhost is allowed for development), and does not fetch or proxy the media through the Pi server. This is for media the user owns or is authorized to stream; it does not implement Cinejoy's third-party provider list or extract streams from embed sites.
