import os, sys
sys.path.insert(0, ".")
from PIL import Image
import numpy as np

img = Image.open(r"C:/Users/hp/.gemini/antigravity/brain/e1a19586-82fb-4a8c-8e03-57f32dd68e58/scratch/exact_cam_frame.jpg").convert("RGB")
arr_rgb = np.asarray(img, dtype=np.float64)
r, g, b = arr_rgb[:, :, 0], arr_rgb[:, :, 1], arr_rgb[:, :, 2]
cb = -0.1687 * r - 0.3313 * g + 0.5 * b + 128.0
cr = 0.5 * r - 0.4187 * g - 0.0813 * b + 128.0
skin_mask = (cb >= 75.0) & (cb <= 140.0) & (cr >= 130.0) & (cr <= 185.0)

y_idx, x_idx = skin_mask.nonzero()
print(f"Total skin pixels: {len(y_idx)} out of {arr_rgb.shape[0]*arr_rgb.shape[1]} ({len(y_idx)/(arr_rgb.shape[0]*arr_rgb.shape[1]):.2%})")

# Let's save the skin mask as an image to visualize where the skin was detected
mask_img = Image.fromarray((skin_mask * 255).astype(np.uint8))
mask_img.save(r"C:/Users/hp/.gemini/antigravity/brain/e1a19586-82fb-4a8c-8e03-57f32dd68e58/scratch/skin_mask.png")

if len(y_idx) > 0:
    y_min, y_max = np.percentile(y_idx, [2, 98])
    x_min, x_max = np.percentile(x_idx, [2, 98])
    h = y_max - y_min
    w = x_max - x_min
    cy = (y_min + y_max) / 2.0
    cx = (x_min + x_max) / 2.0
    side = max(h, w) * 1.25
    x1 = max(0, int(cx - side / 2))
    y1 = max(0, int(cy - side / 2))
    x2 = min(img.width, int(cx + side / 2))
    y2 = min(img.height, int(cy + side / 2))
    print(f"Face crop: x1={x1}, y1={y1}, x2={x2}, y2={y2}")
    cropped = img.crop((x1, y1, x2, y2))
    cropped.save(r"C:/Users/hp/.gemini/antigravity/brain/e1a19586-82fb-4a8c-8e03-57f32dd68e58/scratch/face_crop.jpg")

