#!/usr/bin/env python3

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from scipy.io import loadmat


DATASET_ROOT = Path("/tmp/cipic-hrtf-database/standard_hrir_database")
KEMAR_ROOT = Path("/tmp/cipic-hrtf-database/special_kemar_hrir/kemar_frontal")
OUTPUT_PATH = Path("public/hrtf/cipic-above-head.json")
KEMAR_OUTPUT_PATH = Path("public/hrtf/kemar-frontal-above-head.json")

SAMPLE_RATE = 44_100
FFT_SIZE = 2048
DISPLAY_POINTS = 96
FREQ_MIN = 20.0
FREQ_MAX = 20_000.0

CIPIC_AZIMUTHS = [-80, -65, -55] + list(range(-45, 50, 5)) + [55, 65, 80]
CIPIC_POLARS = [-45 + index * (360 / 64) for index in range(50)]
KEMAR_POLARS = [-45 + index * 2.8125 for index in range(99)]

CIPIC_POSITIONS = [
    {"key": "above", "label": "Above", "lateralDegrees": 0, "polarDegrees": 90},
    {"key": "front", "label": "Front", "lateralDegrees": 0, "polarDegrees": 0},
    {"key": "back", "label": "Back", "lateralDegrees": 0, "polarDegrees": 180},
    {"key": "left", "label": "Left", "lateralDegrees": -80, "polarDegrees": 0},
    {"key": "right", "label": "Right", "lateralDegrees": 80, "polarDegrees": 0},
    {"key": "front_left", "label": "Front Left", "lateralDegrees": -45, "polarDegrees": 0},
    {"key": "front_right", "label": "Front Right", "lateralDegrees": 45, "polarDegrees": 0},
    {"key": "back_left", "label": "Back Left", "lateralDegrees": -45, "polarDegrees": 180},
    {"key": "back_right", "label": "Back Right", "lateralDegrees": 45, "polarDegrees": 180},
]

KEMAR_POSITIONS = [
    {"key": "above", "label": "Above", "lateralDegrees": 0, "polarDegrees": 90},
    {"key": "front", "label": "Front", "lateralDegrees": 0, "polarDegrees": 0},
    {"key": "back", "label": "Back", "lateralDegrees": 0, "polarDegrees": 180},
    {"key": "down_front", "label": "Down Front", "lateralDegrees": 0, "polarDegrees": -45},
]


def log_frequency_axis() -> np.ndarray:
    return np.geomspace(FREQ_MIN, FREQ_MAX, DISPLAY_POINTS)


def relative_magnitude_db(hrir: np.ndarray, frequencies: np.ndarray) -> list[float]:
    spectrum = np.fft.rfft(hrir, n=FFT_SIZE)
    fft_freqs = np.fft.rfftfreq(FFT_SIZE, d=1 / SAMPLE_RATE)
    magnitude = np.maximum(np.abs(spectrum), 1e-8)
    magnitude_db = 20 * np.log10(magnitude)
    interpolated = np.interp(frequencies, fft_freqs, magnitude_db)
    relative = interpolated - float(np.max(interpolated))
    return np.round(relative, 2).tolist()


def normalized_hrir_pair(left: np.ndarray, right: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    peak = max(float(np.max(np.abs(left))), float(np.max(np.abs(right))), 1e-9)
    gain = 0.95 / peak
    return left * gain, right * gain


def closest_index(values: list[float], target: float) -> int:
    return min(range(len(values)), key=lambda index: abs(values[index] - target))


def build_measurement(left: np.ndarray, right: np.ndarray, itd: float, frequencies: np.ndarray) -> dict[str, object]:
    left, right = normalized_hrir_pair(left, right)
    return {
        "itd": round(itd, 3),
        "left": np.round(left, 7).tolist(),
        "right": np.round(right, 7).tolist(),
        "leftDb": relative_magnitude_db(left, frequencies),
        "rightDb": relative_magnitude_db(right, frequencies),
    }


def build_cipic_subjects(frequencies: np.ndarray) -> list[dict[str, object]]:
    subjects = []

    for subject_dir in sorted(DATASET_ROOT.glob("subject_*")):
        mat = loadmat(subject_dir / "hrir_final.mat")
        positions: dict[str, object] = {}

        for position in CIPIC_POSITIONS:
            lateral_index = closest_index(CIPIC_AZIMUTHS, position["lateralDegrees"])
            polar_index = closest_index(CIPIC_POLARS, position["polarDegrees"])
            left = np.asarray(mat["hrir_l"][lateral_index, polar_index], dtype=np.float64)
            right = np.asarray(mat["hrir_r"][lateral_index, polar_index], dtype=np.float64)
            itd = float(np.asarray(mat["ITD"][lateral_index, polar_index]).reshape(-1)[0])
            positions[position["key"]] = build_measurement(left, right, itd, frequencies)

        subject_id = subject_dir.name.split("_", 1)[1]
        subjects.append(
            {
                "id": subject_id,
                "label": f"Subject {subject_id}",
                "positions": positions,
            }
        )

    return subjects


def build_kemar_subjects(frequencies: np.ndarray) -> list[dict[str, object]]:
    subjects = []

    for subject_id, label, filename in [
        ("kemar-large", "KEMAR Large Pinna", "large_pinna_frontal.mat"),
        ("kemar-small", "KEMAR Small Pinna", "small_pinna_frontal.mat"),
    ]:
        mat = loadmat(KEMAR_ROOT / filename)
        positions: dict[str, object] = {}

        for position in KEMAR_POSITIONS:
            polar_index = closest_index(KEMAR_POLARS, position["polarDegrees"])
            left = np.asarray(mat["left"][:, polar_index], dtype=np.float64)
            right = np.asarray(mat["right"][:, polar_index], dtype=np.float64)
            positions[position["key"]] = build_measurement(left, right, 0.0, frequencies)

        subjects.append(
            {
                "id": subject_id,
                "label": label,
                "positions": positions,
            }
        )

    return subjects


def main() -> None:
    frequencies = log_frequency_axis()

    cipic_payload = {
        "source": {
            "name": "CIPIC HRTF Database",
            "license": "Copyright (c) 2001 The Regents of the University of California. All Rights Reserved.",
            "repository": "https://github.com/amini-allight/cipic-hrtf-database",
        },
        "sampleRate": SAMPLE_RATE,
        "frequencies": np.round(frequencies, 2).tolist(),
        "positions": CIPIC_POSITIONS,
        "subjects": build_cipic_subjects(frequencies),
    }

    kemar_payload = {
        "source": {
            "name": "CIPIC Special KEMAR Frontal",
            "license": "Copyright (c) 2001 The Regents of the University of California. All Rights Reserved.",
            "repository": "https://github.com/amini-allight/cipic-hrtf-database",
        },
        "sampleRate": SAMPLE_RATE,
        "frequencies": np.round(frequencies, 2).tolist(),
        "positions": KEMAR_POSITIONS,
        "subjects": build_kemar_subjects(frequencies),
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(cipic_payload, separators=(",", ":")))
    KEMAR_OUTPUT_PATH.write_text(json.dumps(kemar_payload, separators=(",", ":")))


if __name__ == "__main__":
    main()
