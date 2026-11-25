# Acne detection dataset and training dependencies

The backend contains a real YOLO inference pipeline but **no trained acne checkpoint**.
Nothing is generated, substituted or retrained by the application at runtime.

## Dataset

Source (provided by the project owner): https://universe.roboflow.com/hadids/multi-class-acne

Required export: **Object Detection → YOLO format** (not a classification export).
Expected classes, in this exact ID order:

| ID | Class |
| --- | --- |
| 0 | Blackheads |
| 1 | Whiteheads |
| 2 | Papules |
| 3 | Pustules |
| 4 | Nodules |
| 5 | Cysts |

The Roboflow project version is not known locally. Open the dataset page, choose a
version, and set `DATASET_VERSION` in `backend/train_yolo11n_colab.ipynb` accordingly.

### How to generate the export

1. Sign in to Roboflow and open the `hadids/multi-class-acne` project.
2. Select a dataset version (or create a new one with all six classes).
3. Confirm the task is **Object Detection** and the six class names match the table above.
4. Choose **Download Dataset → YOLO format**; the notebook downloads it in Colab using
   your Roboflow API key.
5. The notebook verifies `data.yaml` class order, all three splits, image-label pairing,
   five-value YOLO label lines, integer class IDs in `0..5`, normalised coordinates and
   non-degenerate bounding boxes.
6. If the export lacks a `test` split, the notebook creates one deterministically from
   validation images and rewrites `data.yaml` before training.

## Training

Open `backend/train_yolo11n_colab.ipynb` in Google Colab with a **GPU runtime**, paste a
Roboflow API key, set the correct `DATASET_VERSION`, and run all cells. It trains
`yolo11n.pt` with early stopping and documented augmentations, then evaluates the trained
checkpoint on the **test** split.

The evaluation cell prints the real `mAP50` and `mAP50-95` values and writes them to
`acneclear_training_metrics.json`. No accuracy is claimed until that notebook has actually
been run with a real GPU session and credentials.

## Integrating the result

Copy the downloaded checkpoint to:

```
C:\Users\ansu8\Downloads\ACNEClear\ACNEClear\backend\models\best.pt
```

Or set `YOLO_WEIGHTS` to an absolute path in `backend/.env`. Then restart the backend.
`GET /api/detect/status` must report `yolo_active: true` before `/api/detect` and
`/api/scan` will return detection results. If the file is absent those endpoints
return `503 yolo_checkpoint_missing` with the exact expected path.

The backend also validates the checkpoint class names on load. If a checkpoint reports a
different class set or order, `/api/detect/status` reports `yolo_class_mismatch` and the
checkpoint is rejected rather than producing mislabelled detections.

## Exact remaining external action

1. Confirm the Roboflow dataset version on the dataset page.
2. Run all notebook cells in a Colab GPU session with a valid Roboflow API key.
3. Read the real `mAP50` and `mAP50-95` from the evaluation output.
4. Download `best.pt` and place it at `backend\models\best.pt`.
5. Restart the backend and verify `yolo_active: true` from `/api/detect/status`.
