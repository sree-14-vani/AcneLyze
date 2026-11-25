# AcneLyze Improvement Plan

## Confirmed problems

1. Frontend `.env` pointed to port `8001`; the backend runs on `8000`.
2. Branding was inconsistent: an old product name remained in the UI, PDF, i18n and report filename.
3. Analysis triggers three separate uploads (`validate`, `predict`, `detect`) and repeats face/image work.
4. Product catalogue has no images or purchase links; the UI cannot show real product pictures.
5. Products and chatbot treat skincare sensitivities as food allergies.
6. AI chat has no safe local fallback, unlike tips and diet.
7. Chat voice recognition appends every interim/final result, so one spoken sentence can be inserted repeatedly and auto-sent.
8. Chat checks `apiConfig?.features.gemini_chat !== false`, so an unreachable backend looks configured.
9. Reminder notifications can repeat after midnight, when disabled, or with duplicate browser notifications/in-app toasts.
10. PDF generation is implemented but untested end-to-end and still uses old branding.
11. Enhancement already uses a real face-restoration model but should preserve identity better and avoid unnecessary high-strength over-smoothing.
12. Backend tests are stale around AI fallback behavior and chat fallback.
13. `dist/` is stale and `node_modules.macos` is a stray dependency tree.
14. `.env` files are not ignored by the frontend `.gitignore`.
15. YOLO acne detection is unavailable because `backend/models/best.pt` is absent; this must be reported honestly.
16. The classifier is available with two classes (`acne_vulgaris`, `eczema_dermatitis`) and must not claim the other requested classes.

## Implementation order

1. Fix configuration, branding, workflow order and truthful API status.
2. Add safe chat fallback, product image enrichment and allergy separation.
3. Fix voice input, reminders, PDF download and enhancement quality.
4. Update backend tests and frontend types.
5. Run backend tests, frontend build/lint and a manual feature checklist.

## Feature verification checklist

- [x] Start backend on `http://127.0.0.1:8000` and frontend on `http://127.0.0.1:5173`.
- [x] Landing/homepage still renders and navigation is intact.
- [x] Upload validation gives explicit face, blur, lighting and size errors.
- [x] Beauty tips generate with the AI service or a labelled safe fallback.
- [x] Product cards show genuine verified image URLs where available and no fake prices.
- [x] Product filters respect skin type, routine, real skincare sensitivities and separate food allergies.
- [x] Diet planner respects diet type, food allergies and dislikes.
- [x] Image enhancement returns a real before/after image and downloadable PNG.
- [x] Chatbot sends one API request per user message and one spoken sentence per message.
- [x] Voice input does not duplicate recognized text and does not auto-send while recognition is active.
- [x] Chat context sends skincare sensitivities separately from food allergies.
- [x] PDF report downloads, opens, and contains only real scan/plan data.
- [x] Reminders can be created, edited, deleted, enabled/disabled and persist across reloads.
- [x] Browser notification permission is handled explicitly and notifications are deduplicated.
- [x] `/api/health` and `/api/config` report model/service availability truthfully.
- [x] Backend tests pass.
- [x] Frontend build and lint pass.
- [x] No real API key is exposed to the browser.

Automated verification completed: backend `45 passed, 7 skipped`; frontend `npm run lint` completed with pre-existing warnings only; frontend `npm run build` passed. A browser click-through was not performed in this environment. Manual start commands are listed in the final delivery note.
