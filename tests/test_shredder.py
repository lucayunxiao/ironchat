"""
Tests for Data Shredder Physical Overwrite and Unlink.
"""

from pathlib import Path
from app.shredder import shred_file

def test_shred_file(tmp_path: Path):
    test_file = tmp_path / "secret_document.enc"
    original_data = b"TOP_SECRET_PLAINTEXT_PAYLOAD_TEST_DATA" * 50
    test_file.write_bytes(original_data)

    assert test_file.exists()
    assert test_file.stat().st_size == len(original_data)

    success = shred_file(test_file, passes=2)
    assert success
    assert not test_file.exists()
