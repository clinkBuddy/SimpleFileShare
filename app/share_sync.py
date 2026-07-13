import os
import re
import uuid
from sqlalchemy.orm import Session

from app.models import Container, FileMetadata

DEFAULT_SHARE_ROOT_ROOM = "root"


def sanitize_container_id(container_id: str) -> str:
    safe = re.sub(r'[<>:"/\\|?*]', '_', container_id)
    safe = safe.strip('. ')
    return safe or 'default'


def is_hash_filename(filename: str) -> bool:
    return len(filename) == 64 and all(c in '0123456789abcdef' for c in filename)


def cleanup_duplicate_directories(db: Session, logger=None) -> int:
    """동일 경로의 중복 폴더 레코드를 정리합니다."""
    all_dirs = db.query(FileMetadata).filter(FileMetadata.is_directory == True).all()
    seen = {}
    deleted = 0
    for entry in all_dirs:
        key = (entry.container_id, entry.folder_path or "", entry.original_name)
        if key in seen:
            db.delete(entry)
            deleted += 1
        else:
            seen[key] = entry.id
    if deleted:
        db.commit()
        if logger:
            logger.info(f"Removed {deleted} duplicate folder entries from database")
    return deleted


def sync_share_path(share_path: str, db: Session, logger=None, share_root_room: str = DEFAULT_SHARE_ROOT_ROOM) -> int:
    """share_path 하위 폴더를 방으로 인식하여 파일을 DB에 등록합니다."""
    if not share_path or not os.path.isdir(share_path):
        return 0

    cleanup_duplicate_directories(db, logger)
    added = 0
    added += _sync_root_files(share_path, share_root_room, db, logger)

    for room_name in sorted(os.listdir(share_path)):
        room_path = os.path.join(share_path, room_name)
        if not os.path.isdir(room_path):
            continue
        added += sync_container_from_path(room_name, room_path, db, logger)

    if added and logger:
        logger.info(f"Auto-shared {added} new file(s) from {share_path}")
    return added


def _sync_root_files(share_path: str, container_id: str, db: Session, logger=None) -> int:
    """share_path 바로 아래 파일(루트 파일)을 기본 방에 등록합니다."""
    container = db.query(Container).filter(Container.id == container_id).first()
    if not container:
        container = Container(id=container_id)
        db.add(container)

    added = 0
    created_dirs = set()
    for fname in sorted(os.listdir(share_path)):
        full_path = os.path.join(share_path, fname)
        if not os.path.isfile(full_path) or fname.startswith('.') or fname.startswith('temp_'):
            continue

        existing = db.query(FileMetadata).filter(
            FileMetadata.container_id == container_id,
            FileMetadata.folder_path == "",
            FileMetadata.original_name == fname,
            FileMetadata.is_directory == False
        ).first()

        try:
            file_size = os.path.getsize(full_path)
        except OSError:
            continue

        if existing:
            if existing.filename != fname or existing.file_size != file_size:
                existing.filename = fname
                existing.file_size = file_size
        else:
            db.add(FileMetadata(
                id=str(uuid.uuid4()),
                container_id=container_id,
                filename=fname,
                original_name=fname,
                file_size=file_size,
                is_protected=False,
                folder_path="",
                is_directory=False
            ))
            added += 1

    db.commit()
    return added


def sync_container_from_path(container_id: str, room_path: str, db: Session, logger=None) -> int:
    container = db.query(Container).filter(Container.id == container_id).first()
    if not container:
        container = Container(id=container_id)
        db.add(container)

    added = 0
    created_dirs = set()
    for root, dirs, files in os.walk(room_path):
        dirs[:] = sorted(d for d in dirs if not d.startswith('.'))
        for fname in sorted(files):
            if fname.startswith('temp_') or fname.startswith('.'):
                continue

            full_path = os.path.join(root, fname)
            rel_path = os.path.relpath(full_path, room_path).replace('\\', '/')
            folder_path = os.path.dirname(rel_path).replace('\\', '/')
            if folder_path == '.':
                folder_path = ''

            existing = db.query(FileMetadata).filter(
                FileMetadata.container_id == container_id,
                FileMetadata.folder_path == folder_path,
                FileMetadata.original_name == fname,
                FileMetadata.is_directory == False
            ).first()

            try:
                file_size = os.path.getsize(full_path)
            except OSError:
                continue

            if existing:
                if existing.filename != rel_path or existing.file_size != file_size:
                    existing.filename = rel_path
                    existing.file_size = file_size
            else:
                db.add(FileMetadata(
                    id=str(uuid.uuid4()),
                    container_id=container_id,
                    filename=rel_path,
                    original_name=fname,
                    file_size=file_size,
                    is_protected=False,
                    folder_path=folder_path,
                    is_directory=False
                ))
                added += 1

            if folder_path:
                _ensure_folder_entries(container_id, folder_path, db, created_dirs)

    db.commit()
    return added


def list_share_rooms(share_path: str) -> list:
    """share_path 하위 방(폴더) 목록을 반환합니다."""
    if not share_path or not os.path.isdir(share_path):
        return []

    rooms = []
    root_files = 0
    for name in sorted(os.listdir(share_path)):
        full = os.path.join(share_path, name)
        if os.path.isdir(full):
            file_count = sum(len(files) for _, _, files in os.walk(full))
            rooms.append({"id": name, "file_count": file_count})
        elif os.path.isfile(full) and not name.startswith('.'):
            root_files += 1

    if root_files:
        rooms.insert(0, {"id": DEFAULT_SHARE_ROOT_ROOM, "file_count": root_files, "label": "루트 파일"})

    return rooms


def _ensure_folder_entries(container_id: str, folder_path: str, db: Session, created_dirs: set):
    parts = folder_path.strip('/').split('/')
    current_path = ''
    for part in parts:
        if not part:
            continue
        key = (container_id, current_path, part)
        if key in created_dirs:
            current_path = f"{current_path}/{part}" if current_path else part
            continue

        existing_dir = db.query(FileMetadata).filter(
            FileMetadata.container_id == container_id,
            FileMetadata.folder_path == current_path,
            FileMetadata.original_name == part,
            FileMetadata.is_directory == True
        ).first()
        if not existing_dir:
            db.add(FileMetadata(
                id=str(uuid.uuid4()),
                container_id=container_id,
                filename="",
                original_name=part,
                file_size=0,
                is_protected=False,
                folder_path=current_path,
                is_directory=True
            ))
            db.flush()
        created_dirs.add(key)
        current_path = f"{current_path}/{part}" if current_path else part
