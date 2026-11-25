# AcneLyze

A responsive AI-assisted skincare platform with face-region skin analysis, transparent image
enhancement, personalised tips, diet planning, an AI assistant, routines, reminders and
multilingual UI (English, Hindi, Kannada, Telugu).

> **Important:** AcneLyze provides *educational visual estimates* and cosmetic enhancement.
> It is not a medical device and does not diagnose or treat acne or any other condition.
> Persistent, painful or worsening symptoms need a qualified dermatologist.
>
> The image enhancer is a **general blind face-restoration model**, not an acne detector or
> acne-removal model. Acne-specific inpainting is disabled until a validated pretrained
> segmentation model is available.

## Project layout

```
ACNEClear/
├── backend/            FastAPI service (image processing + secure AI proxy)
│   ├── app/            API routes, validation, analysis, enhancement, AI integration
│   ├── models/         Official face-restoration checkpoint (downloaded, git-ignored)
│   ├── gfpgan/weights/facexlib/weights/ RetinaFace/parsenet weights (auto-downloaded, git-ignored)
│   ├── requirements.txt          Pinned web/image/numerical stack
│   ├── requirements-gfpgan.txt   Enhancement dependencies installed with --no-deps
│   └── tests/          pytest API smoke tests
├── frontend/           React + Vite + TypeScript + Tailwind app
│   └── src/            pages, components, context, local/cloud repository
├── supabase/schema.sql Tables + Row Level Security policies
├── render.yaml         Render deployment definition for the API
└── .env.example        Every supported environment variable
```

## Quick start (local demo, no keys required)

### 1. Backend

Verified on Python 3.12 / Apple M1 (CPU). The enhancement dependencies are installed with `--no-deps` so
`opencv-python-headless` is not replaced by the GUI `opencv-python` package.

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install --upgrade pip
pip install -r requirements.txt
pip install --no-deps -r requirements-gfpgan.txt

# Official face-restoration checkpoint (≈333 MB, git-ignored)
mkdir -p models
curl -L --fail --retry 3 -o models/GFPGANv1.3.pth \
  https://github.com/TencentARC/GFPGAN/releases/download/v1.3.0/GFPGANv1.3.pth

uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

On the first startup, the backend pre-fetches the official RetinaFace detector and parsing weights
into `backend/gfpgan/weights/facexlib/weights/` (also git-ignored), where the enhancer expects them.
The model is loaded once and reused for every request. The first CPU startup can take about a minute;
CUDA is used automatically when available, otherwise CPU is used.
Set `GFPGAN_DEVICE=cpu` or `GFPGAN_DEVICE=cuda` to force a device, and `GFPGAN_WEIGHT=0.55` to
change the default restoration weight (the API clamps it to 0.50–0.60).

`GET /api/health` reports the real state:

```json
{
  "models": {
    "gfpgan": "loaded",
    "model_version": "GFPGANv1.3",
    "device": "CPU"
  }
}
```

It reports `gfpgan: "unavailable"` unless the checkpoint has actually loaded successfully.

### 2. Frontend (new terminal)

```bash
cd frontend
npm install
cp ../.env.example .env.local      # keep VITE_API_URL=http://127.0.0.1:8000
npm run dev -- --host 0.0.0.0 --port 5173
```

Open <http://127.0.0.1:5173/app/enhance>. Choose **Continue as demo** on the login screen if
cloud sync is not configured. Demo accounts and saved data stay in the browser's `localStorage`.

The backend reads `backend/.env` when exported by your process manager. `.env.example` is the
authoritative list of variables; copy the backend section into `backend/.env` when you have keys.

## Verified behaviour

Run these commands to reproduce the checks performed during development:

```bash
cd backend && .venv/bin/python -m pytest tests -q     # API tests; real-enhancement tests skip without checkpoint
cd frontend && npm run build                          # TypeScript + production bundle
```

Automated tests cover health/config, upload validation, five-region analysis, **real enhanced PNG
output**, raw PNG download endpoints, single-face enforcement, multiple-face rejection,
no-face/corrupt/unsupported/oversized rejection, blurred-input handling, AI-written tips/diet
(mock responses), missing-service-key errors, invalid payloads, allergy filtering and empty-message
validation.

## Features and how they are kept honest

| Feature | Implementation | Transparency |
| --- | --- | --- |
| Upload validation | Magic-byte sniff + Pillow decode, EXIF normalisation, 10 MB cap, 200 px minimum | Explicit error codes for unsupported format, corrupt image, too small, too large |
| Face detection | Enhancer's RetinaFace helper for enhancement; Haar cascade for region analysis | Multiple/no-face uploads are rejected with `multiple_faces` / `face_not_detected` |
| Region analysis | Forehead, both cheeks, nose, chin; colour/contrast/spot/shine measurements | `overall_score` is a visual estimate; every response carries a disclaimer |
| Enhancement | **Official face-restoration model only** (`has_aligned=False`, `only_center_face=True`, `paste_back=True`, `upscale=1`) | No fallback, no CSS effect, no OpenCV-only retouch, no random/generated face. Failures return explicit errors |
| Output | Lossless PNG data URL for the UI; raw PNG via `?format=png` or `/api/enhance/png` | Original frame/background and dimensions preserved (`upscale=1`) |
| Tips / diet | AI-service generation after a successful enhancement or on demand | `generator: "gemini"` plus a `notice`; missing key returns `503 gemini_not_configured`, never fake content |
| Chat | Secure backend AI proxy only | With no key, returns `503 gemini_not_configured`; no canned answers |
| Auth / storage | Cloud sync when configured; labelled local demo mode otherwise | Demo banner and `demoSaveNote` toast explain that data stays on the device |
| Languages | English, Hindi, Kannada, Telugu | Backend and frontend share the same language codes |

