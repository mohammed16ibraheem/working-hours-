#!/usr/bin/env python3
"""
Identity only: InsightFace buffalo_l (ArcFace) — https://github.com/deepinsight/insightface
No anti-spoof / liveness. Never returns spoofRejected.

Match rule: cosine distance = 1 - similarity. Match when distance <= MATCH_THRESHOLD.
Threshold 0.55 (similarity >= 0.45) is intentionally slightly loose for dirty/worksite
lighting vs Create Labor enrollment photos. Prefer best match among real JPG/PNG only
(SVG placeholders skipped).
"""
from __future__ import annotations

import base64
import json
import sys
from pathlib import Path

import cv2
import numpy as np

# Cosine distance (1 - ArcFace similarity). Was 0.40; loosened for worksite selfies.
MATCH_THRESHOLD = 0.55
ROOT = Path(__file__).resolve().parent
ENGINE = "insightface/buffalo_l"


def _decode_data_url(data_url: str) -> np.ndarray:
    if "," not in data_url:
        raise ValueError("Invalid image data URL")
    raw = base64.b64decode(data_url.split(",", 1)[1])
    arr = np.frombuffer(raw, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Could not decode image")
    return _worksite_preprocess(img)


def _worksite_preprocess(img: np.ndarray) -> np.ndarray:
    """Mild CLAHE on luminance — helps uneven worksite lighting without changing geometry."""
    try:
        lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
        l, a, b = cv2.split(lab)
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        l2 = clahe.apply(l)
        return cv2.cvtColor(cv2.merge((l2, a, b)), cv2.COLOR_LAB2BGR)
    except Exception:
        return img


def _is_real_photo(data_url: str) -> bool:
    s = str(data_url or "")
    if not s.startswith("data:image/"):
        return False
    head = s.split(",", 1)[0].lower()
    if "svg" in head:
        return False
    return True


def _get_face_app():
    from insightface.app import FaceAnalysis

    root = ROOT / "models"
    root.mkdir(parents=True, exist_ok=True)
    app = FaceAnalysis(
        name="buffalo_l",
        root=str(root),
        providers=["CPUExecutionProvider"],
    )
    # Slightly lower det_thresh so dirty/angled worksite faces still detect.
    app.prepare(ctx_id=-1, det_thresh=0.35, det_size=(640, 640))
    return app


def _largest_face(app, img: np.ndarray):
    faces = app.get(img)
    if not faces:
        raise ValueError("No face detected in image")
    return max(
        faces,
        key=lambda f: float((f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1])),
    )


def _ok(
    *,
    matched: bool,
    message: str,
    confidence: float = 0.0,
    distance: float | None = None,
    similarity: float | None = None,
    labor_record_id=None,
    name=None,
    labor_id=None,
    country=None,
    error: str | None = None,
) -> dict:
    out = {
        "matched": matched,
        "spoofRejected": False,
        "liveness": None,
        "confidence": round(float(confidence), 1),
        "distance": None if distance is None else round(float(distance), 4),
        "similarity": None if similarity is None else round(float(similarity), 4),
        "threshold": MATCH_THRESHOLD,
        "engine": ENGINE,
        "message": message,
    }
    if labor_record_id is not None:
        out["laborRecordId"] = labor_record_id
    if name is not None:
        out["name"] = name
    if labor_id is not None:
        out["laborId"] = labor_id
    if country is not None:
        out["country"] = country
    if error:
        out["error"] = error
    return out


def verify(ref_data_url: str, probe_data_url: str) -> dict:
    app = _get_face_app()
    ref_face = _largest_face(app, _decode_data_url(ref_data_url))
    probe_face = _largest_face(app, _decode_data_url(probe_data_url))
    ref_emb = ref_face.normed_embedding
    probe_emb = probe_face.normed_embedding
    if ref_emb is None or probe_emb is None:
        raise ValueError("Could not extract face embedding")

    sim = float(np.dot(ref_emb, probe_emb))
    distance = float(1.0 - sim)
    matched = distance <= MATCH_THRESHOLD
    confidence = max(0.0, min(100.0, (1.0 - distance) * 100.0))
    return _ok(
        matched=matched,
        confidence=confidence,
        distance=distance,
        similarity=sim,
        message=(
            "Face matched. Attendance recorded."
            if matched
            else "Face did not match Create Labor photo."
        ),
    )


def identify(probe_data_url: str, references: list[dict]) -> dict:
    """1:N — match selfie against enrolled Create Labor face photos."""
    refs = [r for r in references if _is_real_photo(r.get("photoDataUrl") or "")]
    if not refs:
        return _ok(
            matched=False,
            message="No enrolled worker face photos.",
            error="No enrolled worker face photos.",
        )

    app = _get_face_app()
    probe_face = _largest_face(app, _decode_data_url(probe_data_url))
    probe_emb = probe_face.normed_embedding
    if probe_emb is None:
        raise ValueError("Could not extract face embedding")

    best = None
    for ref in refs:
        try:
            ref_face = _largest_face(app, _decode_data_url(ref["photoDataUrl"]))
            emb = ref_face.normed_embedding
            if emb is None:
                continue
            sim = float(np.dot(emb, probe_emb))
            distance = float(1.0 - sim)
            candidate = {
                "id": ref.get("id"),
                "name": ref.get("name"),
                "laborId": ref.get("laborId"),
                "country": ref.get("country"),
                "similarity": sim,
                "distance": distance,
            }
            if best is None or distance < best["distance"]:
                best = candidate
        except Exception:
            continue

    if best is None:
        return _ok(
            matched=False,
            message="No usable Create Labor face photos to match against.",
            error="No usable Create Labor face photos to match against.",
        )

    matched = best["distance"] <= MATCH_THRESHOLD
    confidence = max(0.0, min(100.0, (1.0 - best["distance"]) * 100.0))
    return _ok(
        matched=matched,
        confidence=confidence,
        distance=best["distance"],
        similarity=best["similarity"],
        labor_record_id=best["id"],
        name=best["name"],
        labor_id=best["laborId"],
        country=best["country"],
        message=(
            f"Attendance recorded for {best['name']} (ID {best['laborId']})."
            if matched
            else "Face did not match an enrolled worker."
        ),
    )


def main() -> int:
    payload = json.load(sys.stdin)
    try:
        mode = payload.get("mode") or "verify"
        if mode == "identify":
            result = identify(payload["probe"], payload.get("references") or [])
        else:
            result = verify(payload["reference"], payload["probe"])
        print(json.dumps(result))
        return 0
    except Exception as exc:  # noqa: BLE001
        print(
            json.dumps(
                {
                    "error": str(exc),
                    "matched": False,
                    "spoofRejected": False,
                    "liveness": None,
                    "engine": ENGINE,
                    "message": "Face check failed — attendance can still be saved.",
                }
            )
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
