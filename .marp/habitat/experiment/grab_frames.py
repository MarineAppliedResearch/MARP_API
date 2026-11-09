# Cut the requested frames from one video, at full resolution unless told otherwise.
# Reads {"url": ..., "width": 0, "items": [{"position": seconds, "out": path}]} on stdin,
# so the stream URL and its token never touch the disk or a command line.
import json
import os
import sys

import cv2

job = json.load(sys.stdin)
width = job.get("width") or 0
# OpenCV gives up on a stream after 30 s by default; a slow server read is waited out
# instead of counted as a video that could not be opened.
capture = cv2.VideoCapture(job["url"], cv2.CAP_FFMPEG,
                           [cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 300000, cv2.CAP_PROP_READ_TIMEOUT_MSEC, 300000])
if not capture.isOpened():
    print(json.dumps({"ok": 0, "failed": len(job["items"]), "error": "could not open"}))
    sys.exit(0)

ok = failed = 0
for item in sorted(job["items"], key=lambda i: i["position"]):
    capture.set(cv2.CAP_PROP_POS_MSEC, item["position"] * 1000.0)
    read, frame = capture.read()
    if not read:
        failed += 1
        continue
    if width:
        h, w = frame.shape[:2]
        frame = cv2.resize(frame, (width, round(h * width / w)), interpolation=cv2.INTER_AREA)
    os.makedirs(os.path.dirname(item["out"]), exist_ok=True)
    cv2.imwrite(item["out"], frame, [cv2.IMWRITE_JPEG_QUALITY, 92])
    ok += 1

print(json.dumps({"ok": ok, "failed": failed}))