Images are processed in memory and never written to disk by the API. Only downscaled
thumbnails are stored in history (localStorage or cloud database), never the full uploaded photo.

## Enabling real services

### Cloud sync

1. Create a cloud project.
2. Run `supabase/schema.sql` in the SQL editor. It creates all tables, enables RLS on each,
   adds per-user policies, and a trigger that creates a profile for each new auth user.
3. Put the project URL and anon key in `frontend/.env.local`:

   ```env
   VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   VITE_SUPABASE_ANON_KEY=YOUR_ANON_KEY
   ```

4. If your cloud project has email confirmation enabled, users must confirm their email
   before signing in. Password reset emails redirect to `/reset-password`.
5. Restart the frontend dev server. RLS ensures users can only access their own rows; the anon
   key is a public identifier, not a secret. Do **not** put a service-role key in the frontend.

### AI service

Add `GEMINI_API_KEY` (and optionally `GEMINI_MODEL` / `GEMINI_TIMEOUT_SECONDS`) to the
**backend** environment only. The frontend never sees the key; it only receives a capability flag
from `GET /api/config`. Chat, beauty tips and diet planning all stay disabled with clear errors
until the key is present. No canned or rule-generated plans are used as substitutes.

### Image enhancement configuration

- `GFPGAN_WEIGHTS` — absolute path to a different checkpoint (default:
  `backend/models/GFPGANv1.3.pth`).
- `GFPGAN_WEIGHT` — default restoration weight, clamped to 0.50–0.60 (default `0.55`).
- `GFPGAN_DEVICE` — `auto`, `cpu` or `cuda` (default `auto`).
- `MAX_UPLOAD_MB` — upload limit (default `10`).

The frontend slider (5–85) maps to the supported 0.50–0.60 enhancement weight range. If the
checkpoint, packages or face-detection weights are missing, `/api/enhance` returns a clear
`gfpgan_unavailable` error. It never silently returns the original image or a fake result.

## Deployment

- **API:** `render.yaml` builds with `requirements.txt` plus `requirements-gfpgan.txt` using
  `--no-deps`, then starts `uvicorn app.main:app --host 0.0.0.0 --port $PORT`. Set
  `GEMINI_API_KEY`, cloud service values and `CORS_ORIGINS` as environment variables in Render.
   The enhancement checkpoint must be supplied separately in the deployed environment (for example,
  a build step or mounted file at `backend/models/GFPGANv1.3.pth`); weights are not committed.
- **Frontend:** build with `npm run build` and host `frontend/dist` on any static host. Set
  `VITE_API_URL` at build time, add the static origin to backend `CORS_ORIGINS`, and set
  `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` for real auth.

## API reference (abridged)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/` , `/api/health` , `/api/config` | Status, real enhancement model state and capability flags |
| POST | `/api/uploads/validate` | Validate an image before upload |
| POST | `/api/face-check` | Optional fast face pre-flight |
| POST | `/api/analyze` | Five region scores, concerns and focus areas |
| POST | `/api/enhance` | JSON with enhancement metadata and a PNG data URL |
| POST | `/api/enhance?format=png` | Same processing, raw downloadable PNG response |
| POST | `/api/enhance/png` | Always returns the raw downloadable PNG |
| POST | `/api/tips` | Personalised routine tips (AI service or labelled fallback) |
| POST | `/api/diet` | 1-day + 7-day meal plan (AI service or labelled fallback) |
| POST | `/api/chat` | AI chat proxy (requires server key) |

All enhancement endpoints accept `multipart/form-data` with a `file` field and optional
`strength` (5–85). Full interactive docs are at `/docs` when the API is running.

## Privacy notes

- Uploaded images are processed in memory and never leave the process except to the local
   enhancement/analysis functions. No uploaded photo is sent to an AI provider, cloud service, or
   another image API.
- The enhancer downloads only official model weights from their upstream repositories on
  first use; these are git-ignored and are not user photos.
- Thumbnails in history are downscaled to 420 px before storage. Delete history from the UI to
  remove them from localStorage or the cloud database.
- API keys live only in backend environment variables.

## Known limitations

1. **Acne-specific removal is not enabled.** No validated pretrained acne segmentation model
   and compatible weights were available, so no blemish regions are fabricated or inpainted.
   The enhancer restores faces generally; it does not detect or remove individual pimples.
2. CPU restoration is slower than CUDA. The singleton model and serialized inference keep
   memory bounded, but concurrent requests wait for the enhancement lock.
3. Images longer than 1600 px are processed at a working resolution and returned at the
   validated original size; uploads above 4096 px are first capped at 4096 px.
4. Face detection requires one clear, reasonably frontal face. Group photos, very small faces,
   heavy filters and extreme side profiles are rejected.
5. Identity preservation is best-effort, as with any blind face-restoration model. Results vary
   with input quality; no result is a medical assessment.
6. Cloud auth/database, the AI chat key, and deployed Render credentials are
   environment-provided and were not configured in this local workspace.
