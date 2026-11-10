# Cut one frame per `step` seconds from a stretch of one video, reading it straight through:
# seeking to every second separately is far slower than decoding forward once.
# Reads {"url": ..., "start": s, "end": s, "step": s, "outdir": path} on stdin, so the stream
# URL and its token never touch the disk or a command line. Frames are named by their file
# position in ms.
import json
import os
import sys

import cv2

job = json.load(sys.stdin)
capture = cv2.VideoCapture(job["url"], cv2.CAP_FFMPEG,
                           [cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 300000, cv2.CAP_PROP_READ_TIMEOUT_MSEC, 300000])
if not capture.isOpened():
    print(json.dumps({"ok": 0, "error": "could not open"}))
    sys.exit(0)

os.makedirs(job["outdir"], exist_ok=True)
step, end = job["step"], job["end"]
target = job["start"]
capture.set(cv2.CAP_PROP_POS_MSEC, target * 1000.0)
ok = 0
while target <= end:
    read, frame = capture.read()
    if not read:
        break
    pos = capture.get(cv2.CAP_PROP_POS_MSEC) / 1000.0
    # The first frame at or past each whole step; a frame is 1/30 s, well inside a second.
    if pos + 1e-3 >= target:
        out = os.path.join(job["outdir"], f"{round(target * 1000)}.jpg")
        if not os.path.exists(out):
            cv2.imwrite(out, frame, [cv2.IMWRITE_JPEG_QUALITY, 92])
        ok += 1
        target += step
print(json.dumps({"ok": ok, "last": target - step}))
