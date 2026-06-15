import os
import sys
import logging

# PyInstaller 패키징 여부 감지하여 실행 위치 기준 로그 파일 위치 설정
IS_FROZEN = getattr(sys, 'frozen', False)
RUNNING_DIR = os.path.dirname(sys.executable) if IS_FROZEN else os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

LOG_FILE = os.path.join(RUNNING_DIR, "app.log")

# 커스텀 로거 생성
logger = logging.getLogger("fileshare")
logger.setLevel(logging.INFO)

# 핸들러 중복 추가 방지
if not logger.handlers:
    formatter = logging.Formatter('[%(asctime)s] %(levelname)s - %(message)s', datefmt='%Y-%m-%d %H:%M:%S')

    # 파일 핸들러 (UTF-8)
    try:
        file_handler = logging.FileHandler(LOG_FILE, encoding="utf-8")
        file_handler.setFormatter(formatter)
        logger.addHandler(file_handler)
    except Exception as e:
        print(f"[logger.py] Failed to setup file handler: {e}")

    # 콘솔 핸들러
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(formatter)
    logger.addHandler(console_handler)

def get_logger():
    return logger
