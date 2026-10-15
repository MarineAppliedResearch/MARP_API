# Builds the favicon: the MARP mark on the platform's navy-900 disc.
#
# The mark is bright cyan and green, which disappears against a light browser
# tab, so it is given a dark ground rather than being recoloured.
#
# The source file carries transparent padding, so it is trimmed to the mark
# itself before scaling -- otherwise the fraction below is measured against the
# padding too and the M comes out far smaller than it reads in the source.
from PIL import Image, ImageDraw

SRC = "frontend/shared/assets/images/marp-mark.png"
OUT = "frontend/shared/assets/images/marp-mark-favicon.png"
DISC = (0x03, 0x10, 0x1F, 255)   # navy-900, from tokens.css
SIZE = 256
FRACTION = 0.80                  # more and the M's legs run past the disc edge

canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
ImageDraw.Draw(canvas).ellipse((0, 0, SIZE - 1, SIZE - 1), fill=DISC)

mark = Image.open(SRC).convert("RGBA")
bounds = mark.getbbox()
if bounds:
    mark = mark.crop(bounds)
mark.thumbnail((int(SIZE * FRACTION), int(SIZE * FRACTION)), Image.LANCZOS)
canvas.paste(mark, ((SIZE - mark.width) // 2, (SIZE - mark.height) // 2), mark)
canvas.save(OUT)
print("wrote", OUT, canvas.size)
