"""On-disk model registry: models/<name>/<version>/{model.joblib,manifest.json}.

Artifacts are joblib pickles. Only load from a directory this service (or a trusted
pipeline) writes; never point AI_MODELS_DIR at untrusted storage.
"""
from __future__ import annotations

import json
import re
import shutil
from pathlib import Path
from typing import Any

import joblib

from .constants import MODEL_NAME_PATTERN

MODEL_FILE = "model.joblib"
MANIFEST_FILE = "manifest.json"
VERSION_PREFIX = "v"
_NAME_RE = re.compile(MODEL_NAME_PATTERN)


class RegistryError(ValueError):
    """Invalid model name or version."""


def validate_name(name: str) -> str:
    if not _NAME_RE.fullmatch(name):
        raise RegistryError(f"invalid model name: {name!r}")
    return name


def _version_number(version: str) -> int:
    if not re.fullmatch(rf"{VERSION_PREFIX}\d+", version):
        raise RegistryError(f"invalid version: {version!r}")
    return int(version[len(VERSION_PREFIX):])


class ModelRegistry:
    def __init__(self, root: Path) -> None:
        self.root = Path(root)

    def _name_dir(self, name: str) -> Path:
        return self.root / validate_name(name)

    def versions(self, name: str) -> list[str]:
        base = self._name_dir(name)
        if not base.is_dir():
            return []
        found = [p.name for p in base.iterdir() if (p / MANIFEST_FILE).is_file()]
        return sorted(found, key=_version_number)

    def latest_version(self, name: str) -> str | None:
        versions = self.versions(name)
        return versions[-1] if versions else None

    def save(self, name: str, bundle: dict[str, Any], manifest: dict[str, Any]) -> str:
        """Write a new immutable version; returns the version string."""
        base = self._name_dir(name)
        base.mkdir(parents=True, exist_ok=True)
        number = max((_version_number(v) for v in self.versions(name)), default=0) + 1
        while True:
            version = f"{VERSION_PREFIX}{number}"
            target = base / version
            try:
                target.mkdir()
                break
            except FileExistsError:
                number += 1
        try:
            joblib.dump(bundle, target / MODEL_FILE)
            full = {**manifest, "name": name, "version": version}
            (target / MANIFEST_FILE).write_text(json.dumps(full, indent=2, sort_keys=True), encoding="utf-8")
        except Exception:
            shutil.rmtree(target, ignore_errors=True)
            raise
        return version

    def manifest(self, name: str, version: str) -> dict[str, Any]:
        _version_number(version)
        path = self._name_dir(name) / version / MANIFEST_FILE
        return json.loads(path.read_text(encoding="utf-8"))

    def load(self, name: str, version: str | None = None) -> tuple[dict[str, Any], dict[str, Any]] | None:
        """Return (bundle, manifest) for a version (default latest), or None if absent."""
        chosen = version or self.latest_version(name)
        if chosen is None or chosen not in self.versions(name):
            return None
        bundle = joblib.load(self._name_dir(name) / chosen / MODEL_FILE)
        return bundle, self.manifest(name, chosen)

    def list_models(self) -> list[dict[str, Any]]:
        if not self.root.is_dir():
            return []
        listing = []
        for child in sorted(p for p in self.root.iterdir() if p.is_dir()):
            if not _NAME_RE.fullmatch(child.name):
                continue
            versions = self.versions(child.name)
            if versions:
                listing.append(
                    {
                        "name": child.name,
                        "versions": versions,
                        "latest": self.manifest(child.name, versions[-1]),
                    }
                )
        return listing
